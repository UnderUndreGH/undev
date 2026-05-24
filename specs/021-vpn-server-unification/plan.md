# Implementation Plan: VPN/Server Unification

**Branch**: `021-vpn-server-unification` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-vpn-server-unification/spec.md`

## Summary

Collapse two API routers (`servers.ts` + `servers-vpn.ts`) and two React Query cache layers into a single unified API with kind-based filtering. The `servers` table already has VPN columns from Feature 016 — this spec unifies the API surface and client caching to eliminate data drift and make adding new server types a 3-file change instead of a router+hooks+cache sprawl.

**Dependency**: Feature 017 (vpn-tab-deserialize-fix) MUST be shipped first.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Express (server), React Query (client), Drizzle ORM (DB)
**Storage**: PostgreSQL — `servers` table; optional `kind` column (enum: general, vpn, k8s, proxmox)
**Testing**: Integration test for unified list with kind filter; manual verification of VPN tab parity
**Target Platform**: Web dashboard
**Project Type**: Web application (monorepo: `server/`, `client/`)
**Performance Goals**: Zero performance regression; single query with kind filter
**Constraints**: VPN tab behavior must be identical before and after; no dual-cache period
**Scale/Scope**: 4 user stories, ~12-16 files touched, one router retired

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | No destructive changes; unification is structural |
| II. Secrets never leak | PASS | No secrets involved |
| III. Reviewable database changes | PASS | Migration as .sql if `kind` column added |
| IV. Typed boundaries | PASS | Kind enum; Zod validation on query params |
| V. Feature flags and rollback posture | PASS | Feature flag `UNIFIED_SERVERS_API_ENABLED` gates cutover; VPN router NOT deleted until post-graduation cleanup; Rollback Strategy section in plan |
| VI. Independent review gate | DEFERRED | Required before implement |
| VII. Snapshot stages | N/A | No snapshot tooling |

## Project Structure

### Documentation (this feature)

```text
specs/021-vpn-server-unification/
├── plan.md              # This file
├── research.md          # Kind computation strategy, migration plan
├── data-model.md        # Kind column + enum
├── contracts/           # Unified API specs
│   └── unified-servers.md
├── quickstart.md        # How to verify unification
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
server/
├── db/
│   └── migrations/
│       └── 021-add-server-kind.sql       # kind column + default
├── routes/
│   ├── servers.ts                         # UNIFIED router (absorbs VPN routes)
│   └── servers-vpn.ts                     # RETIRED (deleted or deprecated)
├── services/
│   └── server-queries.ts                  # Unified query builder with kind filter
└── lib/
    └── server-types.ts                    # ServerKind enum

client/
├── lib/
│   ├── servers-api.ts                     # Unified React Query hooks
│   └── vpn-api.ts                         # RETIRED (hooks merged into servers-api)
└── components/
    └── servers/
        ├── ServerList.tsx                  # Unified list with kind filter
        ├── ServerForm.tsx                  # Unified add/edit form
        └── VPNTab.tsx                      # VPN tab as filtered view
```

**Structure Decision**: Existing web app. Two files retired, one unified query service added.

## Research Decisions

### Kind Column vs Computed Kind

**Option A: Explicit `kind` column**
- Pro: Future-proof, queryable, indexed
- Pro: Developer adds new type by updating enum + migration
- Con: Migration required; must backfill existing servers

**Option B: Computed kind from `vpnStatus`**
- Pro: No migration, no new column
- Con: Only works for VPN vs general; k8s/proxmox can't be computed
- Con: Computed value in queries is slower

**Recommendation**: Option A. The spec explicitly requires extensibility for future types. Computed kind only works for the binary case. Backfill is a one-time migration.

### Migration Strategy

1. Add `kind` column (nullable initially)
2. Backfill: `kind = 'vpn'` where `vpnStatus IS NOT NULL`, `kind = 'general'` otherwise
3. Make column NOT NULL with default 'general'
4. **Phase 1: Dual-mode period** — Old VPN router stays active alongside new unified router. Introduce env var `UNIFIED_SERVERS_API_ENABLED` (default: `false`). New unified endpoint available but not primary. Client reads flag, routes to appropriate endpoint.
5. **Phase 2: Flag flip** — Set `UNIFIED_SERVERS_API_ENABLED=true`. Client now uses unified endpoint exclusively. Old VPN router still registered but unused.
6. **Phase 3: Retirement** — After grace period (one release cycle), delete old VPN router file and remove old client hooks. This is a cleanup commit, not a migration.

### React Query Cache Unification

Current: two separate cache key patterns
- `["servers"]` for general
- `["vpn-servers"]` for VPN

Unified: single parameterized key
- `["servers", { kind: "all" | "vpn" | "general" }]`

Invalidation is straightforward: mutations invalidate the entire `["servers"]` key prefix.

## Rollback Strategy

VPN router retirement uses a phased feature-flag approach, making rollback straightforward:

1. **Feature flag rollback**: Set `UNIFIED_SERVERS_API_ENABLED=false` → client immediately reverts to old VPN endpoint. No code deployment needed (env var change).
2. **VPN router file**: NOT deleted until Phase 7 (retirement cleanup, post-graduation). During dual-mode (Phases 4-6), the old router is registered and functional — just deprecated. If issues arise, flip the flag back.
3. **Phase 7 deletion rollback**: If T009 deletes the VPN router file prematurely, restore from git history (`git checkout <prev-commit> -- server/routes/servers-vpn.ts`) + flip flag to `false`.
4. **Migration rollback**: The `kind` column is additive (nullable initially, then NOT NULL with default). DOWN migration drops the column. Safe because `kind` is only used for filtering, not foreign keys.
5. **Client hooks**: Old VPN hooks in `vpn-api.ts` are not deleted during initial implementation — only deprecated. Retirement cleanup (T011) happens after graduation period.

## Complexity Tracking

No constitution violations. Medium feature (~200-300 LOC). Key risk: VPN tab parity regression.
