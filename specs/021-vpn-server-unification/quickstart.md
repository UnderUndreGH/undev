# Quickstart: VPN/Server Unification

**Date**: 2025-05-24
**Spec**: 021-vpn-server-unification

## Prerequisites

- Feature 017 (vpn-tab-deserialize-fix) must be shipped
- VPN tab must be functional before starting this work

## Verifying Unification

### 1. Unified Server List

1. Navigate to Servers page
2. Verify all servers (general + VPN) appear in a single list
3. Each server shows a "kind" badge (General / VPN)
4. Kind filter dropdown works: "All" → all servers, "VPN" → VPN only, "General" → general only

### 2. VPN Tab Parity

1. Navigate to VPN tab
2. Verify it shows the EXACT same servers as filtering main list by "VPN"
3. Verify status indicators are identical
4. Verify refreshing one view updates the other (same cache)

### 3. Add/Edit Server

1. Open Add Server form
2. Select "General" → basic fields shown
3. Select "VPN" → VPN-specific fields additionally shown
4. Submit → server appears in correct filtered views

### 4. No VPN-Specific API Route

```bash
# This should return 410 Gone or 404:
curl http://localhost:3000/api/servers/vpn

# This should work:
curl http://localhost:3000/api/servers?kind=vpn
```

### 5. Cache Verification

1. Add a server from the main list
2. Switch to VPN tab → new server appears if it's VPN kind (no stale cache)
3. This confirms single React Query cache is working
