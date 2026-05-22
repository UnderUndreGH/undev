# Self-Deploy Migrations Investigation

**Date**: 2026-05-23
**Branch**: 016-vpn-features
**Issue**: When the dashboard self-deploys via the UI, DB migrations don't get applied.

## Root Cause

**File**: `scripts/deploy/server-deploy.sh`, line 478

```bash
docker compose -f "$COMPOSE_FILE" $DASHBOARD_OVERRIDE_FLAG $ENV_FLAG up -d
```

The `docker compose up -d` command runs WITHOUT `--build`. When the dashboard self-deploys:

1. `git fetch + reset` pulls new code (including new migration .sql files) onto disk
2. `docker compose up -d` starts containers but **reuses the existing image**
3. The Dockerfile (`devops-app/Dockerfile:23`) bakes `server/db/migrations` from the build context at build time
4. Since the image is NOT rebuilt, the container has **old migrations** in `/app/server/db/migrations`
5. `startup()` in `server/index.ts:160` runs `migrate(db, { migrationsFolder: "./server/db/migrations" })` against old migration files
6. New schema changes never apply → migration drift

## Why Migrations Are Baked (Not Mounted)

The `devops-app/docker-compose.yml` does NOT mount the migrations folder as a volume:

```yaml
volumes:
  - ./data/logs:/app/data/logs
  - ${SSH_KEY_DIR:-~/.ssh}:/app/.ssh:ro
  - /var/run/docker.sock:/var/run/docker.sock
  - /:/host:ro
```

No volume shadows `/app/server/db/migrations`. The migrations come exclusively from the Docker image.

## Why No `--build`

The deploy script is generic — it deploys all apps. Most apps use pre-built images or don't need a rebuild every deploy. Adding unconditional `--build` would slow down every deployment.

## Fix Applied

**Changed**: `scripts/deploy/server-deploy.sh` line 478

Added `--build` flag when the deployed project has a `build:` directive in its compose file. Specifically, detect if `docker compose config --services` returns a service with `build.dockerfile` or `build.context` set. For simplicity and correctness, add `--build` unconditionally for self-deploy and as an opt-in flag for other apps.

### Implementation

Added a BUILD_FLAG variable that defaults to empty but is set to `--build` during self-deploy detection (the same block at line 211-238 that detects `devops-dashboard|devops-app|underundre-undev`).

## Additional Recommendations (Not Implemented)

1. **Migration dry-run pre-check**: At startup, log which migrations are pending BEFORE applying. Add `MIGRATE_ON_BOOT_VERBOSE=1` env for detailed logging.
2. **Health endpoint**: Add `/api/health/migrations` that returns applied-vs-pending diff.
3. **Escape hatch**: Add `npm run db:migrate:force` CLI command for manual migration application.
