# SpecKit Analyze Report: 019-server-soft-delete

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: 019-server-soft-delete
**Artifacts reviewed**: spec.md, plan.md, tasks.md

---

## Detection Passes

### 1. Duplication Detection

Minor: spec FR-009 (block deletion with active deployments) restated in tasks T007/T020 — acceptable level of restatement for verification emphasis. FR-012 (admin finalization auth) restated in T011 expanded scope — justified redundancy (spec requirement + task scope).

### 2. Ambiguity Detection

**Finding A001** [MEDIUM]: spec FR-006 says "automatically permanently delete servers after a 30-day grace period" — the scheduling mechanism (system cron, node-cron, Bull queue) is still not specified. T010 implements the worker but no task sets up the scheduler/trigger infrastructure. This is a deployment/ops concern that can be resolved during implementation but should be noted.

**Finding A002** [LOW]: spec FR-011 mentions "highlight servers approaching their deletion deadline (within 3 days)" but doesn't specify the highlight style (color, badge, icon). Plan doesn't address UI styling. T014 mentions "approaching-deadline warning" but the visual treatment is left to implementation time.

### 3. Underspecification Detection

**Finding U003** [LOW]: Missing optional docs listed in plan (research.md, data-model.md, contracts/, quickstart.md). Plan's project structure shows files that don't exist on disk. These are optional artifacts and their absence doesn't block implementation.

**Finding U004** [LOW]: The `remainingDays` computation in T009 is described as "computed" but timezone handling for the 30-day cutoff is not specified. Low risk — server timestamps are typically UTC.

### 4. Constitution Alignment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Confirmation modal + 30-day grace period + explicit query filter inventory (T006a-T006i) + verification grep (T006v) |
| II. Secrets never leak | PASS | Audit entries contain metadata, not credentials |
| III. Reviewable database changes | PASS | T001/T002 generate .sql migrations |
| IV. Typed boundaries | PASS | Zod validation mentioned for confirmName |
| V. Feature flags and rollback posture | PASS | Rollback Strategy section added to plan.md — separate commits for migration vs query changes, feature flag option |
| VI. Independent review gate | DEFERRED | This analyze report |
| VII. Snapshot stages | N/A | No snapshot tooling |

### 5. Coverage Gaps

- FR-001 (soft-delete) → T001 + T004 + T007 ✓
- FR-002 (exclude from queries) → T006 (T006a-T006i) + T006v ✓
- FR-003 (type name to confirm) → T012 ✓
- FR-004 (archived panel) → T009 + T014 + T016 ✓
- FR-005 (restore) → T008 + T015 ✓
- FR-006 (auto permanent delete) → T010 ⚠ (scheduler mechanism unspecified — A001)
- FR-007 (cascade) → T010 ✓
- FR-008 (audit trail) → T005 + T024 ✓
- FR-009 (block active deploys) → T007 + T020 ✓
- FR-010 (remaining days) → T009 ✓
- FR-011 (deadline warning) → T009 + T014 ✓
- FR-012 (admin finalization auth) → T011 ✓

### 6. Inconsistency Detection

**Finding I003** [LOW]: Concurrent deletion race condition — spec says "first write wins" and `SET deletedAt = NOW() WHERE id = ? AND deletedAt IS NULL` naturally handles this, but no task explicitly implements concurrency control. The pattern is implicit in T007's implementation.

### 7. Agent Routing Validation

- T001-T003 [DB]: Correct
- T004-T010 [BE]: Correct
- T011 [BE][SEC]: Correct — now includes auth middleware + audit
- T006v [BE][SEC]: Correct — verification task with security lens
- T012-T017 [FE]: Correct
- T018-T024 verification: Appropriate

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A001 | MEDIUM | Ambiguity | Finalization scheduler mechanism not specified |
| A002 | LOW | Ambiguity | Deadline warning visual treatment unspecified |
| U003 | LOW | Underspecification | Optional docs listed in plan but not created |
| U004 | LOW | Underspecification | remainingDays computation edge case (timezone) |
| I003 | LOW | Inconsistency | Concurrent deletion race — no explicit task |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 1 | LOW: 4

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| U001 | HIGH | RESOLVED — T006 expanded to T006a-T006i with explicit query inventory + T006v verification grep |
| I001 | HIGH | RESOLVED — T015→T014 dependency annotated as composition (ArchivedServersList imports RestoreButton) |
| U002 | MEDIUM | RESOLVED — FR-012 added to spec.md; T011 expanded with [SEC] tag, auth-check, and audit-write scope |
| Principle V | — | RESOLVED — Rollback Strategy section added to plan.md with separate-commits requirement and feature-flag option |

---

## Cross-Artifact Consistency

- spec → plan: Aligned. Plan extends spec with implementation details. New FR-012 reflected in plan's source structure.
- plan → tasks: Aligned. T006 expanded, T011 auth added, T006v verification added. Dependency graph updated.
- spec → tasks: All FRs covered. FR-012 → T011 explicit.
- Dependency graph: Valid. No circular deps. T015→T014 composition annotated.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T12:00:00Z"
commit: 9070af1
```

**Rationale**: All HIGH findings from the initial analysis have been resolved. T006 now has explicit query inventory (T006a-T006i) with verification (T006v). T014/T015 dependency is annotated as composition. Admin finalization endpoint (T011) now has auth/audit requirements (FR-012). Rollback strategy documented in plan.md. One remaining MEDIUM (A001: scheduler mechanism) is an implementation-time detail that doesn't block spec correctness — the worker exists (T010), the scheduling infrastructure is an ops concern. Four LOW findings are acceptable for spec-level documentation.
