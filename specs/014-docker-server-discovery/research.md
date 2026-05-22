# Research: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)

## R-001: Transport abstraction approach

**Decision**: **Proxy Pattern** — extend `SSHPool` with a local execution branch. When `connectionType === 'local'`, `SSHPool.exec()` bypasses SSH and delegates to `child_process.spawn` wrapped in a `ClientChannelAdapter`.

**Rationale**: The codebase routes all remote execution through `SSHPool`. Every consumer — scriptsRunner, health-poller, deploy orchestrator, Docker commands — calls `sshPool.exec(serverId, command)`. A proxy branch inside SSHPool means zero changes to consumers. The pool checks `connectionType` on the server record and forks: SSH path for `'ssh'`, local spawn for `'local'`. Single integration point, minimal blast radius.

**Alternatives considered**:
- **Transport Interface** (strategy pattern with `ITransport`): clean OOP, but requires 22+ file changes to replace direct `SSHPool` calls with interface references. Every consumer gains a dependency on the abstraction. Over-engineered for a two-variant enum.
- **SSH-to-localhost** (Coolify approach): SSH into `127.0.0.1` with a local key. Works but adds SSH overhead for local commands (~40ms per exec), requires sshd running in the container, and creates a circular dependency (dashboard SSHing into itself). Fragile key management.
- **Agent binary** (Komodo approach): deploy a lightweight agent on each managed host. Correct for multi-transport at scale, but massive scope increase — agent lifecycle, update mechanism, auth protocol. Deferred to hypothetical v3.

## R-002: Local server identification

**Decision**: **Deterministic UUID** derived from the string `'local-server'` using UUID v5 (DNS namespace). Result: `c4a760a8-dbcf-5254-a0d9-6a4474bd1b62`. Cached in-memory as a constant `LOCAL_SERVER_ID`.

**Rationale**: The ID must be stable across restarts, migrations, and fresh installs so that references (audit entries, script runs, AI conversations) remain valid. UUID v5 is deterministic — same input always produces the same output. No DB query needed at runtime; the constant is known at compile time. The seed INSERT uses this ID, and all runtime checks compare against the cached constant.

**Alternatives considered**:
- **DB query per exec**: `SELECT id FROM servers WHERE connection_type = 'local' LIMIT 1`. Correct but adds a query to every local command execution hot path. Unnecessary when the ID is deterministic.
- **Environment variable** (`LOCAL_SERVER_ID=...`): requires operator configuration. Easy to misconfigure. The ID should be an implementation detail, not a config surface.
- **Hostname detection** (`os.hostname()`): non-deterministic across container restarts if hostname isn't pinned. Doesn't produce a valid UUID without hashing, at which point it's just UUID v5 with extra steps.

## R-003: Stream compatibility

**Decision**: **`ClientChannelAdapter`** — a class that wraps `child_process.ChildProcess` (from `spawn`) to match the `ssh2.ClientChannel` event interface (`data`, `stderr`, `close`, `exit`).

**Rationale**: All consumers of `SSHPool.exec()` expect an `ssh2.ClientChannel`-shaped stream. The channel emits `data` on stdout, `stderr` on the stderr stream, `close` when done, and `exit` with a code. `child_process.spawn` emits the same events but on different objects (`child.stdout`, `child.stderr`, `child`). `ClientChannelAdapter` maps between the two: `child.stdout.on('data')` → `adapter.emit('data')`, `child.stderr.on('data')` → `adapter.stderr.emit('data')`, `child.on('exit', code)` → `adapter.emit('exit', code)` → `adapter.emit('close')`. Consumers see no difference.

**Alternatives considered**:
- **Dual event handling in consumers**: each consumer checks `if (isLocal) { handle spawn events } else { handle channel events }`. Scatters transport awareness across 15+ files. Violates single-responsibility.
- **EventEmitter wrapper** (generic): a thin `EventEmitter` that both `ClientChannel` and `ChildProcess` feed into. Functionally identical to `ClientChannelAdapter` but loses the explicit `ssh2.ClientChannel` type contract. Adapter is more precise.

## R-004: Self-protection mechanism

**Decision**: **Container ID detection** via `/proc/1/cpuset` (cgroup v1) or `HOSTNAME` env var (Docker sets this to the short container ID). Cross-referenced with `docker inspect` on the network to identify the dashboard's own container. Protected from destructive operations (stop, remove, prune with running filter).

**Rationale**: The dashboard must not kill itself. When executing Docker commands on the local server, the system needs to know which container is "self". `/proc/1/cpuset` contains the full container ID in cgroup v1 environments (`/docker/<container_id>`). In cgroup v2 or when cpuset is `/`, fall back to `HOSTNAME` which Docker sets to the short container ID by default. Once the self-container-ID is known, Docker operations filter it out: `docker stop` skips self, `docker system prune` excludes self, `docker rm` rejects self with a clear error.

**Alternatives considered**:
- **Label-based filtering** (`com.dashboard.self=true`): requires the operator to add a label to their compose file. Easy to forget. Detection should be automatic.
- **Compose project name matching**: `docker compose ps` in the dashboard's project. Works only if the dashboard uses compose (not guaranteed for all deployment methods). Also doesn't uniquely identify the specific container in multi-service compose stacks.

## R-005: Docker socket vs SSH for Docker commands

**Decision**: **Docker socket mount** (`/var/run/docker.sock`) bind-mounted into the dashboard container. Docker CLI commands execute locally via `child_process.spawn` against the mounted socket.

**Rationale**: The dashboard already runs in Docker. Mounting the host's Docker socket gives direct access to the Docker daemon — no network hop, no authentication layer, no SSH overhead. This is the standard pattern for Docker-in-Docker management tools (Portainer, Dockge, Traefik). The socket is read-write, so all Docker operations (inspect, logs, stop, start, prune) work natively. Combined with the self-protection mechanism (R-004), destructive operations are safe.

**Alternatives considered**:
- **SSH tunnel**: SSH into the host and run Docker commands remotely. Adds SSH overhead, requires host SSH access, and creates a dependency on sshd. The whole point of feature 014 is to avoid SSH for the local server.
- **Docker API over HTTP**: expose the Docker daemon on a TCP port (`-H tcp://0.0.0.0:2375`). Security risk — unauthenticated Docker API access. Requires TLS setup for production. Socket mount is simpler and more secure (Unix socket permissions).
- **nsenter**: enter the host's PID namespace from within the container. Requires `--privileged` or `--pid=host` plus `SYS_ADMIN` capability. More invasive than socket mount. Only needed for host-level operations that Docker CLI can't handle.
