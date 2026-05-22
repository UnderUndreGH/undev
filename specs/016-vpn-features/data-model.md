# Data Model: Amnezia VPN Integration

## Database Schema (Drizzle ORM)

### Extends existing `servers` table

The `servers` table already exists (Features 005/006/008/009/011/013, see `server/db/schema.ts:14`). This feature adds VPN-specific columns via Drizzle migration. DO NOT redefine existing columns.

**Existing columns REUSED** (not re-created):
- `host` (text) — IP address or hostname (NOT `ipAddress`)
- `sshUser` (text) — SSH username (NOT `username`)
- `port` (integer, default 22) — SSH port (NOT `sshPort`)
- `label` (text) — Friendly name (NOT `name`)
- `sshPasswordEncrypted` (text) — Envelope-encrypted password blob (NOT `encryptedPassword`)
- `sshPrivateKeyEncrypted` (text) — Envelope-encrypted key blob (NOT `encryptedPrivateKey`)
- `sshAuthMethod` (text) — 'key' | 'password'
- `sshKeyFingerprint`, `hostKeyFingerprint`, `setupState`, `cloudProvider`, `aiReadAccess`, `aiWriteAccess` — all existing

**NEW columns to ADD**:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `vpn_status` | `text` | Not Null, Default: 'uninstalled' | VPN status: `uninstalled`, `installing`, `installed`, `error` |
| `vpn_drift_status` | `text` | Not Null, Default: 'unknown' | Drift status: `in_sync`, `drifted`, `unknown` |
| `vpn_installed_at` | `text` | Nullable | ISO timestamp when VPN was installed |
| `vpn_remove_on_delete` | `boolean` | Not Null, Default: false | Whether to uninstall VPN on server deletion (currently always false per FR-004) |
| `scripts_enabled` | `boolean` | Not Null, Default: false | Per-server script execution toggle (Feature V gate) |

### `scripts` table (NEW)

Stores script metadata indexed from filesystem and custom scripts created via UI.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `text` | Primary Key | Unique identifier (UUID) |
| `path` | `text` | Not Null, Unique | Relative path within scripts dir (e.g., `server-ops/initialise`) |
| `name` | `text` | Not Null | Display name derived from filename |
| `description` | `text` | Nullable | Extracted from `# @description` annotation or empty |
| `source` | `text` | Not Null, Default: 'filesystem' | Origin: `filesystem` or `database` |
| `content` | `text` | Not Null | Full script content |
| `contentHash` | `text` | Not Null | SHA-256 hash of content (for change detection during re-index) |
| `createdAt` | `text` | Not Null | Timestamp of creation |
| `updatedAt` | `text` | Not Null | Timestamp of last update |

### `script_params` table (NEW)

Stores parsed `@param` annotations for each script. Re-parsed on re-index.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `text` | Primary Key | Unique identifier (UUID) |
| `scriptId` | `text` | Foreign Key → `scripts.id`, ON DELETE CASCADE | Parent script |
| `name` | `text` | Not Null | Parameter name (uppercase, used as `PARAM_<NAME>`) |
| `type` | `text` | Not Null, Default: 'string' | Field type: `string`, `number`, `boolean`, `select` |
| `defaultValue` | `text` | Nullable | Default value from annotation |
| `description` | `text` | Nullable | Human-readable description |
| `options` | `jsonb` | Nullable | For `select` type: `["a", "b", "c"]` |
| `order` | `integer` | Not Null, Default: 0 | Display order (order of appearance in script) |

### REUSES existing `script_runs` table (Feature 005, `server/db/schema.ts:350`)

No new `script_executions` table. Execution records go into `script_runs`. Key existing columns:
- `scriptId`, `serverId`, `userId`, `params` (jsonb), `status`, `startedAt`, `finishedAt`, `exitCode`, `errorMessage`, `logFilePath`
- `initiatedBy`, `aiConversationId`, `aiToolCallId` (Feature 013 AI integration)

Execution output is written to `script_runs.logFilePath` (existing Feature 005 pattern), NOT to an `output` text column.

## API Contracts

### `POST /api/servers`
Adds a new server, optionally triggers Amnezia VPN installation, and tests connection.
**Request Body**:
```json
{
  "label": "My VPN",
  "host": "192.168.1.5",
  "port": 22,
  "sshUser": "root",
  "password": "my_password",
  "privateKey": "-----BEGIN RSA PRIVATE KEY...-----",
  "storeCredentials": true,
  "installVpn": true
}
```
**Response (201)**:
```json
{
  "id": "uuid",
  "label": "My VPN",
  "host": "192.168.1.5",
  "vpnStatus": "installing",
  "vpnDriftStatus": "unknown"
}
```

### `DELETE /api/servers/:id`
Deletes a server from the application (App View Only).
**Response (200)**:
```json
{
  "success": true
}
```

### `GET /api/servers`
Lists all servers and their current status (VPN & Drift status).
**Response (200)**:
```json
[
  {
    "id": "uuid",
    "label": "My VPN",
    "host": "192.168.1.5",
    "sshUser": "root",
    "vpnStatus": "installed",
    "vpnDriftStatus": "drifted",
    "scriptsEnabled": false
  }
]
```

---

## API Contracts — Scripts

### `GET /api/scripts`
Returns a tree-structured list of all indexed scripts with their params.
**Response (200)**:
```json
[
  {
    "id": "uuid",
    "path": "server-ops/initialise",
    "name": "initialise",
    "description": "Initialize server with base packages",
    "source": "filesystem",
    "params": [
      {
        "name": "PACKAGES",
        "type": "string",
        "defaultValue": "docker curl git",
        "description": "Space-separated list of packages to install",
        "options": null,
        "order": 0
      }
    ]
  }
]
```

### `GET /api/scripts/:id`
Returns a single script with full content and params.
**Response (200)**:
```json
{
  "id": "uuid",
  "path": "server-ops/initialise",
  "name": "initialise",
  "description": "Initialize server with base packages",
  "source": "filesystem",
  "content": "#!/bin/bash\n# @param PACKAGES:string:docker curl git:Space-separated list of packages to install\n\napt-get update && apt-get install -y $PARAM_PACKAGES",
  "params": [...]
}
```

### `POST /api/scripts`
Creates a custom script (stored in DB, `source='database'`). Filesystem-sourced scripts CANNOT be created via this endpoint — they are indexed from disk.
**Request Body**:
```json
{
  "path": "custom/my-script",
  "content": "#!/bin/bash\n# @param NAME:string::Your name\necho \"Hello $PARAM_NAME\""
}
```
**Response (201)**:
```json
{
  "id": "uuid",
  "path": "custom/my-script",
  "name": "my-script",
  "source": "database"
}
```

### `PUT /api/scripts/:id`
Updates a custom script's content. Filesystem-sourced scripts (`source='filesystem'`) return 403.
**Request Body**:
```json
{
  "content": "#!/bin/bash\n# @param NAME:string:World:Your name\necho \"Hello $PARAM_NAME\""
}
```

### `DELETE /api/scripts/:id`
Deletes a custom script. Filesystem-sourced scripts return 403 (manage via filesystem + re-index).
**Response (200)**:
```json
{
  "success": true
}
```

### `POST /api/scripts/:id/execute`
Executes a script on a server. Returns execution ID for streaming. Rate-limited: max 3 concurrent per server (returns 429 when exceeded).
**Request Body**:
```json
{
  "serverId": "uuid",
  "params": {
    "PACKAGES": "nginx docker"
  }
}
```
**Response (202)**:
```json
{
  "executionId": "uuid",
  "status": "pending"
}
```

### `GET /api/scripts/executions/:executionId`
Returns execution status and output (via `script_runs` / `logFilePath`).
**Response (200)**:
```json
{
  "id": "uuid",
  "scriptId": "uuid",
  "serverId": "uuid",
  "status": "success",
  "exitCode": 0,
  "startedAt": "2026-05-23T10:00:00Z",
  "finishedAt": "2026-05-23T10:00:05Z"
}
```

### `WS /ws/executions/:executionId`
WebSocket for real-time output streaming.
**Auth**: Session cookie required. On handshake, server verifies session AND that the execution belongs to the user (`script_runs.userId === session.userId`). Unauthenticated/unauthorized connections are closed with code 1008 (policy violation) and HTTP 401.
**Messages (server → client)**:
```json
{ "type": "stdout", "data": "Installing packages..." }
{ "type": "stderr", "data": "Warning: ...\" }
{ "type": "exit", "code": 0 }
```

### `POST /api/scripts/reindex`
Triggers re-indexing of the filesystem scripts directory. Called on startup or on demand via UI "Re-scan" button.
**Response (200)**:
```json
{
  "indexed": 12,
  "added": 2,
  "updated": 1,
  "removed": 0
}
```
