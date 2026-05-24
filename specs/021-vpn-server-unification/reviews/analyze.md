# SpecKit Analyze Report: 021-vpn-server-unification

**Reviewer**: analyze
**Date**: 2026-05-24
**Branch**: specs/017-022
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

---

## Detection Passes

### 1. Duplication Detection

- **FR-002 + FR-002a (kind transition rules)** in spec.md and **data-model.md "Kind Synchronization Rules" + "Kind Transition State Diagram"** both describe kind→vpnStatus synchronization. Spec provides requirements; data-model provides implementation details + state diagram. Consistent.
- **FR-002a** in spec.md and **tasks.md T007** both describe the Zod discriminatedUnion approach for kind transitions. Consistent.
- **Plan.md migration strategy** (phased: dual-mode → flag flip → retirement) and **tasks.md T008/T009** implement this. Consistent.
- **Rollback strategy**: plan.md has dedicated section; tasks.md T000a provides feature flag. Complementary.

No problematic duplication found.

### 2. Ambiguity Detection

- **FR-002**: "When VPN is installed on a server (vpnStatus transitions from NULL to non-NULL), `kind` MUST auto-update to `vpn`." The trigger mechanism is "application-level guards on every write that modifies vpnStatus" — this is clear and addressed in data-model.md.
- **FR-002a**: "Direct manual kind changes via API/DB are NOT allowed." This means no `PATCH /api/servers/:id { kind: 'vpn' }` endpoint exists. Kind is derived from lifecycle only. Clear.
- **Kind downgrade orphan**: FR-002a specifies vpn→standard requires explicit confirmation + transactional cleanup of all VPN fields. The state diagram in data-model.md confirms. Clear.
- **Edge case "invalid kind filter"**: spec says "Return all servers (ignore invalid filter) or return 400 with clear error message." The "or" is still ambiguous — T019 verifies "invalid value returns 400", resolving it to the 400 approach. The tasks resolve the ambiguity. LOW.

### 3. Underspecification Detection

- **vpnStatus assumption scope**: data-model.md "Assumption: vpnStatus Scope" section explicitly documents that `vpnStatus` is exclusively for self-hosted VPN and verified by auditing write paths. This addresses the remediated concern. Well-documented.
- **Feature 017 dependency**: Both plan.md and tasks.md T000 verify Feature 017 is merged. Clear blocker.
- **Concurrent kind update race**: Two simultaneous VPN installs on the same server? The application-level guard (transactional) prevents this — first write wins, second sees already-updated kind. PostgreSQL transaction handles it. Not a gap.
- **Cache invalidation on kind change**: spec.md FR-004 defines cache key `["servers", { kind }]`. When kind changes, the old cache key still has stale data. plan.md "Invalidation is straightforward: mutations invalidate the entire `["servers"]` key prefix." This is correct React Query practice. Not underspecified.

### 4. Constitution Alignment

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Operator safety first | PASS | Kind downgrade requires explicit confirmation modal; no silent data loss |
| II. Secrets never leak | PASS | No secrets involved in unification |
| III. Reviewable database changes | PASS | Migration as .sql file (021-add-server-kind.sql) |
| IV. Typed boundaries | PASS | ServerKind enum; Zod validation on query params; discriminatedUnion for form validation |
| V. Feature flags and rollback posture | PASS | `UNIFIED_SERVERS_API_ENABLED` env var gates cutover; VPN router NOT deleted until post-graduation; rollback strategy documented |
| VI. Independent review gate | DEFERRED | Noted in plan.md constitution check |
| VII. Snapshot stages | N/A | No snapshot tooling |

No MUST violations found.

### 5. Coverage Gaps

**FR → Task coverage**:
- FR-001 (unified endpoint): T006 (query builder), T007 (route update) ✅
- FR-002 (kind column + sync): T003 (migration), T004 (Drizzle), T007 (enforcement), T020a (verify sync) ✅
- FR-002a (transition rules): T007 (Zod discriminatedUnion), T013 (frontend form) ✅
- FR-003 (retire VPN endpoint): T008 (deprecation), T009 (retirement) ✅
- FR-004 (single React Query cache): T010 (unified hook) ✅
- FR-005 (retire VPN hooks): T011 ✅
- FR-006 (unified form): T013 ✅
- FR-007 (VPN tab as filtered view): T014 ✅
- FR-008 (extensibility): T021v (extensibility spike) ✅
- FR-009 (existing CRUD works): T015 (verify unified endpoint) ✅
- FR-010 (migration assign kind='general'): T003 (migration includes backfill) ✅

**SC → Task coverage**:
- SC-001 (one router): T007 absorbs VPN routes, T015 verifies ✅
- SC-002 (one cache key): T010 implements, T017 verifies parity ✅
- SC-003 (VPN tab parity): T017 ✅
- SC-004 (3-file extensibility): T021v validates ✅
- SC-005 (no data drift): T020 (cache consistency), T020a (sync verify) ✅

Full coverage. All FRs and SCs have corresponding tasks.

### 6. Inconsistency Detection

- **spec.md FR-002**: kind sync rules → **data-model.md Kind Synchronization Rules table**: Both say vpnStatus NULL→non-NULL = kind='vpn', non-NULL→NULL = kind='general'. Consistent.
- **spec.md FR-002a**: "vpn→standard requires explicit user confirmation modal" → **data-model.md state diagram**: "vpn→general: Only via explicit 'Remove VPN' action with user confirmation." Consistent.
- **spec.md edge case "invalid kind filter"**: ambiguous (ignore vs 400) → **tasks.md T019**: "invalid value returns 400." Tasks resolve the ambiguity toward 400. Consistent with tasks resolution.
- **plan.md migration phases**: Phase 1 dual-mode, Phase 2 flag flip, Phase 3 retirement → **tasks.md**: T000a (flag), T008 (deprecation in dual-mode), T009 (retirement post-graduation). Consistent.
- **plan.md "client hard cutover"**: "remove old hooks in the same commit that adds new unified hooks" → **tasks.md T011**: "Delete VPN-specific hooks." Consistent.
- **data-model.md**: `kind VARCHAR(20)` → **plan.md**: "enum: general, vpn, k8s, proxmox" → **data-model.md TypeScript**: `ServerKind` const enum. All consistent.

No inconsistencies found.

### 7. Agent Routing Validation

- **Lane 0 [BE] pre-conditions**: T000, T000a. Independent start. Correct.
- **Lane 1 [BE] research**: T001, T002. Blocked by T000. Correct — must verify Feature 017 first.
- **Lane 2 [DB]**: T003 → T004. Blocked by T001, T002. Correct.
- **Lane 3 [BE] core**: T005 → T006 → T007 → T008. Blocked by T004, T000a. Correct.
- **Lane 4 [FE] API**: T010, T011. Independent start. Correct — hooks can be written before backend is ready.
- **Lane 5 [FE] UI**: T012, T013, T014. Blocked by T010, T011, T006. Correct.
- **Lane 6 verify**: T015-T020, T020a, T020b, T021v. Blocked by implementation. Correct.

**Dep graph check**: T000 → T001, T003, T000a. T000a → T007, T008. All IDs exist. No circular dependencies. No orphans. Validated.

**Note**: T005 → T007 (server-types needed for route) and T006 → T007 (query builder needed). Both specified. Correct.

---

## Findings Summary

| ID | Severity | Category | Summary |
|----|----------|----------|---------|
| A021-F1 | LOW | Ambiguity | Edge case "invalid kind filter" lists two behaviors (ignore vs 400) — resolved by T019 toward 400, but spec wording still says "or" |
| A021-F2 | LOW | Underspecification | Future type install/remove lifecycle mentioned in FR-002 but no extensibility contract defined beyond VPN. Acceptable for current scope. |

**Counts**: CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 2

---

## Remediation History

| Original ID | Severity | Resolution |
|-------------|----------|------------|
| AG-F1 (HIGH) | HIGH | Resolved: Kind downgrade orphan addressed with FR-002a transition rules + state diagram in data-model.md. vpn→standard requires explicit confirmation + transactional cleanup of all VPN fields. |
| AG-F2 (MEDIUM) | MEDIUM | Resolved: Form field stripping via Zod discriminatedUnion in T013. Frontend strips out-of-discriminator fields; backend re-validates with same discriminated union. |
| AG-F3 (LOW) | LOW | Resolved: vpnStatus assumption documented in data-model.md "Assumption: vpnStatus Scope" section with verification of write paths. |

All Antigravity findings from round 1 have been addressed. Current analysis finds only LOW-severity items.

---

## VERDICT

```yaml
verdict: PASS
reviewer: analyze
reviewed_at: "2026-05-24T14:00:00Z"
commit: 7324438
```
