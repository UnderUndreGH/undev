# Implementation Plan: Amnezia VPN Integration & Server Management

**Branch**: `016-vpn-features` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-vpn-features/spec.md`

## Summary

Extend the existing devops-dashboard to support VPS server management for Amnezia VPN. The spec extends the existing `servers` table (Features 005/006/008/009/011/013) with VPN-specific columns and reuses the existing `script_runs` table (Feature 005) for execution tracking. New tables: `scripts` and `script_params`. Features include: add/connect servers, VPN install via SSH, credential management (envelope encryption via existing Feature 011 pattern), server deletion, drift detection, dual-source script library (filesystem + DB), arbitrary script execution with real-time WebSocket output, and dynamic `@param` annotation parsing.

## Technical Context

**Language/Version**: TypeScript / Node.js
**Primary Dependencies**: React, Vite, Express, Drizzle ORM, `ssh2`
**Storage**: PostgreSQL (via Drizzle ORM)
**Testing**: Vitest (unit), Playwright (E2E)
**Target Platform**: Web application (devops-dashboard)
**Project Type**: Web Service + Single Page Application
**Performance Goals**: Add-server flow: ≤3 min end-to-end (SC-001). Script execution: ≤2 s from invoke to first stdout chunk (SC-004).
**Encryption**: Reuse existing envelope-encryption helper (Feature 011/013 pattern, see `server/lib/envelope-cipher.ts` using `DASHBOARD_MASTER_KEY`). Per-row IV, GCM auth tag, `{ ct, iv, tag }` blobs stored in `sshPasswordEncrypted`/`sshPrivateKeyEncrypted`. Do NOT introduce a parallel AES scheme.
**Scale/Scope**: Dozens of servers per user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Operator safety first)**: User must explicitly confirm server deletion. VPN-install from AI is always RED tier (FR-020).
- **Principle II (Secrets never leak)**: SSH passwords and keys encrypted at rest via existing envelope cipher. Never logged. WebSocket auth enforced (FR-019) to prevent output leakage.
- **Principle III (Reviewable database changes)**: Drizzle ORM migrations (`drizzle-kit generate`) reviewed before execution. Extends existing tables — never redefines.
- **Principle IV (Typed boundaries)**: API inputs validated using Zod.
- **Principle V (Feature flags and rollback posture)**: VPN install and arbitrary script execution gated behind `FEATURE_VPN_ENABLED=1` env flag (default OFF in production). Per-server `scripts_enabled` boolean column (default false) controls script execution at row level. When flag is off, VPN routes return 404 and script execution endpoints are disabled.
- **Principle VI (Independent review gate)**: Will require `/speckit.analyze` PASS + two reviewer PASS verdicts before `/speckit.implement`.
- **Principle VII (Snapshot stages)**: **GAP**: Snapshot tags for `/specify`, `/plan`, `/tasks` stages have NOT been verified (`git tag -l "specify/016-vpn-features/*"` returned no results at time of writing). Remediation: run `snapshot-stage.ps1` for each completed stage and document, or acknowledge gap in post-implementation review.

## Project Structure

### Documentation (this feature)

```text
specs/016-vpn-features/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── tasks.md             # Phase 2 output
└── notes/               # Investigation notes
```

### Source Code (repository root)

```text
devops-app/
├── server/
│   ├── db/
│   │   └── schema.ts           # EXTEND servers table; ADD scripts + script_params tables
│   ├── routes/
│   │   ├── servers.ts          # EXTEND existing API for VPN fields
│   │   └── scripts.ts          # NEW: script CRUD + execute
│   └── services/
│       ├── ssh.ts              # EXTEND existing SSH service
│       ├── drift.ts            # NEW: Cron-like polling for drift detection
│       ├── script-indexer.ts   # NEW: Filesystem script scanner + DB sync
│       ├── script-parser.ts    # NEW: @param + @description annotation parser
│       └── script-executor.ts  # NEW: Script execution engine (SSH + env vars + streaming)
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   └── Servers/        # Servers dashboard & management
│   │   └── components/
│   │       ├── ServerForm.tsx  # Add server form
│   │       ├── ServerList.tsx  # Display servers and drift alerts
│   │       ├── ScriptTree.tsx  # Navigable script directory tree + "Re-scan" button
│   │       ├── ScriptForm.tsx  # Dynamic param form (renders from @param annotations)
│   │       ├── ScriptOutput.tsx# Real-time execution output (WebSocket)
│   │       └── ScriptEditor.tsx# Create/edit custom scripts (DB-sourced only)
├── scripts/                    # Script library root (filesystem-sourced)
│   ├── vpn/
│   │   └── install-amnezia.sh  # Amnezia VPN installer (Docker-based)
│   ├── server-ops/
│   │   └── initialise          # Server initialization script
│   └── maintenance/
│       └── cleanup             # Maintenance cleanup script
```

**Structure Decision**: Extends existing `devops-app` monolith. No new crypto module — reuses `server/lib/envelope-cipher.ts`.

## Testing Strategy

- **Unit tests (Vitest)**: `script-parser.ts` regex, envelope-cipher integration for VPN credentials, script-indexer collision logic.
- **E2E tests (Playwright)**: One per user story (US1–US5) covering acceptance scenarios.
- **Perf validation**: SC-004 first-byte streaming latency measured in E2E.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Dual-source scripts (FS + DB) | User wants filesystem ease + UI editability | FS-only = no UI editing; DB-only = harder initial setup |
| WebSocket for output streaming | Real-time output requires push | Polling = higher latency, more DB load |
| Custom annotation parser | No standard exists for shell param metadata | Hardcoded params = new script = code change |
