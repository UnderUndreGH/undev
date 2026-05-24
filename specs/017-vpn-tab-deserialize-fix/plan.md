# Implementation Plan: VPN Tab Deserialize Fix

**Branch**: `017-vpn-tab-deserialize-fix` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-vpn-tab-deserialize-fix/spec.md`

## Summary

Fix a data shape mismatch between the VPN server list endpoint and the client VPN API module. The server wraps the response in `{ servers: rows }` while the client expects a bare array. One-line change in `server/routes/servers-vpn.ts:227` — change `res.json({ servers: rows })` to `res.json(rows)`.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Express (server), React Query (client)
**Storage**: PostgreSQL via existing `servers` table — no schema changes
**Testing**: Manual verification via VPN tab; no automated test suite required for this fix
**Target Platform**: Web dashboard (server + client)
**Project Type**: Web application (monorepo: `server/`, `client/`)
**Performance Goals**: N/A — one-line fix
**Constraints**: Zero collateral changes (SC-003)
**Scale/Scope**: Single line in single file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Non-destructive fix, no data loss risk |
| II. Secrets never leak | PASS | No secrets involved |
| III. Reviewable database changes | PASS | No database changes |
| IV. Typed boundaries | PASS | Response shape becomes consistent with client expectations |
| V. Feature flags and rollback posture | PASS | Trivially reversible |
| VI. Independent review gate | DEFERRED | Required before implement, not before plan |
| VII. Snapshot stages | N/A | No snapshot tooling present |

## Project Structure

### Documentation (this feature)

```text
specs/017-vpn-tab-deserialize-fix/
├── plan.md              # This file
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
server/
├── routes/
│   └── servers-vpn.ts   # Line 227 — the fix target
client/
└── lib/
    └── vpn-api.ts       # Client-side consumer (no changes needed)
```

**Structure Decision**: Existing web app structure. Change is isolated to `server/routes/servers-vpn.ts`.

## Complexity Tracking

No constitution violations. Trivial fix, <5 LOC total change.
