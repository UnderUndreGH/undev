# Self-Protection Contract: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22

## Container ID Detection

```typescript
interface SelfProtection {
  /** Dashboard's own container ID (64-char hex or 12-char short) */
  readonly containerId: string | null;

  /** Dashboard's Docker Compose project name (if detectable) */
  readonly composeProject: string | null;

  /** Check if a container ID or name refers to the dashboard itself */
  isSelf(containerIdOrName: string): boolean;

  /** Filter out self-container from a list of container IDs */
  excludeSelf(containerIds: string[]): string[];

  /** Check if a docker command targets self — returns error message or null */
  validateDockerCommand(command: string): string | null;
}
```

## Detection Sources (priority order)

1. **`/proc/1/cpuset`** — cgroup v1: contains `/docker/<container_id>`. Parse the 64-char hex suffix.
2. **`HOSTNAME` env var** — Docker sets this to the short container ID (12 chars) by default.
3. **`/.dockerenv` file existence** — confirms running in Docker, but doesn't provide container ID. Used as a fallback signal.

If none detected → `containerId = null` → self-protection is disabled (non-Docker environment, e.g., dev mode). Log warning at startup.

## Protected Operations

| Operation | Protection | Error Message |
|-----------|-----------|---------------|
| `docker stop <self>` | Blocked | `"Cannot stop the dashboard container"` |
| `docker rm <self>` | Blocked | `"Cannot remove the dashboard container"` |
| `docker kill <self>` | Blocked | `"Cannot kill the dashboard container"` |
| `docker compose down` in dashboard dir | Blocked | `"Cannot bring down the dashboard's own compose stack"` |
| `docker system prune` | Allowed | Self-container excluded from prune candidates |
| `docker network prune` | Allowed | Dashboard network preserved via `--filter` |
| `docker image prune` | Allowed | No self-protection needed (images ≠ running containers) |

## Integration Points

### Docker routes (`routes/docker.ts`)

- **Container list**: `isSelf()` flag added to each container in response → UI renders lock icon
- **Safe cleanup**: exclude self-container from `docker container prune` filter
- **Aggressive cleanup**: same exclusion + network preservation
- **Container stop/restart/remove**: `validateDockerCommand()` check before execution

### Scripts runner

- No change needed — scripts don't target specific containers by ID
- Deploy scripts create NEW containers, never stop the dashboard's own

## Startup Initialization

```typescript
// Called in server/index.ts during startup, before health polling starts
const selfProtection = await detectSelfContainer();
// Export as singleton for route handlers
```

Initialization is async (reads `/proc/1/cpuset`). Must complete before any Docker operations are allowed.
