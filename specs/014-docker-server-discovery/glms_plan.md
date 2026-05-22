I now have a complete picture. Here is the full report.

---

## 1. Server Database Schema (table columns)

**File**: `C:\Repositories\underundre\helpers\undev\devops-app\server\db\schema.ts` (lines 14–53)

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `text` PK | — | UUID |
| `label` | `text` NOT NULL | — | Human name |
| `host` | `text` NOT NULL | — | Hostname/IP |
| `port` | `integer` NOT NULL | `22` | SSH port |
| `ssh_user` | `text` NOT NULL | — | SSH username |
| `ssh_auth_method` | `text` NOT NULL | `'key'` | `'key'` or `'password'` |
| `ssh_private_key` | `text` nullable | — | Plaintext PEM (legacy, pre-Feature 011) |
| `ssh_password` | `text` nullable | — | Plaintext password (legacy) |
| `scripts_path` | `text` NOT NULL | — | Path for deploy scripts on remote |
| `status` | `text` NOT NULL | `'unknown'` | `'online'` / `'offline'` / `'unknown'` |
| `last_health_check` | `text` nullable | — | ISO timestamp |
| `scan_roots` | `jsonb` NOT NULL | `["/opt","/srv","/var/www","/home"]` | Paths for app scanning |
| `ssh_private_key_encrypted` | `text` nullable | — | Envelope-encrypted `{ct,iv,tag}` JSON blob |
| `ssh_password_encrypted` | `text` nullable | — | Envelope-encrypted `{ct,iv,tag}` JSON blob |
| `ssh_key_fingerprint` | `text` nullable | — | `SHA256:<base64>` of active public key |
| `ssh_key_rotated_at` | `text` nullable | — | ISO timestamp |
| `host_key_fingerprint` | `text` nullable | — | SHA256 of target host key (MITM detection) |
| `cloud_provider` | `text` nullable | — | `'gcp'` / `'aws'` / `'do'` / `'hetzner'` / `'vanilla'` / NULL |
| `setup_state` | `text` NOT NULL | `'unknown'` | `'unknown'` / `'needs_initialisation'` / `'initialising'` / `'ready'` |
| `created_at` | `text` NOT NULL | — | ISO timestamp |
| `ai_read_access` | `boolean` NOT NULL | `true` | Feature 013 |
| `ai_write_access` | `text` NOT NULL | `'enabled'` | `'enabled'` / `'sandbox-only'` / `'disabled'` |

Index: `idx_servers_status_setup_state` on `(status, setup_state)`.

---

## 2. Server List UI Component

**File**: `C:\Repositories\underundre\helpers\undev\devops-app\client\pages\DashboardPage.tsx`

- Route: `"/"` in `App.tsx` (line 34)
- Fetches `GET /api/servers` via `useQuery({ queryKey: ["servers"] })`
- Renders a responsive grid (`md:grid-cols-2 lg:grid-cols-3`) of `<Link>` cards, each showing:
  - `server.label` (title)
  - `<StatusBadge>` (online=green, offline=red, unknown=gray)
  - `server.host:server.port`
  - `server.lastHealthCheck` as "Last check" timestamp
  - `<AnalyzeButton>` when offline (AI incident copilot)
- Empty state: "No servers configured. Click 'Add Server' to get started."
- **Legacy "Add Server" dialog** (inline in DashboardPage): simple form with label, host, port, SSH user, auth method (key/password), private key or password, scan roots. Posts to `POST /api/servers` then optionally calls `POST /api/servers/:id/verify`.
- The **new Feature 011 onboarding form** (`AddServerForm.tsx`) is a separate component with probe-then-onboard flow (see below), but it is NOT currently rendered in DashboardPage — the DashboardPage still uses the legacy inline form.

---

## 3. "Self" / "Localhost" Server Detection

**No concept of a "self" or "localhost" server exists.** The codebase has:

- **No special-casing** of `127.0.0.1`, `localhost`, or any "self-host" concept for server records.
- `ensure-ssh.ts` restores ALL server rows from DB into the SSH pool at boot, with no distinction between local/remote.
- `server-onboarding.ts` always treats every server as a remote SSH target.
- The SSRF guard (`ssrf-guard.test.ts`) explicitly **blocks** `127.0.0.1` as a health probe URL — the system actively prevents local-loop usage in certain contexts.
- No bootstrap/seed logic creates any initial server row at startup. The `startup()` function in `server/index.ts` runs migrations, zombie triage, SSH pool restore, boot checks, and notification-preferences seeding — but **never** inserts a server row.

---

## 4. SSH Connection Architecture

**SSH Pool**: `C:\Repositories\underundre\helpers\undev\devops-app\server\services\ssh-pool.ts`

- Singleton `SSHPool` class (`sshPool` export) maintaining a `Map<serverId, PoolEntry>` of persistent SSH2 `Client` connections.
- **Connect config**: `host`, `port`, `username`, `privateKey` (PEM content) or `password`, `readyTimeout: 10s`, keepalive every 30s.
- **Reconnection**: exponential backoff (1s base, max 30s) on error/close events.
- **Methods**: `connect()`, `exec()` (with timeout), `execStream()`, `openTunnel()` (SSH port-forward to remote host:port via local `127.0.0.1:ephemeral`), `disconnect()`, `disconnectAll()`.

**Key Storage & Encryption**:

- Legacy path: `ssh_private_key` and `ssh_password` columns stored **plaintext** in DB.
- Feature 011 path: credentials are envelope-encrypted (AES-256-GCM) via `envelope-cipher.ts` using `DASHBOARD_MASTER_KEY` env var (base64 32-byte key). Stored as JSON blobs `{ct, iv, tag}` in `ssh_private_key_encrypted` and `ssh_password_encrypted`.
- **Serialization**: `serializer.ts` strips all secret columns (`sshPrivateKey`, `sshPassword`, `sshPrivateKeyEncrypted`, `sshPasswordEncrypted`) from API responses.
- **Boot restore**: `restoreSshPoolFromDb()` in `ensure-ssh.ts` reads all server rows, connects in parallel via `Promise.allSettled`, decrypting credentials on the fly (uses `sshPrivateKey` / `sshPassword` plaintext columns — NOTE: does NOT decrypt envelope-encrypted variants here, which means the legacy path is used for pool restore).

**Onboarding SSH Probe** (`server-onboarding.ts`):

- One-shot `ssh2.Client` connection, **not** the pool.
- 15s timeout.
- Captures host key fingerprint via `hostVerifier` callback (always accepts, compares after session).
- Three auth modes: paste-key, paste-password, generate-key (Ed25519 keypair generated server-side).

---

## 5. Onboarding Flow / Initial Server Setup

There are **two parallel flows**:

### Flow A — Legacy (DashboardPage inline dialog)

1. `POST /api/servers` with label, host, port, sshUser, auth method, key/password, scriptsPath
2. Optional `POST /api/servers/:id/verify` — SSH connect test, sets `status` to `online`/`offline`

### Flow B — Feature 011 Zero-Touch Onboarding (AddServerForm.tsx)

1. **Probe**: `POST /api/servers/probe` with host, port, sshUser, bootstrapAuth (key/password/generate-key)
   - One-shot SSH session
   - Runs cloud-init detection + compatibility probes (Docker, sudo, disk, swap, OS, arch)
   - Returns `probeToken` (10-min TTL, in-memory cache), `cloudProvider`, `compatibility` report, `hostKeyFingerprint`, optionally `generatedPublicKey`
2. **Compatibility review**: UI shows the report, operator acknowledges warnings
3. **Onboard**: `POST /api/servers/onboard` with label, host, port, sshUser, scriptsPath, `probeToken`, `managedSshCredential`, `acknowledgedWarnings`
   - Consumes probeToken, validates compatibility, envelope-encrypts credentials, inserts server row, writes audit entry
4. **Initialize** (if `setupState === 'needs_initialisation'`): `POST /api/servers/:id/initialise` — runs `setup-vps.sh` via scripts-runner, handles password-to-key credential rotation
5. **Key rotation**: `POST /api/servers/:id/rotate-key` — generates new Ed25519 keypair, installs on target, updates DB

**SetupWizard.tsx** (`client/components/servers/SetupWizard.tsx`): A checklist-based UI for running setup tasks (deploy-user, SSH hardening, firewall, swap, Node.js, SSL) via `POST /api/servers/:id/setup`. This is the older/legacy setup wizard.

**InitialiseWizard.tsx** (`client/components/servers/InitialiseWizard.tsx`): The Feature 011 version — triggered when `server.setupState === 'needs_initialisation'`, renders on `ServerPage.tsx` (line 301–328).

---

## 6. Pre-Seeding a Server at Startup

**No mechanism exists to pre-seed a server.** The startup sequence in `server/index.ts` (lines 153–345) does:

- DB migration
- Interrupted-deploys cache init
- Deploy-lock pool check
- Scripts manifest validation
- Various cron startups
- Zombie deploy/run triage
- SSH pool restore from existing DB rows
- Boot checks (master key canary)
- Notification preferences seeding

It does NOT insert any server rows. To pre-seed a server, you would need to add custom startup logic that inserts a row into the `servers` table (after migration, before `restoreSshPoolFromDb()`). The `restoreSshPoolFromDb()` call would then pick it up and connect.

---

## Key File Paths Summary

| Artifact | Absolute Path |
|---|---|
| DB Schema (servers table) | `C:\Repositories\underundre\helpers\undev\devops-app\server\db\schema.ts` |
| Server API routes | `C:\Repositories\underundre\helpers\undev\devops-app\server\routes\servers.ts` |
| Server list UI | `C:\Repositories\underundre\helpers\undev\devops-app\client\pages\DashboardPage.tsx` |
| Server detail UI | `C:\Repositories\underundre\helpers\undev\devops-app\client\pages\ServerPage.tsx` |
| Feature 011 Add Server form | `C:\Repositories\underundre\helpers\undev\devops-app\client\components\servers\AddServerForm.tsx` |
| Legacy Setup Wizard | `C:\Repositories\underundre\helpers\undev\devops-app\client\components\servers\SetupWizard.tsx` |
| Feature 011 Initialise Wizard | `C:\Repositories\underundre\helpers\undev\devops-app\client\components\servers\InitialiseWizard.tsx` |
| Server onboarding service | `C:\Repositories\underundre\helpers\undev\devops-app\server\services\server-onboarding.ts` |
| Server bootstrap service | `C:\Repositories\underundre\helpers\undev\devops-app\server\services\server-bootstrap.ts` |
| SSH pool | `C:\Repositories\underundre\helpers\undev\devops-app\server\services\ssh-pool.ts` |
| SSH ensure/restore | `C:\Repositories\underundre\helpers\undev\devops-app\server\lib\ensure-ssh.ts` |
| Envelope cipher | `C:\Repositories\underundre\helpers\undev\devops-app\server\lib\envelope-cipher.ts` |
| Secret serializer | `C:\Repositories\underundre\helpers\undev\devops-app\server\lib\serializer.ts` |
| App startup | `C:\Repositories\underundre\helpers\undev\devops-app\server\index.ts` |
| Boot checks | `C:\Repositories\underundre\helpers\undev\devops-app\server\lib\boot-checks.ts` |
| App router | `C:\Repositories\underundre\helpers\undev\devops-app\client\App.tsx` |
