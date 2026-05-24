# API Contracts: Unified Servers

**Date**: 2025-05-24
**Spec**: 021-vpn-server-unification

## GET /api/servers (unified)

List servers with optional kind filter.

**Query params**: `kind=all|vpn|general` (default: `all`)

**Response** (200):
```json
[
  {
    "id": 1,
    "name": "my-server",
    "kind": "general",
    "ip": "1.2.3.4",
    "vpnStatus": null
  },
  {
    "id": 2,
    "name": "vpn-server",
    "kind": "vpn",
    "ip": "5.6.7.8",
    "vpnStatus": "running"
  }
]
```

---

## POST /api/servers (modified)

Create server. Now accepts `kind` field.

**Request**:
```json
{
  "name": "new-server",
  "ip": "10.0.0.1",
  "kind": "general",
  "sshCredentials": { ... }
}
```

---

## GET /api/servers/vpn — REMOVED

Use `GET /api/servers?kind=vpn` instead. Returns 410 Gone during transition (if needed).

---

## PUT /api/servers/:id (modified)

Update server. Can change `kind` field.

---

## Kind Filter Validation

- `kind` param accepts: `all`, `general`, `vpn` (and future types)
- Invalid value → 400 with error: `Invalid kind filter. Accepted values: all, general, vpn`
- Missing `kind` → defaults to `all`
