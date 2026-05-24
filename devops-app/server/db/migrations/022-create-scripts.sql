-- ============================================================
-- Feature 022: Script System Unification
-- Migration: 022-create-scripts.sql
-- ============================================================
--
-- NOTE: The existing Feature 016 "scripts" table remains untouched.
-- Phase 5 migration (T025) will migrate F016 data into this table
-- and drop the old tables. Until then both coexist.
-- ============================================================

CREATE TABLE "unified_scripts" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "content_hash" VARCHAR(64) NOT NULL,
  "file_path" TEXT NOT NULL,
  "parameter_schema" JSONB,
  "source" VARCHAR(20) NOT NULL DEFAULT 'upload',
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "unified_scripts" ADD CONSTRAINT "unified_scripts_name_unique"
  UNIQUE ("name");

ALTER TABLE "unified_scripts" ADD CONSTRAINT "chk_unified_scripts_source"
  CHECK ("source" IN ('upload', 'feature-005', 'feature-016'));

CREATE INDEX "idx_unified_scripts_name" ON "unified_scripts" ("name");
CREATE INDEX "idx_unified_scripts_source" ON "unified_scripts" ("source");
