# SpecKit Review: 021-vpn-server-unification

**Reviewer**: antigravity
**Reviewed at**: 2026-05-24T08:17:40Z
**Commit**: HEAD
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

## Summary

The unification plan effectively resolves API fragmentation and establishes a strong pattern for future extensibility. However, it misses the lifecycle implications of kind-switching on existing servers and validation state.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | HIGH | Edge case | The spec allows a server's kind to change (e.g., General -> VPN, or VPN -> General). However, there is no logic specified for what happens to existing kind-specific data when downgrading. If a VPN server is edited to be "General", the `vpnStatus` and VPN credentials might be orphaned in the DB, leading to inconsistent state. | Define a strategy for kind downgrades in the backend route (T007): either explicitly clear orthogonal fields when kind changes, or block kind changes on existing servers if it would orphan active data. |
| F2 | MEDIUM | Logical Consistency | The unified `ServerForm` (T013) combines General and VPN fields. If a user toggles the form kind from "VPN" back to "General", React Hook Form / Formik might still submit the populated VPN fields. | Ensure the frontend form and backend Zod validation strictly strip or reject fields that do not belong to the selected `kind` payload. |
| F3 | LOW | Edge case | `data-model.md` states: `UPDATE servers SET kind = 'vpn' WHERE "vpnStatus" IS NOT NULL;`. This assumes `vpnStatus` strictly implies it's a dedicated VPN server, rather than a general server that happens to run a VPN client. | Verify that `vpnStatus` is exclusively used for dedicated VPN servers before running this migration, to avoid miscategorizing general application servers. |

## Alternative approaches considered

Instead of a `kind` column that acts as a strict enum, consider a `tags` or `roles` array (e.g., `['vpn', 'k8s']`) if servers can fulfill multiple roles simultaneously in the future. A strict `kind` column forces servers into mutually exclusive buckets.

## VERDICT

```yaml
verdict: HIGH
reviewer: antigravity
reviewed_at: 2026-05-24T08:17:40Z
commit: HEAD
critical_count: 0
high_count: 1
medium_count: 1
low_count: 1
```
