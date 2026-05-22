# Technical Research: Amnezia VPN Integration

## Objective
Determine the technical mechanisms required to implement Amnezia VPN installation and server management via SSH.

## Key Findings

### 1. Connecting to the VPS
The application already has the `ssh2` dependency in `package.json`.
We can use `ssh2` to establish an SSH connection to the target VPS using either a password or a private key (which mimics the fields present in the Amnezia client).

### 2. Installing Amnezia VPN
The official Amnezia VPN uses an automated installation approach.
Usually, it involves deploying a docker-compose payload or running a specific installation script. To mimic the Amnezia VPN client:
- We can connect via SSH.
- We need to either execute a standard setup script from Amnezia or use an automation payload to install the server-side components (like OpenVPN, WireGuard, Xray, depending on Amnezia configuration).
MVP uses `scripts/vpn/install-amnezia.sh` — a Docker-based install script. Script contents are out-of-scope of this spec; spec only mandates the orchestration (SSH to target, execute script, stream output).

### 3. Server Configuration & Secret Storage
The application will need a database table (`servers`) to store connection details.
Since storing SSH credentials (passwords/private keys) is highly sensitive, we need to apply AES encryption on the database side or restrict to "Forget credentials" mode if the user requests it. Wait, the spec says "System MUST securely handle and store server credentials". We will use AES encryption (e.g., Node's `crypto` module) when storing credentials in PostgreSQL, and discard them if the user chooses "forget credentials".

### 4. Drift Detection (DevOps Feature)
To detect "drift", we can periodically poll the server via SSH (if credentials are kept) to check if the Docker containers for the VPN are still running and matching the expected configuration. If a user manually stopped the VPN container, we flag it as "drift" in the UI.

## Conclusion
The current tech stack (`ssh2`, `drizzle-orm`, `express`) is perfectly suited for this. We will:
1. Create a `Server` entity.
2. Build an API endpoint to add the server and run SSH payload.
3. Build a drift detection cron/background task.

---

## Research: Script Executor & Dynamic Parameter Parsing

### 5. Script Storage Architecture (Dual-Source)

**Requirement**: Scripts come from two sources — filesystem (`scripts/` directory) and user-created (stored in DB).

**Design**:
- On application startup, `script-indexer.ts` scans the `scripts/` directory recursively.
- Each file is hashed (SHA-256) and compared to the DB record (by `path` + `contentHash`).
- New/changed files are upserted into the `scripts` table with `source: 'filesystem'`.
- Files removed from disk are flagged or deleted from DB.
- Custom scripts created via UI are stored with `source: 'database'` — never overwritten by filesystem indexing.
- On conflict (same `path` in both sources), filesystem wins during re-index.

**Parsing**: Each script file is read and scanned for `# @param` annotations using `script-parser.ts`.

### 6. `@param` Annotation Format

**Syntax**: `# @param NAME:type[(opts)]:default:description`

| Component | Required | Example | Notes |
|-----------|----------|---------|-------|
| `NAME` | Yes | `PACKAGES` | Uppercase, becomes env var `PARAM_PACKAGES` |
| `type` | Yes | `string`, `number`, `boolean`, `select:a,b,c` | Determines UI widget |
| `default` | No | `docker curl git` | Empty = no default. MUST NOT contain `:` (parse warning if found). |
| `description` | No | `Space-separated list of packages` | CAN contain `:` (captured as remainder after 3rd `:`). |

**Pinned grammar**: Split on `:` into exactly 4 segments: `NAME`, `type+opts`, `default`, `description` (remainder). If fewer than 4 `:`-separated segments, the line is not a valid `@param`. If `default` contains `:`, emit a parse warning and treat the ambiguous split as `[NAME, type+opts, everything-before-colon-in-desc, everything-after]` — but recommend users avoid `:` in defaults.

**Parsing algorithm**:
1. Read file line by line.
2. Match regex: `^#\s*@param\s+(\w+):(\w+(?::[\w,]+)?):([^:]*):(.*)$`
3. For `select` type, extract options from `select:opt1,opt2,opt3`.
4. Store parsed params in `script_params` table with `order` = line number.

**Edge cases**:
- Empty default → `defaultValue: null`
- Unsupported type → fall back to `string` with a warning log
- Missing `@param` → script has no dynamic params (execute button only, no form)
- Description with colons → captured as remainder after 3rd `:` split (4th segment and beyond joined)

**Example script**:
```bash
#!/bin/bash
# @description Initialize server with base packages
# @param PACKAGES:string:docker curl git:Space-separated list of packages to install
# @param VERBOSE:boolean:false:Enable verbose output
# @param MODE:select:quick,full,custom:Installation mode

apt-get update
apt-get install -y $PARAM_PACKAGES

if [ "$PARAM_VERBOSE" = "true" ]; then
  echo "Installed: $PARAM_PACKAGES"
fi
```

### 7. Script Execution via SSH

**Flow**:
1. User selects a script and a server, fills in params (if any).
2. Frontend sends `POST /api/scripts/:id/execute` with `{ serverId, params }`.
3. Backend creates a `ScriptExecution` record (status: `pending`).
4. Backend resolves server credentials from DB (decrypt via `crypto.ts`).
5. Backend opens SSH connection via `ssh2`.
6. Script content is written to a temp file on the remote server via `mktemp -p /tmp script.XXXXXX.sh`, chmod 700, with `trap rm -f $TMP EXIT` cleanup.
7. `PARAM_*` env vars are prefixed to the execution command: `PARAM_FOO=bar PARAM_BAZ=qux bash $TMPFILE`.
8. stdout/stderr are streamed via WebSocket back to the frontend.
9. On exit, `exitCode` and `status` are recorded in `script_executions`.

**WebSocket protocol**: Server pushes `{ type: "stdout"|"stderr"|"exit", data/code }` messages. Client connects to `WS /ws/executions/:executionId` after receiving the execution ID from the REST response.

### 8. Existing Patterns in the Codebase

The `ssh2` library is already a dependency. The existing `server/services/ssh.ts` will be extended (or `script-executor.ts` will use it as a base) to support:
- Writing script content to remote temp files
- Setting environment variables on the remote command
- Streaming stdout/stderr via data events on the SSH channel
