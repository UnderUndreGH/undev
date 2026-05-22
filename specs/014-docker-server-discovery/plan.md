# Implementation Plan: Local Server Transport

**Branch**: `014-docker-server-discovery` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/014-docker-server-discovery/spec.md`

## Summary

Add a local transport capability to the existing `SSHPool` singleton via the **Proxy Pattern**. When a command targets the local server (`connectionType === 'local'`), `sshPool` delegates to `child_process.spawn` wrapped in a `ClientChannelAdapter` instead of SSH. The local server is auto-seeded at startup with a deterministic UUID. Docker socket mounting provides Docker daemon access. Self-protection prevents the dashboard from killing its own container.

**Zero changes to existing consumer imports** — all 22+ files calling `sshPool.exec()` / `sshPool.execStream()` work transparently.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20 (Alpine)
**Primary Dependencies**: Express 5, ssh2, child_process (Node built-in), drizzle-orm, postgres (porsager), Vite 8, React 19, Tailwind CSS 4
**Storage**: PostgreSQL 16 via Drizzle ORM — 1 column addition to `servers` table (`connection_type TEXT DEFAULT 'ssh'`)
**Testing**: Vitest 4 (unit + integration), Playwright (e2e)
**Target Platform**: Linux Docker container (node:20-alpine), managing its own host
**Project Type**: Web application (Express backend + React SPA frontend)
**Performance Goals**: Local exec <5ms overhead (vs ~50-100ms SSH). Max 10 concurrent local spawns to prevent event loop starvation.
**Constraints**: Container must have `/var/run/docker.sock` mounted and `pid: host` for metrics. `maxBuffer` overridden to ~50MB for large NDJSON outputs.
**Scale/Scope**: Single self-hosted dashboard instance. One local server per instance. ~22 consumer files use `sshPool` — zero import changes needed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Operator safety first** | PASS | Self-protection mechanism prevents dashboard self-destruction. AI write access disabled for local server by default. Docker cleanup excludes dashboard container. |
| **II. Secrets never leak** | PASS | Local server requires no SSH credentials. No passwords/keys stored for local transport. Existing `serializer.ts` secret stripping unaffected. |
| **III. Reviewable database changes** | PASS | Migration `0015_local_server_transport.sql` generated as reviewable SQL artifact. No direct migration execution during planning. |
| **IV. Typed boundaries** | PASS | `connectionType` validated via Zod enum `z.enum(['ssh', 'local'])`. `ClientChannelAdapter` implements `ssh2.ClientChannel`-compatible interface. New interfaces (`LocalExecOptions`, `SelfProtection`) fully typed. |
| **V. Feature flags and rollback posture** | PASS | Local transport is isolated — `connectionType === 'local'` branch only fires for the single local server row. SSH servers completely unaffected. Rollback = drop column + delete local server row (DOWN migration provided). |
| **VI. Independent review gate** | PENDING | Requires `/speckit.analyze` PASS + 2 reviewer PASses before implementation. |
| **VII. Snapshot stages** | PENDING | Will tag `plan/014-docker-server-discovery/v1` after plan completion. |

**Gate verdict**: PASS (no violations). Principles VI and VII are procedural gates resolved post-plan.

## Project Structure

### Documentation (this feature)

```text
specs/014-docker-server-discovery/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 5 research decisions (R-001 to R-005)
├── data-model.md        # Phase 1 output — migration 0015, Drizzle schema additions
├── quickstart.md        # Phase 1 output — operator verification steps
├── contracts/           # Phase 1 output — internal interface contracts
├── idea_and_plan.md     # Pre-plan codebase analysis
├── glms_plan.md         # Detailed codebase inventory (schema, routes, services)
├── hermes_prompt.md     # Related: Feature 013 review tasks (separate concern)
└── reviews/             # Review artifacts
```

### Source Code (devops-app/)

```text
devops-app/
├── server/
│   ├── db/
│   │   ├── schema.ts                    # MODIFY: add connectionType column to servers
│   │   └── migrations/
│   │       └── 0015_local_server_transport.sql  # NEW: migration
│   ├── services/
│   │   ├── ssh-pool.ts                  # MODIFY: proxy pattern — local exec branch
│   │   ├── local-executor.ts            # NEW: ClientChannelAdapter + local spawn logic
│   │   └── self-protection.ts           # NEW: container ID detection + operation filtering
│   ├── lib/
│   │   ├── ensure-ssh.ts               # MODIFY: skip SSH connect for local server
│   │   ├── local-server-seed.ts        # NEW: auto-seed local server at startup
│   │   └── constants.ts                # NEW or MODIFY: LOCAL_SERVER_ID constant
│   ├── routes/
│   │   └── servers.ts                  # MODIFY: hide SSH ops for local server, prevent delete
│   └── index.ts                        # MODIFY: call localServerSeed() at startup
├── client/
│   ├── pages/
│   │   ├── DashboardPage.tsx           # MODIFY: "Local" badge on server card
│   │   └── ServerPage.tsx              # MODIFY: hide SSH-specific tabs/actions for local
│   └── components/
│       └── servers/
│           └── LocalBadge.tsx          # NEW: visual badge component
├── Dockerfile                          # MODIFY: install bash + docker-cli in Alpine
└── docker-compose.yml                  # MODIFY: add docker.sock volume + pid:host
```

**Structure Decision**: Existing web application structure (Express backend + React SPA). No new directories at the project root — all changes within `devops-app/`. New files are minimal (4 new server-side modules, 1 new client component).

## Complexity Tracking

No constitution violations to justify. The design is intentionally simple:

- Proxy pattern vs. full transport interface → fewer files changed (spec §Design Decision 1)
- Auto-seed vs. manual creation → no new onboarding flow needed
- Docker socket mount vs. Docker API/agent → industry-standard pattern (Portainer, Dockge)

## File Change Inventory

### New Files (6)

| File | Purpose | Estimated Lines |
|------|---------|----------------|
| `server/services/local-executor.ts` | `ClientChannelAdapter` class + `localExec()` / `localExecStream()` functions | ~150 |
| `server/services/self-protection.ts` | Container ID detection, operation filtering, self-container exclusion | ~80 |
| `server/lib/local-server-seed.ts` | Startup auto-seed logic for local server row | ~40 |
| `server/lib/constants.ts` | `LOCAL_SERVER_ID` constant + `isLocalServer()` helper | ~10 |
| `server/db/migrations/0015_local_server_transport.sql` | Migration: `connection_type` column, CHECK constraint, index, seed | ~25 |
| `client/components/servers/LocalBadge.tsx` | "Local" badge UI component | ~15 |

### Modified Files (10)

| File | Change | Risk |
|------|--------|------|
| `server/db/schema.ts` | Add `connectionType` column to `servers` table | Low |
| `server/services/ssh-pool.ts` | Add `isLocalServer()` check in `exec()`, `execStream()`, `connect()`, `disconnect()` — delegate to `local-executor` | **Medium** — core execution path |
| `server/lib/ensure-ssh.ts` | Skip SSH connect when `connectionType === 'local'` | Low |
| `server/index.ts` | Call `seedLocalServer()` during startup sequence | Low |
| `server/routes/servers.ts` | Block DELETE for local server, hide SSH verify/probe/onboard | Low |
| `client/pages/DashboardPage.tsx` | Render `LocalBadge` when `connectionType === 'local'` | Low |
| `client/pages/ServerPage.tsx` | Conditionally hide SSH-specific UI elements | Low |
| `Dockerfile` | `RUN apk add --no-cache bash docker-cli` | Low |
| `docker-compose.yml` | Add `/var/run/docker.sock` volume + `pid: host` | Low |
| `server/services/health-poller.ts` | Use local exec for health metrics when server is local (handled transparently by ssh-pool proxy) | Low — no explicit change needed, covered by proxy |

### Unchanged Files (22+ consumer files)

All files importing `sshPool` continue to work without modification:
`ssh-executor.ts`, `scripts-runner.ts`, `scanner.ts`, `slot-namer.ts`, `interrupted-deploys-scanner.ts`, `blue-green-orchestrator.ts`, `ssh-key-rotation.ts`, `compatibility-probe.ts`, `cloud-init-probe.ts`, `migration-toolkit.ts`, `hard-delete-with-hooks.ts`, `caddy-override-writer.ts`, `bootstrap-orchestrator.ts`, `orphan-cleanup-job.ts`, `caddy-admin-client.ts`, `probes/container.ts`, `probes/caddy-admin.ts`, `routes/domain.ts`, `routes/deployments.ts`, `routes/blue-green.ts`, `routes/apps.ts`, `routes/docker.ts`, `routes/logs.ts`, `compose-override-generator.ts`.

## Implementation Phases

### Phase 1: Core Transport (Backend)

1. Create `server/lib/constants.ts` with `LOCAL_SERVER_ID`
2. Create `server/services/local-executor.ts` with `ClientChannelAdapter`
3. Modify `server/services/ssh-pool.ts` — proxy pattern integration
4. Create migration `0015_local_server_transport.sql`
5. Modify `server/db/schema.ts` — add `connectionType` column
6. Create `server/lib/local-server-seed.ts`
7. Modify `server/index.ts` — call seed at startup
8. Modify `server/lib/ensure-ssh.ts` — skip local server

### Phase 2: Self-Protection + Docker

1. Create `server/services/self-protection.ts`
2. Integrate self-protection into Docker routes (`routes/docker.ts`)
3. Modify `Dockerfile` — install bash + docker-cli

### Phase 3: API Guards

1. Modify `server/routes/servers.ts` — block delete, hide SSH endpoints for local
2. Add `connectionType` to serialized server responses

### Phase 4: Frontend

1. Create `client/components/servers/LocalBadge.tsx`
2. Modify `DashboardPage.tsx` — render badge
3. Modify `ServerPage.tsx` — conditional SSH UI hiding

### Phase 5: Infrastructure

1. Modify `docker-compose.yml` — socket + pid mount
2. Update migration journal `meta/_journal.json`

### Phase 6: Testing

1. Unit tests for `ClientChannelAdapter`
2. Unit tests for `self-protection.ts`
3. Integration tests for local exec through `sshPool` proxy
4. Verify all existing tests pass unchanged

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ssh-pool.ts` proxy breaks SSH path | HIGH | Proxy only activates for `LOCAL_SERVER_ID`. SSH path is default. All existing tests must pass. |
| Docker socket permissions in Alpine | LOW | Standard `apk add docker-cli` + socket mount. Same pattern as Portainer. |
| `child_process` maxBuffer overflow | MEDIUM | Override to 50MB. Log warning if approaching limit. |
| Event loop starvation from local spawns | MEDIUM | Semaphore limiting concurrent spawns to 10. |
| Self-protection false positive (blocking legitimate ops) | LOW | Only blocks ops targeting dashboard's own container ID. Container ID detection is well-tested. |
| Migration conflicts with Feature 013 | LOW | Migration 0015 depends only on base `servers` table from Feature 001. No column conflicts. |

## Dependencies

- **Feature 001** (base dashboard): `servers` table exists
- **Feature 005** (script runner): `scriptsRunner`/`sshExecutor` use `sshPool` — transparent compatibility
- **Feature 011** (onboarding): Local server bypasses onboarding — auto-seeded
- **Feature 013** (AI copilot): `aiWriteAccess = 'disabled'` for local server by default
