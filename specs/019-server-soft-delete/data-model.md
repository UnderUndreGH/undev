# Data Model: Server Soft-Delete

**Date**: 2025-05-24
**Spec**: 019-server-soft-delete

## Schema Changes

### `servers` table — add `deletedAt`

```sql
ALTER TABLE servers ADD COLUMN "deletedAt" TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_servers_deleted_at ON servers("deletedAt") WHERE "deletedAt" IS NOT NULL;

-- Partial unique indexes: allow re-adding server with same IP/name after soft-delete
-- Only ACTIVE servers (deletedAt IS NULL) must be unique
DROP INDEX IF EXISTS idx_servers_ip_unique;   -- or whatever the existing unique constraint name is
DROP INDEX IF EXISTS idx_servers_name_unique;  -- or whatever the existing unique constraint name is
CREATE UNIQUE INDEX idx_servers_ip_active ON servers(ip) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX idx_servers_name_active ON servers(name) WHERE "deletedAt" IS NULL;
```

- `deletedAt IS NULL` → active server
- `deletedAt IS NOT NULL` → soft-deleted, in grace period

### `audit_entries` table — new

```sql
CREATE TABLE audit_entries (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_type VARCHAR(20) NOT NULL DEFAULT 'user',  -- 'user' | 'system'
  action VARCHAR(50) NOT NULL,                       -- 'soft-delete' | 'restore' | 'permanent-delete'
  resource_type VARCHAR(50) NOT NULL,                -- 'server'
  resource_id INTEGER NOT NULL,
  resource_name VARCHAR(255),
  metadata JSONB DEFAULT '{}',                       -- e.g., { relatedRecordsCount: 5 }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_entries_resource ON audit_entries(resource_type, resource_id);
CREATE INDEX idx_audit_entries_action ON audit_entries(action);
CREATE INDEX idx_audit_entries_created ON audit_entries(created_at);
```

## Relationships

```
Server 1 ←→ 0..N AuditEntry (via resource_type='server', resource_id)
User 1 ←→ N AuditEntry (via actor_id)
```

## Query Patterns

### Active servers (default list)
```sql
SELECT * FROM servers WHERE "deletedAt" IS NULL;
```

### Archived servers
```sql
SELECT *, ("deletedAt" + INTERVAL '30 days' - NOW()) AS remaining_days
FROM servers WHERE "deletedAt" IS NOT NULL
ORDER BY "deletedAt" DESC;
```

### Servers eligible for finalization
```sql
SELECT * FROM servers
WHERE "deletedAt" IS NOT NULL AND "deletedAt" < NOW() - INTERVAL '30 days';
```

## Index Strategy

- **Active-list path (hot path)**: Relies on existing primary key + foreign key indexes + the new partial unique indexes (`idx_servers_ip_active`, `idx_servers_name_active`). No additional index needed — `WHERE deletedAt IS NULL` benefits from partial unique index structure.
- **Archived-view path (cold path)**: Partial index `WHERE "deletedAt" IS NOT NULL` accelerates the rare archived servers query.
- **Future scaling**: If table grows >100k servers, add `CREATE INDEX idx_servers_active ON servers(id) WHERE "deletedAt" IS NULL` for faster active-list pagination. Not needed at current scale.

## Migration Files

- `019-add-deleted-at.sql` — add column + index
- `019-create-audit-entries.sql` — new table + indexes

## FK CASCADE Verification (T010v)

The following child tables reference `servers(id)` and MUST have `ON DELETE CASCADE`:
1. `apps` — server_id FK
2. `deploys` — transitive via apps
3. `backups` — server_id FK
4. `certs` — server_id FK
5. `health_checks` — server_id FK
6. `locks` — server_id FK

If any FK lacks `ON DELETE CASCADE`, the finalization worker (T010) must manually delete children in dependency order before deleting the server record.
