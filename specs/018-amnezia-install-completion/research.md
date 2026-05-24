# Amnezia VPN Install — Research Notes

**Date**: 2025-05-24
**Spec**: 018-amnezia-install-completion

## Amnezia CLI / Headless Install

### Options Investigated

1. **Amnezia VPN CLI** (`amnezia-vpn-cli`): Official CLI tool. Supports headless configuration. Can generate config files for WireGuard and other protocols.
2. **Bash installer script**: Amnezia distributes a curl-able installer. Can be adapted for headless use.
3. **Docker-based install**: Amnezia offers Docker containers for VPN services. More predictable than bare-metal install.

### Recommendation

Use a custom `install-amnezia.sh` script that:
1. Checks prerequisites (Ubuntu 20.04+, root/sudo, curl)
2. Downloads and runs Amnezia installer with headless flags
3. Waits for service to start
4. Extracts generated config file from known path
5. Outputs config to stdout for capture by worker

### Script Stages for Progress Reporting

```
connecting    → SSH connection established
installing    → Package installation in progress
configuring   → Amnezia VPN service being configured
extracting    → VPN config being extracted
complete      → Install + config extraction done
error         → Any stage failure
```

## Config File Formats

- **WireGuard `.conf`**: Standard `[Interface]`/`[Peer]` format. Universally supported.
- **Amnezia `.vpn`**: Amnezia's extended format. Supported by Amnezia clients.
- Both should be extracted and stored. Deliver whichever the user requests.

## Encryption Pattern

Use existing `encrypt/decrypt` utility from `server/lib/crypto.ts` (AES-256-GCM pattern from `ai_provider_keys`). Store encrypted config in a new `vpn_configs` table or as a column on `servers` table.

## Worker Integration

Feature 016 established a worker pattern:
1. Client triggers action via POST endpoint
2. Server creates worker job, sets status on server record
3. Worker executes remote script via SSH
4. Worker emits events (progress stages)
5. Client polls status endpoint for progress

This pattern maps directly to Amnezia install.

## QR Code Generation

- Use `qrcode` npm package to generate QR code from WireGuard config string
- Render as SVG or data URL in the client component
- QR code is scannable by Amnezia mobile client and WireGuard mobile client
