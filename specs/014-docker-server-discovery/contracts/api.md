# API Contract: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22

## Modified Endpoints

### GET /api/servers

**Response change**: Each server object now includes `connectionType` field.

```typescript
interface ServerResponse {
  // ... existing fields ...
  connectionType: "ssh" | "local";  // NEW — default "ssh" for existing servers
}
```

### DELETE /api/servers/:id

**New guard**: Returns `403 Forbidden` when `id === LOCAL_SERVER_ID`.

```json
{
  "error": "Cannot delete the local server"
}
```

### POST /api/servers/:id/verify

**Local behavior**: Returns immediately with `{ status: "online", latencyMs: 0 }` — no SSH connection attempt.

### POST /api/servers/:id/setup

**Local behavior**: Returns `400 Bad Request` — local server is always `setupState = 'ready'`.

### POST /api/servers/probe

**No change**: Probe is for SSH onboarding. Local server is auto-seeded, never probed.

### POST /api/servers/onboard

**No change**: Onboarding is for SSH servers. Local server is auto-seeded, never onboarded.

### POST /api/servers/:id/rotate-key

**Local behavior**: Returns `400 Bad Request` — no SSH keys to rotate on local server.

## Unchanged Endpoints

All other server endpoints work identically for local and SSH servers:

- `GET /api/servers/:id` — returns server with `connectionType: "local"`
- `PUT /api/servers/:id` — updates allowed fields (label, scanRoots, AI policy)
- `GET /api/servers/:id/health` — returns health snapshots (collected via local exec)
- `POST /api/servers/:id/health/refresh` — triggers local health poll
- `GET /api/servers/:id/docker/*` — Docker operations via local exec
- `POST /api/servers/:id/scan` — scan via local exec
- All deployment and script endpoints — transparent via SSHPool proxy

## Client-Side Contract

### Server List (DashboardPage)

```typescript
// Conditional rendering per connectionType
if (server.connectionType === "local") {
  // Show "Local" badge (LocalBadge component)
  // Hide "SSH" status indicator
  // Disable delete button
}
```

### Server Detail (ServerPage)

```typescript
// SSH-specific UI hidden when connectionType === "local":
// - SSH credentials section
// - "Verify SSH" button
// - "Rotate Key" button
// - Setup/Initialise wizard
// - Onboarding flow
//
// All other tabs fully functional:
// - Apps, Scripts, Health, Backups, Logs, Docker, AI Policy
```
