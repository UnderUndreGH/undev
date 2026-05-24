# SpecKit Analyze Report: 022-script-system-unification

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: specs/017-022
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md, contracts/scripts-crud.md

---

## Detection Passes

### 1. Duplication Detection

- **FR-003 (ajv validation)** in spec.md and **plan.md "JSON Schema Validation (ajv)"** section describe the same approach: `# @param` → JSON Schema at upload, `ajv.compile(schema)` at runtime. Consistent.
- **FR-004 (scanner advisory)** in spec.md and **plan.md "Dangerous Pattern Scanner"** section both describe multi-layer defense with advisory-only policy. Consistent.
- **FR-008 (sandbox)** in spec.md and **plan.md "Sandboxing Technology Comparison"** and **tasks.md T013** all describe sandboxed execution. Spec provides requirements; plan provides technology comparison; tasks provide implementation. Consistent.
- **[SECURITY-PASS-REQUIRED]** section in spec.md and **tasks.md Phase 0** duplicate the 4 security vectors. Intentional — spec defines the problem, tasks define the work items. Acceptable.
- **Key Entities** in spec.md: "Script Parameter Schema: JSON Schema definition of a script's parameters, stored in the database, validated at runtime using ajv." — now consistent with FR-003. Previous stale Zod wording is FIXED.

No duplication findings.

### 2. Ambiguity Detection

- **FR-004**: "advisory only — does NOT block upload or execution." Clear policy: scanner warns, admin proceeds. Sandbox is the sole security boundary. plan.md Policy line now says "warn admin" (line 123). Consistent. FIXED.
- **FR-008**: "Script execution MUST run inside firejail or bubblewrap sandbox." Two options listed. T004 evaluates and selects one. Not ambiguous — choice is deferred to security review.
- **Sandbox fail-closed**: spec.md edge case and FR-008 clearly state 503 if sandbox unavailable. tasks.md T000-sec and T011-sec implement pre-flight and per-execution checks. Clear.
- **Scanner advisory policy**: spec.md FR-004 says advisory-only. plan.md line 123 says "warn admin." SC-002 says "warns on 100% of detected dangerous patterns." All three now consistent. FIXED.

### 3. Underspecification Detection

- **AST parser selection**: T001a evaluates bashlex vs tree-sitter-bash. Decision deferred to security review. Acceptable for Phase 0.
- **Scanner extensibility**: tasks.md notes say "Scanner denylist MUST be extensible — new patterns added without code changes (config file or DB table)." No task implements this extensibility mechanism. LOW — denylist initially hardcoded; extensibility is a future enhancement.
- **JSON Schema → UI form mapping**: T028 (ScriptExecuteForm) generates dynamic form from JSON Schema. Mapping rules not specified. LOW — frontend implementation detail.
- **Concurrent upload + execution race**: Hash verification (T011) + atomic write (write to temp, hash, move) prevents partial reads. Not underspecified.
- **Secret parameter convention**: spec.md edge case (line 107) defines `{secret: true}` in JSON Schema `x-*` extension for marking secrets, and `{secret}` modifier for `# @param` parser. Audit shows `***REDACTED***`. Convention defined. FIXED.

### 4. Constitution Alignment

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Operator safety first | PASS (conditional) | Security pass required (Phase 0 gate); sandboxed execution; RBAC; hash verification. BLOCKED until sign-off. |
| II. Secrets never leak | PASS | Audit entries redact secret params via `{secret: true}` convention; script content hashed not logged |
| III. Reviewable database changes | PASS | Two .sql migration files |
| IV. Typed boundaries | PASS | JSON Schema validated via ajv at runtime; Zod for static schemas only; TypeScript types for Script entities |
| V. Feature flags and rollback posture | PASS | Legacy code RETAINED as fallback; Phase 0 security gate blocks implementation; new tables are additive |
| VI. Independent review gate | DEFERRED | Required before implement — plus security review gate |
| VII. Snapshot stages | N/A | No snapshot tooling |

No MUST violations found. Constitution I is conditional on Phase 0 security sign-off, which is correctly gated.

### 5. Coverage Gaps

**FR → Task coverage**:
- FR-001 (admin-only upload): T012 (RBAC middleware), T017 (upload endpoint) ✅
- FR-002 (# @param → JSON Schema): T014 (parser) ✅
- FR-003 (ajv validation): T015 (ajv validator) ✅
- FR-004 (advisory scanner): T010 (scanner) ✅
- FR-005 (RBAC): T012 ✅
- FR-006 (audit): T012 (audit on CRUD), integrated into T017-T021 ✅
- FR-007 (hash integrity): T011 ✅
- FR-008 (sandbox): T004 (select tech), T013 (implement), T000-sec (pre-flight), T011-sec (per-exec check) ✅
- FR-009 (# @param fallback): T025 ✅
- FR-010 (directory permissions): T016 ✅
- FR-011 (Feature 005 compat): T024 (deprecation + fallback) ✅
- FR-012 (Feature 016 compat): T025 ✅

**SC → Task coverage**:
- SC-001 (upload in 30s): Functional coverage in T017. No timing test. LOW.
- SC-002 (warns on 100% of detected patterns): T031 verifies scanner catches all patterns. Now consistent with advisory-only policy. ✅
- SC-003 (zero regression Feature 016): T036 ✅
- SC-004 (100% audit capture): No explicit audit completeness test. T034 tests RBAC events. LOW.
- SC-005 (100% tamper detection): T033 ✅

### 6. Inconsistency Detection

- **SC-002 vs FR-004 — RESOLVED**: SC-002 now says "Advisory scanner warns on 100% of detected dangerous patterns (warns but does not block — sandbox is the security boundary)." Consistent with FR-004 advisory-only policy. FIXED.
- **plan.md scanner policy — RESOLVED**: plan.md line 123 now says "warn admin with specific pattern details. Admin can proceed with upload. Advisory-only." Consistent with FR-004. FIXED.
- **Key Entities Zod reference — RESOLVED**: Key Entities now says "validated at runtime using ajv." Consistent with FR-003. FIXED.
- **T021 Zod reference — RESOLVED**: T021 now says "validate params via ajv (T015)." Consistent with T015's ajv implementation. FIXED.
- **Secret parameter convention — RESOLVED**: Edge case bullet (line 107) defines `{secret: true}` in JSON Schema `x-*` extension and `{secret}` modifier for `# @param`. Audit shows `***REDACTED***`. Convention specified. FIXED.

No inconsistency findings remain.

### 7. Agent Routing Validation

- **Lane 1 [SEC]**: T001, T002, T003, T004, T000-sec. Independent start. Correct.
- **Lane 2 [DB]**: T005, T006 → T007. Independent start. Correct.
- **Lane 3 [BE] types**: T008, T009. Independent start. Correct.
- **Lane 4 [BE] security**: T010, T011, T012, T013, T011-sec. Blocked by T001-T004. Correct.
- **Lane 5 [BE] core**: T014, T015, T016. Blocked by T008-T009, T002. Correct.
- **Lane 6 [BE] API**: T017-T021. Blocked by T005-T007, T010-T016. Correct.
- **Lane 7 [BE] legacy**: T022-T025. Blocked by T017, T021. Correct.
- **Lane 8 [FE]**: T026-T030. Blocked by T017. Correct.
- **Lane 9 verify**: T031-T038. Blocked by implementation. Correct.

**Dep graph check**: All task IDs in dependencies exist. No circular dependencies. No orphans. Fan-in uses `+`, fan-out uses `,`. Validated.

**Phase 0 gate**: Correctly blocks Phase 2+ until T001-T004 are signed off. Phase 1 can proceed in parallel.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A022-F6 | LOW | Coverage | SC-001 (upload in 30s) lacks dedicated performance test task. |
| A022-F7 | LOW | Underspecification | Scanner extensibility (config file or DB table) mentioned in notes but no task implements it. |
| A022-F8 | LOW | Coverage | SC-004 (100% audit capture) has no explicit completeness test. |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 3

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| AG-F1 (antigravity) | CRITICAL | Resolved: Dropped json-schema-to-zod. Replaced with ajv for runtime validation (FR-003). No eval, no codegen. |
| AG-F2 (antigravity) | HIGH | Resolved: Scanner advisory-only (FR-004). Sandbox (FR-008) is sole security boundary. |
| AG-F3 (antigravity) | HIGH | Resolved: Sandbox fail-closed via T000-sec + T011-sec. 503 if unavailable. |
| AG-F4 (antigravity) | MEDIUM | Resolved: Migration path clarified — T022 CLI for Feature 005 Zod→JSON Schema one-time conversion. |
| A022-F1 (analyze v1) | HIGH | SC-002 now says "warns on 100% of detected dangerous patterns." Consistent with FR-004 advisory-only. FIXED. |
| A022-F2 (analyze v1) | HIGH | plan.md scanner policy now says "warn admin." Consistent with FR-004. FIXED. |
| A022-F3 (analyze v1) | MEDIUM | Key Entities now says "validated at runtime using ajv." Stale Zod wording removed. FIXED. |
| A022-F4 (analyze v1) | MEDIUM | T021 now says "validate params via ajv (T015)." Stale Zod reference removed. FIXED. |
| A022-F5 (analyze v1) | MEDIUM | Secret parameter convention defined: `{secret: true}` in JSON Schema `x-*` extension, `{secret}` modifier in `# @param`. Audit redacts as `***REDACTED***`. FIXED. |

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T15:00:00Z"
commit: 7324438
critical_count: 0
high_count: 0
medium_count: 0
low_count: 3
notes: >
  All previous HIGH and MEDIUM findings resolved. Spec is internally consistent.
  Three LOW findings remain (SC-001 timing test, scanner extensibility, audit
  completeness test) — none blocking. Security pass gate (Phase 0) correctly
  blocks implementation until sign-off. Ready for security review.
```
