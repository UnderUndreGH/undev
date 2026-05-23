-- ============================================================
-- Feature 016: Amnezia VPN Integration & Server Management
-- Migration: 0016_vpn_features.sql
-- ============================================================

-- 1. Add VPN status columns to servers table
ALTER TABLE "servers" ADD COLUMN "vpn_status" TEXT NOT NULL DEFAULT 'uninstalled';
ALTER TABLE "servers" ADD COLUMN "vpn_drift_status" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "servers" ADD COLUMN "vpn_installed_at" TEXT;
ALTER TABLE "servers" ADD COLUMN "vpn_remove_on_delete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servers" ADD COLUMN "scripts_enabled" BOOLEAN NOT NULL DEFAULT false;

-- 2. CHECK constraints for VPN status enums
ALTER TABLE "servers" ADD CONSTRAINT "chk_servers_vpn_status"
  CHECK ("vpn_status" IN ('uninstalled', 'installing', 'installed', 'error'));

ALTER TABLE "servers" ADD CONSTRAINT "chk_servers_vpn_drift_status"
  CHECK ("vpn_drift_status" IN ('in_sync', 'drifted', 'unknown'));

-- 3. Indexes for common VPN queries
CREATE INDEX "idx_servers_vpn_status"
  ON "servers" ("vpn_status");

CREATE INDEX "idx_servers_vpn_drift_status"
  ON "servers" ("vpn_drift_status");

-- 4. Scripts library table (FS + DB sourced)
CREATE TABLE "scripts" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "path" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL DEFAULT 'filesystem',
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

-- Unique path constraint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_path_unique" UNIQUE ("path");

-- Source check constraint
ALTER TABLE "scripts" ADD CONSTRAINT "chk_scripts_source"
  CHECK ("source" IN ('filesystem', 'database'));

-- 5. Script parameters table
CREATE TABLE "script_params" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "script_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'string',
  "default_value" TEXT,
  "description" TEXT,
  "options" JSONB,
  "order" INTEGER NOT NULL DEFAULT 0
);

-- Foreign key: script_params → scripts (CASCADE delete)
ALTER TABLE "script_params" ADD CONSTRAINT "fk_script_params_script_id"
  FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Type check constraint
ALTER TABLE "script_params" ADD CONSTRAINT "chk_script_params_type"
  CHECK ("type" IN ('string', 'number', 'boolean', 'select'));

-- Index for joining params by script
CREATE INDEX "idx_script_params_script_id"
  ON "script_params" ("script_id");
