# Data Model: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)

## Migration: `0015_local_server_transport.sql`

Sequence: feature 013 reserves `0013`, feature 012 reserves `0012`, feature 014 gets `0015`.
Merge order: `0013 → 0015`.

### Modified tables

```sql
-- ============================================================
-- Feature 014: Local Server Transport
-- Migration: 0015_local_server_transport.sql
-- Depends on: 0013_ai_incident_copilot.sql (servers table must exist with ai columns)
-- ============================================================

-- 1. Add connection_type column to servers
ALTER TABLE "servers" ADD COLUMN "connection_type" TEXT NOT NULL DEFAULT 'ssh';

-- 2. CHECK constraint: only valid transport types
ALTER TABLE "servers" ADD CONSTRAINT "chk_servers_connection_type"
  CHECK ("connection_type" IN ('ssh', 'local'));

-- 3. Index for filtering by connection type
CREATE INDEX "idx_servers_connection_type"
  ON "servers" ("connection_type");
```

### Seed: local server auto-insert

All existing rows default to `'ssh'` via the `DEFAULT` clause. The local server is auto-seeded at application startup. If the row already exists (idempotent), the `ON CONFLICT` clause prevents duplicates.

```sql
-- 4. Auto-seed local server entry
-- UUID is deterministic: uuid5(DNS, 'local-server') = c4a760a8-dbcf-5254-a0d9-6a4474bd1b62
INSERT INTO "servers" (
  "id",
  "label",
  "host",
  "port",
  "sshUser",
  "sshAuthMethod",
  "connectionType",
  "setupState",
  "status",
  "aiWriteAccess",
  "scriptsPath"
) VALUES (
  'c4a760a8-dbcf-5254-a0d9-6a4474bd1b62',
  'This Server',
  '__local__',
  0,
  'root',
  'key',
  'local',
  'ready',
  'online',
  'disabled',
  '/app/scripts'
) ON CONFLICT ("id") DO NOTHING;
```

### DOWN migration (manual, operator-gated)

```sql
-- WARNING: Remove local server row first, then drop column + constraint.
--
-- DELETE FROM "servers" WHERE "id" = 'c4a760a8-dbcf-5254-a0d9-6a4474bd1b62';
-- DROP INDEX "idx_servers_connection_type";
-- ALTER TABLE "servers" DROP CONSTRAINT "chk_servers_connection_type";
-- ALTER TABLE "servers" DROP COLUMN "connection_type";
```

## Entity relationships

```
servers (existing)
    + connection_type TEXT ('ssh' | 'local')
    |
    ├── 'ssh' rows: use SSHPool for remote execution (existing behavior)
    └── 'local' row: use child_process.spawn via ClientChannelAdapter
         id = c4a760a8-dbcf-5254-a0d9-6a4474bd1b62
         host = '__local__'
         setupState = 'ready' (skip setup wizard)
         status = 'online' (always, no SSH heartbeat needed)
         aiWriteAccess = 'disabled' (conservative default)
```

## Drizzle schema additions

Modified tables:
- `servers` — 1 new column (`connectionType: text('connection_type').notNull().default('ssh')`)

New enum-like constraint in Zod validation:
- `connectionTypeEnum = z.enum(['ssh', 'local'])`

## Startup behavior

The local server seed runs at application boot in `server/index.ts` (or equivalent startup hook):

1. Query `servers` for `id = 'c4a760a8-dbcf-5254-a0d9-6a4474bd1b62'`
2. If not found → execute the INSERT above
3. If found → update `status = 'online'` (in case of prior unclean shutdown)
4. UUID is cached in-memory as `LOCAL_SERVER_ID` constant — no DB lookup per exec call
