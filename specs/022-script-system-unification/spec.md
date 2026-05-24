# Feature Specification: Script System Unification

**Feature Branch**: `022-script-system-unification`  
**Created**: 2025-05-24  
**Status**: Draft  
**Input**: Unify two script-execution systems (Feature 005 Zod-manifest with 13 hardcoded scripts + Feature 016 `# @param` annotations with DB-stored scripts) into a single system with secure script upload, parameter parsing, content scanning, RBAC, and sandboxed execution.

## Context

The codebase has two incompatible script execution systems:

1. **Feature 005 (Zod-manifest)**: 13 hardcoded scripts with parameters defined via Zod schemas. Scripts are registered in code, validated at compile time, and executed with typed parameters.
2. **Feature 016 (`# @param` annotations)**: Scripts stored in the database with parameters extracted from `# @param` comment annotations. Runtime parsing of comments for parameter discovery.

These systems use different parsers, different storage mechanisms, and different validation approaches. A script written for one system cannot run in the other. Additionally, both systems have significant security gaps (see [SECURITY-PASS-REQUIRED] below).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Upload and Parse a Script (Priority: P1)

An admin user uploads a `.sh` script file through the dashboard. The system parses parameters from the script's annotations, scans the content for dangerous patterns, validates it passes the security scanner, and stores the script with its parameter schema (as JSON Schema in the database).

**Why this priority**: Upload is the entry point. Without secure upload, nothing else matters.

**Independent Test**: Upload a well-formed script with `# @param` annotations, verify it appears in the script list with parsed parameters. Upload a dangerous script (containing `rm -rf /`), verify it is rejected.

**Acceptance Scenarios**:

1. **Given** a valid `.sh` script with `# @param` annotations, **When** the admin uploads it, **Then** the system parses all parameters, stores the script, and displays it in the script list with parsed parameter metadata.
2. **Given** a script containing dangerous patterns (e.g., `rm -rf /`, `curl | bash`, `eval`, `exec`), **When** the admin uploads it, **Then** the system rejects the upload with a specific security violation message identifying the problematic pattern.
3. **Given** a script without any `# @param` annotations, **When** the admin uploads it, **Then** the system stores it as a parameterless script and it appears in the script list.
4. **Given** a valid script, **When** stored, **Then** its parameter schema is stored as JSON Schema (not raw Zod strings — never eval untrusted code).

---

### User Story 2 - Execute a Script with Parameters (Priority: P1)

A user selects a script from the script library, fills in its parameters via a dynamically generated form, and executes it on a target server. The script runs inside a sandboxed environment. Results (stdout, stderr, exit code) are returned to the user.

**Why this priority**: Execution is the core value. Both upload and execution are P1 because neither is useful alone.

**Independent Test**: Upload a script that echoes its parameters, execute it on a test server with parameter values, verify the output contains the provided values.

**Acceptance Scenarios**:

1. **Given** a script with parameters is stored in the library, **When** the user selects it, **Then** a form is dynamically generated from the JSON Schema parameter definition with correct types and validation.
2. **Given** the user fills in parameters and executes the script, **When** execution completes, **Then** the user sees stdout, stderr, and exit code.
3. **Given** a script execution fails, **When** the sandbox detects a policy violation, **Then** the execution is terminated and the user sees a clear sandbox violation message.
4. **Given** a legacy `# @param` script from Feature 016, **When** executed, **Then** it runs identically to before (backward compatibility).

---

### User Story 3 - Manage Script Library with RBAC (Priority: P2)

An admin can view all scripts, upload new ones, update existing ones, and delete them. Non-admin users can browse and execute scripts but cannot modify the library. Every upload, update, delete, and execute event is recorded in an audit trail.

**Why this priority**: Multi-user safety. Without RBAC, any user could inject malicious scripts.

**Independent Test**: Log in as admin, upload a script — succeeds. Log in as non-admin, attempt upload — rejected. Check audit log for the upload event.

**Acceptance Scenarios**:

1. **Given** an admin user, **When** they upload a new script, **Then** the upload succeeds and an audit entry is created.
2. **Given** a non-admin user, **When** they attempt to upload a script, **Then** the action is denied with a clear permissions error.
3. **Given** any user, **When** they execute a script, **Then** an audit entry records the execution with actor, timestamp, script name, parameters (redacted for secrets), and target server.
4. **Given** an admin user, **When** they update an existing script, **Then** the previous version's hash is archived and a new audit entry is created.

---

### User Story 4 - Legacy Scripts Continue Working (Priority: P2)

All existing Feature 016 scripts with `# @param` annotations continue to work without modification. The `# @param` parser is retained as a fallback for scripts that don't have a Zod-manifest or JSON Schema definition.

**Why this priority**: Zero-break migration. Existing operational scripts cannot stop working.

**Independent Test**: Execute a pre-existing Feature 016 script, verify it runs with the same parameter parsing and execution behavior as before.

**Acceptance Scenarios**:

1. **Given** a script created under Feature 016 with `# @param` annotations, **When** executed, **Then** parameters are parsed from annotations and the script runs successfully.
2. **Given** a script with both JSON Schema definition and `# @param` annotations, **When** executed, **Then** the JSON Schema definition takes precedence (primary path), with `# @param` as fallback.

---

### User Story 5 - Verify Script Integrity at Execution (Priority: P3)

Before executing a script, the system verifies its hash/signature matches what was stored at upload time. If the script file has been tampered with on disk, execution is blocked.

**Why this priority**: Defense in depth. If an attacker gains filesystem access, script tampering should be detectable.

**Independent Test**: Upload a script, modify the file on disk, attempt execution — blocked with integrity violation error.

**Acceptance Scenarios**:

1. **Given** a script was uploaded and hashed, **When** the script file on disk matches the stored hash, **Then** execution proceeds normally.
2. **Given** a script was uploaded and hashed, **When** the script file on disk has been modified (hash mismatch), **Then** execution is blocked with an integrity violation alert.
3. **Given** a hash mismatch is detected, **When** the block occurs, **Then** an audit entry is created flagging the tampering attempt.

---

### Edge Cases

- What happens if the JSON Schema ↔ Zod conversion produces a different validation result? — Use `zod-to-json-schema` for forward conversion (lossy but safe) and `json-schema-to-zod` for back-conversion. Test round-trip fidelity for common parameter types.
- What happens if a script upload is interrupted mid-write? — Atomic write: write to temp file, hash, move to final location. Never leave partial scripts.
- What happens if the sandbox (firejail/bubblewrap/landlock) is not available on the target server? — Log a warning; execute without sandboxing but flag in audit log. Do NOT block execution — but make the security gap visible.
- What happens if `VPN_SCRIPTS_ROOT` directory is writable by non-admin users? — RBAC enforcement MUST check directory permissions at startup and refuse to start if insecure. Log a critical warning.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept `.sh` script uploads from admin users only.
- **FR-002**: System MUST parse script parameters from `# @param` annotations and store as JSON Schema in the database.
- **FR-003**: System MUST convert JSON Schema to Zod at runtime via `json-schema-to-zod` for parameter validation (never store or eval raw Zod strings). **Fallback strategy**: If JSON Schema → Zod conversion fails or roundtrip fidelity is lost (detected by validating a known-good test input against the re-converted schema), the system MUST: (a) reject the script at upload with a clear error message to the admin indicating which JSON Schema construct couldn't be converted, OR (b) downgrade to `# @param` parser with a logged WARNING. NEVER silently succeed with degraded validation. The upload endpoint MUST test roundtrip fidelity before accepting the script.
- **FR-004**: System MUST scan uploaded script content for dangerous patterns: `rm -rf /`, `curl | bash`, `eval`, `exec`, network exfiltration patterns, fork bombs.
- **FR-005**: System MUST enforce RBAC for script CRUD: admin-only upload/update/delete; all authenticated users may execute.
- **FR-006**: System MUST audit every upload, update, delete, and execute event with actor, timestamp, script identity, and action.
- **FR-007**: System MUST hash scripts at upload time (SHA-256) and verify hash before execution.
- **FR-008**: System MUST support sandboxed script execution (investigate firejail, bubblewrap, or landlock for syscall-level confinement).
- **FR-009**: System MUST retain `# @param` parser as fallback for legacy scripts without JSON Schema definitions.
- **FR-010**: System MUST validate `VPN_SCRIPTS_ROOT` directory permissions at startup — refuse to start if writable by non-admin.
- **FR-011**: Existing Feature 005 hardcoded scripts MUST continue to work during and after migration.
- **FR-012**: Existing Feature 016 `# @param` DB-stored scripts MUST continue to work without modification.

### Key Entities

- **Script**: An executable script file with metadata — name, description, parameter schema (JSON Schema), content hash, upload timestamp, uploader.
- **Script Parameter Schema**: JSON Schema definition of a script's parameters, stored in the database, converted to Zod at runtime for validation.
- **Audit Entry**: Records all script lifecycle events — upload, update, delete, execute, integrity-check-failure — with actor, timestamp, script identity, and relevant details.
- **Sandbox Configuration**: Per-execution sandbox policy — allowed syscalls, resource limits, network restrictions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newly uploaded script with `# @param` annotations is parsed, stored, and executable within 30 seconds of upload.
- **SC-002**: Zero dangerous scripts pass the content scanner (100% rejection rate for patterns in the denylist).
- **SC-003**: All existing Feature 016 scripts execute with identical behavior after unification (zero regressions).
- **SC-004**: Audit trail captures 100% of script CRUD and execution events.
- **SC-005**: Hash verification detects 100% of on-disk script tampering attempts.

## Assumptions

- `zod-to-json-schema` and `json-schema-to-zod` packages exist and support common parameter types (string, number, boolean, enum, array).
- Sandboxing tools (firejail, bubblewrap, landlock) are available on target Ubuntu servers or can be installed as dependencies.
- The `VPN_SCRIPTS_ROOT` directory can be secured with appropriate filesystem permissions (owned by deploy user, not world-writable).

## Dependencies

- None (standalone feature). However, Feature 005 and Feature 016 code must be present for backward compatibility.

## [SECURITY-PASS-REQUIRED]

**THIS SPEC IS BLOCKED ON COMPLETION OF THE SECURITY PASS DESCRIBED BELOW. Implementation MUST NOT begin until every item in this section is resolved, reviewed, and signed off.**

### Security Vectors That MUST Be Closed

1. **Content Scanner for Dangerous Bash Patterns**: The current `# @param` validation lets ANY bash content pass execution. A content scanner MUST reject scripts containing:
   - `rm -rf /` and variants (`rm -rf /*`, `rm -rf ~`)
   - `curl | bash`, `wget | sh` and any remote-code-execution pipe patterns
   - `eval`, `exec` with variable arguments
   - Network exfiltration patterns: `curl/wget/nc` to external URLs with data payload
   - Fork bombs (`:(){:|:&};:` and variants)
   - Base64-encoded payload execution (`echo <base64> | bash`)

   **Multi-layer defense strategy (regex alone is insufficient against bash obfuscation)**:
   - **Layer 1 — Shell unescape preprocessor**: Normalize script content before scanning. Handle `\x72\x6d` hex escapes, `$'\x72\x6d'` ANSI-C quoting, `$'\162\155'` octal escapes, and Unicode homoglyphs. Unescape then re-scan the normalized content.
   - **Layer 2 — AST-based analysis**: Parse bash scripts using `bashlex` (Python) or `tree-sitter-bash` (WASM/Node) to detect: variable indirection (`a="rm"; $a -rf /`), command substitution within eval/exec, heredoc-based evasion, and dynamically constructed commands. If AST parsing fails on a script, REJECT the script — do not fall back to regex-only scanning for unparsable scripts.
   - **Layer 3 — Regex denylist**: Pattern-match the normalized content against the denylist above. Catches obvious patterns quickly even if AST analysis misses edge cases.
   - **Layer 4 — Indirection denylist**: Flag scripts containing patterns commonly used for obfuscation even if the target command isn't directly visible: variable expansion in command position (`${var}`), `printf` to construct commands, `declare`/`typeset` with function names, associative arrays used as dispatch tables.
   - **Policy**: If ANY layer flags a pattern, the script is rejected. No "maybe" — reject and require admin manual review.

2. **`VPN_SCRIPTS_ROOT` Writability RBAC**: If an attacker can write into this directory, all prior script-upload protection is bypassed — they gain full RCE on every script execution. Requirements:
   - Directory MUST be owned by the deploy user
   - Directory MUST NOT be world-writable (permissions 755 or stricter)
   - Application MUST check permissions at startup and refuse to start if insecure
   - Audit log MUST record permission check results

3. **Arbitrary Script Upload RBAC**: Only admin-role users can upload scripts. Requirements:
   - RBAC check on every upload/update/delete endpoint
   - Audit every upload event with actor identity
   - Hash (SHA-256) scripts at rest. **Note: cryptographic signing is deferred to a future enhancement — v1 uses hash-only integrity with the assumption that RBAC already restricts upload to admin users. Signing adds key management complexity for marginal benefit given the existing RBAC + audit controls.**
   - Verify hash at execution time (hash mismatch = block + alert)

4. **Sandboxed Execution**: Scripts currently run on VPS with full deploy-user privileges. Requirements:
   - Investigate firejail, bubblewrap, or landlock for syscall-level confinement
   - Default-deny: block network access, filesystem writes outside designated paths, and privileged syscalls
   - If sandboxing is unavailable on a target server, log a WARNING and flag in audit — do NOT silently execute without sandbox
   - Document minimum kernel version requirements for chosen sandboxing technology

### Sign-Off Required

Before implementation begins, a security review MUST be completed covering all 4 items above. The review MUST produce:
- A confirmed denylist of dangerous bash patterns (item 1)
- A confirmed filesystem permission policy (item 2)
- A confirmed RBAC policy for script CRUD (item 3)
- A chosen sandboxing technology with justification (item 4)

tasks.md (when generated later) MUST be tagged "BLOCKED on security pass" at the top until sign-off is obtained.
