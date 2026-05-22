# Quickstart: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22

## Prerequisites

- Dashboard running with features 001-013 deployed
- Docker socket accessible on the host (`/var/run/docker.sock`)
- Dashboard container has access to host PID namespace (for process metrics)

## Step 1: Update `docker-compose.yml`

Add the Docker socket volume and PID namespace to the dashboard service:

```yaml
services:
  dashboard:
    # ... existing config ...
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      # ... other volumes ...
    pid: host
```

The `pid: host` flag enables the dashboard to read host-level process metrics (CPU, RAM, disk) via `/proc` without SSH.

## Step 2: Rebuild and Restart

```bash
docker compose up -d --build
```

On startup, the dashboard automatically:
1. Detects its own container ID (via `/proc/1/cpuset` or `HOSTNAME`)
2. Seeds the local server row (`id = c4a760a8-dbcf-5254-a0d9-6a4474bd1b62`) if not present
3. Sets local server status to `online`

No manual configuration required.

## Step 3: Verify Local Server Appears

1. Navigate to the **Dashboard → Servers** page
2. A new server entry appears: **"This Server"** with a **Local** badge
3. The server shows `setupState = ready` — no setup wizard, no SSH key exchange
4. Status indicator shows **online** (always-on, no SSH heartbeat)

**Smoke check**: Server list includes "This Server" with connection type `local`. No SSH credentials shown.

## Step 4: Check Health Metrics

1. Click **"This Server"** to open the server detail page
2. Navigate to the **Health** tab
3. Verify real-time metrics:
   - **CPU**: host CPU usage (read from `/proc/stat`)
   - **RAM**: host memory usage (read from `/proc/meminfo`)
   - **Disk**: host filesystem usage (read from `df`)
4. Metrics refresh on the same polling interval as SSH servers

**Smoke check**: CPU/RAM/disk values match `htop` or `docker stats` on the host. No SSH connection errors in logs.

## Step 5: Run Docker Cleanup

1. Navigate to **"This Server" → Docker** tab
2. Click **Safe Cleanup** (prunes dangling images, stopped containers, unused networks)
3. The cleanup runs locally via Docker socket — no SSH tunnel
4. The dashboard's own container is automatically excluded from cleanup (self-protection)
5. Results stream in real-time, same UI as SSH-based cleanup

**Smoke check**: Cleanup completes without errors. Dashboard container remains running. Audit log shows `docker.cleanup` with `serverId = c4a760a8-...`.

## Step 6: Deploy an App to Local Server

1. Navigate to **Apps → Add Application**
2. Select **"This Server"** as the target server
3. Configure the app as usual (compose file, environment, domain)
4. Click **Deploy**
5. Deployment executes locally via `child_process.spawn` instead of SSH
6. Logs stream in real-time through the same WS channel as SSH deployments

**Smoke check**: Deployment succeeds. `docker ps` on the host shows the new container. Script run record shows `serverId = c4a760a8-...`. No SSH-related entries in the run log.

## Verification Checklist

| SC | What to verify | How |
|---|---|---|
| SC-001 | Local server seeded at startup | Query `servers WHERE id = 'c4a760a8-dbcf-5254-a0d9-6a4474bd1b62'` — row exists with `connection_type = 'local'` |
| SC-002 | Health metrics without SSH | Health tab shows CPU/RAM/disk. Server logs show no SSH connection attempts for this server |
| SC-003 | Docker socket operations work | Run cleanup or inspect containers. Commands execute without SSH errors |
| SC-004 | Self-protection active | Attempt to stop the dashboard container via Docker tab — operation is blocked with a clear error message |
| SC-005 | Existing SSH servers unaffected | SSH servers continue to work exactly as before. No behavioral changes for `connection_type = 'ssh'` |
| SC-006 | AI write access disabled by default | Local server `ai_write_access = 'disabled'`. AI copilot cannot execute tool calls on local server without explicit operator opt-in |
