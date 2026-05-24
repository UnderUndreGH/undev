# Research Notes: Script System Unification

**Date**: 2025-05-24
**Spec**: 022-script-system-unification

## Existing Systems Analysis

### Feature 005: Zod-Manifest Scripts
- 13 hardcoded scripts registered in TypeScript code
- Parameters defined via Zod schemas at compile time
- Type-safe at development time
- No database storage — scripts are code
- Cannot be added at runtime by users

### Feature 016: `# @param` Scripts
- Scripts stored in database
- Parameters parsed from `# @param name:type:desc` comment annotations at runtime
- Runtime parameter discovery
- No type validation (just string extraction)
- Security: NONE — any bash content accepted

### Unification Approach

**Script storage**: Database (as Feature 016)
**Parameter schema**: JSON Schema (new) — stored in DB column
**Parameter parsing**: `# @param` parser retained as fallback for legacy scripts
**Parameter validation**: JSON Schema → Zod at runtime (via `json-schema-to-zod`)
**Hardcoded scripts (Feature 005)**: Migrated to DB entries with JSON Schema during migration

## Sandboxing Deep-Dive

### firejail (Recommended)

```bash
# Execution profile
firejail --noprofile \
  --private=/tmp/script-sandbox \
  --net=none \
  --caps.drop=all \
  --seccomp \
  ./script.sh param1 param2
```

Features:
- SUID binary — no root needed to execute
- Network isolation via `--net=none`
- Filesystem isolation via `--private`
- Syscall filtering via `--seccomp`
- Available as `apt install firejail` on Ubuntu

Fallback when unavailable:
- Log WARNING to audit
- Execute without sandbox
- Flag in audit entry: `sandboxed: false`

### bubblewrap (Alternative)

```bash
bwrap --ro-bind / / \
  --dev /dev \
  --proc /proc \
  --unshare-net \
  --die-with-parent \
  ./script.sh
```

More flexible but requires more configuration. Use if firejail has issues.

## Content Scanner Design

### Pattern Denylist

```typescript
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(\s|$)/i,           // rm -rf /
  /rm\s+-rf\s+\/\*/i,               // rm -rf /*
  /rm\s+-rf\s+~/i,                  // rm -rf ~
  /curl\s+.*\|\s*(bash|sh)/i,       // curl | bash
  /wget\s+.*\|\s*(bash|sh)/i,       // wget | sh
  /\beval\s+["\']?\$/i,             // eval "$..."
  /\bexec\s+["\']?\$/i,             // exec "$..."
  /:\(\)\{.*:.*\|.*:&.*\};:/i,      // fork bomb
  /echo\s+[A-Za-z0-9+\/=]+\s*\|\s*(bash|sh)/i,  // base64 decode exec
];
```

### Scanner Architecture

1. Pre-upload: scan content, reject if any pattern matches
2. Pre-execution: re-verify hash (integrity) — content hasn't changed since upload
3. Scanning is synchronous — no async needed
4. Pattern matches return specific violation description to user

## `# @param` Parser (Backward Compat)

```bash
# @param username:string:Server username
# @param port:number:SSH port (default 22)
```

Parser extracts: name, type (string|number|boolean|enum), description, optional default.

Conversion to JSON Schema:
```json
{
  "type": "object",
  "properties": {
    "username": { "type": "string", "description": "Server username" },
    "port": { "type": "number", "description": "SSH port", "default": 22 }
  },
  "required": ["username"]
}
```

## VPN_SCRIPTS_ROOT Security

- Directory must be owned by deploy user
- Permissions: 755 or stricter (not 777)
- Application checks at startup:
  ```typescript
  const stat = fs.statSync(process.env.VPN_SCRIPTS_ROOT);
  if (stat.mode & 0o002) { // world-writable
    throw new Error('VPN_SCRIPTS_ROOT is world-writable — refusing to start');
  }
  ```
- Audit log records permission check result at startup
