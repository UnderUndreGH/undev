## 🔎 Scrutiny: Feature 014 — Local Transport for DevOps Dashboard

### Untested Assumptions

- [ ] **[Local transport will be transparent]** — disproved by: `sshPool` is used in ~65 files across routes, services, and tests; any abstraction layer must handle both SSH and local modes without breaking existing calls.
- [ ] **[Server model supports a "local" type]** — disproved by: `schema.ts` defines `servers` table with only `host`, `port`, `sshUser`, `sshAuthMethod`; no `transportType` or `isLocal` field exists.
- [ ] **[Child_process.exec is sufficient for local execution]** — disproved by: SSH provides keepalive, reconnect logic, connection pooling, and structured error handling; naive exec lacks these without significant rework.
- [ ] **[Existing health polling can reuse the same code path]** — disproved by: `health-poller.ts` uses `sshPool.isConnected`, `sshPool.connect`, `sshPool.exec`; local mode would need equivalent state tracking.

### Failure Modes

- [ ] **[Race condition on connection initialization]** — what happens now: multiple services call `ensureSshConnected()` concurrently for the same local server; what should happen: only one connection established, others reuse it (like SSH pool behavior).
- [ ] **[Stale process handles]** — what happens now: if a long-running script is interrupted via WebSocket abort signal, the child process may continue running locally; what should happen: SIGTERM/SIGKILL forwarded to the process.
- [ ] **[Partial state during migration]** — what happens now: if local transport fails mid-migration (e.g., `migrateExistingAppWizard`), the app remains in inconsistent state on disk; what should happen: rollback hooks or atomic operations.

### Edge Cases

- [ ] **Empty/null**: Local server with empty config object — needs validation before creating connection.
- [ ] **Boundary**: Local server at `/` root path vs subdirectory like `/opt/app` — affects how `child_process` resolves working directory for scripts.
- [ ] **Concurrent**: Multiple services (health poller, scanner, deploy) accessing local server simultaneously — needs connection pooling similar to SSH pool.
- [ ] **Stale**: Local transport holds file descriptors open longer than expected if not properly closed after script completion.
- [ ] **Malicious**: Local execution runs scripts with user input via stdin; potential command injection if `raw: false` mode uses bash escaping.
- [ ] **Platform (Windows, timezone, locale, unicode)**: Windows path separators vs Unix paths in scripts; local execution bypasses SSH's environment normalization.

### Rejected Alternatives

- [ ] **[Use existing SSH tunnel to localhost]** — rejected because it adds unnecessary network hop and complexity for a server that runs locally.
- [ ] **[Create separate "local" service class]** — not evaluated yet; could work but requires duplicating pool logic or creating an interface.

### Recommended Actions

- **Priority 1 (blocking):** Define the `ServerTransport` interface that abstracts both SSH and local execution, then implement a `LocalTransport` class with connection pooling.
- **Priority 2 (before ship):** Add `transportType` field to `servers` table schema to distinguish between SSH and local servers.
- **Priority 3 (tech debt):** Create a unified `exec()` wrapper that accepts both `ServerConfig` (SSH) and local path configurations, then refactor all callers to use this abstraction.

---

Давай уточню пару моментов:

1. **Как должен определяться "local" сервер?**
   - По новому полю в БД (`transportType = 'local'`)?
   - По отсутствию SSH credentials (если нет `sshUser` или `sshAuthMethod`, то local)?
   - По отдельному флагу/типу при создании сервера?

2. **Какие команды будут выполняться локально?**
   - Только те же скрипты из `scriptsPath` (например, `/opt/scripts/deploy.sh`)?
   - Или также inline-команды через `exec()` как сейчас с SSH?

3. **Нужна ли поддержка "hybrid" режима**, где один сервер может иметь и SSH, и local transport для разных целей?

---

## 🔎 Scrutiny: Feature 014 — Local Transport for DevOps Dashboard

### Untested Assumptions
- [ ] **[Local transport will be transparent]** — disproved by: `sshPool` is used in ~65 files across routes, services, and tests; any abstraction layer must handle both SSH and local modes without breaking existing calls.
- [ ] **[Server model supports a "local" type]** — disproved by: `schema.ts` defines `servers` table with only `host`, `port`, `sshUser`, `sshAuthMethod`; no `transportType` or `isLocal` field exists.
- [ ] **[Child_process.exec is sufficient for local execution]** — disproved by: SSH provides keepalive, reconnect logic, connection pooling, and structured error handling; naive exec lacks these without significant rework.
- [ ] **[Existing health polling can reuse the same code path]** — disproved by: `health-poller.ts` uses `sshPool.isConnected`, `sshPool.connect`, `sshPool.exec`; local mode would need equivalent state tracking.

### Failure Modes
- [ ] **[Race condition on connection initialization]** — what happens now: multiple services call `ensureSshConnected()` concurrently for the same local server; what should happen: only one connection established, others reuse it (like SSH pool behavior).
- [ ] **[Stale process handles]** — what happens now: if a long-running script is interrupted via WebSocket abort signal, the child process may continue running locally; what should happen: SIGTERM/SIGKILL forwarded to the process.
- [ ] **[Partial state during migration]** — what happens now: if local transport fails mid-migration (e.g., `migrateExistingAppWizard`), the app remains in inconsistent state on disk; what should happen: rollback hooks or atomic operations.

### Edge Cases
- [ ] **Empty/null**: Local server with empty config object — needs validation before creating connection.
- [ ] **Boundary**: Local server at `/` root path vs subdirectory like `/opt/app` — affects how `child_process` resolves working directory for scripts.
- [ ] **Concurrent**: Multiple services (health poller, scanner, deploy) accessing local server simultaneously — needs connection pooling similar to SSH pool.
- [ ] **Stale**: Local transport holds file descriptors open longer than expected if not properly closed after script completion.
- [ ] **Malicious**: Local execution runs scripts with user input via stdin; potential command injection if `raw: false` mode uses bash escaping.
- [ ] **Platform (Windows, timezone, locale, unicode)**: Windows path separators vs Unix paths in scripts; local execution bypasses SSH's environment normalization.

### Rejected Alternatives
- [ ] **[Use existing SSH tunnel to localhost]** — rejected because it adds unnecessary network hop and complexity for a server that runs locally.
- [ ] **[Create separate "local" service class]** — not evaluated yet; could work but requires duplicating pool logic or creating an interface.

### Recommended Actions
- **Priority 1 (blocking):** Define the `ServerTransport` interface that abstracts both SSH and local execution, then implement a `LocalTransport` class with connection pooling.
- **Priority 2 (before ship):** Add `transportType` field to `servers` table schema to distinguish between SSH and local servers.
- **Priority 3 (tech debt):** Create a unified `exec()` wrapper that accepts both `ServerConfig` (SSH) and local path configurations, then refactor all callers to use this abstraction.

---

Давай уточню пару моментов:

1. **Как должен определяться "local" сервер?**
   - По новому полю в БД (`transportType = 'local'`)?
   - По отсутствию SSH credentials (если нет `sshUser` или `sshAuthMethod`, то local)?
   - По отдельному флагу/типу при создании сервера?

2. **Какие команды будут выполняться локально?**
   - Только те же скрипты из `scriptsPath` (например, `/opt/scripts/deploy.sh`)?
   - Или также inline-команды через `exec()` как сейчас с SSH?

3. **Нужна ли поддержка "hybrid" режима**, где один сервер может иметь и SSH, и local transport для разных целей?
Хорошо, файл пустой — начнем писать ревью.

---

Как должен определяться "local" сервер? - как советуешь?
2: также inline-команды через exec() как сейчас с SSH
Нужна ли поддержка "hybrid" режима, где один сервер может иметь и SSH, и local transport для разных целей? - я думаю навряд ли или может быть пригодится?

---

## 🔍 Review: Feature 014 — Local Transport for DevOps Dashboard

### Executive Summary

**Idea:** Add a "local" transport type that executes commands via `child_process` instead of SSH, allowing the dashboard to manage its own host transparently.

**Verdict:** ✅ **Strong candidate**, but requires careful abstraction layering to avoid code duplication and maintain consistency with existing SSH-based flows.

---

### 1. Untested Assumptions (Scrutiny)

| # | Assumption | Falsification Test |
|---|------------|---------------------|
| 1 | **Local transport will be transparent** — existing `sshPool` calls can reuse same interface | Check all ~65 files using `sshPool`: routes, services, tests. Any abstraction must handle both modes without breaking calls. |
| 2 | **Server model supports a "local" type** — DB schema needs modification | Read `schema.ts` for `servers` table: currently only has `host`, `port`, `sshUser`, `sshAuthMethod`. No `transportType` field exists. |
| 3 | **Child_process.exec is sufficient** — naive exec provides same reliability as SSH pool | SSH provides keepalive, reconnect logic, connection pooling; naive exec lacks these without significant rework. |
| 4 | **Health polling can reuse the same code path** — `health-poller.ts` uses `sshPool.isConnected`, `connect`, `exec` | Local mode needs equivalent state tracking (connected/disconnected flags). |

---

### 2. Failure Modes

| # | Scenario | Current Behavior | Expected Behavior |
|---|----------|------------------|-------------------|
| 1 | **Race condition on connection init** — multiple services call `ensureSshConnected()` concurrently for same local server | Each service creates its own child process, potentially conflicting with each other | Only one connection established; others reuse it (like SSH pool behavior) |
| 2 | **Stale process handles** — long-running script interrupted via WebSocket abort signal | Child process may continue running locally | SIGTERM/SIGKILL forwarded to the process |
| 3 | **Partial state during migration** — local transport fails mid-migration (`migrateExistingAppWizard`) | App remains in inconsistent state on disk | Rollback hooks or atomic operations needed |
| 4 | **Connection pooling conflicts** — SSH pool uses `Map<string, PoolEntry>` with connection state; local needs similar | Without pooling, each call spawns new process (inefficient) | Implement local connection pooling mirroring SSH behavior |

---

### 3. Edge Cases by Taxonomy

#### Empty/null/zero

- Local server with empty config object → needs validation before creating connection
- `scriptsPath` = `/` vs undefined → affects how `child_process` resolves working directory

#### Boundary

- Local server at root path (`/`) vs subdirectory (`/opt/app`) → affects script resolution
- Script paths containing spaces or special characters (bash escaping)

#### Concurrent

- Multiple services (health poller, scanner, deploy) accessing local server simultaneously → needs connection pooling similar to SSH pool

#### Stale

- Local transport holds file descriptors open longer than expected if not properly closed after script completion

#### Malicious

- Local execution runs scripts with user input via stdin; potential command injection if `raw: false` mode uses bash escaping

#### Platform (Windows, timezone, locale, unicode)

- Windows path separators (`\`) vs Unix paths in scripts → local execution bypasses SSH's environment normalization
- Timezone differences between dashboard container and host OS

---

### 4. Rejected Alternatives

| # | Approach | Evaluated? | Justification |
|---|----------|------------|----------------|
| 1 | **Use existing SSH tunnel to localhost** | Yes | Adds unnecessary network hop and complexity for a server that runs locally |
| 2 | **Create separate "local" service class** | Partially | Could work but requires duplicating pool logic or creating an interface (→ see Priority 1) |
| 3 | **Add `transportType` field to DB schema** | Yes | Cleanest for future, but adds migration complexity; can defer until needed |

---

### 5. Recommended Actions

#### Priority 1 (Blocking — Core Abstraction)

- [ ] Define `ServerTransport` interface in `ssh-pool.ts` that abstracts both SSH and local execution
- [ ] Implement `LocalTransport` class with connection pooling
- [ ] Refactor `ensure-ssh.ts` → rename to `ensure-transport.ts`, make it universal

#### Priority 2 (Before Ship — Type Definitions)

- [ ] Add `transportType` field to `servers` table schema (optional, can defer)
- [ ] Create `server/types/server-config.ts` for shared type definitions

#### Priority 3 (Tech Debt — Route Updates)

- [ ] Determine "local" server definition at creation/update time in `routes/servers.ts`
- [ ] Update health polling and scanner services to support both transports

---

### 6. Implementation Plan (Detailed)

#### Step 1: Core Interface (`ssh-pool.ts`)

```typescript
// Add these interfaces before existing ServerConfig

export interface TransportResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TransportEntry {
  transportType: "ssh" | "local";
  connected: boolean;
  reconnecting: boolean;
  retryCount: number;
  scriptsPath?: string; // for local mode
  workingDir?: string; // for local mode
}

// Extend PoolEntry to support both transports
interface LocalPoolEntry extends TransportEntry {
  client: Client; // ssh2 Client (for SSH)
  config: ServerConfig;
}

interface LocalPoolEntry extends TransportEntry {
  scriptsPath: string;
  workingDir?: string;
}
```

#### Step 2: LocalTransport Implementation

Create `local-transport.ts` with similar structure to `SSHPool`:

```typescript
class LocalTransport {
  private pool = new Map<string, LocalPoolEntry>();

  async connect(config: LocalConfig): Promise<void> {
    // Similar connection state management as SSHPool
    // But uses child_process instead of ssh2
  }

  exec(serverId: string, command: string, timeoutMs?: number): Promise<TransportResult> {
    // Uses child_process.exec or execSync with proper error handling
    // Keepalive equivalent: periodic health checks via simple ping script
  }

  execStream(...): Promise<{stream, kill}> {
    // Similar to sshPool.execStream but uses child_process.ChildProcess
  }

  disconnect(serverId: string): void {
    // Clean up file descriptors and close processes
  }

  isConnected(serverId: string): boolean {
    return this.pool.get(serverId)?.connected ?? false;
  }
}
```

#### Step 3: Unified Transport Layer

Create `transport-manager.ts`:

```typescript
class TransportManager {
  private sshPool = new SSHPool();
  private localTransport = new LocalTransport();

  async connect(
    serverId: string,
    config: ServerConfig | LocalConfig
  ): Promise<void> {
    if (isLocalConfig(config)) {
      await this.localTransport.connect(config);
    } else {
      await this.sshPool.connect(config as ServerConfig);
    }
  }

  async exec(
    serverId: string,
    command: string,
    timeoutMs?: number
  ): Promise<TransportResult> {
    // Determine transport type and delegate
  }
}
```

#### Step 4: Schema Migration (Optional but Recommended)

Add to `servers` table:

```sql
ALTER TABLE servers ADD COLUMN IF NOT EXISTS transport_type TEXT DEFAULT 'ssh';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS scripts_path TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS working_directory TEXT;
CREATE INDEX idx_servers_transport ON servers(transport_type);
```

#### Step 5: Refactor Existing Services

- `health-poller.ts`: Replace `sshPool.isConnected` with unified transport check
- `scanner.ts`, `blue-green-orchestrator.ts`, etc.: Update to use new transport interface

---

### 7. File Impact Analysis

| Priority | Files Changed | Reason |
|----------|---------------|--------|
| **P1** | `ssh-pool.ts` | Add interfaces and LocalTransport class |
| **P2** | `ensure-transport.ts` (renamed from ensure-ssh) | Universal transport handling |
| **P3** | `routes/servers.ts`, `schema.ts` | Define "local" type, optional schema changes |
| **P4** | ~15 service files | Update to use unified transport interface |

---

### 8. Questions for User

1. **How should "local" server be defined?**
   - By new DB field (`transportType = 'local'`)? → Cleanest, future-proof
   - By missing SSH credentials (empty `sshUser` or no `sshAuthMethod`)? → Minimal schema change
   - By separate flag at creation time? → Simple but requires API changes

2. **What commands will be executed locally?**
   - Only scripts from `scriptsPath` (e.g., `/opt/scripts/deploy.sh`)?
   - Also inline-commands via `exec()` like current SSH behavior?

3. **Hybrid mode needed?** One server with both SSH and local transport for different purposes?

---

### 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Connection race conditions | Medium | Low-Medium | Implement connection pooling like SSH pool |
| Process handle leaks | Low | Medium | Proper cleanup in `disconnect()` method |
| Path resolution issues (Windows vs Unix) | Medium | Low | Normalize paths before execution |
| Security (command injection via stdin) | Low | High | Validate inputs, use `raw: true` for trusted scripts |

---

### 10. Final Recommendation

**Proceed with Priority 1 implementation first.** The core abstraction layer (`ServerTransport` interface + `LocalTransport` class) is the foundation that all other changes depend on. Once this is in place, refactoring existing services becomes straightforward.

The "define by missing credentials" approach (empty `sshUser` or no `sshAuthMethod`) is recommended for minimal disruption — it allows immediate use without DB migrations. Schema changes can be deferred until needed for advanced features like connection pooling optimization.
