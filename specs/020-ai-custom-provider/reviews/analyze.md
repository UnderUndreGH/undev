# SpecKit Analyze Report: 020-ai-custom-provider

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: specs/017-022
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

---

## Detection Passes

### 1. Duplication Detection

- **FR-003a (SSRF Protection)** in spec.md and **plan.md "URL Validation Layer"** section describe the same SSRF defense (dual-point validation: config-time + fetch-time, DNS rebinding mitigation, ALLOW_LOCAL_AI_ENDPOINTS override). Spec provides requirements; plan provides implementation details. Complementary, consistent.
- **FR-002 (optional API keys)** in spec.md and **data-model.md migration** (`ALTER COLUMN api_key_encrypted DROP NOT NULL`) both address nullable API keys. Tasks.md T002 also includes this migration. All three consistent.
- **Azure OpenAI exclusion**: spec.md explicitly marks as OUT OF SCOPE with dedicated assumption. plan.md DEFERRED note matches. tasks.md has no Azure-specific tasks. Consistent exclusion.

No problematic duplication. Cross-artifact references are aligned.

### 2. Ambiguity Detection

- **FR-003a**: "Override available via `ALLOW_LOCAL_AI_ENDPOINTS=true` server env var with mandatory audit log entry per request when the override is in effect." Clear — each request through local endpoint gets an audit entry.
- **FR-002**: "API key is OPTIONAL for openai-compatible providers — some local endpoints (LM Studio, Ollama) accept any value or empty string." The distinction between "empty string" and "null" for the api_key column is addressed by the nullable migration. Clear.
- **T006 (test connectivity)**: "using `max_completion_tokens: 5` (newer field, falls back to `max_tokens: 5` if 400 error). If both fail, attempt minimal stream-test." The fallback chain is well-specified. Not ambiguous.

### 3. Underspecification Detection

- **DNS rebinding mitigation**: FR-003a says "re-validate at request time, not just config time, to prevent DNS rebinding." Plan.md T006c specifies "re-resolve hostname to catch DNS rebinding." However, neither specifies the TTL window or whether to pin the resolved IP for the duration of the request. The re-resolve approach is standard; full IP pinning is an implementation detail. LOW concern.
- **Audit entry schema for SSRF override**: FR-003a mandates audit entries when `ALLOW_LOCAL_AI_ENDPOINTS` is active, but the audit entry structure (table, fields) is not defined. This could use the existing audit system from 019 or a separate log. MEDIUM concern — needs an audit destination.
- **Error message for Azure OpenAI URLs**: spec.md assumption says "Users attempting Azure OpenAI URLs will receive a helpful error message directing them to the future provider type." No task covers URL pattern detection for Azure OpenAI. LOW — nice-to-have, not a core requirement.

### 4. Constitution Alignment

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Operator safety first | PASS | Test connectivity before committing; SSRF protection prevents internal network access |
| II. Secrets never leak | PASS | API keys encrypted at rest (AES-256-GCM, existing pattern); api_key_encrypted nullable but still encrypted when present |
| III. Reviewable database changes | PASS | Migration as .sql file (020-add-endpoint-url.sql) |
| IV. Typed boundaries | PASS | Zod validation on provider config; new provider type enum; URL validation |
| V. Feature flags and rollback posture | PASS | New provider type is additive; existing providers unaffected; nullable column is backward-compatible |
| VI. Independent review gate | DEFERRED | Noted in plan.md constitution check |
| VII. Snapshot stages | N/A | No snapshot tooling |

No MUST violations found. SSRF protection (FR-003a) is well-specified and addresses the security concern.

### 5. Coverage Gaps

**FR → Task coverage**:
- FR-001 (openai-compatible type): T002 (enum), T004 (factory), T008 (UI selector) ✅
- FR-002 (optional API keys): T002 (nullable migration + Zod schema) ✅
- FR-003 (URL format validation): T005 (CRUD routes validate URL) ✅
- FR-003a (SSRF protection): T006a (validator module), T006b (config-time), T006c (fetch-time), T006d (override) ✅
- FR-004 (Anthropic custom URL): T004 (factory update), T007 (UI field) ✅
- FR-005 (test connectivity): T006 (endpoint), T009/T010 (UI) ✅
- FR-006 (API key encryption): Existing pattern, no new task needed ✅
- FR-007 (endpoint URL field in UI): T007 ✅
- FR-008 (pass URL + key at invocation): T004 (factory) ✅

**SC → Task coverage**:
- SC-001 (configure in 2 min): Functional flow covered by T001-T010. No timing test. LOW.
- SC-002 (same latency bounds): Architectural — uses same SDK pattern. No perf test. LOW.
- SC-003 (test connectivity <10s): T006 implements with latency measurement. T014 verifies. ✅
- SC-004 (zero regression): T011 explicitly verifies all existing providers. ✅

All FRs have task coverage. NFR (performance) criteria lack dedicated test tasks — LOW.

### 6. Inconsistency Detection

- **spec.md FR-002**: "api_key_encrypted column is nullable" → **data-model.md**: `ALTER TABLE ai_provider_keys ALTER COLUMN api_key_encrypted DROP NOT NULL` → **tasks.md T002**: includes this ALTER statement. Consistent.
- **spec.md FR-003a**: SSRF denylist ranges (10/8, 172.16/12, 192.168/16, 169.254/16, fe80::/10, 127/8, ::1, 100.64/10) → **tasks.md T006a**: lists same ranges. Consistent.
- **spec.md**: Azure OpenAI OUT OF SCOPE → **plan.md**: DEFERRED → **tasks.md**: No Azure tasks. Consistent.
- **plan.md**: "Test connectivity sends a minimal chat completion request (e.g., 'Hi' with max_tokens=1)" → **tasks.md T006**: "payload 'ping' using `max_completion_tokens: 5`". Minor wording difference (Hi/ping, 1/5 tokens) but the implementation intent is the same — minimal request. LOW inconsistency, functionally irrelevant.
- **data-model.md**: `endpointUrl TEXT` (nullable) → **spec.md**: "optional `endpointUrl` field". Consistent.
- **Dependency graph**: T002 → T004, T002 → T006a. But T006a → T006b, T006c. T006c → T004 (fetch-time validation before factory use). This creates a dependency chain: T002 → T006a → T006c → T004. But T002 also directly → T004. This means T004 can't start until T006c completes (via T006c → T004), which is correct — factory needs fetch-time wrapper. No inconsistency, just a transitive dependency.

### 7. Agent Routing Validation

- **Lane 1 [DB]**: T001 → T003. Correct.
- **Lane 2 [BE] types**: T002 independent. Correct — type/enum setup can start immediately.
- **Lane 3 [BE] factory**: T004 → T005, T006. Blocked by T001-T003. Correct.
- **Lane 4 [FE] API**: T010 blocked by T006 (test endpoint must exist first). Correct.
- **Lane 5 [FE] UI**: T007, T008, T009 blocked by T005, T006. Correct.
- **Lane 6 verify**: T011-T014 blocked by implementation. Correct.

**Dep graph self-check**: All task IDs in dependencies exist in task list. No circular dependencies. No orphan tasks. Fan-in uses `+`, fan-out uses `,`. Validated.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A020-F1 | MEDIUM | Underspecification | Audit destination for SSRF override entries (FR-003a) not specified — needs audit table or log destination |
| A020-F2 | LOW | Coverage | SC-001/SC-002 performance criteria lack dedicated perf test tasks |
| A020-F3 | LOW | Inconsistency | Plan says max_tokens=1, tasks.md T006 says max_completion_tokens=5 — minor wording drift in test payload description |
| A020-F4 | LOW | Underspecification | DNS rebinding IP-pinning duration not specified (standard re-resolve approach assumed) |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 1 | LOW: 3

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| AG-F1 (CRITICAL) | CRITICAL | Resolved: SSRF protection added as FR-003a with URL denylist, DNS rebinding mitigation, dual-point validation (config-time + fetch-time), ALLOW_LOCAL_AI_ENDPOINTS override with audit. Tasks T006a-d implement full defense. |
| AG-F2 (HIGH) | HIGH | Resolved: `api_key_encrypted` made nullable in data-model.md migration and tasks.md T002. Zod schema updated to `apiKey: z.string().min(1).optional()`. |
| AG-F3 (HIGH) | HIGH | Resolved: Azure OpenAI explicitly marked OUT OF SCOPE in spec.md, plan.md, and tasks.md. Clear deferred note. |
| AG-F4 (MEDIUM) | MEDIUM | Resolved: T006 test connectivity uses `max_completion_tokens` with fallback to `max_tokens` for quirky models. |

All Antigravity findings from round 1 have been addressed. Current analysis finds only one MEDIUM and three LOW items.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T14:00:00Z"
commit: 7324438
```
