# Feature 016: Amnezia VPN Integration — Implementation Summary

## Files Created (15 new)

### Backend Services (6)
- `devops-app/server/services/vpn-ssh.ts` — `runRemoteCommand()` wrapping sshPool with streaming
- `devops-app/server/services/vpn-install-probe.ts` — `probeAmneziaInstalled()` checks Docker/binary
- `devops-app/server/services/script-parser.ts` — `parseAnnotations()` pure regex parser
- `devops-app/server/services/script-indexer.ts` — `indexScriptsDirectory()` FS walker + DB upsert
- `devops-app/server/services/script-executor.ts` — `executeScript()` async SSH execution + executionBus pub/sub
- `devops-app/server/services/vpn-drift.ts` — `startVpnDriftCron()`/`stopVpnDriftCron()` 5-min interval

### Backend Routes (2)
- `devops-app/server/routes/servers-vpn.ts` — `vpnServersRouter`: POST/GET/DELETE /api/vpn/servers
- `devops-app/server/routes/vpn-scripts.ts` — `vpnScriptsRouter`: GET/POST/PUT/DELETE /api/vpn/scripts, execute, reindex

### Frontend (10)
- `devops-app/client/lib/vpn-api.ts` — Typed REST client for VPN server CRUD
- `devops-app/client/lib/scripts-api.ts` — Typed REST client for scripts CRUD + execute
- `devops-app/client/components/vpn/ServerForm.tsx` — Add server form with auth mode toggle
- `devops-app/client/components/vpn/ServerList.tsx` — Server table with status/drift pills
- `devops-app/client/components/vpn/ScriptTree.tsx` — Directory-grouped script list
- `devops-app/client/components/vpn/ScriptOutput.tsx` — WebSocket live output viewer
- `devops-app/client/components/vpn/ScriptEditor.tsx` — Content editor for DB-sourced scripts
- `devops-app/client/components/vpn/ScriptForm.tsx` — Dynamic param form (string/number/boolean/select)
- `devops-app/client/pages/VpnPage.tsx` — Main VPN page with Servers/Scripts tabs

### DB Migration (1)
- `devops-app/server/db/migrations/0016_vpn_features.sql` — ALTER servers + CREATE scripts/script_params

### Tests (1)
- `devops-app/tests/unit/script-parser.test.ts` — 10 unit tests, all passing

### Docs (3)
- `specs/016-vpn-features/reviews/sec-self-review.md` — Security self-review (CONDITIONAL PASS)
- `specs/016-vpn-features/notes/testing-deferred.md` — E2E test scenarios for manual validation
- `specs/016-vpn-features/quickstart.md` — Updated with new env vars

## Files Modified (4)

- `devops-app/server/db/schema.ts` — Added 5 VPN columns to `servers` table + `scripts` + `scriptParams` tables
- `devops-app/server/index.ts` — Feature flag gate + VPN router mounts + startup hooks (script indexer, drift cron) + shutdown hook
- `devops-app/server/ws/handler.ts` — Added execution channel subscription with ownership check
- `devops-app/.env.example` — Added `FEATURE_VPN_ENABLED=0`
- `devops-app/client/App.tsx` — Added `/vpn` route + VpnPage import
- `devops-app/client/components/layout/Layout.tsx` — Added VPN sidebar link
- `devops-app/server/db/migrations/meta/_journal.json` — Registered migration 0016
- `devops-app/vitest.config.ts` — Added server-side test config (was missing)

## Decisions Deferred / Simplified

1. **VPN install payload** — actual Amnezia Docker install via SSH is deferred. The probe checks if already installed; `installVpn=true` sets status to `installing` but doesn't trigger install yet.
2. **Drift interval** — hardcoded 5 min via setInterval; no external cron lib added.
3. **429 rate limit** — soft guard via COUNT before INSERT; acceptable TOCTOU for MVP.
4. **WS auth** — reuses existing `authenticateWs()` + ownership check rather than separate 1008 close code path.

## Known Issues

1. Pre-existing TS errors in `node_modules/drizzle-orm` (gel-core, mysql-core, singlestore-core, sqlite-core type mismatches) — NOT from our changes.
2. Pre-existing TS errors from `@types/node` / `@types/ssh2` duplicate declarations — NOT from our changes.
3. Integration test failures (26 test files) — pre-existing, need running DB. Our unit tests pass cleanly.

## Recommended Manual Test Plan

1. **Add VPS** — POST /api/vpn/servers with password auth, verify row in DB with encrypted creds
2. **List servers** — GET /api/vpn/servers, verify VPN columns present
3. **Delete server** — DELETE /api/vpn/servers/:id, verify cascade cleanup
4. **Script parse** — POST /api/vpn/scripts/reindex with a .sh file in ./scripts, verify indexed count
5. **Script execute** — POST /api/vpn/scripts/:id/execute, verify script_runs row created, WS stream works
6. **VPN page** — Navigate to /vpn, verify server list renders, add form works, script tree loads
