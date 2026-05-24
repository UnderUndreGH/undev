# API Contracts: Amnezia VPN Install

**Date**: 2025-05-24
**Spec**: 018-amnezia-install-completion

## POST /api/servers/:id/vpn/install

Trigger Amnezia VPN installation on a server.

**Request**:
```json
{
  "reinstall": false
}
```

**Response** (202 Accepted):
```json
{
  "serverId": 1,
  "status": "installing",
  "message": "Installation started"
}
```

**Error** (409 Conflict — already installed):
```json
{
  "error": "VPN already installed. Set reinstall=true to overwrite."
}
```

**Error** (400 — active deployment):
```json
{
  "error": "Cannot install VPN on server with active deployments."
}
```

---

## GET /api/servers/:id/vpn/status

Poll installation progress.

**Response** (200):
```json
{
  "serverId": 1,
  "vpnStatus": "configuring",
  "stage": "configuring",
  "message": "Configuring Amnezia VPN service...",
  "startedAt": "2025-05-24T10:00:00Z"
}
```

---

## GET /api/servers/:id/vpn/config

Download VPN configuration file.

**Query params**: `format=wireguard|amnezia`

**Response** (200):
- `Content-Type: application/octet-stream`
- `Content-Disposition: attachment; filename="server-name.conf"`
- Body: decrypted config file content

**Error** (404 — no config):
```json
{
  "error": "VPN configuration not available. Install VPN first."
}
```

---

## GET /api/servers/:id/vpn/config/qr

Get QR code for VPN configuration.

**Query params**: `format=wireguard|amnezia`

**Response** (200):
```json
{
  "qrCodeDataUrl": "data:image/svg+xml;base64,...",
  "format": "wireguard"
}
```
