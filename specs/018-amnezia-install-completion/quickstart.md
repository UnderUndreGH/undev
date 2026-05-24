# Quickstart: Amnezia VPN Install

**Date**: 2025-05-24
**Spec**: 018-amnezia-install-completion

## Prerequisites

1. A server running Ubuntu 20.04+ with SSH access configured in the dashboard
2. The server must be accessible via the SSH credentials stored in its server record
3. The server must have at least 1GB free disk space and internet connectivity

## Testing the Full Flow

### 1. Add a Server

Add a fresh Ubuntu VPS to the dashboard with SSH credentials.

### 2. Trigger Install

Navigate to the server detail page → click "Install Amnezia VPN".

Watch progress stages: connecting → installing → configuring → extracting → complete.

### 3. Download Config

After install completes, click "Download VPN Config" to get a `.conf` file.

### 4. Import to Client

- **Amnezia desktop**: Import → select downloaded file
- **Amnezia mobile**: Scan QR code from server detail page
- **WireGuard**: Import tunnel from file

### 5. Verify Connection

Connect via the client. Verify your public IP matches the server's IP.

## Troubleshooting

- **Install fails at "connecting"**: Check SSH credentials and server accessibility
- **Install fails at "installing"**: Check server disk space and internet connectivity
- **Config extraction fails**: Install succeeded but config not found — check Amnezia service status on server
- **Client won't connect**: Verify server firewall allows WireGuard/Amnezia ports (typically UDP 51820)
