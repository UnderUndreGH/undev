# Data Model: Amnezia VPN Install Completion

**Date**: 2025-05-24
**Spec**: 018-amnezia-install-completion

## Entities

### VPN Config (new table or server column)

**Option A: Column on `servers` table**

```sql
ALTER TABLE servers ADD COLUMN vpn_config_encrypted TEXT;
ALTER TABLE servers ADD COLUMN vpn_config_format VARCHAR(10); -- 'wireguard' | 'amnezia'
```

Simple, co-located with server. Config is 1:1 with server.

**Option B: Separate `vpn_configs` table**

```sql
CREATE TABLE vpn_configs (
  id SERIAL PRIMARY KEY,
  server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
  config_encrypted TEXT NOT NULL,
  config_format VARCHAR(10) NOT NULL DEFAULT 'wireguard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(server_id)
);
```

**Recommendation**: Option A (column). Config is always 1:1 with server. Simpler. Avoids JOIN overhead.

### Install Progress (existing field, extended values)

```typescript
type VpnInstallStage =
  | "idle"         // no install in progress
  | "installing"   // install triggered (existing state)
  | "connecting"   // SSH connecting
  | "configuring"  // Amnezia being configured
  | "extracting"   // Config being extracted
  | "running"      // Install complete (existing state)
  | "error";       // Install failed (existing state)
```

The `vpnStatus` column on `servers` already stores status strings. Extend with granular stages.

## Relationships

```
Server 1 ←→ 0..1 VPN Config (encrypted column on same row)
Server 1 ←→ 0..1 Install Progress (vpnStatus field)
```

## Migration

```sql
-- 018-add-vpn-config-column.sql
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vpn_config_encrypted TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vpn_config_format VARCHAR(10);
```

Minimal, additive, zero-downtime.
