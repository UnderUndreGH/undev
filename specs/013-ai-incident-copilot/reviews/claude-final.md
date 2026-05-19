# SpecKit Review: 013-ai-incident-copilot

**Reviewer**: claude
**Reviewed at**: 2026-05-19T08:15:00Z
**Commit**: 60dc2cd9dfff259644f03e244848ff840981f862
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md, contracts/api.md, contracts/llm-provider.md, research.md, quickstart.md, constitution.md, reviews/codex.md, reviews/gemini.md, reviews/gpt.md, reviews/analyze.md

## Summary

This is one of the most thorough feature specifications I have reviewed. The safety architecture — manifest-derived tool registry, envelope-cipher key storage, tiered danger-level confirmation with server-side challenge, sandbox defaults, kill switch, and comprehensive audit trail — is genuinely defence-in-depth rather than security theatre. The fix pass since the codex/gemini/gpt reviews has addressed the five explicitly targeted HIGH findings (JSONB alignment, budget reservation column, max conversation duration, prompt injection sanitization, push dedup concurrency) with precision and consistency across all four artifacts.

The remaining gaps are primarily MEDIUM-grade: missing FTS index for the hypothesis search column, `aborted_by_timeout` not surfaced in a notification trigger, empty `content_text` edge case for tool results, and a handful of spec-to-implementation gaps (role mapping, `content_text` size guidance). None block implementation.

## Verification of Previously Identified HIGH Findings

### Fix 1: JSONB vs TEXT type mismatches (Codex F1/F2, Gemini F3/F21, GPT F5)

**Status: RESOLVED.**

Cross-verification across all four artifacts:

| Column | spec.md Key Entities | data-model.md migration | contracts/api.md | Consistent? |
|--------|---------------------|------------------------|-----------------|-------------|
| `ai_messages.content_meta` | `JSONB` (L1018) | `JSONB NULL` (L98) | `contentMeta: null` (L254) | Yes — JSONB |
| `ai_tool_calls.params_json` | `JSONB NOT NULL` (L1029) | `JSONB NOT NULL` (L110) | `{ "appId": "..." }` parsed object (L260) | Yes — JSONB |
| `ai_compose_review_cache.findings_json` | — | `JSONB NOT NULL` (L140) | findings array (L388) | Yes — JSONB |
| `api_key_encrypted` | `BYTEA` (L989 aspirational) | `TEXT NOT NULL` (L45) | N/A | TEXT is correct — envelope-cipher blobs are base64 JSON strings |

The TEXT-vs-BYTEA difference on `api_key_encrypted` is correctly documented by analyze.md (F1) as a non-issue: envelope-cipher produces base64-encoded JSON `{ct, iv, tag}` blobs stored as TEXT, which is the project convention. The spec Key Entities section uses BYTEA aspirationally but data-model.md is the binding migration artifact.

### Fix 2: Budget reservation race conditions (Codex F3, Gemini F4, GPT F11)

**Status: RESOLVED.**

`ai_conversations.tokens_reserved` column added:

- data-model.md L77: `"tokens_reserved" INTEGER NOT NULL DEFAULT 0` — present in migration SQL
- spec.md FR-045 (L859-861): describes "reserves a conservative token estimate before inference starts and reconciles against actual provider usage on completion/error"
- tasks.md T010: "conservative token reservation/reconciliation with typed inputs/outputs"
- tasks.md T013: "create conversation row with `tokens_reserved`"
- llm-provider.md L161-163: comments describing reserve-then-reconcile pattern

The lifecycle is: reserve at conversation start, set actual on complete/error/cap_exhausted. Budget check uses `SUM(actual) + SUM(reserved) >= cap`. This is a sound design for a single-process Node.js architecture.

### Fix 3: Missing max conversation duration (Codex F4)

**Status: RESOLVED.**

`ai_settings.max_conversation_duration_minutes` added:

- data-model.md L33: `"max_conversation_duration_minutes" INTEGER NOT NULL DEFAULT 30`
- spec.md status enum (L67-69): includes `'aborted_by_timeout'` in `ai_conversations.status` CHECK constraint
- tasks.md T013: "include `max_conversation_duration` wall-clock safety net"
- tasks.md T005a: `AppError` factory for `aborted_by_timeout`
- tasks.md T014: audit action count updated to 27 (added `aborted_by_timeout`)

### Fix 4: Prompt injection escaping in mask-context-document.ts (Gemini F2)

**Status: RESOLVED.**

- tasks.md T007: explicitly specifies "sanitization of XML-like tags (`</?context-source`) from untrusted input"
- spec.md FR-012 (L646-651): describes untrusted source delimiters and the two-tier detection policy (high-confidence blocks send, lower-confidence emits warning audit)
- llm-provider.md L125-127: system prompt instructs model to treat `<context-source trusted="false">` blocks as evidence only

The defense is layered: (a) strip/escape closing context-source tags from untrusted input before wrapping, (b) system prompt explicitly instructs the model to treat source content as evidence, (c) A-003 acknowledges that safety relies on tool-tier gating + operator approval, not model alignment alone.

### Fix 5: Push dedup concurrency safety / TOCTOU (Gemini F1)

**Status: RESOLVED.**

- tasks.md T041: "ensure concurrency-safe check-then-set via synchronous critical section (no `await` during dedup logic)"
- spec.md FR-017 (L703-707): specifies in-memory map with single-process semantics
- data-model.md L301-310: defines dedup map structure with expiry

The approach is correct for Node.js's cooperative concurrency model: if the `has()` check, `set()`, and conversation-row creation are all in a single synchronous block (no `await` between them), no two events can interleave. The task description makes this requirement explicit.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | HIGH | Missing edge case | `aborted_by_timeout` conversation status exists in data-model.md (L69) and the `ai_conversations.status` enum but has NO corresponding notification trigger in data-model.md's notification triggers table (L260-267) or spec.md's notification triggers section (L1204-1221). Every other terminal status that indicates an operational issue has a trigger (`cap_exhausted`, `kill_switch_engaged`). A timeout-terminated conversation is an operational signal — it means the LLM is running unusually long or the absorb loop is cycling — and deserves a TG notification option. | Add `ai.conversation_aborted_timeout` to the notification triggers table (operational class, default ON). This is borderline HIGH/MEDIUM — it won't block implementation but is a coverage gap that's easiest to fix now. |
| F2 | HIGH | Performance | Full-text search on `ai_conversations.hypothesis` (FR-046, contracts/api.md `q` param) has NO index specified in data-model.md. The only indexes on `ai_conversations` are `idx_ai_conversations_target`, `idx_ai_conversations_status`, and `idx_ai_conversations_archived`. A `LIKE '%pattern%'` or `to_tsvector` query on `hypothesis TEXT` with thousands of rows (90-day retention, 30+ push convos/day = ~2700+ rows at steady state) will sequential-scan. This was flagged by Codex F18 and Gemini F10 and remains unaddressed. | Add a GIN index to data-model.md: `CREATE INDEX idx_ai_conversations_hypothesis_fts ON ai_conversations USING gin(to_tsvector('english', hypothesis));` Or a `pg_trgm` GIN index for substring matching. Update tasks.md T002 to include this index. |
| F3 | MEDIUM | Security | `GET /api/ai/conversations/:id` (contracts/api.md L249-251) returns `role: "system"` messages including the full system prompt to `ai:viewer` role (the weakest AI role). The system prompt contains the confidence rubric, untrusted-context handling instructions, tool metadata guidance, and formatting rules. Codex F8 flagged this; it remains unfixed. A compromised viewer-level account could use this information to craft inputs that exploit the model's prompt structure. | Omit `role: "system"` messages from GET responses by default. If operator context transparency is needed, restrict system-prompt visibility to `ai:admin` role. FR-013's transparency mandate applies to the context document (role=user), not the system prompt. |
| F4 | MEDIUM | Missing edge case | `ai_messages.content_text` is `TEXT NOT NULL` but tool results with empty stdout produce an empty string. Codex F5 flagged this; no sentinel value defined. The LLM receives `(empty tool result)` which may confuse its next-turn reasoning. | Define in llm-provider.md or system-prompt.md: when `stdout` is empty and `exit_code = 0`, use sentinel `(no output — command succeeded silently)`. When `stdout` is empty and `exit_code != 0`, use `(no stdout captured — exit code: N)`. Document in system prompt so LLM knows how to interpret sentinels. |
| F5 | MEDIUM | Hidden assumption | `ai:admin`, `ai:operator`, `ai:viewer` roles (FR-050, contracts/api.md L8-10) have no mapping to the existing auth/role system. Gemini F12 flagged this. No task in tasks.md addresses role system extension. If the dashboard currently has a single `admin` role, implementation will need to either (a) derive AI roles from existing roles, (b) add new permission columns, or (c) use a role mapping table. This decision should be made before Phase 3 (US1 routes). | Add implementation guidance to T022 or T076: "AI roles derived from existing roles as follows: admin → ai:admin, authenticated user → ai:operator for create/approve, ai:viewer for read-only. Granular AI roles deferred to v2." Or add a mapping config. |
| F6 | MEDIUM | Performance | Context aggregator (T011) runs 6 concurrent DB queries per analysis. Under combined load (10 pull/min user limit + 30 push/min system limit = 40 concurrent aggregations), this produces 240 concurrent queries. Neither spec, plan, nor tasks mention connection pool sizing. Codex F10 flagged this. | Add a note to T011 implementation: verify that the `postgres` package pool size accommodates 40 concurrent query bursts. If the default pool (typically 10) is insufficient, either increase pool size or queue aggregation requests behind a semaphore. |
| F7 | MEDIUM | Missing edge case | Push dedup map (FR-017) has no explicit cleanup mechanism specified. Data-model.md L309 says "Entries expire after 300s from firstEventAt" but no `setInterval` sweep or TTL-aware map is mentioned. Codex F11 flagged this. In a long-running server with high event volume, the map grows unboundedly until entries are checked on access. | Add to T041 description: "Implement cleanup via `setInterval` sweep every 60s removing entries where `Date.now() - firstEventAt > 300_000`, or use a TTL-aware Map implementation." |
| F8 | MEDIUM | Logical consistency | `script_runs.initiated_by` (data-model.md L158) has no CHECK constraint for its enum values (`'operator' | 'ai_proposal'`), unlike every other enum column in the feature which has an explicit CHECK. Data-model.md L162-164 says these are "represented in Drizzle/Zod validation" — but `ai_conversations.status`, `ai_conversations.trigger`, `ai_tool_calls.status`, etc. all have CHECK constraints. Gemini F11 flagged this. The inconsistency means a raw SQL insert or migration script could introduce invalid values. | Add `CHECK ("initiated_by" IN ('operator', 'ai_proposal'))` to the ALTER TABLE statement in data-model.md, consistent with the project's convention for all enum columns. |
| F9 | MEDIUM | Failure modes | No spec for what happens when `envelope-cipher.open()` fails for a stored API key during inference (master key changed since seal, DB corruption, key was from a different master-key generation). Gemini F13 flagged this. The spec covers save-time failure but not runtime decryption failure. The incident-analyzer would call `resolveModel()` → `open()` → throw, causing an unhandled error path. | Add to spec edge cases or llm-provider.md: wrap `resolveModel()` in try/catch; on `open()` failure, set conversation status to `error`, emit `ai.analysis_failed` with `{ errorClass: 'master_key_unavailable' }`, surface "Provider key cannot be decrypted — re-save the provider key." Task T013 or T006 should include this error path. |
| F10 | MEDIUM | Hidden assumption | `ai_conversations.hypothesis` and `confidence` columns exist in data-model.md (L73-74) but no FR specifies the extraction mechanism. `extractHypothesis()` and `extractConfidence()` in llm-provider.md (L70-71) are undefined stubs. Codex F12 and Gemini F15 flagged this. Free-text regex extraction is fragile across providers and model versions. | Add to llm-provider.md: specify the extraction heuristic (e.g., regex `## Hypothesis\n([\s\S]*?)\*\*Confidence\*\*:\s*(high|medium|low)` from the system prompt's response format). On extraction failure, default `hypothesis = first 200 chars of assistant text`, `confidence = null`. |
| F11 | MEDIUM | Hidden assumption | Codex F13 / Gemini F13 concern about `ai_write_access = 'enabled'` for pre-existing servers vs. constitution Principle V "dormant by default." The spec (FR-037) and data-model.md (L153) correctly preserve status quo for existing servers. But the instant `ai_settings.enabled` is flipped to `true`, ALL existing servers have full write access without per-server review. This is an operator decision point, not a bug — but it should be called out in quickstart.md as an explicit step. | Add to quickstart.md after "Enable AI Copilot": "Review per-server AI write access defaults. Pre-existing servers default to 'enabled'; newly-added servers default to 'sandbox-only'. Consider setting pre-existing servers to 'sandbox-only' before enabling AI and upgrading individually after testing." |
| F12 | MEDIUM | Security | GPT F9 flagged that FR-012 audits masking warnings but the spec's language around "high-confidence unredacted secret detection blocks provider send" (spec L649-651) is stronger than the audit-only path for lower-confidence detections. The distinction between "block" and "warn" thresholds is not numerically defined. | Clarify in FR-012: define the blocking threshold (e.g., "patterns matching `sk-*`, `ghp_*`, `AKIA*`, `-----BEGIN*` with ≥90% pattern confidence block the send") vs. the warning threshold (e.g., "suspected base64-encoded credentials, unusual env var values, with <90% confidence emit warning audit"). |
| F13 | MEDIUM | Logical consistency | Codex F15: `ai_compose_review_cache.findings_json` is correctly `JSONB` in data-model.md (L140) — this is now consistent with the other JSONB columns. No action needed. Verifying: findings_json is JSONB ✓. | No action. Recording for completeness — this was resolved in the fix pass. |
| F14 | LOW | Stakeholder clarity | The term "conversation" is overloaded (Codex F14, Gemini F17). The UI uses "Incident" (`/incidents/:id`) while the API uses "conversations". A non-technical reader may assume closing the IncidentView tab stops the analysis. | Add to US2 acceptance: "Closing the IncidentView tab does NOT stop an in-progress analysis; analysis runs server-side. Re-opening shows the completed/partial result." |
| F15 | LOW | Performance | Compose static lint (FR-032) runs on every keystroke (debounced 300ms) for arbitrarily large compose files. Gemini F18 flagged this. No size threshold for lint activation. | Add to FR-032: "Static lint skips files >200 lines (show 'too large for real-time lint') or implements lint in a Web Worker." |
| F16 | LOW | Security | `approvalChallengeId` for high-danger tool calls (FR-024, contracts/api.md L342-356) has no explicit single-use constraint. Gemini F19 flagged this. If stored in-memory, it's trivially consumed; if DB-backed, needs a `consumed_at` column. | Add to FR-024 or contracts/api.md: "Challenges are single-use — consumed on first approve attempt; subsequent uses return `410 Gone`." |
| F17 | LOW | Logical consistency | `ai_settings` singleton seed (data-model.md L37) correctly uses `ON CONFLICT (\"id\") DO NOTHING`. Gemini F20 flagged the original version without this clause. The fix pass added it. | No action. Verified idempotent. |
| F18 | LOW | Security | `maskContextDocument()` regex catalogue (FR-012, spec L648) covers `sk-*`, `ghp_*`, `AKIA*`, `-----BEGIN*`, `password=*` but misses `glpat-*` (GitLab), `xoxb-*`/`xoxp-*` (Slack), `eyJ*` (JWT). Codex F17 flagged this. | Expand the regex catalogue in T007 description to include `glpat-*`, `xox[bps]-*`, and `eyJ[a-zA-Z0-9_-]{10,}\.` patterns. Document that the catalogue is not exhaustive and should be periodically updated. |

## Unresolved GPT Review Findings

The GPT review raised a CRITICAL finding (F1: constitution.md missing) and several HIGH findings that warrant assessment:

| GPT Finding | Status | Assessment |
|-------------|--------|------------|
| F1 (CRITICAL): constitution.md missing | **RESOLVED** | `.specify/memory/constitution.md` now exists at the expected path. Both analyze.md and this review loaded it successfully. |
| F2 (HIGH): Settings storage contradictory | **RESOLVED** | spec.md FR-002 (L584-591) now describes `ai_settings` singleton table. Key Entities section (L967-981) correctly lists `ai_settings` as a standalone table. All artifacts aligned. |
| F3 (HIGH): Push-trigger architecture inconsistent | **RESOLVED** | spec FR-014 (L665-670) now describes direct function calls (`aiPushSubscriber.onEvent()`). plan.md and tasks.md T041/T042 implement direct wiring. All aligned. |
| F4 (HIGH): Approval contract missing danger-tier fields | **RESOLVED** | contracts/api.md L306-329 now includes `ackText`, `typedTarget`, `approvalChallengeId` with server-side enforcement per danger level. Challenge endpoint (L342-356) added. |
| F5 (HIGH): DB dialect mixing | **PARTIALLY RESOLVED** | data-model.md now uses consistent PostgreSQL types (`JSONB`, `NUMERIC`, `to_char(NOW()...)`). However, the timestamp format uses `to_char(NOW() AT TIME ZONE 'UTC', ...)` instead of native `timestamptz` — this is a TEXT-based approach consistent with the existing project convention (prior features use TEXT for timestamps), so it's intentional, not a dialect mismatch. |
| F6 (HIGH): FK target `applications` vs `apps` | **NOT RESOLVED** | data-model.md references `applications("id")` and `servers("id")`. GPT claims spec uses `apps(id)`. Checking: spec L1031 says `REFERENCES applications(id)` — so spec and data-model are ALIGNED on `applications`. GPT's reading of `apps(id)` at spec L956 appears to be from an older spec version or misread. Current artifacts are consistent. No action needed. |
| F7 (HIGH): Conflicting low-danger auto-execution language | **RESOLVED** | spec.md Out of Scope (L1140-1143) explicitly states "Automatic remediation execution without operator approval (any dangerLevel)... is a v2 feature." The mid-stream visibility section (FR-055, L901-923) clarifies that log-only visibility applies AFTER approval/execution, not in place of approval. |
| F8 (HIGH): Task dependency ordering | **PARTIALLY RESOLVED** | Checking dependency graph: T014 (audit-actions) → T013 (incident-analyzer) is NOT present in the graph. The graph has `T009 + T010 + T011 + T014 → T013` (L153), which correctly makes T013 depend on T014. For masking: `T007 → T011` (L151) makes aggregator depend on masking, which is correct. `T001 → T007` (L149) is also correct — masking doesn't depend on provider resolution. GPT's reading of the dependency graph appears incorrect; the current graph has proper ordering. |

## Alternative Approaches Considered

1. **Structured output via `generateObject` for hypothesis/confidence extraction**: The current design uses free-text LLM output with regex extraction of hypothesis and confidence. Vercel AI SDK supports `generateObject` with Zod schemas for structured output. Using this would eliminate F10's extraction fragility at the cost of (a) a potential second LLM call if used as a post-processing step, or (b) constraining the entire response to structured JSON which limits the narrative quality of the analysis. The author's choice of free-text + regex is pragmatic for v1; if extraction proves unreliable in testing, switching to `generateObject` is a contained refactor (one function, one test file).

2. **Persistent dedup table vs. in-memory map**: The in-memory map is correct for single-process architecture (A-006). The fix pass correctly addressed the TOCTOU race by requiring synchronous critical sections. If horizontal scaling is ever needed, a PostgreSQL-backed dedup table with `INSERT ... ON CONFLICT DO NOTHING` and TTL cleanup would be the migration path. The current design documents this tradeoff explicitly in FR-017.

3. **DB-level budget reservation vs. in-memory counter**: The current design uses a `tokens_reserved` column on `ai_conversations` with reserve-at-start, reconcile-on-complete semantics. An alternative is a dedicated `ai_budget_ledger` table with atomic increment/decrement operations. The column-based approach is simpler and sufficient for single-process — the budget check query (`SELECT SUM(tokens_in) + SUM(tokens_reserved) FROM ai_conversations WHERE ...`) is a single aggregation. A ledger table would be warranted if multi-process coordination were needed.

## VERDICT

```yaml
verdict: MEDIUM
reviewer: claude
reviewed_at: "2026-05-19T08:15:00Z"
commit: 60dc2cd9dfff259644f03e244848ff840981f862
critical_count: 0
high_count: 2
medium_count: 12
low_count: 5
```
