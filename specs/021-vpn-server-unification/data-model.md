# Data Model: VPN/Server Unification

**Date**: 2025-05-24
**Spec**: 021-vpn-server-unification

## Assumption: vpnStatus Scope

The `vpnStatus` column is exclusively used for servers running self-hosted VPN (Amnezia, WireGuard). It is NEVER set for general application servers that happen to be VPN clients (e.g., a backend server using VPN to reach a database). The migration query `UPDATE servers SET kind='vpn' WHERE vpnStatus IS NOT NULL` is safe under this assumption. This was verified by auditing all `vpnStatus` write paths — only the Amnezia install flow (Features 016/018) sets this field.

## Schema Changes

### `servers` table — add `kind` column

```sql
ALTER TABLE servers ADD COLUMN kind VARCHAR(20);
UPDATE servers SET kind = 'vpn' WHERE "vpnStatus" IS NOT NULL;
UPDATE servers SET kind = 'general' WHERE kind IS NULL;
ALTER TABLE servers ALTER COLUMN kind SET NOT NULL;
ALTER TABLE servers ALTER COLUMN kind SET DEFAULT 'general';
CREATE INDEX idx_servers_kind ON servers(kind);
```

### Kind Enum (TypeScript)

```typescript
const ServerKind = {
  GENERAL: "general",
  VPN: "vpn",
  // Future: K8S: "k8s", PROXMOX: "proxmox"
} as const;
type ServerKind = (typeof ServerKind)[keyof typeof ServerKind];
```

## Kind Synchronization Rules

The `kind` column stays synchronized with type-specific status columns via application-level guards:

| Event | Condition | kind update |
|-------|-----------|-------------|
| VPN installed | `vpnStatus` transitions NULL → non-NULL | `kind = 'vpn'` |
| VPN removed | `vpnStatus` transitions non-NULL → NULL | `kind = 'general'` |
| Future type installed | Type-specific column set | `kind = '<type>'` |
| Future type removed | Type-specific column cleared | `kind = 'general'` |

**Implementation**: Every route handler that modifies `vpnStatus` (or future type columns) MUST also update `kind` in the same transaction. No async/batch sync — immediate, transactional consistency.

**Validation guard**: A write-time check ensures `kind = 'vpn'` requires `vpnStatus IS NOT NULL`. If violated, the write fails with a clear error. This prevents kind/vpnStatus drift.

## Kind Transition State Diagram

```
[general] --(install VPN)--> [vpn]
[vpn] --(remove VPN + confirm)--> [general]

Rules:
- general→vpn: Only via VPN install action. Sets vpnStatus='installing', kind='vpn'.
- vpn→general: Only via explicit "Remove VPN" action with user confirmation. Transaction:
  1. Verify user confirmation received
  2. SET vpnStatus=NULL, vpnConfig=NULL, vpnPubkey=NULL, vpnEndpoint=NULL, vpnInstalledAt=NULL
  3. SET kind='general'
  No silent drops. Kind is always derived from lifecycle, never manually set.
```

## Query Patterns

### Unified list with kind filter
```sql
SELECT * FROM servers WHERE kind = ANY($1)  -- $1 = ['general', 'vpn'] or ['vpn'] etc.
```

### Kind filter from query param
```
GET /api/servers              → kind IN ('general', 'vpn') -- all
GET /api/servers?kind=vpn     → kind = 'vpn'
GET /api/servers?kind=general → kind = 'general'
```

## Migration File

`021-add-server-kind.sql` — all steps above in a single migration.
