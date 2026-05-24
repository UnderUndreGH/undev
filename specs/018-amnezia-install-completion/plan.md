# Implementation Plan: Amnezia VPN Install Completion

**Branch**: `018-amnezia-install-completion` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-amnezia-install-completion/spec.md`

## Summary

Complete the Amnezia VPN install flow from a stubbed state to a fully functional end-to-end pipeline. The system must: execute Amnezia installation on remote Ubuntu servers via SSH, report multi-stage progress to the dashboard, extract and securely store VPN configuration, and deliver configuration to users as downloadable files or QR codes.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Express (server API), React Query (client cache), SSH2/worker pattern (Feature 016), AES-256-GCM (config encryption)
**Storage**: PostgreSQL — `servers` table with VPN columns; new storage for extracted configs
**Testing**: Integration test with real VPS; manual verification of config delivery
**Target Platform**: Web dashboard + remote Ubuntu 20.04+ servers
**Project Type**: Web application (monorepo: `server/`, `client/`)
**Performance Goals**: Install completes <5 min; progress updates <5s latency; config retrieval instant
**Constraints**: SSH connectivity to target; Amnezia CLI must support headless install
**Scale/Scope**: Single server install flow, 3 user stories, ~8-12 files touched

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | PASS | Install is non-destructive; retry on failure |
| II. Secrets never leak | PASS | VPN config encrypted at rest (AES-256-GCM); SSH keys already encrypted |
| III. Reviewable database changes | PASS | Config storage requires schema — generate .sql for review |
| IV. Typed boundaries | PASS | Install stages enum; Zod validation on config extraction |
| V. Feature flags and rollback posture | PASS | vpnStatus field already exists; failure sets "error" without affecting other servers |
| VI. Independent review gate | DEFERRED | Required before implement |
| VII. Snapshot stages | N/A | No snapshot tooling |

## Project Structure

### Documentation (this feature)

```text
specs/018-amnezia-install-completion/
├── plan.md              # This file
├── research.md          # Amnezia CLI investigation, SSH2 worker patterns
├── data-model.md        # VPN config storage entity
├── quickstart.md        # How to test the full install flow
├── contracts/           # API endpoint specs
│   └── vpn-install.md
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
server/
├── routes/
│   └── servers-vpn.ts        # Install trigger endpoint, config download endpoint
├── workers/
│   └── amnezia-installer.ts  # Worker: SSH → install → extract → store config
├── scripts/
│   └── install-amnezia.sh    # Remote execution script (uploaded to target server)
├── lib/
│   └── vpn-config.ts         # Config extraction, encryption, QR generation
└── db/
    └── migrations/           # Config storage migration (.sql)

client/
├── lib/
│   └── vpn-api.ts            # Install trigger, progress polling, config download
└── components/
    └── vpn/
        ├── InstallButton.tsx  # Trigger + progress display
        ├── ConfigDownload.tsx # Download .vpn/.conf file
        └── ConfigQRCode.tsx   # QR code display for mobile
```

**Structure Decision**: Existing web app monorepo. Worker pattern from Feature 016 extended for Amnezia-specific install logic.

## Research Decisions

### Install Mechanism
- Amnezia VPN supports headless install via `amnezia-vpn-cli` or via their bash installer script
- Script stages: (1) SSH connect, (2) install packages, (3) configure Amnezia, (4) extract config, (5) cleanup
- Worker reports progress via existing worker event system (Feature 016 pattern)

### Config Extraction
- Amnezia generates config files in a known path after install
- Config is typically a WireGuard `.conf` or Amnezia `.vpn` file
- Extract via SCP after install completes

### Encryption
- VPN config stored encrypted using AES-256-GCM (same pattern as `api_key_encrypted` in `ai_provider_keys`)
- Decrypted at delivery time only

## Complexity Tracking

No constitution violations. This is a medium-complexity feature (~200-300 LOC change) building on established patterns.
