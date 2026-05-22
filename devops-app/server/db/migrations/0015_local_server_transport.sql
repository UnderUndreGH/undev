-- ============================================================
-- Feature 014: Local Server Transport
-- Migration: 0015_local_server_transport.sql
-- ============================================================

-- 1. Add connection_type column to servers
ALTER TABLE "servers" ADD COLUMN "connection_type" TEXT NOT NULL DEFAULT 'ssh';

-- 2. CHECK constraint: only valid transport types
ALTER TABLE "servers" ADD CONSTRAINT "chk_servers_connection_type"
  CHECK ("connection_type" IN ('ssh', 'local'));

-- 3. Index for filtering by connection type
CREATE INDEX "idx_servers_connection_type"
  ON "servers" ("connection_type");

-- 4. Auto-seed local server entry (idempotent, ON CONFLICT DO NOTHING)
-- UUID is deterministic: uuid5(DNS, 'local-server') = c4a760a8-dbcf-5254-a0d9-6a4474bd1b62
INSERT INTO "servers" (
  "id",
  "label",
  "host",
  "port",
  "ssh_user",
  "ssh_auth_method",
  "connection_type",
  "setup_state",
  "status",
  "ai_write_access",
  "scripts_path"
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
