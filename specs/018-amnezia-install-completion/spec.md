# Feature Specification: Amnezia VPN Install Completion

**Feature Branch**: `018-amnezia-install-completion`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Complete the Amnezia VPN install flow. Currently stubbed — clicking "Install Amnezia VPN" sets vpnStatus="installing" and halts. Need: install script, worker invocation, config extraction, user delivery.

## Context

Feature 016 (VPN Features) implemented VPN server management infrastructure including a worker integration pattern. The Amnezia VPN install action exists as a stub: the UI shows an "Install Amnezia VPN" checkbox/button that sets `vpnStatus="installing"` on the server record, then stops. There is no `install-amnezia.sh` script, no worker to run it, no mechanism to extract the generated VPN configuration, and no UI to deliver the config to the user.

This spec closes that gap, building on the Feature 016 worker integration pattern.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install Amnezia VPN on a Fresh Server (Priority: P1)

A user provisions a fresh Ubuntu VPS, adds it to the server list, and clicks "Install Amnezia VPN". The system installs Amnezia on the remote server, extracts the generated VPN configuration, and presents it to the user as a downloadable file and/or QR code. The user downloads the config, imports it into the Amnezia client, and connects successfully.

**Why this priority**: This is the core end-to-end flow. Without it, the VPN feature is a placeholder.

**Independent Test**: Can be fully tested by provisioning a fresh Ubuntu VPS, triggering install, and verifying config delivery + client connection.

**Acceptance Scenarios**:

1. **Given** a server running Ubuntu 20.04+ with SSH access configured, **When** the user clicks "Install Amnezia VPN", **Then** the system installs Amnezia VPN on the remote server and updates `vpnStatus` to "running" upon success.
2. **Given** Amnezia installation completes successfully, **When** the config is extracted, **Then** the user can download a `.vpn` file (Amnezia format) or WireGuard `.conf` file.
3. **Given** a `.vpn` config file, **When** the user imports it into the Amnezia client, **Then** the client connects to the VPN server successfully.

---

### User Story 2 - Monitor Installation Progress (Priority: P2)

During installation (which may take 2-5 minutes), the user sees real-time status updates in the dashboard — progress stages (connecting, installing packages, configuring, extracting config) and any error messages.

**Why this priority**: User confidence during a multi-minute operation. Without feedback, users may retry or abandon.

**Independent Test**: Trigger install on a real server and verify status updates appear in the UI at each stage.

**Acceptance Scenarios**:

1. **Given** installation is in progress, **When** the user views the server detail page, **Then** the status indicator shows the current stage of installation.
2. **Given** installation fails at any stage, **When** the error occurs, **Then** the user sees a human-readable error message and the status reverts to "error" with a retry option.

---

### User Story 3 - Retrieve VPN Config After Installation (Priority: P3)

After installation completes, the user can return to the server detail page at any time to re-download the VPN config or display the QR code for mobile client setup.

**Why this priority**: Users lose config files. Persistent access to config retrieval is essential for ongoing usability.

**Independent Test**: Install VPN, navigate away, return to server detail, verify config download still available.

**Acceptance Scenarios**:

1. **Given** a server with `vpnStatus="running"`, **When** the user views the server detail page, **Then** a "Download VPN Config" action is available.
2. **Given** a server with `vpnStatus="running"`, **When** the user clicks "Show QR Code", **Then** a QR code is displayed that can be scanned by the Amnezia mobile client.

---

### Edge Cases

- What happens if the server loses SSH connectivity mid-install? — Status should show "error" with a message about connectivity loss; partial install should be cleaned up on retry.
- What happens if Amnezia install script fails (package conflict, insufficient disk space)? — Error message propagated to user; status set to "error"; retry available.
- What happens if the user triggers install on a server that already has VPN installed? — Show confirmation prompt: "VPN is already installed. Reinstall?" with warning that existing config will be invalidated.
- What happens if config extraction fails (script ran but config file not found)? — Status shows "error" with specific message; install succeeded but manual config retrieval may be needed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST execute Amnezia VPN installation on a remote Ubuntu server via SSH when the user triggers the install action.
- **FR-002**: System MUST report installation progress through multiple stages (connecting, installing, configuring, extracting, complete).
- **FR-003**: System MUST extract the generated VPN configuration (`.vpn` file and/or WireGuard `.conf`) after successful installation.
- **FR-004**: System MUST store the extracted configuration securely (encrypted at rest).
- **FR-005**: System MUST provide a UI mechanism for the user to download the VPN config file.
- **FR-006**: System MUST provide a UI mechanism for the user to display a QR code of the VPN config for mobile scanning.
- **FR-007**: System MUST update `vpnStatus` through the lifecycle: "installing" → "running" (success) or "error" (failure).
- **FR-008**: System MUST support retrying a failed installation.
- **FR-009**: System MUST warn the user when re-installing on a server that already has VPN configured.

### Key Entities

- **VPN Installation**: A process entity tracking the lifecycle of an Amnezia install on a specific server — stages: pending, connecting, installing, configuring, extracting, complete, error.
- **VPN Configuration**: The extracted connection credentials — protocol type, server endpoint, encryption keys, DNS settings. Stored encrypted, deliverable as file or QR.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: End-to-end installation on a fresh Ubuntu VPS completes within 5 minutes.
- **SC-002**: User can download config and connect via Amnezia client within 6 minutes of triggering install.
- **SC-003**: Installation progress updates appear in the dashboard within 5 seconds of each stage transition.
- **SC-004**: Failed installations show a human-readable error message within 10 seconds of failure.
- **SC-005**: Config retrieval is available at any time after successful installation, without re-running install.

## Assumptions

- Target servers run Ubuntu 20.04+ with SSH access via the credentials already stored in the server record.
- Amnezia VPN supports headless install via script (documented in Amnezia CLI/docs).
- The Feature 016 worker integration pattern is the mechanism for executing remote scripts.
- Config encryption uses the same AES-256-GCM pattern already used for `api_key_encrypted` in `ai_provider_keys`.
