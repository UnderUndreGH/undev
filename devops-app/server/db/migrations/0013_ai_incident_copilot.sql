-- ============================================================
-- Feature 013: AI Incident Copilot
-- Migration: 0013_ai_incident_copilot.sql
-- Depends on: 0012_blue_green_deploy.sql (schema only, no data dep)
-- ============================================================

-- 1. AI Settings (singleton, same pattern as notification_settings)
CREATE TABLE "ai_settings" (
  "id"                              INTEGER PRIMARY KEY CHECK ("id" = 1),
  "enabled"                         BOOLEAN NOT NULL DEFAULT false,
  "default_provider"                TEXT NULL,
  "system_prompt_content"           TEXT NULL,
  "monthly_token_budget_in"         INTEGER NOT NULL DEFAULT 5000000,
  "monthly_token_budget_out"        INTEGER NOT NULL DEFAULT 1000000,
  "per_incident_token_cap_in"       INTEGER NOT NULL DEFAULT 100000,
  "per_incident_token_cap_out"      INTEGER NOT NULL DEFAULT 20000,
  "global_tool_use_enabled"         BOOLEAN NOT NULL DEFAULT true,
  "global_kill_switch_engaged"      BOOLEAN NOT NULL DEFAULT false,
  "default_sandbox"                 BOOLEAN NOT NULL DEFAULT false,
  "conversation_retention_days"     INTEGER NOT NULL DEFAULT 90,
  "max_conversation_duration_minutes" INTEGER NOT NULL DEFAULT 30,
  "updated_at"                      TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

INSERT INTO "ai_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- 2. AI Provider Keys
CREATE TABLE "ai_provider_keys" (
  "id"                    TEXT PRIMARY KEY,
  "provider"              TEXT NOT NULL CHECK ("provider" IN ('anthropic', 'openai', 'ollama')),
  "model_default"         TEXT NOT NULL,
  "endpoint_url"          TEXT NULL,
  "api_key_encrypted"     TEXT NOT NULL,
  "is_active"             BOOLEAN NOT NULL DEFAULT true,
  "rate_card_input_per_mtok"  NUMERIC NULL,
  "rate_card_output_per_mtok" NUMERIC NULL,
  "created_at"            TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  "rotated_at"            TEXT NULL
);

CREATE UNIQUE INDEX "uq_ai_provider_keys_active_per_provider"
  ON "ai_provider_keys" ("provider") WHERE "is_active" = true;

-- 3. AI Conversations
CREATE TABLE "ai_conversations" (
  "id"                      TEXT PRIMARY KEY,
  "trigger"                 TEXT NOT NULL CHECK ("trigger" IN ('pull', 'push')),
  "target_kind"             TEXT NOT NULL CHECK ("target_kind" IN (
    'app', 'server', 'deployment', 'audit_event', 'cert',
    'script_run', 'manual', 'compose_review'
  )),
  "target_id"               TEXT NULL,
  "provider_key_id"         TEXT NOT NULL REFERENCES "ai_provider_keys"("id"),
  "model"                   TEXT NOT NULL,
  "status"                  TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN (
    'pending', 'streaming', 'completed', 'error',
    'cap_exhausted', 'aborted_by_kill_switch', 'aborted_by_timeout', 'provider_rate_limited'
  )),
  "sandbox_mode"            BOOLEAN NOT NULL DEFAULT false,
  "prior_conversation_id"   TEXT NULL REFERENCES "ai_conversations"("id"),
  "hypothesis"              TEXT NULL,
  "confidence"              TEXT NULL CHECK ("confidence" IS NULL OR "confidence" IN ('high', 'medium', 'low')),
  "tokens_in"               INTEGER NOT NULL DEFAULT 0,
  "tokens_out"              INTEGER NOT NULL DEFAULT 0,
  "tokens_reserved"         INTEGER NOT NULL DEFAULT 0,
  "est_cost_usd"            NUMERIC NOT NULL DEFAULT 0,
  "created_at"              TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  "updated_at"              TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  "archived_at"             TEXT NULL
);

CREATE INDEX "idx_ai_conversations_target"
  ON "ai_conversations" ("target_kind", "target_id", "created_at" DESC);
CREATE INDEX "idx_ai_conversations_status"
  ON "ai_conversations" ("status") WHERE "status" NOT IN ('completed', 'error');
CREATE INDEX "idx_ai_conversations_archived"
  ON "ai_conversations" ("archived_at") WHERE "archived_at" IS NULL;
CREATE INDEX "idx_ai_conversations_hypothesis_fts"
  ON "ai_conversations" USING gin(to_tsvector('english', "hypothesis"));

-- 4. AI Messages
CREATE TABLE "ai_messages" (
  "id"                TEXT PRIMARY KEY,
  "conversation_id"   TEXT NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role"              TEXT NOT NULL CHECK ("role" IN ('system', 'user', 'assistant', 'tool')),
  "seq"               INTEGER NOT NULL,
  "content_text"      TEXT NOT NULL,
  "content_meta"      JSONB NULL,
  "tokens_in"         INTEGER NOT NULL DEFAULT 0,
  "tokens_out"        INTEGER NOT NULL DEFAULT 0,
  "created_at"        TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  UNIQUE ("conversation_id", "seq")
);

-- 5. AI Tool Calls
CREATE TABLE "ai_tool_calls" (
  "id"                TEXT PRIMARY KEY,
  "conversation_id"   TEXT NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "manifest_id"       TEXT NOT NULL,
  "params_json"       JSONB NOT NULL,
  "target_server_id"  TEXT NULL REFERENCES "servers"("id") ON DELETE SET NULL,
  "target_app_id"     TEXT NULL REFERENCES "applications"("id") ON DELETE SET NULL,
  "status"            TEXT NOT NULL DEFAULT 'proposed' CHECK ("status" IN (
    'proposed', 'approved', 'rejected', 'executing',
    'completed', 'failed', 'blocked_by_policy', 'blocked_by_lock'
  )),
  "script_run_id"     TEXT NULL REFERENCES "script_runs"("id") ON DELETE SET NULL,
  "dry_run"           BOOLEAN NOT NULL DEFAULT false,
  "decided_by"        TEXT NULL,
  "created_at"        TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  "decided_at"        TEXT NULL,
  "executed_at"       TEXT NULL
);

CREATE INDEX "idx_ai_tool_calls_conversation"
  ON "ai_tool_calls" ("conversation_id", "created_at");

-- 6. AI Dismissed Findings (compose reviewer)
CREATE TABLE "ai_dismissed_findings" (
  "app_id"          TEXT NOT NULL REFERENCES "applications"("id") ON DELETE CASCADE,
  "finding_hash"    TEXT NOT NULL,
  "dismissed_at"    TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY ("app_id", "finding_hash")
);

-- 7. AI Compose Review Cache
CREATE TABLE "ai_compose_review_cache" (
  "app_id"          TEXT NOT NULL REFERENCES "applications"("id") ON DELETE CASCADE,
  "content_sha256"  TEXT NOT NULL,
  "findings_json"   JSONB NOT NULL,
  "conversation_id" TEXT NULL REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "created_at"      TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY ("app_id", "content_sha256")
);

-- 8. servers — AI access controls
ALTER TABLE "servers" ADD COLUMN "ai_read_access" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "servers" ADD COLUMN "ai_write_access" TEXT NOT NULL DEFAULT 'enabled';

-- 9. script_runs — AI provenance linkage
ALTER TABLE "script_runs" ADD COLUMN "initiated_by" TEXT NOT NULL DEFAULT 'operator';
ALTER TABLE "script_runs" ADD COLUMN "ai_conversation_id" TEXT NULL REFERENCES "ai_conversations"("id") ON DELETE SET NULL;
ALTER TABLE "script_runs" ADD COLUMN "ai_tool_call_id" TEXT NULL REFERENCES "ai_tool_calls"("id") ON DELETE SET NULL;
