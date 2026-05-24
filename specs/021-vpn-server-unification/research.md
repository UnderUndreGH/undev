# Research Notes: VPN/Server Unification

**Date**: 2025-05-24
**Spec**: 021-vpn-server-unification

## Kind Column Decision

### Analysis

| Aspect | Explicit Column | Computed |
|--------|----------------|----------|
| Query performance | Indexed, fast | CASE expression per query |
| Extensibility | Add enum value | Need new computation logic |
| Migration cost | One-time backfill | None |
| Data integrity | DB constraint | No constraint, relies on logic |
| Future types | Trivial | Requires new computation rules |

**Decision**: Explicit `kind` column. The spec's US4 (extensibility) makes this the only viable option.

## Migration Plan

```sql
-- Step 1: Add nullable column
ALTER TABLE servers ADD COLUMN kind VARCHAR(20);

-- Step 2: Backfill
UPDATE servers SET kind = 'vpn' WHERE "vpnStatus" IS NOT NULL;
UPDATE servers SET kind = 'general' WHERE kind IS NULL;

-- Step 3: Make NOT NULL with default
ALTER TABLE servers ALTER COLUMN kind SET NOT NULL;
ALTER TABLE servers ALTER COLUMN kind SET DEFAULT 'general';

-- Step 4: Index
CREATE INDEX idx_servers_kind ON servers(kind);
```

## Router Unification Plan

### Current state:
- `server/routes/servers.ts` — general server CRUD
- `server/routes/servers-vpn.ts` — VPN-specific routes

### Target state:
- `server/routes/servers.ts` — ALL server CRUD with kind filter
- `server/routes/servers-vpn.ts` — DELETED

### Route mapping:
- `GET /api/servers` → unified list with `?kind=` query param
- `GET /api/servers/vpn` → REMOVED (use `GET /api/servers?kind=vpn`)
- All other CRUD stays the same

## Client Cache Unification

### Current:
```
useServers() → cache key ["servers"]
useVpnServers() → cache key ["vpn-servers"] (via vpn-api.ts)
```

### Target:
```
useServers({ kind: "all" | "vpn" | "general" }) → cache key ["servers", { kind }]
```

### Hard cutover:
- Remove `vpn-api.ts` hooks in same commit that adds unified hooks
- No dual-cache period (spec edge case requirement)
- VPN tab component imports from `servers-api.ts` instead of `vpn-api.ts`

## Extensibility Proof

Adding a new type (e.g., "proxmox"):
1. Update `ServerKind` enum: add `'proxmox'`
2. Add migration: `ALTER TYPE server_kind ADD VALUE 'proxmox'`
3. Add conditional form section in `ServerForm.tsx`
4. Done. No new routes, no new hooks, no new cache keys.

Changes: 3 files (enum, migration, form) — meets SC-004 requirement.
