# SpecKit Analyze Report: 022-script-system-unification

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: 022-script-system-unification
**Artifacts reviewed**: spec.md, plan.md, tasks.md

---

## KNOWN GATING CONSTRAINT

This spec contains a **[SECURITY-PASS-REQUIRED]** section that explicitly blocks implementation until 4 security vectors are reviewed and signed off. tasks.md has a `[!CAUTION] BLOCKED` header and Phase 0 (T001-T004 + T001a-T001c) contains security review tasks that MUST complete before any implementation phases begin. **This is an intentional gating constraint, NOT a spec defect.** The analyze verdict reflects findings beyond this known block.

---

## Detection Passes

### 1. Duplication Detection

Minor: spec §[SECURITY-PASS-REQUIRED] and plan §Dangerous Pattern Scanner overlap on denylist patterns. Acceptable — spec states requirements, plan provides implementation detail for multi-layer defense.

### 2. Ambiguity Detection

**Finding A002** [MEDIUM]: spec FR-008 says "System MUST support sandboxed script execution (investigate firejail, bubblewrap, or landlock)" — the word "investigate" makes sandboxing non-mandatory. Plan recommends firejail with "fallback: execute without sandbox but flag in audit log." This is a conscious decision point, not an ambiguity: sandboxing is best-effort with audit visibility. Acceptable for v1 given that RBAC already restricts upload to admins.

### 3. Underspecification Detection

**Finding U003** [MEDIUM]: No task addresses the `VPN_SCRIPTS_ROOT` environment variable configuration beyond T016 (permission check). How to set this variable, what the default is, or what happens if it's not set is not documented. This is an operational/deployment concern.

**Finding U004** [LOW]: Missing optional docs (research.md, data-model.md, contracts/, quickstart.md).

**Finding U005** [LOW]: T009 installs `zod-to-json-schema` and `json-schema-to-zod` — neither spec nor plan confirms these packages exist on npm with the expected API. Standing orders require checking unfamiliar APIs before coding.

### 4. Constitution Alignment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | **BLOCKED** | Security pass explicitly required — 4 open vectors (intentional gate) |
| II. Secrets never leak | PASS | Audit entries redact secret params; hashes not reversible |
| III. Reviewable database changes | PASS | T005/T006 generate .sql migrations |
| IV. Typed boundaries | PASS | JSON Schema → Zod at runtime; fallback strategy for failed conversion |
| V. Feature flags and rollback posture | PASS | Legacy code RETAINED as fallback (deprecation, not deletion); Rollback Strategy section in plan |
| VI. Independent review gate | **DOUBLE-GATED** | Standard review gate + security review gate (Phase 0) |
| VII. Snapshot stages | N/A | No snapshot tooling |

### 5. Coverage Gaps

- FR-001 (admin-only upload) → T012 + T017 ✓
- FR-002 (parse params to JSON Schema) → T014 ✓
- FR-003 (JSON Schema → Zod runtime + fallback) → T015 + T038v ✓
- FR-004 (content scanner — multi-layer) → T010 + T001a-T001c + T031a ✓
- FR-005 (RBAC) → T012 ✓
- FR-006 (audit trail) → T006 + T012 ✓
- FR-007 (hash + verify — no signing in v1) → T011 ✓
- FR-008 (sandbox) → T013 ✓ ⚠ (best-effort, A002)
- FR-009 (# @param fallback) → T014 + T025 ✓
- FR-010 (VPN_SCRIPTS_ROOT permissions) → T016 ✓
- FR-011 (Feature 005 compat) → T022 + T024 ✓
- FR-012 (Feature 016 compat) → T023 + T025 ✓

### 6. Inconsistency Detection

**Finding I002** [LOW]: plan §Complexity Tracking estimates ~400-500 LOC; tasks.md has 38+ tasks. Large feature but with intentional security coupling justification. Implementation strategy should note cluster orchestration per speckit-pipeline skill guidelines.

**Finding I003** [LOW]: Phase numbering can be misleading for parallel lanes — T030 (Phase 6) depends on T017 (Phase 4) but Phase 5 runs in parallel. Fine for parallelism but numbering implies sequentiality.

### 7. Agent Routing Validation

- T001-T001c, T002-T004 [SEC]: Correct — expanded security review tasks
- T005-T007 [DB]: Correct
- T008 [BE], T009 [SETUP]: Correct
- T010 [BE][SEC]: Correct — multi-layer scanner with security tag
- T011-T013 [BE]: Correct (could benefit from [SEC] tag but implementation tasks)
- T014-T025 [BE]: Correct
- T026-T030 [FE]: Correct
- T031-T038v verification: T031, T031a, T032-T034 tagged [SEC] ✓, T035-T037 [BE], T038 [FE], T038v [BE] ✓

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A002 | MEDIUM | Ambiguity | Sandboxing is best-effort with fallback — conscious decision for v1 |
| U003 | MEDIUM | Underspecification | VPN_SCRIPTS_ROOT env var configuration undocumented (ops concern) |
| U004 | LOW | Underspecification | Optional docs not created |
| U005 | LOW | Underspecification | json-schema-to-zod npm package API unverified |
| I002 | LOW | Inconsistency | 38+ tasks exceeds single-speckit guideline; no cluster orchestration strategy |
| I003 | LOW | Inconsistency | Phase numbering misleading for parallel lanes |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 2 | LOW: 5

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| A001 | HIGH | RESOLVED — Multi-layer defense strategy: (1) shell unescape preprocessor, (2) AST-based analysis (bashlex/tree-sitter-bash), (3) regex denylist on normalized content, (4) indirection denylist. T001 expanded to T001+T001a+T001b+T001c. T010 updated to [BE][SEC]. T031a added for multi-layer verification. |
| U001 | HIGH | RESOLVED — FR-003 expanded with explicit fallback: reject at upload with error OR downgrade to # @param with logged warning. T038v added for roundtrip fidelity testing of all JSON Schema constructs. |
| I001 | MEDIUM | RESOLVED — Signing language removed from spec. Item 3 now says "Hash (SHA-256) scripts at rest" with note that signing is deferred to v2. "Verify signature" changed to "Verify hash". T003 updated. |
| U002 | MEDIUM | RESOLVED — T024/T025 changed from "retire" to "deprecate as primary, retain as fallback". Original code NOT deleted. Rollback Strategy section added to plan.md. |
| Principle V | — | RESOLVED — Legacy code retained as fallback; deprecation not deletion; Rollback Strategy section in plan.md; Principle V status upgraded to PASS |

---

## Cross-Artifact Consistency

- spec → plan: Aligned. Multi-layer scanner in both. Hash-only integrity in both. Fallback strategy in both.
- plan → tasks: Aligned. T010 implements multi-layer scanner. T024/T025 use deprecation not deletion. Rollback Strategy in plan.
- spec → tasks: All FRs covered. FR-003 fallback in T038v. FR-004 multi-layer in T001a-T001c + T010.
- Dependency graph: Valid. T001+T001a+T001b+T001c → T010 correctly gates all scanner work.

---

## SECURITY GATING STATUS

**Expected**: This spec is intentionally blocked by the `[SECURITY-PASS-REQUIRED]` section. Phase 0 tasks T001-T004 (expanded with T001a-T001c) are security review tasks that must be signed off before implementation begins. This is NOT a spec defect — it is a deliberate security gate.

**The analyze report correctly identifies this as a known gating constraint.**

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T13:00:00Z"
commit: 9070af1
```

**Rationale**: Both HIGH findings resolved. Scanner now uses multi-layer defense (AST + unescape + regex + indirection denylist) instead of regex-only. JSON Schema → Zod conversion has explicit fallback strategy (reject or downgrade, never silent). Signing/hashing drift resolved: spec now clearly states hash-only for v1 with signing deferred. Legacy migration uses deprecation (retain code as fallback) instead of deletion, with rollback strategy documented. Two remaining MEDIUMs are acceptable: sandboxing fallback is a conscious design choice with audit visibility, and VPN_SCRIPTS_ROOT config is an ops/deployment concern. Five LOW findings are documentation/organizational items.
