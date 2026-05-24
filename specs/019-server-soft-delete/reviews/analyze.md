# SpecKit Analyze Report: 019-server-soft-delete

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: specs/017-022
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

---

## Detection Passes

### 1. Duplication Detection

- **FR-001 (spec.md)** and **data-model.md** both describe the `deletedAt` column semantics. Consistent and non-conflicting — acceptable redundancy between spec requirement and data model.
- **FR-007** (cascade permanent deletion) is described in spec.md, plan.md (Cascade Analysis section), tasks.md (T010), and data-model.md (FK CASCADE Verification). All consistent. No conflicting definitions.
- **Plan.md** "Query Layer — Relational and Join Audit" section and **tasks.md T006j/T006k/T006l** cover the same concern. Plan provides policy; tasks provide actionable steps. Complementary, not duplicative.
- **FR-012** (admin finalization endpoint) appears in spec.md and tasks.md T011 with matching requirements (admin role, audit entry). No drift.

No problematic duplication found. Cross-references are consistent.

### 2. Ambiguity Detection

- **FR-012**: "admin role authentication" — assumes a role system exists. No ambiguity given the existing codebase context.
- **SC-004**: "Zero accidental permanent deletions — all require 30-day wait + explicit confirmation." The "explicit confirmation" for permanent deletion is done by the system (cron), not the user. This is technically correct (the user already confirmed soft-delete; permanent deletion is automated after grace period). Minor wording but not ambiguous in context.
- **Edge case: restored server name conflict**: spec says "Allow duplicate names (name is not unique constraint); or show warning during restore." The two options ("allow" vs "warn") are unresolved. However, the data-model.md resolves this by using partial unique indexes `WHERE deletedAt IS NULL`, which implicitly allows the soft-deleted row to coexist. The "or" is addressed by the partial index strategy. LOW concern.

### 3. Underspecification Detection

- **Audit entry schema for permanent-delete**: spec.md US5 scenario 3 mentions "related records count" in metadata. The data-model.md `metadata JSONB DEFAULT '{}'` accommodates this but doesn't specify the exact key name. LOW — implementation detail.
- **Finalization transaction isolation level**: plan.md says "transactional cascade" but doesn't specify isolation level. For cascade deletion of up to 100 records (SC-003), READ COMMITTED is sufficient. LOW concern.
- **Concurrent restore + finalization race**: What if a user restores a server at the exact moment the finalization cron runs? The restore clears `deletedAt`, finalization selects `WHERE deletedAt < NOW() - 30 days`. If restore happens first, the server won't be selected. If finalization selects first and the restore happens during the transaction, the transaction's WHERE snapshot excludes the restored server. PostgreSQL MVCC handles this correctly. No underspecification issue.

### 4. Constitution Alignment

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Operator safety first | PASS | Confirmation modal (type server name); 30-day grace period; SC-004 zero accidental permanent deletions |
| II. Secrets never leak | PASS | Audit entries contain server metadata, not credentials |
| III. Reviewable database changes | PASS | Two .sql migration files (019-add-deleted-at.sql, 019-create-audit-entries.sql) |
| IV. Typed boundaries | PASS | Zod validation on delete/restore requests; audit entry typed; Drizzle schema updated (T003) |
| V. Feature flags and rollback posture | PASS | Additive feature; rollback strategy documented in plan.md with separate commits for migration vs query changes |
| VI. Independent review gate | DEFERRED | Noted in plan.md constitution check |
| VII. Snapshot stages | N/A | No snapshot tooling |

No MUST violations found.

### 5. Coverage Gaps

**FR → Task coverage**:
- FR-001 (soft-delete timestamp): T001 (migration), T004 (service), T007 (endpoint) ✅
- FR-002 (exclude from default queries): T006a-T006i, T006j-T006l ✅
- FR-003 (type name confirmation): T012 (modal), T007 (server-side validate) ✅
- FR-004 (archived panel): T009 (endpoint), T014 (UI) ✅
- FR-005 (restore): T008 (endpoint), T015 (button) ✅
- FR-006 (auto permanent delete after 30d): T010 (worker) ✅
- FR-007 (cascade deletion): T010 + T010v ✅
- FR-008 (audit trail): T005 (audit utility), integrated into T007/T008/T010/T011 ✅
- FR-009 (block deletion with active deploys): T007 (check in endpoint) ✅
- FR-010 (remaining days display): T009 (compute), T014 (display) ✅
- FR-011 (highlight approaching deadline): T009 (compute `approachingDeadline`), T014 (display warning) ✅
- FR-012 (admin finalization endpoint): T011 ✅

**SC → Task coverage**:
- SC-001 (delete <2s): No explicit performance test task. T018 verifies functionality but not timing. LOW gap.
- SC-002 (restore <2s): Same as SC-001. LOW gap.
- SC-003 (100 related records): T010 handles cascade; T021 verifies. Acceptable.
- SC-004 (zero accidental): Architecturally guaranteed by grace period + confirmation modal.
- SC-005 (100% audit capture): T024 verifies audit trail.

**NFR coverage**: No explicit load/performance testing tasks. LOW — SC-001/SC-002 are performance criteria without dedicated perf test tasks.

### 6. Inconsistency Detection

- **data-model.md** says `idx_servers_deleted_at` is a partial index `WHERE "deletedAt" IS NOT NULL`. **tasks.md T001** also specifies this. Consistent.
- **data-model.md** specifies partial unique indexes `idx_servers_ip_active` and `idx_servers_name_active`. **tasks.md T001** matches. **spec.md edge case** (re-add same IP/name) aligns with this design. Consistent.
- **plan.md** mentions "6 related tables" with CASCADE. **data-model.md FK CASCADE Verification** lists the same 6 tables. Consistent.
- **tasks.md T010v** verifies FK CASCADE on all 6 child tables. Consistent with data-model.md.
- **Plan.md** "Query Layer" section and **tasks.md T006j/T006k/T006l** both address relational query auditing. Consistent — plan states policy, tasks provide implementation steps.

No inconsistencies found.

### 7. Agent Routing Validation

- **Lane 1 [DB]**: T001, T002 → T003. T003 depends on T001+T002 (schema changes). Correct.
- **Lane 2 [BE] core**: T005, T006 → T004 → T007, T008, T009. Wait — dependency graph shows T004 depends on T001+T002+T003 (Phase 1 complete). Tasks.md says "T001 + T002 + T003 → T004". Lane 2 correctly states "Blocked By: T001-T003". Correct.
- **Lane 3 [BE] worker**: T010 → T011. Dep graph: T010 depends on T005. Correct.
- **Lane 4 [FE] API**: T017 independent. Correct — client API hooks can be written independently.
- **Lane 5 [FE] UI delete**: T012 → T013. Blocked by T007, T017. Correct.
- **Lane 6 [FE] UI archive**: T015 → T014 → T016. Blocked by T008, T009, T017. Correct.
- **Lane 7 verify**: T018-T024. Blocked by all implementation. Correct.
- **T006v**: Depends on T006 (per dep graph). Correct — can't verify until all query filters applied.
- **T006j + T006k → T006l**: Audit then apply. Correct sequencing.

Agent routing is sound. No orphan tasks. No circular dependencies. Self-validation checklist confirms.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A019-F1 | LOW | Coverage | SC-001/SC-002 (performance criteria) have no dedicated performance test task |
| A019-F2 | LOW | Ambiguity | Edge case "restored server name conflict" lists two options — resolved by data-model partial unique indexes but spec wording still says "or" |
| A019-F3 | LOW | Underspecification | Finalization transaction isolation level not specified (READ COMMITTED assumed) |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 3

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| AG-F1 (HIGH) | HIGH | Resolved: Partial unique indexes `WHERE deletedAt IS NULL` added to T001 and data-model.md |
| AG-F2 (HIGH) | HIGH | Resolved: Drizzle with/join audit tasks T006j/k/l added to tasks.md |
| AG-F3 (MEDIUM) | MEDIUM | Resolved: Index strategy documented in data-model.md Index Strategy section |
| AG-F4 (LOW) | LOW | Resolved: FK CASCADE verify task T010v added to tasks.md and data-model.md |

All Antigravity findings from round 1 have been addressed. Current analysis finds only LOW-severity items.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T14:00:00Z"
commit: 7324438
```
