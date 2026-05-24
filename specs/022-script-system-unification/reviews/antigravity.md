# SpecKit Review: 022-script-system-unification

**Reviewer**: antigravity
**Reviewed at**: 2026-05-24T08:18:00Z
**Commit**: HEAD
**Artifacts reviewed**: spec.md, plan.md, tasks.md, data-model.md

## Summary

The unification plan correctly identifies severe security gaps in the current script system. However, the proposed security controls contain critical design flaws: relying on regex to secure bash scripts, and a self-contradictory requirement regarding Zod and JSON Schema validation that implies using `eval()`.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | CRITICAL | Security | `FR-003` states the system must convert JSON Schema to Zod at runtime via `json-schema-to-zod` without using `eval`. This is impossible. `json-schema-to-zod` generates TypeScript code (strings). To use it for validation at runtime, you must `eval()` the output, which introduces a severe RCE vulnerability. | Do not use Zod for runtime dynamic validation. Use a standard JSON Schema validator like `ajv` to validate user input directly against the stored JSON Schema. |
| F2 | HIGH | Security | The dangerous pattern scanner (T010, FR-004) relies on a regex denylist for bash. This is fundamentally insecure and trivial to bypass (e.g., `r\m -r\f /`, `eval $(echo rm...)`, variable expansion). A regex denylist provides a false sense of security. | Remove the regex scanner. Security MUST rely entirely on the sandbox (firejail/bubblewrap) enforcing read-only filesystems, dropped capabilities, and network namespaces. Do not trust pattern matching for bash. |
| F3 | HIGH | Security | The sandbox fallback behavior states: "If sandboxing is unavailable... do NOT block execution". If an attacker can trigger a condition where the sandbox fails to initialize, they bypass the sandbox entirely. This violates fail-closed security principles. | Sandbox initialization failure MUST block execution. The sandbox should be a hard prerequisite for running any user-uploaded script. |
| F4 | MEDIUM | Logical Consistency | T022 and T023 handle migrating scripts into the new database table, but T022 says "convert Zod schemas to JSON Schema". This implies a one-time script or code to do this conversion, but doesn't specify if this happens at runtime during migration or via a CLI tool. | Clarify the migration path for Zod schemas. Use `zod-to-json-schema` in a migration script to persist the JSON Schema representations. |

## Alternative approaches considered

Instead of writing a custom bash pattern scanner, use a static analysis tool like `shellcheck` to enforce best practices, but rely on OS-level sandboxing (firejail) as the absolute security boundary.
Furthermore, instead of attempting to parse `# @param` annotations natively, consider adopting a standardized bash metadata format or requiring a companion `.json` file for script parameters.

## VERDICT

```yaml
verdict: CRITICAL
reviewer: antigravity
reviewed_at: 2026-05-24T08:18:00Z
commit: HEAD
critical_count: 1
high_count: 2
medium_count: 1
low_count: 0
```
