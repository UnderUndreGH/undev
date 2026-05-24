# SpecKit Analyze Report: 018-amnezia-install-completion

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: 018-amnezia-install-completion
**Artifacts reviewed**: spec.md, plan.md, tasks.md

---

## Detection Passes

### 1. Duplication Detection

Minor: plan.md §Research Decisions restates spec.md §Assumptions (Amnezia CLI headless support, AES-256-GCM encryption pattern). Acceptable — plan provides technical detail that spec leaves at assumption level.

### 2. Ambiguity Detection

**Finding A001** [MEDIUM]: spec.md FR-004 says "System MUST store the extracted configuration securely (encrypted at rest)" but doesn't specify what constitutes the config lifecycle — when is it decrypted, who has access, is there a rotation policy. plan.md §Encryption mentions AES-256-GCM and "decrypted at delivery time only" which partially addresses this, but no task explicitly validates encryption correctness.

**Finding A002** [LOW]: spec.md line 101 assumes "Amnezia VPN supports headless install via script (documented in Amnezia CLI/docs)" — this is an unvalidated external dependency. If Amnezia CLI doesn't support headless install, the entire feature is blocked. plan.md acknowledges this as a constraint but no task validates it (would be a research task, correctly not in scope for implementation tasks).

**Finding A003** [LOW]: spec mentions `.vpn` file format and WireGuard `.conf` — plan/tasks handle both formats but don't specify format detection logic. T007 (vpn-config.ts) should handle this, but the format detection is implicit.

### 3. Underspecification Detection

**Finding U001** [MEDIUM]: Progress reporting mechanism is underspecified. spec.md FR-002 requires "report installation progress through multiple stages" and plan.md mentions "worker event system (Feature 016 pattern)" but tasks.md has no task for the SSE/WebSocket/polling transport layer. T006 (GET /api/servers/:id/vpn/status) implies polling, but polling interval, retry strategy, and real-time behavior are not specified. SC-003 requires updates within 5 seconds — is polling sufficient?

**Finding U002** [LOW]: No error taxonomy defined. spec mentions "human-readable error message" (SC-004) and multiple failure modes (SSH failure, disk space, package conflict, config extraction failure) but no structured error codes or error message format is specified. T019 verifies error handling exists but doesn't specify what "correct" looks like.

**Finding U003** [LOW]: Missing research.md, data-model.md, contracts/ — plan.md lists these as documentation files but they weren't created. Plan's project structure shows `research.md`, `data-model.md`, `quickstart.md`, `contracts/vpn-install.md` but these don't exist on disk. Not blocking for analyze (they're optional supplements) but their absence means the encryption schema, API contracts, and Amnezia CLI investigation are not documented.

### 4. Constitution Alignment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Non-destructive install; retry on failure |
| II. Secrets never leak | PASS | VPN config encrypted at rest; SSH keys already encrypted |
| III. Reviewable database changes | PASS | T001 generates .sql migration for review |
| IV. Typed boundaries | PASS | Zod validation mentioned for config extraction |
| V. Feature flags and rollback posture | PASS | vpnStatus="error" isolates failure; existing servers unaffected |
| VI. Independent review gate | DEFERRED | This analyze report is part of the gate |
| VII. Snapshot stages | N/A | No snapshot tooling |

### 5. Coverage Gaps

- FR-001 (execute install) → T002 + T004 ✓
- FR-002 (progress reporting) → T006 + T010 (partial — transport underspecified, see U001)
- FR-003 (extract config) → T004 ✓
- FR-004 (encrypted storage) → T001 + T004 ✓
- FR-005 (download UI) → T008 + T012 + T014 ✓
- FR-006 (QR code UI) → T009 + T013 + T014 ✓
- FR-007 (vpnStatus lifecycle) → T004 + T005 ✓
- FR-008 (retry) → T019 ✓ (implicit in error handling)
- FR-009 (reinstall warning) → T020 ✓
- SC-001 through SC-005 → T016-T020 ✓

### 6. Inconsistency Detection

**Finding I001** [LOW]: tasks.md line 83: `T011 + T014 → T016, T017, T018` — but T016 (verify install end-to-end) should also depend on T008 (config download endpoint) since "config extraction" is part of the end-to-end flow. T016 description says "trigger → stages → config extraction → status=running" which implies config extraction, but the dependency graph only lists T011 + T014 as prerequisites.

**Finding I002** [LOW]: T003 installs `qrcode` npm dependency but tasks.md doesn't mention who reviews/approves the new dependency. Standing orders require explicit approval for package installs. T003 should flag this.

### 7. Agent Routing Validation

- T001 [DB]: Correct — database migration
- T002 [BE]: Correct — shell script creation (could argue [OPS] but [BE] is fine for server-side scripts)
- T003 [SETUP]: Correct — dependency installation
- T004-T009 [BE]: Correct — backend worker and API endpoints
- T010-T015 [FE]: Correct — frontend components and API layer
- T016-T020 verification tasks: T016/T019/T020 tagged [BE], T017/T018 tagged [FE] — correct split

Missing: No [SEC] task for validating encryption implementation. T007 handles encryption/decryption but isn't tagged for security review.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A001 | MEDIUM | Ambiguity | VPN config access lifecycle not fully specified (rotation, access control) |
| A002 | LOW | Ambiguity | Amnezia CLI headless install capability unvalidated |
| A003 | LOW | Ambiguity | Config format detection logic implicit |
| U001 | MEDIUM | Underspecification | Progress reporting transport mechanism not specified (polling vs SSE/WS) |
| U002 | LOW | Underspecification | No structured error taxonomy for install failures |
| U003 | LOW | Underspecification | Optional docs (research.md, data-model.md, contracts/) listed in plan but not created |
| I001 | LOW | Inconsistency | T016 dependency graph may be missing T008 prerequisite |
| I002 | LOW | Inconsistency | T003 new dependency install needs explicit approval per standing orders |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 2 | LOW: 6

---

## Cross-Artifact Consistency

- spec → plan: Mostly aligned. Plan extends spec with technical decisions.
- plan → tasks: Aligned. Tasks decompose plan into phases correctly.
- spec → tasks: Aligned with gaps noted in U001 (progress transport).
- Dependency graph: Valid structure, minor gap in I001.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T00:00:00Z"
commit: HEAD
```

**Rationale**: No CRITICAL or HIGH findings. Two MEDIUM findings (config lifecycle ambiguity, progress transport underspecification) are addressable during implementation. The feature builds on established patterns (Feature 016 worker, existing encryption) and the task decomposition is sound. Recommend documenting progress transport decision (polling interval/strategy) before Phase 4.
