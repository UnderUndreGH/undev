-- ============================================================
-- Feature 022: Script System Unification
-- Migration: 022-create-script-audit.sql
-- ============================================================

CREATE TABLE "unified_script_audit_entries" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_role" VARCHAR(20) NOT NULL,
  "action" VARCHAR(50) NOT NULL,
  "script_id" TEXT,
  "script_name" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "unified_script_audit_entries"
  ADD CONSTRAINT "fk_unified_script_audit_script_id"
  FOREIGN KEY ("script_id") REFERENCES "unified_scripts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "unified_script_audit_entries"
  ADD CONSTRAINT "chk_unified_script_audit_actor_role"
  CHECK ("actor_role" IN ('admin', 'user', 'system'));

ALTER TABLE "unified_script_audit_entries"
  ADD CONSTRAINT "chk_unified_script_audit_action"
  CHECK ("action" IN ('upload', 'update', 'delete', 'execute', 'integrity-failure', 'scanner-warn'));

CREATE INDEX "idx_unified_script_audit_script_id"
  ON "unified_script_audit_entries" ("script_id");
CREATE INDEX "idx_unified_script_audit_action"
  ON "unified_script_audit_entries" ("action");
CREATE INDEX "idx_unified_script_audit_created_at"
  ON "unified_script_audit_entries" ("created_at");
