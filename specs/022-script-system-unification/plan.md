# Implementation Plan: Script System Unification

**Branch**: `022-script-system-unification` | **Date**: 2025-05-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-script-system-unification/spec.md`

## Summary

Unify two incompatible script execution systems (Feature 005 Zod-manifest + Feature 016 `# @param` annotations) into a single system with secure script upload, JSON Schema parameter storage, content scanning for dangerous patterns, RBAC enforcement, hash-based integrity verification, and sandboxed execution. The unified system stores parameter schemas as JSON Schema (never raw Zod), validates at runtime using ajv (no eval, no codegen), and retains `# @param` parsing as a backward-compatible fallback.

> **[SECURITY-PASS-REQUIRED]**: This spec is BLOCKED until the 4 security vectors in spec.md are reviewed and signed off. Implementation phases MUST NOT begin until sign-off is obtained.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Express (server), Zod (static schemas only) + ajv + ajv-formats (dynamic JSON Schema validation), React Query (client)
**Storage**: PostgreSQL — new `scripts` table, new `script_audit_entries` table
**Testing**: Security scanner unit tests (100% rejection rate); backward-compat tests for Feature 005/016 scripts
**Target Platform**: Web dashboard + remote Ubuntu servers
**Project Type**: Web application (monorepo: `server/`, `client/`)
**Performance Goals**: Script upload + parse <30s; hash verification <100ms; scanner reject immediate
**Constraints**: Zero regression on existing Feature 005 and Feature 016 scripts
**Scale/Scope**: 5 user stories, ~20-30 files touched, new security infrastructure

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Operator safety first | **BLOCKED** | Security pass required before implementation — 4 open vectors |
| II. Secrets never leak | PASS | Audit entries redact secret params; script content hashed not logged |
| III. Reviewable database changes | PASS | Migration as .sql file |
|| IV. Typed boundaries | PASS | JSON Schema validated via ajv at runtime; Zod for static schemas only |
| V. Feature flags and rollback posture | PASS | Legacy code RETAINED as fallback (deprecation, not deletion); Rollback Strategy section in plan; Phase 0 gate blocks all implementation |
| VI. Independent review gate | DEFERRED | Required before implement — plus security review gate |
| VII. Snapshot stages | N/A | No snapshot tooling |

## Project Structure

### Documentation (this feature)

```text
specs/022-script-system-unification/
├── plan.md              # This file
├── research.md          # Sandbox tech comparison, scanner patterns
├── data-model.md        # Scripts table, audit entries, schema storage
├── contracts/           # API specs
│   ├── scripts-crud.md
│   └── scripts-execute.md
├── quickstart.md        # How to test unified system
└── tasks.md             # Task breakdown (BLOCKED header)
```

### Source Code (repository root)

```text
server/
├── db/
│   └── migrations/
│       ├── 022-create-scripts.sql          # scripts table
│       └── 022-create-script-audit.sql     # audit entries
├── routes/
│   └── scripts.ts                          # Script CRUD + execute endpoints
├── services/
│   ├── script-parser.ts                    # # @param → JSON Schema parser
│   ├── script-scanner.ts                   # Dangerous pattern scanner
│   ├── script-executor.ts                  # Sandboxed execution engine
│   └── script-integrity.ts                 # SHA-256 hash verification
├── workers/
│   └── script-runner.ts                    # Remote script execution worker
├── middleware/
│   └── script-rbac.ts                      # RBAC enforcement for script ops
└── lib/
    ├── ajv-validator.ts               # ajv-based JSON Schema validator
    └── script-types.ts                     # Type definitions

client/
├── lib/
│   └── scripts-api.ts                      # Script CRUD + execute hooks
└── components/
    └── scripts/
        ├── ScriptUpload.tsx                 # Upload form with scanner feedback
        ├── ScriptLibrary.tsx               # Script list with RBAC-aware actions
        ├── ScriptExecuteForm.tsx           # Dynamic form from JSON Schema params
        └── ScriptResult.tsx                # Execution result display
```

**Structure Decision**: Existing web app. New service layer for security (scanner, integrity, RBAC, sandbox).

## Research Decisions

### Sandboxing Technology Comparison

| Technology | Kernel Req | Complexity | Network Isolation | FS Isolation |
|-----------|-----------|------------|-------------------|-------------|
| firejail | 4.x+ | Low (SUID) | Yes (protocol filter) | Yes (seccomp) |
| bubblewrap | 3.x+ | Medium | Yes | Yes (bind mounts) |
| landlock | 5.13+ | High (kernel API) | No (needs seccomp) | Yes |
| Docker | Any | High | Yes | Yes |

**Recommendation**: firejail as primary. Available on Ubuntu 20.04+, SUID binary, easy to configure profiles. Fallback: execute without sandbox but flag in audit log.

### Dangerous Pattern Scanner

**Multi-layer defense** (regex alone is insufficient — bash obfuscation is trivial):

1. **Shell unescape preprocessor**: Normalize hex escapes (`\x72\x6d`), ANSI-C quoting (`$'\x72\x6d'`), octal escapes, Unicode homoglyphs before scanning. Output is a normalized script string.

2. **AST-based analysis**: Parse bash scripts with `bashlex` (Python subprocess or WASM build) or `tree-sitter-bash` (Node native). Detect: variable indirection in command position, command substitution within eval/exec, heredoc-based evasion, dynamically constructed commands. **If AST parse fails → REJECT the script** (fail-closed).

3. **Regex denylist on normalized content**: Catches obvious patterns quickly. Patterns (minimum):
   - `rm -rf /`, `rm -rf /*`, `rm -rf ~`
   - `curl | bash`, `wget | sh`, `curl | sh`
   - `eval "$..."`, `exec "$..."`
   - `:(){:|:&};:` (fork bomb)
   - `echo <base64> | bash` (base64 decode exec)
   - Network exfiltration: `curl/wget/nc` with data payload to external URLs

4. **Indirection denylist**: Flag obfuscation patterns even if target command isn't visible:
   - Variable expansion in command position (`${var}`)
   - `printf` to construct commands
   - `declare`/`typeset` with function names
   - Associative arrays as dispatch tables

**Policy**: If ANY layer flags → warn admin with specific pattern details. Admin can proceed with upload. Advisory-only — sandbox (FR-008) is the sole security boundary.

### JSON Schema Validation (ajv)

- Upload (one-way): `# @param` annotations → parsed to JSON Schema via custom parser → stored in DB
- Runtime (execute): JSON Schema → `ajv.compile(schema)` → validate user params directly
- Zod is NOT used for dynamic/runtime schema validation
- `eval()` is NEVER invoked — ajv compiles to internal bytecode, not JS strings
- `zod-to-json-schema` may be used during one-time migration (T022) to convert Feature 005's hardcoded Zod schemas to JSON Schema

## Rollback Strategy

Legacy migration uses deprecation, not deletion:

1. **Feature 005 scripts (T024)**: Original registration code is NOT deleted — it's retained as a fallback. If the unified execution path fails for a Feature 005 script, the system falls back to the original hardcoded registration. Rollback = remove the unified redirect, restoring Feature 005 as primary. No code restoration from git needed.
2. **Feature 016 scripts (T025)**: `# @param` parser is RETAINED per FR-009. If unified parser fails, fallback to original `# @param` parsing. Rollback = flip the routing back to `# @param` as primary. Parser file never deleted.
3. **New unified tables**: `scripts` and `script_audit_entries` tables are additive — existing tables are not modified. DOWN migration drops these tables. Safe because they contain only new unified data.
4. **Security services**: Scanner, integrity, RBAC middleware are all additive. They can be disabled by removing route middleware without reverting database changes.
5. **Phase 0 security gate**: If security review fails to sign off, the entire Phase 2+ is blocked. No code is deployed. Zero risk.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Security infrastructure (4 vectors) | Script execution = RCE surface | Cannot ship without closing all 4 vectors |
| Dual parser backward compat | Existing scripts must not break | Migration would require re-uploading all scripts |

Implementation is ~400-500 LOC, split across security services (~200 LOC), unified API (~100 LOC), client (~100 LOC). Exceeds WRAP <500 LOC guideline — justified by security coupling.
