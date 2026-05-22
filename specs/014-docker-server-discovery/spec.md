# Feature Specification: Local Server Transport

Version 1.0 | Status: Draft | Date: 2026-05-22

> **Sequence note**: Migration `0015` reserved. Depends on 001 (base dashboard), 005 (script runner), 011 (onboarding). No migration conflicts with 013 (AI Incident Copilot).

> **Spec lifts and extensions**:
>
> - **Feature 001** (base dashboard): Extends `servers` table with `connectionType` field. All existing servers default to `"ssh"`.
> - **Feature 005** (script runner): `scriptsRunner` and `sshExecutor` gain transparent local execution path — no API changes.
> - **Feature 011** (onboarding): Local server bypasses probe/onboard flow — auto-seeded at startup.

## Problem Statement

The DevOps Dashboard runs inside a Docker container on the same server it needs to manage. Currently, to manage its own host, the dashboard must establish an SSH connection to `localhost` — requiring SSH keys, an sshd process reachable from the container, and suffering unnecessary network overhead.

This is the same problem Coolify faces (and solves with SSH-to-localhost). Komodo solves it with a separate agent binary. Portainer uses Docker socket mounting but only for Docker API calls, not arbitrary shell commands.

None of these approaches provide a clean, transparent local execution path that integrates with an existing SSH-based command execution architecture.

## Proposed Solution

Add a **local transport** capability to the existing `SSHPool` singleton via the **Proxy Pattern**: when a command targets the local server, `sshPool` delegates to `child_process` instead of SSH. This requires **zero changes to existing import statements** across 22+ consumer files.

### Key Design Decisions

1. **Proxy Pattern over Transport Interface**: Instead of creating a new `ServerTransport` interface and replacing all 22 `sshPool` imports, we extend `SSHPool` to detect local server IDs and delegate internally. This minimizes diff size and regression risk while preserving future extensibility.

2. **Auto-seed over manual creation**: The local server record is created automatically at startup if none exists. No UI flow needed for adding local servers.

3. **Docker socket mounting**: The container gains access to the host's Docker daemon via `/var/run/docker.sock` volume mount, enabling Docker commands without SSH.

4. **Host filesystem access**: For health metrics (CPU/RAM/disk), the container reads from `/proc` and `/sys` which reflect host state when running with `--pid=host` or appropriate mounts.

## User Stories

### US1: Auto-discover Local Server (P1)

**As** a dashboard operator,
**I want** the dashboard to automatically detect and display the server it's running on,
**so that** I can monitor and manage my host without configuring SSH credentials.

**Success Criteria**:
- On first startup, a "This Server" entry appears in the server list with status "online"
- The server is marked with a "Local" badge in the UI
- No SSH credentials are required or displayed for this server
- The local server cannot be deleted through the UI

### US2: Execute Commands Locally (P1)

**As** a dashboard operator,
**I want** to run scripts, deployments, and Docker commands on the local server,
**so that** I get the same management capabilities as SSH-connected servers without the SSH overhead.

**Success Criteria**:
- All `sshPool.exec()` calls work transparently for the local server via `child_process`
- All `sshPool.execStream()` calls work transparently with proper stream lifecycle (events, kill, backpressure)
- Script runner (Feature 005) works on the local server without modification
- Deploy scripts execute successfully on the local server

### US3: Monitor Local Server Health (P1)

**As** a dashboard operator,
**I want** to see CPU, RAM, disk, swap, and Docker container metrics for my local server,
**so that** I can monitor the health of the machine running the dashboard.

**Success Criteria**:
- Health poller collects metrics from the local server via `child_process` instead of SSH
- Health snapshots are stored and displayed identically to SSH-connected servers
- Real-time WebSocket updates work for local server health

### US4: Docker Management on Local Server (P1)

**As** a dashboard operator,
**I want** to view containers, disk usage, and run cleanup on the local server,
**so that** I can manage Docker resources on my host directly.

**Success Criteria**:
- Docker panel shows containers, images, volumes for the local server
- Safe and aggressive cleanup work on the local server
- The dashboard's own container and network are protected from cleanup operations

### US5: Self-Protection (P1)

**As** a dashboard operator,
**I want** the dashboard to protect itself from self-destructive operations,
**so that** I don't accidentally kill the dashboard while managing the local server.

**Success Criteria**:
- `docker stop`/`docker rm` commands targeting the dashboard's own container are blocked
- `docker network prune` preserves the dashboard's network (`ai-twins-network`)
- `docker compose down` in the dashboard's own directory is blocked
- AI write access is disabled for the local server by default

### US6: UI Differentiation (P2)

**As** a dashboard operator,
**I want** to visually distinguish the local server from SSH-connected servers,
**so that** I understand which server is local at a glance.

**Success Criteria**:
- "Local" badge displayed on server card in dashboard
- SSH-specific UI elements hidden for local server (credentials, verify SSH, rotate key, probe, onboard)
- Server detail page works fully for local server with all tabs functional

## Out of Scope

- **Multiple local servers**: Only one local server per dashboard instance
- **Hybrid transport**: A server cannot have both SSH and local transport
- **Docker API direct integration**: We use Docker CLI via shell, not Docker Engine API
- **Windows/macOS dev mode**: Local transport requires Linux (`/proc`, `bash`, `docker` CLI). Dev environments use SSH-connected servers
- **Agent-based architecture**: No separate agent binary (Komodo-style)

## Technical Constraints

1. **Container environment**: `node:20-alpine` does not include `bash` or `docker-cli` by default — Dockerfile must be updated
2. **maxBuffer**: `child_process.exec` has 1MB default maxBuffer — must be overridden to ~50MB for large NDJSON outputs
3. **Stream semantics**: `child_process.spawn` streams differ from `ssh2.ClientChannel` — adapter required
4. **Resource sharing**: Local spawned processes share CPU/RAM with the Node.js event loop — concurrent execution limits needed
5. **SSRF guard**: Existing HTTP probe SSRF guard blocks `127.0.0.1` — must whitelist local server ID
6. **LOCAL_SERVER_ID**: Must be deterministic and cached in memory — no DB query per exec call

## Security Considerations

- Local transport runs commands as the container's user (typically root in Alpine) — same blast radius as SSH root access
- AI Incident Copilot write access must be disabled for local server to prevent sandbox escape
- Shell injection risk is identical to SSH path (same `shQuote` escaping applies)
- Docker socket access grants full Docker daemon control — same as SSH + docker group membership

## Non-Functional Requirements

- **Latency**: Local exec should be <5ms overhead (vs ~50-100ms for SSH)
- **Concurrency**: Maximum 10 concurrent local spawns to prevent event loop starvation
- **Reliability**: Local transport is always "connected" — no reconnect logic needed
- **Backwards compatibility**: All existing SSH server functionality unchanged. All existing tests pass without modification.
