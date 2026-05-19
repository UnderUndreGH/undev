# Data Model: AI Incident Copilot

**Feature**: 013 | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md)

## Migration: `0013_ai_incident_copilot.sql`

Sequence: feature 012 reserves `0012`, this feature gets `0013`.
Merge order: `0012 → 0013`.

### New tables

```sql
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
  "monthly_token_budget_in"         INTEGER NOT NULL DEFAULT 5000000,
  "monthly_token_budget_out"        INTEGER NOT NULL DEFAULT 1000000,
  "per_incident_token_cap_in"       INTEGER NOT NULL DEFAULT 100000,
  "per_incident_token_cap_out"      INTEGER NOT NULL DEFAULT 20000,
  "global_tool_use_enabled"         BOOLEAN NOT NULL DEFAULT true,
  "global_kill_switch_engaged"      BOOLEAN NOT NULL DEFAULT false,
  "default_sandbox"                 BOOLEAN NOT NULL DEFAULT false,
  "conversation_retention_days"     INTEGER NOT NULL DEFAULT 90,
  "updated_at"                      TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

INSERT INTO "ai_settings" ("id") VALUES (1);

-- 2. AI Provider Keys
CREATE TABLE "ai_provider_keys" (
  "id"                    TEXT PRIMARY KEY,
  "provider"              TEXT NOT NULL CHECK ("provider" IN ('anthropic', 'openai', 'ollama')),
  "model_default"         TEXT NOT NULL,
  "endpoint_url"          TEXT NULL,
  "api_key_encrypted"     TEXT NOT NULL,
  "is_active"             BOOLEAN NOT NULL DEFAULT true,
  "rate_card_input_per_mtok"  REAL NULL,
  "rate_card_output_per_mtok" REAL NULL,
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
    'cap_exhausted', 'aborted_by_kill_switch', 'provider_rate_limited'
  )),
  "sandbox_mode"            BOOLEAN NOT NULL DEFAULT false,
  "prior_conversation_id"   TEXT NULL REFERENCES "ai_conversations"("id"),
  "hypothesis"              TEXT NULL,
  "confidence"              TEXT NULL CHECK ("confidence" IS NULL OR "confidence" IN ('high', 'medium', 'low')),
  "tokens_in"               INTEGER NOT NULL DEFAULT 0,
  "tokens_out"              INTEGER NOT NULL DEFAULT 0,
  "est_cost_usd"            REAL NOT NULL DEFAULT 0,
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

-- 4. AI Messages
CREATE TABLE "ai_messages" (
  "id"                TEXT PRIMARY KEY,
  "conversation_id"   TEXT NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
  "role"              TEXT NOT NULL CHECK ("role" IN ('system', 'user', 'assistant', 'tool')),
  "seq"               INTEGER NOT NULL,
  "content_text"      TEXT NOT NULL,
  "content_meta"      TEXT NULL,
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
  "params_json"       TEXT NOT NULL,
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
  "findings_json"   TEXT NOT NULL,
  "conversation_id" TEXT NULL REFERENCES "ai_conversations"("id") ON DELETE SET NULL,
  "created_at"      TEXT NOT NULL DEFAULT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  PRIMARY KEY ("app_id", "content_sha256")
);
```

### Modified tables

```sql
-- 8. servers — AI access controls
ALTER TABLE "servers" ADD COLUMN "ai_read_access" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "servers" ADD COLUMN "ai_write_access" TEXT NOT NULL DEFAULT 'enabled';
-- NOTE: existing servers get 'enabled' (status quo); new servers after this
-- migration get 'sandbox-only' via application-layer default in the
-- server-creation route.

-- 9. script_runs — AI provenance linkage
ALTER TABLE "script_runs" ADD COLUMN "initiated_by" TEXT NOT NULL DEFAULT 'operator';
ALTER TABLE "script_runs" ADD COLUMN "ai_conversation_id" TEXT NULL REFERENCES "ai_conversations"("id") ON DELETE SET NULL;
ALTER TABLE "script_runs" ADD COLUMN "ai_tool_call_id" TEXT NULL REFERENCES "ai_tool_calls"("id") ON DELETE SET NULL;

-- Enum CHECK constraints for new ALTERed columns are represented in
-- Drizzle/Zod validation and route-level guards. Existing project migrations
-- use reviewable SQL without post-hoc ADD CONSTRAINT for altered columns.
```

### DOWN migration (manual, operator-gated)

```sql
-- WARNING: Drop in reverse order of creation. Clear ai_tool_calls and
-- ai_messages first (FK deps).
--
-- DROP TABLE "ai_compose_review_cache";
-- DROP TABLE "ai_dismissed_findings";
-- DROP TABLE "ai_tool_calls";
-- DROP TABLE "ai_messages";
-- DROP TABLE "ai_conversations";
-- DROP TABLE "ai_provider_keys";
-- DROP TABLE "ai_settings";
-- ALTER TABLE "servers" DROP COLUMN "ai_write_access";
-- ALTER TABLE "servers" DROP COLUMN "ai_read_access";
-- ALTER TABLE "script_runs" DROP COLUMN "ai_tool_call_id";
-- ALTER TABLE "script_runs" DROP COLUMN "ai_conversation_id";
-- ALTER TABLE "script_runs" DROP COLUMN "initiated_by";
```

## Entity relationships

```
ai_settings (1 row)
    ↓ (read by all AI services)

ai_provider_keys
    ↓ 1:N
ai_conversations ←──── prior_conversation_id (self-ref)
    ↓ 1:N              ↓ 1:N
ai_messages          ai_tool_calls
                        ↓ 1:1
                     script_runs (existing, gains initiated_by + FK columns)

ai_dismissed_findings ←── apps (N:1)
ai_compose_review_cache ←── apps (N:1), ai_conversations (N:1)

servers (existing, gains ai_read_access + ai_write_access)
```

## Drizzle schema additions

New tables added to `devops-app/server/db/schema.ts`:

- `aiSettings` — singleton table (CHECK id=1)
- `aiProviderKeys` — provider config + encrypted API key
- `aiConversations` — analysis sessions
- `aiMessages` — per-conversation message log
- `aiToolCalls` — proposed/executed actions
- `aiDismissedFindings` — compose reviewer dismissals
- `aiComposeReviewCache` — content-hash keyed LLM review cache

Modified tables:
- `servers` — 2 new columns (`aiReadAccess`, `aiWriteAccess`)
- `scriptRuns` — 3 new columns (`initiatedBy`, `aiConversationId`, `aiToolCallId`)

## Audit event catalogue extension

New event types for `event-catalogue.ts` (extends `EVENT_CATALOGUE`):

| Event Type | Category | Default Enabled | Description |
|---|---|---|---|
| `ai.provider_configured` | config | true | Provider settings saved |
| `ai.provider_configure_failed` | config | true | Provider settings failed validation/sealing |
| `ai.provider_key_rotated` | security | true | API key changed |
| `ai.connection_tested` | config | true | Test connection result |
| `ai.analysis_started` | ai | true | Pull/push analysis begun |
| `ai.analysis_completed` | ai | true | Analysis finished |
| `ai.analysis_failed` | ai | true | Analysis errored |
| `ai.push_analysis_started` | ai | true | Background push analysis begun |
| `ai.push_analysis_skipped` | ai | false | Push skipped (disabled/budget) |
| `ai.push_event_absorbed_by_in_flight` | ai | false | Event absorbed by in-flight conversation |
| `ai.push_event_new_conversation_post_dedup` | ai | true | New conversation after dedup window |
| `ai.budget_exhausted_skipped_push` | ai | true | Push skipped due to budget |
| `ai.tool_call_proposed` | ai | true | LLM proposed a tool call |
| `ai.tool_call_approved` | ai | true | Operator approved |
| `ai.tool_call_rejected` | ai | true | Operator rejected |
| `ai.tool_call_executed` | ai | true | Tool call dispatched to scriptsRunner |
| `ai.tool_call_failed` | ai | true | Execution failed |
| `ai.tool_call_blocked_by_policy` | ai | true | Server policy blocked |
| `ai.tool_call_blocked_by_lock` | ai | true | Deploy lock blocked |
| `ai.tool_call_executed_destructive` | security | true | Destructive action executed (TG trigger) |
| `ai.context_masking_warning` | security | true | Secret pattern detected in context |
| `ai.cost_drift_alert` | operational | true | Token count drift > 5% |
| `ai.kill_switch_engaged` | security | true | Global kill switch ON |
| `ai.kill_switch_released` | security | true | Global kill switch OFF |
| `ai.server_policy_changed` | config | true | Per-server AI access changed |
| `ai.conversation_recovered` | ai | true | Archived conversation restored |

## Notification triggers extension

New entries for `notification_preferences` (feature 011 catalogue):

| Trigger | Class | Default |
|---|---|---|
| `ai.analysis_completed_high_severity` | success | OFF |
| `ai.tool_call_executed_destructive` | security | ON |
| `ai.budget_exhausted` | operational | ON |
| `ai.kill_switch_engaged` | security | ON |
| `ai.cost_drift_alert` | operational | ON |
| `ai.context_masking_warning` | security | ON |

## ScriptManifestEntry type extension

New field on `ScriptManifestEntry`:

```typescript
interface ScriptManifestEntry<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  // ... existing fields ...
  reversible?: boolean; // default false (conservative)
}
```

Manifest entries with explicit `reversible` values:

| Manifest ID | reversible | Rationale |
|---|---|---|
| `deploy/logs` | `true` | Read-only |
| `server-ops/health-check` | `true` | Read-only |
| `db/backup` | `true` | Creates artifact, no mutation |
| `monitoring/security-audit` | `true` | Read-only scan |
| `deploy/server-deploy` | `false` | Modifies live state |
| `deploy/project-local-deploy` | `false` | Modifies live state |
| `deploy/server-rollback` | `false` | Modifies live state |
| `deploy/deploy-docker` | `false` | Modifies live state |
| `db/restore` | `false` | Destructive overwrite |
| `docker/cleanup` | `false` | Image prune irreversible |
| `bootstrap/hard-delete` | `false` | Destructive |
| All others | `false` | Conservative default |

## In-memory structures

### Push dedup map

```typescript
// ai-push-subscriber.ts
type DedupKey = `${string}::${string}::${string}`; // target_kind::target_id::event_class
type DedupEntry = {
  firstEventAt: Date;
  conversationId: string;
};
const dedupMap = new Map<DedupKey, DedupEntry>();
// Entries expire after 300s from firstEventAt
```

### WS channel convention

- `ai:<conversationId>` — streaming deltas + tool-call state transitions
- Payload types: `{ type: "delta", content: string }`, `{ type: "tool_call", toolCall: AiToolCall }`, `{ type: "complete", usage: { inputTokens, outputTokens } }`, `{ type: "error", message: string }`
