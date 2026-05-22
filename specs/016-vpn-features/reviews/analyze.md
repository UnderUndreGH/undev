# SpecKit Analyze: 016-vpn-features

**Reviewer**: analyze (Claude self-consistency)
**Reviewed at**: 2026-05-22T23:09:08Z
**Commit**: c639083b00877e9f309850e6d94867172378ca27
**Artifacts**: spec.md, plan.md, tasks.md, data-model.md, research.md, quickstart.md
**Reference**: `.specify/memory/constitution.md`, existing `devops-app/server/db/schema.ts`

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| C1 | Inconsistency | CRITICAL | data-model.md:5–22; existing `schema.ts:14–54` | Spec proposes **new** `servers` table with columns (`name`, `ipAddress`, `sshPort`, `username`, `encryptedPassword`, `encryptedPrivateKey`, `storeCredentials`, `vpnStatus`, `driftStatus`). DB already has `servers` table from Features 005/006/008/009/011/013 with columns (`label`, `host`, `port`, `sshUser`, `sshAuthMethod`, `sshPrivateKey`, `sshPasswordEncrypted`, `sshKeyFingerprint`, `setupState`, `aiReadAccess`, `aiWriteAccess`, …). Same table name, different schema, different types (`text` vs `varchar`/`uuid`). T002 `CREATE TABLE servers` will fail or wipe existing data. | Rewrite T002 as **ALTER**: reconcile column names (reuse `host`/`port`/`sshUser`), map new fields onto existing (`encryptedPassword` → reuse `sshPasswordEncrypted` envelope blob format). Update data-model.md to extend existing schema, not redefine it. |
| C2 | Inconsistency | CRITICAL | data-model.md:107–122; existing `schema.ts:350–387` | Spec proposes `script_executions` table for FR-013. Existing `script_runs` table (Feature 005) already records `scriptId`, `serverId`, `status`, `params`, `exitCode`, `startedAt`, `finishedAt`, `outputArtifact`, `errorMessage`, `logFilePath`, `aiConversationId`, `aiToolCallId`. New table would be a second source-of-truth for the same concept. | Reuse `script_runs`. Add `output` column or repurpose `logFilePath`/`outputArtifact`. Drop `script_executions` from data-model.md. Update T003 accordingly. |
| C3 | Constitution Alignment | CRITICAL | plan.md:24–33; constitution.md:V | **Principle V (Feature flags and rollback posture)** completely unaddressed. Plan's Constitution Check section lists I, II, III, IV, VI but skips V and VII. VPN install/SSH exec is a high-blast-radius risky feature — MUST be dormant by default. No env-gated rollout, no per-server `vpn_enabled` switch, no kill-switch for script execution. | Add Principle V check to plan: gate VPN routes behind `FEATURE_VPN_ENABLED=1`; gate script execution behind explicit per-server `scripts_enabled` flag. Add T-task `[OPS]` for feature-flag wiring. |
| C4 | Coverage Gap / Security | CRITICAL | tasks.md:80 (T017); spec.md:114 (FR-012); constitution.md:II | T017 creates `WS /ws/executions/:executionId` for real-time output streaming with NO auth/authz task. WebSocket protocol in data-model.md:240–247 has no token/cookie/header. Anonymous client → can subscribe to any execution → leaks command output (which may contain secrets per script body) → violates Principle II "Secrets never leak". | Add task `[SEC] [US4] Enforce session-token gate on WS handshake and bind executionId to current user`. T028 SEC review must include WS. |
| C5 | Inconsistency / Security | CRITICAL | plan.md:21; quickstart.md:9–12; existing `schema.ts:34–35` | Plan picks AES-256-GCM with **single** `ENCRYPTION_SECRET_KEY` from `.env` (quickstart). Existing codebase uses **envelope cipher** per-secret blob `{ ct, iv, tag }` (`sshPrivateKeyEncrypted`, `sshPasswordEncrypted`, `envVarsEncrypted`, Feature 011/013 KMS pattern). Two competing crypto layers will diverge → key-rotation breakage, dual decryption paths, audit holes. | Drop new `crypto.ts` design. Reuse existing envelope-cipher helper (resolver-provider service from Feature 013 region of context). Update T005 to "wire VPN credential fields to existing envelope cipher; do not introduce parallel scheme." |
| C6 | Coverage Gap | CRITICAL | spec.md:109 (FR-007); tasks.md (no task) | FR-007 "System MUST support connecting to existing Amnezia VPN servers without re-installation" has **zero tasks**. T002–T010 only cover create+install path. No detection logic (is VPN already installed?), no skip-install branch. | Add task `[BE] [US1] Implement installation-detection probe in /api/servers; skip install when present (FR-007)`. |
| H1 | Coverage Gap | HIGH | spec.md (no E2E mention); plan.md:18 (Playwright); tasks.md (no [E2E] tag) | Plan declares Playwright as testing tool. Tasks.md has **zero `[E2E]`, zero `[TEST]`** tasks despite 5 user stories with explicit "Independent Test" scenarios. Spec acceptance scenarios are not testable. | Add Phase 5.5 / Phase 8.5 `[E2E]` tasks per story (US1–US5). Add unit-test `[TEST]` tasks for `script-parser.ts`, `crypto.ts`, `script-indexer.ts`. |
| H2 | Ambiguity / Inconsistency | HIGH | plan.md:20 ("Performance Goals: N/A"); spec.md:132 (SC-001 ≤3min); spec.md:135 (SC-004 ≤2s) | Plan declares Performance Goals as **N/A**. Spec has measurable SC-001 (≤3 min add-VPS) and SC-004 (≤2 s execution start). Direct contradiction — both files are sources of truth. | Update plan.md Technical Context with actual perf targets from SC-001/SC-004. Add `[PERF]` task to validate SC-004 streaming latency. |
| H3 | Terminology Drift | HIGH | spec.md:103 (`IP, User, Password, Private Key, Port`); data-model.md:13 (`ipAddress, username, sshPort`); existing schema (`host, sshUser, port`) | Three different naming conventions for the same fields across three layers. Frontend `ServerForm.tsx` (T009) will not know which to use. Migration path unclear. | Pick existing schema names (`host`, `sshUser`, `port`). Update spec FR-001 and data-model.md to match. Add note for users: API uses `host`, UI label says "IP Address". |
| H4 | Coverage Gap / Logic Conflict | HIGH | spec.md:108 (FR-006 forget creds); spec.md:115 (FR-008 drift); tasks.md:115 (T026 drift poller) | Drift detection requires recurring SSH login. If user chose `storeCredentials=false`, server has no credentials. T026 design does not specify the "forget" branch. Drift detector will fail silently or crash on null credentials. | Spec: clarify drift behavior when credentials forgotten (set `driftStatus='unknown'`). Task: T026 must include null-credentials guard. |
| H5 | Constitution Alignment | HIGH | constitution.md:VII; tasks.md (no snapshot tags) | Principle VII requires snapshot-stage tags per major SpecKit phase. No evidence `<stage>/016-vpn-features/v1` tags were created for /specify, /plan, /tasks stages. | Verify `snapshot-stage.ps1` was run after each stage. If not, retroactively tag or document the gap in retrospective. |
| H6 | Security / Underspecification | HIGH | research.md:99 ("/tmp/script-<id>.sh") | Script content written to predictable remote path `/tmp/script-<id>.sh`. Symlink-race attack vector if `id` is sequential or guessable. No `mktemp` + 0700 perms + post-run cleanup mentioned. | Use `mktemp -p /tmp script.XXXXXX.sh`, chmod 700, `trap rm -f $TMP EXIT`. Spec edge cases miss this. Add to T015 description. |
| H7 | Underspecification | HIGH | research.md:64 (regex) | Annotation regex `^#\s*@param\s+(\w+):(\w+(?::[\w,]+)?):([^:]*):(.*)$` forbids `:` in defaults (segment is `[^:]*`). Conflicts with research note "Description with colons → only split on first 4 segments". Also no max-length, no escaping. Spec FR-014 doesn't pin the grammar. | Pin a single grammar in spec: e.g., `# @param NAME:type[(opts)]:default:description` where `default` is empty-or-non-colon, OR introduce quoting. Document in spec + add unit tests. |
| H8 | Coverage Gap | HIGH | spec.md:130 (SC-006 "one application restart"); tasks.md:78 (T014 startup only) | SC-006 requires new `.sh` in `scripts/` to appear in UI **within one restart**. T014 runs indexer once at startup. No watcher, no re-index API surfaced to UI (`/api/scripts/reindex` exists in data-model but no FE button). | Either add FS watcher (`chokidar`) task, OR add FE button to call `/api/scripts/reindex`. Pick one in plan. |
| H9 | Coverage Gap | HIGH | spec.md:108 (FR-006 secrets); tasks.md:126 (T028 SEC) | T028 depends on T007 only. Should also depend on T005 (crypto) and T006 (ssh) — those are the primary attack surface. Currently SEC review can't read encryption implementation before reviewing. | Update dependency: `T005 + T006 + T007 + T015 + T017 → T028`. |
| H10 | Coverage Gap | HIGH | spec.md:122 ("Key Entities" lists Server/Script/ScriptExecution only); data-model.md:93 (script_params table) | `script_params` is a fourth entity introduced by data-model but absent from spec.md Key Entities. Spec is missing the abstraction. | Add `ScriptParam` to spec Key Entities. Define cardinality (1 Script → 0..N ScriptParam). |
| H11 | Coverage Gap | HIGH | spec.md (no rate-limit); tasks.md (no throttle task) | Script execution is an unauthenticated-on-WS, expensive-on-remote operation. No rate limit, no per-user cap, no per-server concurrent-execution guard. Server flood = DoS or burning customer's SSH MaxStartups. | Spec: add NFR "Max N concurrent executions per server". Task: `[BE] Add rate-limiter middleware on POST /api/scripts/:id/execute`. |
| H12 | Inconsistency | HIGH | tasks.md:26 ("Create `Server` model"); existing schema | T002 description says "Create" — but `servers` already exists. Engineer following tasks.md literally may `DROP TABLE servers; CREATE TABLE servers ...` and torch Features 005, 006, 008, 009, 011, 013 data. | Rename T002: "Extend existing `servers` table — add VPN-specific columns (`vpnStatus`, `driftStatus`); reuse existing SSH credential columns". |
| H13 | Routing / Lane Conflict | HIGH | tasks.md:26,27 (T002, T003 both touch `server/db/schema.ts`) | Two `[DB]` tasks edit the same file. Tasks.md Self-Validation §3 checks orphans but doesn't check shared-file race. Parallel Lanes table puts both in Lane 2 sequentially → OK, but rule G in /analyze checks for cross-agent shared-file conflicts. Here it's same agent so MEDIUM not CRITICAL. | Acceptable as-is (same agent, sequential in Lane 2). Document explicitly: "T002 must complete before T003 because both modify schema.ts." |
| H14 | Coverage Gap | HIGH | spec.md:42 (US3 mentions "self-service environments, drift detection, and basic resource cost tracking"); tasks.md (only T026/T027) | US3 has 3 features: self-service, drift, cost-tracking. Tasks only cover drift. Self-service and cost-tracking unmapped. | Either drop sub-features from US3 acceptance scenarios, OR add tasks. Recommend drop — US3 is P3 and overscoped. |
| H15 | Security / Underspecification | HIGH | existing schema.ts:48–51 (`aiReadAccess`, `aiWriteAccess`); spec.md (no interaction) | Existing `servers` table has Feature 013 AI access columns. Does VPN feature respect them? Can AI Copilot execute VPN-install scripts on a server with `aiWriteAccess='disabled'`? Spec is silent. | Add FR: "Script execution from AI proposals MUST honor `aiWriteAccess` per-server. VPN-install scripts MUST require operator confirmation regardless." Cross-reference Feature 013 danger-tier framework. |
| M1 | Underspecification | MEDIUM | research.md:14–18 ("we don't have the exact Amnezia binaries"); spec.md FR-002 | "Trigger Amnezia VPN installation payload" — what payload exactly? Research admits unknown. FR-002 reads as definite. Whole MVP could ship a mock. | Spec: define the exact installation contract (e.g., "execute `scripts/vpn/install-amnezia` over SSH"; the script's contents are out-of-scope). Plan: same. |
| M2 | Coverage Gap | MEDIUM | spec.md edge case "two scripts with same path in FS and DB" (line 97); research.md:48 ("filesystem wins"); tasks.md (no task) | Edge case is in spec, resolved in research, but no specific task ensures the precedence is enforced. T014 description is generic. | Update T014 description to include "on path collision, filesystem source overwrites DB-sourced row (set source='filesystem')". |
| M3 | Underspecification | MEDIUM | data-model.md:115 (`output` text, unbounded) | `script_executions.output` is unbounded `text`. A noisy script (`tail -f`) → blows up Postgres row → killing other queries via TOAST inflation. | Either cap output at e.g. 1 MB (truncate with marker), OR offload to file like `script_runs.logFilePath`. Pick the latter for consistency with C2. |
| M4 | Underspecification | MEDIUM | spec.md FR-006; data-model.md:17 (`storeCredentials`) | When `storeCredentials=false`, what's the lifetime? Used once for VPN install, then nulled? Held for the SSH session only? Spec says "securely discard". No mechanism specified. | Define: `storeCredentials=false` → credentials NULL-ed immediately after install completes (success OR failure). Add task to wipe in `finally` block. |
| M5 | Inconsistency | MEDIUM | data-model.md:86 (`# @description` annotation); research.md:78 (example uses `# @description`); tasks.md T013 (only `@param`) | T013 description says "parse `# @param`" only. But data-model assumes `description` is also parsed. | Update T013: "parse `@param` and `@description` annotations". |
| M6 | Routing | MEDIUM | tasks.md:213 (Parallel Lanes Lane 6 [SEC] T028); tasks.md:215 (Lane 3 [BE]) | T026 (drift poller) is labeled [BE] but is more aligned with [OPS] (recurring background job). T028 in Lane 6 but Lane 6 doesn't show in Agent Summary as a distinct flow. | Re-tag T026 as `[OPS]` or `[BE]` with note "background job, see [OPS] §server-management skill". Minor — won't block. |
| M7 | Coverage Gap | MEDIUM | tasks.md:127 (T029); quickstart.md (entire file) | T029 depends only on T001. Quickstart covers full system. T029 should wait for all FE+BE done. | Update: `T010 + T012 + T022 + T027 → T029`. |
| M8 | Underspecification | MEDIUM | data-model.md:19 (`driftStatus` enum: `in_sync, drifted, unknown`); spec.md FR-008 | Spec only mentions binary drift. Data-model adds `unknown`. No spec coverage for when `unknown` appears (never-connected? credentials forgotten? error?). | Add to spec: "drift state machine = in_sync | drifted | unknown (when credentials forgotten or first contact pending)". |
| M9 | Routing | MEDIUM | tasks.md:202 (T028 in Critical Path); T028 has 0 dependents | T028 is SEC review and depends on T007, but nothing else depends on T028. Means implementation can ship before SEC review completes. | Add: `T028 → /speckit.review` (implicit gate). Document that T028 must PASS before /speckit.implement. |
| M10 | Inconsistency | MEDIUM | spec.md FR-018 ("custom scripts through the UI, stored in DB"); data-model.md:87 (`source: 'database'`); tasks.md T016 (PUT/POST/DELETE) | API allows full CRUD on scripts, but spec doesn't say filesystem scripts are read-only via UI. Data-model.md:186 hints "filesystem scripts are read-only via API" but spec FR-018 doesn't constrain. | Add FR-018a: "Filesystem-sourced scripts MUST NOT be editable or deletable via API (read-only)". |
| L1 | Style | LOW | plan.md:6 ("This template is filled in by …") | Boilerplate template instruction left in plan.md. | Strip. |
| L2 | Style | LOW | spec.md:1 ("Status: Draft") | Status still "Draft" at /analyze stage. Should be "Ready for Review" or similar. | Update Status. |
| L3 | Style | LOW | tasks.md:158–164 (Self-Validation Checklist all `[x]`) | Self-checks are pre-checked. No evidence the checks ran. | Either remove the checklist or document the manual run. |
| L4 | Style | LOW | quickstart.md:10 (`ENCRYPTION_SECRET_KEY="your-32-byte-secret-key-here-!!!"`) | Placeholder looks like a real key (32 chars). Could be copy-pasted by careless operator into production. | Use obvious-placeholder: `<REPLACE_WITH_32_BYTE_RANDOM>`. |
| L5 | Style | LOW | tasks.md:6 ("# Tasks: Amnezia VPN…") | Tasks file doesn't reference the existing Feature 013/011 context (AI integration, envelope encryption). | Add note in Phase 1 (T001): "Audit existing `servers`/`script_runs` schema before extending." |

(Total: 35 findings. No overflow.)

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 add-server-form | ✅ | T007, T009 | OK |
| FR-002 trigger-vpn-install | ⚠️ | T006, T007 | Payload undefined (M1) |
| FR-003 list-servers | ✅ | T007, T010 | OK |
| FR-004 delete-server | ✅ | T011, T012 | OK |
| FR-005 confirm-delete | ✅ | T012 | UI dialog |
| FR-006 store-or-forget-creds | ⚠️ | T005, T007 | Forget-branch lifetime ambiguous (M4) |
| FR-007 connect-existing-vpn | ❌ | — | **No task** (C6) |
| FR-008 drift-visual-alert | ✅ | T026, T027 | OK |
| FR-009 dual-source-scripts | ✅ | T014 | Collision rule unclear (M2) |
| FR-010 script-tree-ui | ✅ | T019 | OK |
| FR-011 execute-any-script | ✅ | T015, T016 | OK |
| FR-012 stream-output-realtime | ⚠️ | T015, T017, T020 | WS auth missing (C4) |
| FR-013 exit-code-final-output | ✅ | T015, T020 | OK |
| FR-014 parse-param-annotations | ⚠️ | T013 | Regex incomplete (H7); no `@description` (M5) |
| FR-015 render-dynamic-form | ✅ | T023 | OK |
| FR-016 pass-env-vars | ✅ | T015, T025 | OK |
| FR-017 prefill-defaults | ✅ | T024 | OK |
| FR-018 custom-scripts-via-ui | ⚠️ | T016, T021 | No read-only constraint on FS scripts (M10) |
| SC-001 add-vps-≤3min | ❌ | — | No perf task |
| SC-002 delete-≤2-clicks | ✅ | T012 | UX |
| SC-003 cleanup-local-only | ✅ | T011 | API design |
| SC-004 exec-≤2s-streaming | ❌ | — | No perf task (H2) |
| SC-005 zero-fe-code-changes | ✅ | T023 | Pattern OK |
| SC-006 fs-hot-reload | ❌ | — | No watcher/reindex-button (H8) |

**Coverage**: 19 of 24 requirements/criteria have ≥1 task (79%). 5 unmapped or only partially mapped.

## Constitution Alignment Issues

- **Principle V (Feature flags and rollback posture)**: NOT addressed in plan.md Constitution Check. VPN install + arbitrary script execution are high-risk; must be flag-gated. → **C3**
- **Principle VII (Snapshot stages)**: Plan doesn't confirm snapshot tags were created. → **H5**
- **Principle II (Secrets never leak)**: WS endpoint has no auth → output containing secrets leaks. → **C4**
- **Principle IV (Typed boundaries)**: Spec doesn't mention Zod schemas, but plan.md Constitution Check claims Zod will be used. No task explicitly creates the Zod schemas — implicit only. MEDIUM, treat as documentation gap.

## Unmapped Tasks

(All 29 tasks map to at least one requirement, story, or constitution principle. No orphan tasks.)

## Metrics

- Total Requirements (FR + SC): 24
- Total Tasks: 29
- Coverage % (requirements with ≥1 task): **79%** (19/24)
- Ambiguity count: 6 (M1, M3, M4, M5, M8, H7)
- Duplication count: 2 (C1 servers table, C2 script_executions vs script_runs)
- CRITICAL count: **6**
- HIGH count: **15**
- MEDIUM count: **10**
- LOW count: **5**

## VERDICT

```yaml
verdict: CRITICAL
reviewer: analyze
reviewed_at: 2026-05-22T23:09:08Z
commit: c639083b00877e9f309850e6d94867172378ca27
critical_count: 6
high_count: 15
medium_count: 10
low_count: 5
```

## Notes for Operator

The 6 CRITICAL findings cluster around **collision with existing codebase**:

1. **C1 + C2** — the spec was authored as if this were a greenfield app. It is not. `servers` table and `script_runs` table already exist with overlapping semantics. Implementing as-is will overwrite production schema.
2. **C3** — Principle V is non-negotiable per constitution; feature flags are missing.
3. **C4** — WebSocket auth gap is a direct Principle II violation.
4. **C5** — Two parallel crypto schemes will diverge.
5. **C6** — FR-007 has zero coverage.

**Recommended next step**: Resolve C1–C6 (rewrite spec+data-model to extend existing schema; add feature flag tasks; add WS-auth task; add FR-007 task). Then re-run `/speckit.analyze`. Verdict should drop to MEDIUM or PASS depending on how H1–H15 are addressed.

If you want to ship with these gaps acknowledged: `/speckit.analyze --override "Pre-merge spike, schema collision tasks tracked in #issue"`.
