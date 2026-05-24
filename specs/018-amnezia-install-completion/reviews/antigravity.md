# SpecKit Review: 018-amnezia-install-completion

**Reviewer**: antigravity
**Reviewed at**: 2026-05-24T08:16:30Z
**Commit**: HEAD
**Artifacts reviewed**: spec.md, plan.md, tasks.md

## Summary

The design for completing the Amnezia VPN installation is well thought out, leveraging existing patterns for workers and encryption. However, there are significant edge cases related to long-running tasks over SSH and server-side vs client-side QR generation.

## Findings

| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| F1 | HIGH | Edge case | Amnezia installation can take 5+ minutes on slower VPS nodes. If the worker process or HTTP request enforcing the worker has a typical timeout (e.g., 30s-60s), the install will fail midway or be orphaned. | Explicitly define the worker execution model as detached/background and ensure SSH connection timeouts are disabled or set very high. |
| F2 | MEDIUM | Security / Perf | Generating the QR code server-side (T009) means the server decrypts the config and sends an image over the wire. This adds server overhead and an extra endpoint. | Consider returning the decrypted config as text to the client and generating the QR code entirely client-side using a React QR library. |
| F3 | MEDIUM | Edge case | SCP extraction of the config assumes the file is generated at a specific, predictable path. If Amnezia changes the path or generates multiple files, it breaks. | The install script should explicitly copy or link the generated config to a known deterministic location (e.g., `/tmp/amnezia-export.vpn`) for the worker to pull. |
| F4 | LOW | Logical Consistency | T002 mentions "SSH-target script with stage markers", but doesn't explain how the worker parses these markers. | Specify a standard output format (e.g., `[STAGE: extracting]`) for the worker to parse via stdout stream. |

## Alternative approaches considered

Generating the QR code client-side rather than server-side. This would eliminate the need for the `qrcode` npm dependency on the backend, reduce server CPU load, and keep the decrypted config in client memory.

## VERDICT

```yaml
verdict: MEDIUM
reviewer: antigravity
reviewed_at: 2026-05-24T08:16:30Z
commit: HEAD
critical_count: 0
high_count: 1
medium_count: 2
low_count: 1
```
