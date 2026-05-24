# API Contracts: Script System Unification

**Date**: 2025-05-24
**Spec**: 022-script-system-unification

## POST /api/scripts/upload (admin-only)

Upload a new script.

**Request** (multipart/form-data):
- `file`: `.sh` script file
- `name`: script display name
- `description`: optional description

**Response** (201):
```json
{
  "id": 1,
  "name": "backup-database",
  "contentHash": "sha256-abc123...",
  "parameterSchema": {
    "type": "object",
    "properties": {
      "db_name": { "type": "string", "description": "Database name" }
    },
    "required": ["db_name"]
  },
  "source": "upload"
}
```

**Error** (400 — scanner rejection):
```json
{
  "error": "Script rejected: dangerous pattern detected",
  "violations": [
    { "pattern": "rm -rf /", "line": 15, "description": "Recursive force delete of root filesystem" }
  ]
}
```

**Error** (403 — not admin):
```json
{ "error": "Admin role required for script uploads." }
```

---

## GET /api/scripts

List all scripts.

**Response** (200):
```json
[
  {
    "id": 1,
    "name": "backup-database",
    "description": "Backup a database",
    "parameterSchema": { ... },
    "source": "upload",
    "createdAt": "2025-05-24T10:00:00Z"
  }
]
```

---

## PUT /api/scripts/:id (admin-only)

Update script content or metadata.

**Request** (multipart/form-data):
- `file`: new script file (optional — metadata-only update if omitted)
- `name`: updated name (optional)
- `description`: updated description (optional)

---

## DELETE /api/scripts/:id (admin-only)

Delete a script.

**Response** (200):
```json
{ "message": "Script 'backup-database' deleted." }
```

---

## POST /api/scripts/:id/execute

Execute a script on a target server.

**Request**:
```json
{
  "serverId": 5,
  "parameters": {
    "db_name": "production"
  }
}
```

**Response** (200):
```json
{
  "exitCode": 0,
  "stdout": "Backup completed successfully\n",
  "stderr": "",
  "sandboxed": true,
  "durationMs": 1234
}
```

**Error** (400 — validation error):
```json
{
  "error": "Parameter validation failed",
  "details": { "db_name": "Required" }
}
```

**Error** (400 — integrity failure):
```json
{
  "error": "Script integrity check failed. File may have been tampered with.",
  "expectedHash": "sha256-abc123...",
  "actualHash": "sha256-def456..."
}
```
