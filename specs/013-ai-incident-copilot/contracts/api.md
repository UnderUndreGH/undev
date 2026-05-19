# API Contracts: AI Incident Copilot

**Feature**: 013 | **Date**: 2026-05-19

All endpoints require `requireAuth` middleware. AI endpoints additionally
enforce role checks:

- `ai:viewer` — read conversation/history/spend summaries
- `ai:operator` — create analyses, approve/reject tool calls
- `ai:admin` — provider/settings/kill-switch/rate-card/server policy changes

All mutations emit `audit_entries`. Rate-limit: 10 inference-creating
requests/min per user (FR-052); push-triggered system analyses also have a
global system rate limit.

## AI Settings

### `GET /api/ai/settings`

Returns AI configuration (singleton row).

Role: `ai:viewer`.

**Response** `200`:
```json
{
  "enabled": false,
  "defaultProvider": null,
  "systemPromptContent": null,
  "monthlyTokenBudgetIn": 5000000,
  "monthlyTokenBudgetOut": 1000000,
  "perIncidentTokenCapIn": 100000,
  "perIncidentTokenCapOut": 20000,
  "globalToolUseEnabled": true,
  "globalKillSwitchEngaged": false,
  "defaultSandbox": false,
  "conversationRetentionDays": 90
}
```

### `PUT /api/ai/settings`

Updates AI settings. Emits `ai.provider_configured` audit when provider,
model, budget, or tool-use fields change.

Role: `ai:admin`.

**Body**: Same shape as GET response (all fields optional, merge-patch semantics).

**Response** `200`: Updated settings object.

### `PUT /api/ai/settings/kill-switch`

Engages or releases the global kill switch. Emits `ai.kill_switch_engaged` or `ai.kill_switch_released`.

Role: `ai:admin`.

**Body**:
```json
{ "engaged": true }
```

**Response** `200`: `{ "engaged": true }`

## Provider Keys

### `GET /api/ai/providers`

Lists configured providers. API keys are NEVER returned (write-only).

Role: `ai:viewer`.

**Response** `200`:
```json
[{
  "id": "uuid",
  "provider": "anthropic",
  "modelDefault": "claude-sonnet-4-20250514",
  "endpointUrl": null,
  "hasApiKey": true,
  "isActive": true,
  "rateCardInputPerMtok": 3.0,
  "rateCardOutputPerMtok": 15.0,
  "createdAt": "2026-05-19T...",
  "rotatedAt": null
}]
```

### `POST /api/ai/providers`

Creates a provider configuration. Emits `ai.provider_configured`.

Role: `ai:admin`.

**Body**:
```json
{
  "provider": "anthropic",
  "modelDefault": "claude-sonnet-4-20250514",
  "endpointUrl": null,
  "apiKey": "sk-ant-...",
  "rateCardInputPerMtok": 3.0,
  "rateCardOutputPerMtok": 15.0
}
```

**Response** `201`: Provider object (no `apiKey`).

**Errors**:
- `503`: Envelope-cipher master key unavailable (`ai.provider_configure_failed` audit emitted, key not persisted)

### `PUT /api/ai/providers/:id`

Updates provider config. Changing `apiKey` emits `ai.provider_key_rotated`.

Role: `ai:admin`.

**Body**: Same as POST (all fields optional).

**Response** `200`: Updated provider object.

### `DELETE /api/ai/providers/:id`

Deactivates a provider (soft-delete: sets `isActive = false`).

Role: `ai:admin`.

If any `pending` or `streaming` conversation references this provider key,
deactivation returns `409` and the operator must retry after those
conversations reach a terminal status.

**Response** `204`

### `POST /api/ai/providers/:id/test`

Tests connectivity with a ≤10 token probe. Emits `ai.connection_tested`.

Role: `ai:admin`.

**Response** `200`:
```json
{ "ok": true, "latencyMs": 342 }
```

**Error** `502`:
```json
{ "ok": false, "error": "Provider returned 401 Unauthorized" }
```

## Conversations (Incidents)

### `POST /api/ai/conversations`

Creates a new analysis (pull trigger). Emits `ai.analysis_started`.
Starts inference in background; streams via WS channel `ai:<conversationId>`.

Role: `ai:operator`.

**Body**:
```json
{
  "targetKind": "app",
  "targetId": "app-uuid",
  "sandboxMode": false
}
```

**Response** `201`:
```json
{
  "id": "conversation-uuid",
  "status": "pending",
  "targetKind": "app",
  "targetId": "app-uuid",
  "sandboxMode": false,
  "createdAt": "2026-05-19T..."
}
```

**Errors**:
- `409`: In-flight conversation exists for same target (returns existing conversation ID)
- `402`: Monthly budget exhausted
- `503`: Global kill switch engaged
- `502`: Provider unreachable

### `GET /api/ai/conversations`

Lists conversations with filters. Pagination follows existing `?page=&limit=` convention.

Role: `ai:viewer`.

**Query params**:
- `trigger`: `pull | push` (optional)
- `targetKind`: string (optional)
- `status`: string (optional)
- `from`: ISO date (optional)
- `to`: ISO date (optional)
- `q`: full-text search over hypothesis (optional)
- `page`: integer (default 1)
- `limit`: integer (default 50, max 100)

**Response** `200`:
```json
{
  "items": [{
    "id": "uuid",
    "trigger": "pull",
    "targetKind": "app",
    "targetId": "app-uuid",
    "status": "completed",
    "sandboxMode": false,
    "hypothesis": "Container OOM-killed due to memory limit...",
    "confidence": "high",
    "tokensIn": 4521,
    "tokensOut": 1203,
    "estCostUsd": 0.0317,
    "createdAt": "...",
    "hasApprovedToolCalls": true
  }],
  "total": 142,
  "page": 1,
  "limit": 50
}
```

### `GET /api/ai/conversations/:id`

Returns full conversation with messages and tool calls.

Role: `ai:viewer`.

**Response** `200`:
```json
{
  "id": "uuid",
  "trigger": "pull",
  "targetKind": "app",
  "targetId": "app-uuid",
  "model": "claude-sonnet-4-20250514",
  "status": "completed",
  "sandboxMode": false,
  "hypothesis": "...",
  "confidence": "high",
  "tokensIn": 4521,
  "tokensOut": 1203,
  "estCostUsd": 0.0317,
  "priorConversationId": null,
  "createdAt": "...",
  "messages": [{
    "id": "msg-uuid",
    "role": "system",
    "seq": 0,
    "contentText": "You are an incident copilot...",
    "contentMeta": null,
    "createdAt": "..."
  }],
  "toolCalls": [{
    "id": "tc-uuid",
    "manifestId": "deploy/server-rollback",
    "paramsJson": { "appId": "..." },
    "targetServerId": "server-uuid",
    "status": "completed",
    "dryRun": false,
    "scriptRunId": "run-uuid",
    "createdAt": "...",
    "decidedAt": "...",
    "executedAt": "..."
  }]
}
```

### `POST /api/ai/conversations/:id/recover`

Recovers an archived conversation. Emits `ai.conversation_recovered`.

Role: `ai:admin`.

### `PATCH /api/ai/conversations/:id`

Updates per-conversation controls such as sandbox/dry-run mode.

Role: `ai:operator`.

**Body**:
```json
{ "sandboxMode": true }
```

**Response** `200`: Updated conversation summary.

### `GET /api/ai/conversations/latest`

Returns latest non-archived conversation for a target, used by dashboard
badges.

Role: `ai:viewer`.

**Query params**: `targetKind`, `targetId`, `trigger` (optional)

**Response** `200`: Conversation object with `archivedAt: null`.

**Error** `404`: Conversation not found or not archived.

## Tool Calls

### `POST /api/ai/tool-calls/:id/approve`

Approves a proposed tool call. Emits `ai.tool_call_approved` then dispatches execution.

Role: `ai:operator`.

**Body**:
```json
{
  "paramsJson": { "appId": "..." },
  "targetServerId": "server-uuid",
  "ackText": "approve",
  "typedTarget": "my-app",
  "approvalChallengeId": "challenge-uuid"
}
```

Fields are optional — omit to accept LLM's original proposal. Include to override (operator-edited params).
Confirmation fields are required by danger level:
- `low`: no extra field
- `medium`: `ackText` must equal `approve`
- `high`: `typedTarget` must match expected app/server name and
  `approvalChallengeId` must reference a server-issued challenge whose
  5-second cooldown has elapsed

**Response** `200`:
```json
{ "id": "tc-uuid", "status": "executing" }
```

**Errors**:
- `403`: Server policy disallows (`blocked_by_policy`)
- `409`: Deploy lock held (`blocked_by_lock`)
- `422`: Params failed Zod validation
- `428`: Required danger-tier confirmation missing or cooldown not elapsed

### `POST /api/ai/tool-calls/:id/challenge`

Creates a server-side approval challenge for high-danger tool calls. The
challenge records the expected typed target and `availableAt` timestamp.

Role: `ai:operator`.

**Response** `201`:
```json
{
  "challengeId": "challenge-uuid",
  "expectedTargetHint": "type the app or server name",
  "availableAt": "2026-05-19T...Z"
}
```

### `POST /api/ai/tool-calls/:id/reject`

Rejects a proposed tool call. Emits `ai.tool_call_rejected`.

Role: `ai:operator`.

**Response** `200`:
```json
{ "id": "tc-uuid", "status": "rejected" }
```

## Compose Reviewer

### `POST /api/ai/compose-review`

Triggers LLM review of compose content. Returns cached result if content unchanged.

Role: `ai:operator`.

**Body**:
```json
{
  "appId": "app-uuid",
  "composeContent": "version: '3.8'\nservices:\n  web:\n    image: nginx:latest\n    ..."
}
```

**Response** `200`:
```json
{
  "findings": [{
    "severity": "warn",
    "line": 4,
    "finding": "`image: nginx:latest` — pinned tag recommended",
    "suggestion": "Use a specific version tag like `nginx:1.27`",
    "hash": "sha256:abc...",
    "source": "static"
  }, {
    "severity": "error",
    "line": 8,
    "finding": "Plaintext secret pattern detected in env",
    "suggestion": "Move to env-vars-store",
    "hash": "sha256:def...",
    "source": "llm"
  }],
  "cached": false,
  "conversationId": "conv-uuid"
}
```

### `POST /api/ai/compose-review/dismiss`

Dismisses a finding for an app.

Role: `ai:operator`.

**Body**:
```json
{
  "appId": "app-uuid",
  "findingHash": "sha256:abc..."
}
```

**Response** `204`

### `DELETE /api/ai/compose-review/dismiss`

Un-dismisses a finding.

**Body**: Same as POST.

**Response** `204`

## Server AI Policy

### `PATCH /api/servers/:id` (extension)

Existing PATCH route gains two new optional fields:

Role: existing server settings role plus `ai:admin` for AI fields.

```json
{
  "aiReadAccess": true,
  "aiWriteAccess": "sandbox-only"
}
```

Emits `ai.server_policy_changed` when AI fields change.

Validation: `aiWriteAccess` must be `enabled | sandbox-only | disabled`.

## Cost Dashboard

### `GET /api/ai/spend`

Returns aggregated spend data.

Role: `ai:viewer`.

**Query params**:
- `period`: `today | month` (default `month`)

**Response** `200`:
```json
{
  "period": "month",
  "tokensIn": 1250000,
  "tokensOut": 320000,
  "estCostUsd": 12.35,
  "conversationCount": 47,
  "budgetIn": 5000000,
  "budgetOut": 1000000,
  "budgetExhausted": false
}
```

### `GET /api/ai/spend/conversations`

Per-conversation breakdown.

Role: `ai:viewer`.

**Query params**: `page`, `limit`, `from`, `to`

**Response** `200`:
```json
{
  "items": [{
    "conversationId": "uuid",
    "trigger": "push",
    "targetKind": "app",
    "targetId": "app-uuid",
    "tokensIn": 4521,
    "tokensOut": 1203,
    "estCostUsd": 0.0317,
    "status": "completed",
    "createdAt": "..."
  }],
  "total": 47,
  "page": 1
}
```

## WebSocket Events

Channel: `ai:<conversationId>`

### Streaming delta
```json
{ "type": "delta", "content": "The root cause appears to be..." }
```

### Tool call proposed
```json
{
  "type": "tool_call",
  "toolCall": {
    "id": "tc-uuid",
    "manifestId": "deploy/server-rollback",
    "paramsJson": { "appId": "..." },
    "status": "proposed",
    "dryRun": false
  }
}
```

### Tool call state change
```json
{
  "type": "tool_call_update",
  "toolCallId": "tc-uuid",
  "status": "executing"
}
```

### Conversation complete
```json
{
  "type": "complete",
  "hypothesis": "...",
  "confidence": "high",
  "usage": { "inputTokens": 4521, "outputTokens": 1203 }
}
```

### Error
```json
{ "type": "error", "message": "Provider rate-limited", "retryAfterMs": 30000 }
```

## Static Lint (non-LLM)

### `POST /api/ai/compose-lint`

Runs static lint rules only (zero LLM cost). Used for keystroke-debounced inline feedback.

**Body**:
```json
{
  "appId": "app-uuid",
  "composeContent": "..."
}
```

**Response** `200`:
```json
{
  "findings": [{
    "severity": "warn",
    "line": 4,
    "finding": "`image: nginx:latest` — pinned tag recommended",
    "suggestion": "Use a specific version tag",
    "hash": "sha256:abc...",
    "source": "static"
  }]
}
```
