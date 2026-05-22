# Quickstart: Amnezia VPN Server Management

## Overview
This feature allows operators to add VPS servers, bootstrap Amnezia VPN, and manage the fleet. It integrates directly with the `devops-dashboard` UI.

## Environment Variables

```bash
# Feature flag — must be set to enable VPN/script routes (default: OFF)
FEATURE_VPN_ENABLED=1

# Encryption keys are managed via existing Feature 011 setup (DASHBOARD_MASTER_KEY).
# Refer to root README for KMS configuration. Do NOT create a separate encryption key.
```

## Running the App
1. Generate the database schema: `npm run db:generate`
2. Migrate the database: `npm run db:migrate`
3. Run the development server: `npm run dev`

## Usage
1. Open the UI at `http://localhost:5173` (or the configured Vite port).
2. Navigate to "Servers".
3. Click "Add Server" and provide the SSH credentials (Server Host / IP, Username, Key/Password, SSH Port).
4. If it's a new VPS, checking "Install Amnezia VPN" will automatically deploy the VPN payloads via SSH. If VPN is already installed, the system detects it and skips installation.
5. Servers will appear in the dashboard. If the Amnezia container stops unexpectedly on the remote VPS, a "Drift" visual alert will appear next to the server.
