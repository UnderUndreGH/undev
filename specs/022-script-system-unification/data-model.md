# Data Model: Script System Unification

**Date**: 2025-05-24
**Spec**: 022-script-system-unification

## New Tables

### `scripts` table

```sql
CREATE TABLE scripts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  content_hash VARCHAR(64) NOT NULL,         -- SHA-256 of script file
  file_path TEXT NOT NULL,                    -- Path on disk (under VPN_SCRIPTS_ROOT)
  parameter_schema JSONB,                     -- JSON Schema for parameters (null if parameterless)
  source VARCHAR(20) NOT NULL DEFAULT 'upload', -- 'upload' | 'feature-005' | 'feature-016'
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scripts_name ON scripts(name);
CREATE INDEX idx_scripts_source ON scripts(source);
```

### `script_audit_entries` table

```sql
CREATE TABLE script_audit_entries (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_role VARCHAR(20) NOT NULL,            -- 'admin' | 'user' | 'system'
  action VARCHAR(50) NOT NULL,                -- 'upload' | 'update' | 'delete' | 'execute' | 'integrity-failure' | 'scanner-reject'
  script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  script_name VARCHAR(255),
  metadata JSONB DEFAULT '{}',                -- e.g., { params: {...}, targetServer: 1, sandboxed: true }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_script_audit_script ON script_audit_entries(script_id);
CREATE INDEX idx_script_audit_action ON script_audit_entries(action);
CREATE INDEX idx_script_audit_created ON script_audit_entries(created_at);
```

## Relationships

```
User 1 ←→ N Scripts (created_by)
User 1 ←→ N ScriptAuditEntries (actor_id)
Script 1 ←→ N ScriptAuditEntries (script_id)
```

## Migration Strategy

1. Create `scripts` and `script_audit_entries` tables
2. Migrate Feature 005 hardcoded scripts → insert into `scripts` with `source='feature-005'`
3. Migrate Feature 016 DB scripts → insert into `scripts` with `source='feature-016'`, parse `# @param` → JSON Schema
4. Both migrations are data-only — no schema changes to existing tables

## Key Constraints

- `content_hash` is immutable after upload — tampering detected by mismatch
- `parameter_schema` stored as JSONB for queryability
- `file_path` is relative to `VPN_SCRIPTS_ROOT` — never store absolute paths
