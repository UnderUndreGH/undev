# E2E Testing Deferred — Feature 016

**Date:** 2026-05-23  
**Status:** Deferred (T030–T034)  
**Rationale:** E2E tests require live SSH targets and VPN container orchestration. Deferred to post-merge CI with a dedicated VPS test fixture.

---

## US1 — Add VPS Server

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Create server with password auth, valid host | Server row created, status `pending`, sealed credential blob stored |
| 2 | Create server with SSH key auth | Same as above, key stored in sealed blob |
| 3 | Create server without credentials (`storeCredentials=false`) | Server created, credentials NULL after install attempt |
| 4 | Create server with `install=true` flag | SSH session boots Amnezia, status transitions `pending` → `active` |
| 5 | Create server with duplicate host+port | 409 conflict or idempotent update (per spec) |

## US2 — Delete VPS Server

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Delete existing server | Server row removed, 200 response |
| 2 | Delete non-existent server ID | 404 response |
| 3 | Delete server with active `script_runs` | Cascade delete removes associated runs (or blocks — verify per FK policy) |

## US3 — Drift Detection

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Container running on remote host | Drift status `in_sync` |
| 2 | Container stopped on remote host | Drift status `drift_detected`, UI shows alert |
| 3 | Server has no stored credentials | Drift status `unknown`, no SSH attempt made |
| 4 | SSH connection timeout | Drift status `unknown`, error logged |

## US4 — Script Executor

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Parse annotations from valid script content | `parseAnnotations` returns correct description + params |
| 2 | Index directory of `.sh` files | Script index populated with metadata |
| 3 | Execute script with required params | Script runs, output streamed via WS, status `completed` |
| 4 | Execute script missing required param | 400 validation error |
| 5 | Concurrent execution exceeds rate limit | 429 response for the N+1th request |

## US5 — Dynamic Parameters

| # | Scenario | Expected |
|---|----------|----------|
| 1 | All param types rendered (string, number, boolean, select) | UI renders appropriate input controls |
| 2 | Default values applied when user omits param | Execution uses default, completes successfully |
| 3 | Execution with all user-supplied values | Values passed as `PARAM_<NAME>` env vars, script uses them |
| 4 | Select param with invalid option | 400 validation error |

---

## CI Integration Notes

- E2E suite should provision a disposable VPS (e.g., Hetzner cloud API) per run.
- SSH keypair generated per run; injected via env.
- VPN install test is slow (~60s); mark with `@slow` annotation.
