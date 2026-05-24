# Quickstart: Script System Unification

**Date**: 2025-05-24
**Spec**: 022-script-system-unification

> **BLOCKED**: This feature cannot be implemented until the [SECURITY-PASS-REQUIRED] section in spec.md is reviewed and signed off.

## Prerequisites

1. Security review completed and signed off (all 4 vectors closed)
2. Sandboxing tool (firejail recommended) installed on target servers
3. `VPN_SCRIPTS_ROOT` directory created with correct permissions (755, owned by deploy user)

## Testing the Flow

### 1. Upload a Valid Script

1. Create a `.sh` file with `# @param` annotations:
   ```bash
   #!/bin/bash
   # @param name:string:Name to greet
   echo "Hello, $1!"
   ```
2. Upload via dashboard as admin
3. Verify: script appears in library with parsed parameters

### 2. Upload a Dangerous Script (Should Fail)

1. Create a script containing `rm -rf /`
2. Attempt upload
3. Verify: rejected with specific pattern violation message

### 3. Execute a Script

1. Select a script from library
2. Dynamic form appears from JSON Schema
3. Fill in parameters
4. Select target server
5. Execute
6. Verify: stdout/stderr/exit code displayed

### 4. Verify Legacy Compat

1. Execute a Feature 016 `# @param` script
2. Verify: runs identically to before
3. Execute a Feature 005 hardcoded script
4. Verify: runs identically to before

### 5. Verify Integrity Check

1. Upload a script
2. Manually modify the file on disk
3. Attempt execution
4. Verify: blocked with integrity violation error + audit entry

### 6. Verify RBAC

1. Log in as non-admin → attempt upload → rejected
2. Log in as non-admin → execute script → succeeds
3. Log in as admin → upload → succeeds

## Security Verification

- `VPN_SCRIPTS_ROOT` permissions: `ls -la $VPN_SCRIPTS_ROOT` — should be 755
- Startup check: set directory to 777, restart app → should refuse to start
- Scanner: try uploading each dangerous pattern from the denylist → all rejected
- Integrity: modify file → execution blocked
