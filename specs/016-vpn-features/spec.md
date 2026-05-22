# Feature Specification: Amnezia VPN Integration & Server Management

**Feature Branch**: `016-vpn-features`  
**Created**: 2026-05-23
**Status**: Reviewed  
**Input**: User description: "загугли популярные фичи для девопс приложений + я хочу добавить фичу установки амнезии впн https://github.com/amnezia-vpn/amnezia-client на впс с фронтом как у амнезии клиента, в плане, какие поля заполнять, чтобы настроить подключение и нужна фича удаление сервера из списка серверов - а то добавить добавил, а удалить ненужный мешающийся нельзя"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add and Configure VPS for Amnezia VPN (Priority: P1)

As a user, I want to add a new VPS or connect to an existing Amnezia VPN server by filling out a connection form identical to the official Amnezia VPN client.

**Why this priority**: Core functionality requested by the user to enable VPN server provisioning and management.

**Independent Test**: Can be tested by filling out the connection form with test VPS credentials and verifying that the VPS is successfully added to the system and VPN installation is triggered (for new servers) or connection is established (for existing servers).

**Acceptance Scenarios**:

1. **Given** the user is on the server management page, **When** they click "Add Server", **Then** they see a form with fields mirroring the Amnezia VPN client (Server Host / IP, Username, Password/Key, SSH Port). Implementation maps to existing schema columns: `host`, `sshUser`, `port`, `sshPasswordEncrypted`/`sshPrivateKeyEncrypted`.
2. **Given** a new server setup, **When** the user submits the form, **Then** they are given a choice: either automatically add the server to the list (store credentials for future connections) OR forget the credentials after installation.
3. **Given** an existing server setup, **When** the user submits the form, **Then** the application stores the credentials to allow future connections without re-requesting them.

---

### User Story 2 - Delete Server from the List (Priority: P1)

As a user, I want to be able to delete a previously added server from my list of servers so that obsolete or interfering servers do not clutter the interface.

**Why this priority**: Explicitly requested by the user due to frustration with the inability to remove added servers.

**Independent Test**: Can be tested by adding a dummy server and then deleting it, verifying it is completely removed from the UI and backend data store.

**Acceptance Scenarios**:

1. **Given** a list of added servers, **When** the user clicks the "Delete" action next to a server, **Then** a confirmation dialog appears.
2. **Given** the confirmation dialog, **When** the user confirms deletion, **Then** the server is removed from the application's view and its data is deleted from the DB. **Note:** The Amnezia VPN installation on the VPS itself is NOT uninstalled, allowing future re-connection. Per FR-004, deletion is App-View-Only.

---

### User Story 3 - Drift Detection (Priority: P3)

As a DevOps engineer, I want the application to detect and alert when an active server's VPN configuration has drifted from the expected state.

**Why this priority**: Addresses the user's prompt to research popular DevOps app features. Reduced from original overscoped US3 (self-service environments + cost tracking removed — out of MVP scope).

**Independent Test**: Can be tested by stopping the VPN container on a remote host and verifying that the drift alert appears in the UI.

**Acceptance Scenarios**:

1. **Given** an active server with stored credentials, **When** its VPN configuration drifts from the expected state, **Then** a Visual UI Alert is displayed on the server list.
2. **Given** a server with forgotten credentials (`storeCredentials=false`), **When** drift detection runs, **Then** the server's drift status remains `unknown` and is skipped by the drift poller.

---

### User Story 4 - Execute Arbitrary Scripts on Servers (Priority: P1)

As a user, I want to execute any custom script from the script library on a selected server (e.g., `server-ops/initialise`, maintenance scripts, diagnostics), not just the built-in Amnezia VPN installer.

**Why this priority**: User explicitly requested the ability to execute any custom script, not just hardcoded VPN installation. This generalizes the SSH execution layer.

**Independent Test**: Can be tested by adding a script file to the scripts directory, verifying it appears in the UI script tree, selecting a server, and executing it. The output should be displayed in the UI.

**Acceptance Scenarios**:

1. **Given** the user is on the server detail page, **When** they open the "Scripts" panel, **Then** they see a tree of all available scripts (organized by folder hierarchy like `server-ops/initialise`, `maintenance/cleanup`, etc.).
2. **Given** a script in the tree, **When** the user clicks "Execute" on it, **Then** the system establishes an SSH connection to the selected server and runs the script.
3. **Given** a running script, **When** it produces output, **Then** the output is streamed back to the UI in real-time (stdout + stderr).
4. **Given** a script execution completes, **When** it finishes (success or failure), **Then** the exit code and final output are displayed.

---

### User Story 5 - Dynamic Script Options from Annotations (Priority: P2)

As a user, I want the UI to automatically detect and present input fields for script parameters (defined via `# @param` annotations in the script file) so I can fill in required values before executing the script.

**Why this priority**: Eliminates hardcoding script options — scripts become self-describing. Makes adding new scripts zero-code on the frontend.

**Independent Test**: Can be tested by creating a script with `# @param` annotations, verifying the UI renders the correct form fields, and confirming the values are passed as environment variables during execution.

**Acceptance Scenarios**:

1. **Given** a script with `# @param NAME:type[(opts)]:default:description` annotations, **When** the user selects the script for execution, **Then** the UI renders a dynamic form with labeled input fields matching each `@param`.
2. **Given** a param with type `string`, **When** rendered, **Then** it shows a text input. For `number` — a number input. For `boolean` — a toggle/checkbox. For `select:a,b,c` — a dropdown.
3. **Given** the user fills in param values and clicks "Execute", **When** the script runs, **Then** the values are passed as environment variables (`PARAM_<NAME>=<value>`) to the script.
4. **Given** a param with a default value, **When** the form renders, **Then** the default value is pre-filled.

---

### Edge Cases

- What happens if the VPS credentials provided for Amnezia VPN are incorrect?
- What happens if the VPS is unreachable during installation?
- How are SSH keys securely stored for the connection form when the user chooses to save credentials?
- What happens if a script file is malformed or has no executable permissions?
- What happens if a `@param` annotation has an unsupported type?
- What happens if the script exits with a non-zero code?
- What happens if two scripts with the same path exist in both filesystem and DB? (FS wins — overwrite DB row)
- Remote temp file must use mktemp + 0700 + EXIT-trap cleanup to prevent symlink attack (see T015).
- If credentials were not stored (`storeCredentials=false`), drift status is `unknown` and the drift cron skips that server.
- When `storeCredentials=false`, the system MUST NULL `sshPasswordEncrypted`/`sshPrivateKeyEncrypted` columns immediately after VPN install completes (success OR failure). Wrap in try/finally.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Add Server" form mirroring the Amnezia VPN client fields (Server Host / IP, Username, Password/Key, SSH Port). Note: API uses existing schema column names (`host`, `sshUser`, `port`); UI labels may differ for user friendliness.
- **FR-002**: System MUST trigger the Amnezia VPN installation payload onto the target VPS upon successful form submission if it's a new server. MVP uses `scripts/vpn/install-amnezia.sh` — a Docker-based install script. Script contents are out-of-scope of this spec; spec only mandates the orchestration.
- **FR-003**: System MUST display a list of all configured servers.
- **FR-004**: System MUST allow users to delete any server from the server list (removes from App View Only — does NOT uninstall remote VPN).
- **FR-005**: System MUST prompt for confirmation before deleting a server.
- **FR-006**: System MUST securely handle and store server credentials (passwords/keys) if the user chooses to retain them, or securely discard them if they choose the "forget" option. When `storeCredentials=false`, the system MUST NULL `sshPasswordEncrypted`/`sshPrivateKeyEncrypted` columns immediately after VPN install completes (success OR failure). Wrap in try/finally.
- **FR-007**: System MUST support connecting to existing Amnezia VPN servers without re-installation. System MUST probe the target server to detect whether Amnezia container/binaries already exist before attempting installation.
- **FR-008**: System MUST display a Visual UI Alert when configuration drift is detected on an active server. Drift state machine: `in_sync` → `drifted` → `in_sync` plus terminal `unknown` (no creds, never-contacted, or error).
- **FR-009**: System MUST index script files from the filesystem `scripts/` directory at startup and store metadata in the database (dual-source: filesystem = primary, DB = index + custom scripts added via UI).
- **FR-010**: System MUST display a navigable tree of all available scripts organized by directory hierarchy.
- **FR-011**: System MUST allow users to execute any script from the library on any server with stored credentials.
- **FR-012**: System MUST stream script execution output (stdout + stderr) in real-time to the frontend via authenticated WebSocket.
- **FR-013**: System MUST display the exit code and final output when script execution completes. Reuses existing `script_runs` table (Feature 005).
- **FR-014**: System MUST parse `# @param NAME:type[(opts)]:default:description` annotations from script files and expose them via API. Annotation parser MUST tolerate `:` in description but reject `:` in default values (with parse warning).
- **FR-015**: System MUST render dynamic form fields on the frontend based on parsed `@param` annotations (string→text input, number→number input, boolean→checkbox, select:a,b,c→dropdown).
- **FR-016**: System MUST pass user-provided param values as environment variables (`PARAM_<NAME>=<value>`) to the script during execution. Uses existing `script_runs` execution semantics.
- **FR-017**: System MUST pre-fill default values from `@param` annotations in the UI form.
- **FR-018**: System MUST allow adding/editing custom scripts through the UI (stored in DB, `source='database'`).
- **FR-018a**: Filesystem-sourced scripts (`source='filesystem'`) MUST NOT be editable, renameable, or deletable via API or UI. Edits require filesystem modification + re-index.
- **FR-019**: System MUST authenticate WebSocket connections to `/ws/executions/:executionId` using the same session cookie used by REST routes. Unauthenticated connections MUST be closed with code 1008 (policy violation). System MUST authorize: the connecting user MUST own the execution (`script_runs.userId === session.userId`).
- **FR-020**: When the AI Copilot (Feature 013) proposes a VPN-install or script-execution tool call, the danger-tier framework MUST gate it. Per-server `aiWriteAccess='disabled'` MUST block ALL script executions originating from `initiatedBy='ai_proposal'`. VPN-install is always RED tier (typed-confirmation challenge required).

### Non-Functional Requirements

- **NFR-001**: Max 3 concurrent script executions per server. `POST /api/scripts/:id/execute` returns 429 when exceeded.

### Key Entities

- **Server**: Represents a VPS. EXTENDS existing `servers` table (Feature 005/006/008/009/011/013). Contains host, connection credentials (if stored, envelope-encrypted), drift status, and VPN installation status.
- **Script**: Represents an executable script. Sourced from filesystem or DB. Contains path, name, description, parsed params, and content.
- **ScriptExecution**: Represents a single execution of a script on a server. REUSES existing `script_runs` table (Feature 005, `server/db/schema.ts:350`). Contains status, output (via `logFilePath`), exit code, and timestamps.
- **ScriptParam**: Parsed `@param` annotation. Belongs to a Script. Fields: name (uppercase), type, defaultValue, description, options (for select), order.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: User can successfully add a VPS and initiate Amnezia VPN installation in under 3 minutes.
- **SC-002**: User can delete an existing server from the list with no more than 2 clicks (including confirmation).
- **SC-003**: Server deletion successfully cleans up all local database records related to that server without affecting the remote VPS.
- **SC-004**: User can execute any script from the library on a server and see real-time output within 2 seconds of invocation.
- **SC-005**: Script with `@param` annotations renders a correct dynamic form with zero frontend code changes.
- **SC-006**: Adding a new `.sh` file to the `scripts/` directory makes it available in the UI within one application restart (or via "Re-scan" button without restart).
