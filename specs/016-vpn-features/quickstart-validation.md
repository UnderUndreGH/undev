# Quickstart Validation Report — Feature 016 (VPN Features)

**Date:** 2026-05-23
**Document validated:** `specs/016-vpn-features/quickstart.md`
**Implementation base:** `devops-app/`

---

## 1. Instructions Match Actual Implementation

| Quickstart Instruction | Implementation | Match? |
|------------------------|----------------|--------|
| "Navigate to Servers, click Add Server, provide SSH credentials" | `POST /api/vpn/servers` in `servers-vpn.ts` accepts `host`, `sshUser`, `password`/`privateKey`, `port` | YES |
| "Install Amnezia VPN" checkbox → auto-deploy | `installVpn: true` in create body → sets `vpnStatus = "installing"` (L154-160). Probe via `vpn-install-probe.ts` checks for existing Amnezia first (L133-151) | YES |
| "If VPN already installed, system detects and skips" | `probeAmneziaInstalled()` checks Docker containers + binary. If `installed = true`, sets `vpnStatus = "installed"` and skips install (L139-145) | YES |
| "Drift visual alert if container stops" | `vpn-drift.ts` cron checks `docker ps --filter "name=amnezia"` every 5 min, updates `vpnDriftStatus` to `"drifted"` / `"in_sync"` / `"unknown"` | YES |
| "Scripts auto-indexed on startup" | `server/index.ts` L216-220: `indexScriptsDirectory(scriptsRoot)` called at boot when `FEATURE_VPN_ENABLED=1` | YES |
| "Output streams in real time via WebSocket" | `script-executor.ts` → `executionBus` → `handler.ts` `wireExecutionToChannel()` → WS client | YES |

---

## 2. FEATURE_VPN_ENABLED Flag Wiring

**Status: Properly wired**

- **Read:** `server/index.ts` L60: `const vpnEnabled = process.env.FEATURE_VPN_ENABLED === "1";`
- **Route mounting:** L159-163: conditional `app.use("/api/vpn", vpnServersRouter)` and `app.use("/api/vpn", vpnScriptsRouter)` — only if `vpnEnabled` is true
- **Dynamic imports:** VPN modules are dynamically imported (L65-68) so code is never loaded when flag is off
- **Startup hooks:** L215-231: script indexer and drift cron only start when `vpnEnabled`
- **Default:** `.env.example` L19: `FEATURE_VPN_ENABLED=0` — feature is OFF by default
- **Log message:** L70: `"[startup] FEATURE_VPN_ENABLED off — VPN routes disabled"` when disabled

---

## 3. Environment Variables — Docs vs. Code

| Env Var | quickstart.md says | Actually consumed by code | Match? |
|---------|--------------------|---------------------------|---------|
| `FEATURE_VPN_ENABLED` | Required, must be `1` to enable | `server/index.ts` L60: `process.env.FEATURE_VPN_ENABLED === "1"` | YES |
| `VPN_SCRIPTS_ROOT` | Optional, default `./scripts` | `server/index.ts` L218: `process.env.VPN_SCRIPTS_ROOT \|\| "./scripts"` and `vpn-scripts.ts` L458: same fallback | YES |
| `VPN_DRIFT_INTERVAL_MS` | Optional, default 300000 (5 min) | **NOT CONSUMED** — `vpn-drift.ts` L19 hardcodes `const INTERVAL_MS = 300_000` | **NO** |
| `DASHBOARD_MASTER_KEY` | Required for envelope cipher, managed by Feature 011 | `envelope-cipher.ts` L29: `process.env.DASHBOARD_MASTER_KEY` | YES |

**Discrepancy:** `VPN_DRIFT_INTERVAL_MS` is documented in quickstart.md as configurable, but the code hardcodes the interval at 300,000 ms. The env var is never read.

---

## 4. npm Scripts Validation

| Script | quickstart.md references | package.json exists? | Command |
|--------|--------------------------|---------------------|---------|
| `db:generate` | Yes (step 1) | YES (L20) | `drizzle-kit generate` |
| `db:migrate` | Yes (step 2) | YES (L21) | `drizzle-kit migrate` |
| `dev` | Yes (step 3) | YES (L7) | `concurrently "tsx watch server/index.ts" "vite"` |

All three referenced npm scripts exist in `package.json` and map to the expected tools.

---

## 5. Discrepancies and Notes

### Discrepancy 1: `VPN_DRIFT_INTERVAL_MS` not wired
- **quickstart.md** says: "Drift detection polling interval in milliseconds (optional, default: 300000)"
- **Code:** `vpn-drift.ts` hardcodes `const INTERVAL_MS = 300_000` — the env var is never read.
- **Severity:** Low (cosmetic — the default matches, but operators expecting to tune it via env will be confused).
- **Fix:** Add `const INTERVAL_MS = parseInt(process.env.VPN_DRIFT_INTERVAL_MS || "300000", 10);` in `vpn-drift.ts`.

### Discrepancy 2: Quickstart says "UI at http://localhost:5173"
- The `dev` script runs `vite` (dev server default port is 5173), which is correct.
- No discrepancy — just noting this is the Vite dev default, not a hardcoded config.

### Discrepancy 3: quickstart.md mentions `@param` / `@description` annotations
- The quickstart says scripts must have `@param / @description annotations` but does not reference the script indexer implementation file.
- The indexer (`server/services/script-indexer.ts`) is imported dynamically in `server/index.ts` L217 and `vpn-scripts.ts` L454.
- This is consistent — no discrepancy, just an implementation detail.

---

## Summary

| Check | Result |
|-------|--------|
| Instructions match implementation | PASS |
| FEATURE_VPN_ENABLED properly wired | PASS |
| Env vars consumed by code | PARTIAL (VPN_DRIFT_INTERVAL_MS not wired) |
| npm scripts exist in package.json | PASS |
| No critical discrepancies | PASS |

**Action required:** Wire `VPN_DRIFT_INTERVAL_MS` env var in `vpn-drift.ts`, or remove it from quickstart.md documentation.
