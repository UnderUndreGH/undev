# API Contracts: Server Soft-Delete

**Date**: 2025-05-24
**Spec**: 019-server-soft-delete

## DELETE /api/servers/:id (modified)

Soft-delete a server. Requires name confirmation.

**Request**:
```json
{
  "confirmName": "my-server-01"
}
```

**Response** (200):
```json
{
  "id": 1,
  "name": "my-server-01",
  "deletedAt": "2025-05-24T10:00:00Z",
  "message": "Server archived. It will be permanently deleted in 30 days."
}
```

**Error** (400 — name mismatch):
```json
{
  "error": "Server name does not match. Type the exact server name to confirm deletion."
}
```

**Error** (409 — active deployments):
```json
{
  "error": "Cannot delete server with active deployments. Stop all deployments first."
}
```

**Error** (404 — not found):
```json
{
  "error": "Server not found."
}
```

---

## POST /api/servers/:id/restore

Restore a soft-deleted server.

**Response** (200):
```json
{
  "id": 1,
  "name": "my-server-01",
  "deletedAt": null,
  "message": "Server restored successfully."
}
```

**Error** (404 — not archived):
```json
{
  "error": "Server is not archived."
}
```

---

## GET /api/servers/archived

List all soft-deleted servers.

**Response** (200):
```json
[
  {
    "id": 1,
    "name": "my-server-01",
    "deletedAt": "2025-05-24T10:00:00Z",
    "remainingDays": 25,
    "approachingDeadline": false
  }
]
```

---

## GET /api/servers/:id (modified)

When server is soft-deleted, include `deletedAt` and `remainingDays` in response. Still accessible for viewing.

---

## POST /api/admin/finalize-deleted (internal/admin)

Trigger finalization of expired soft-deleted servers.

**Response** (200):
```json
{
  "finalized": 3,
  "servers": [
    { "id": 5, "name": "old-server", "permanentDeletedAt": "2025-05-24T12:00:00Z" }
  ]
}
```
