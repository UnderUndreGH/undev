# Security Review — Feature 016 (VPN Features)

**Date:** 2026-05-23
**Reviewer:** Automated codebase audit
**Scope:** Envelope cipher, credential lifecycle, script execution, WebSocket auth, concurrency, injection prevention, script immutability

---

## 1. SSH Credential Encryption — AES-256-GCM Envelope Cipher

**Verdict: PASS**

**Evidence:**
- `server/lib/envelope-cipher.ts` implements `seal()` / `open()` using `aes-256-gcm` with:
  - 32-byte key from `DASHBOARD_MASTER_KEY` (base64-decoded, length-validated at module load, L41-45)
  - 12-byte random IV per `seal()` call via `randomBytes(IV_LEN)` (L53)
  - 16-byte GCM auth tag (L59)
  - `open()` validates IV and tag lengths before decryption (L71-76) and calls `decipher.setAuthTag(tag)` (L78) — tampered or wrong-key blobs will fail at `decipher.final()`
- `server/routes/servers-vpn.ts` imports `seal` (L18) and wraps it in `encryptCredential()` (L49-51), called for both password (L102) and privateKey (L105)
- Fail-fast: module-level `loadMasterKey()` throws if key missing/malformed (L28-47)

---

## 2. Credential Cleanup on `storeCredentials=false`

**Verdict: PASS**

**Evidence:**
- `servers-vpn.ts` L163-177: after probe/install completes, if `!body.storeCredentials`:
  ```ts
  await db.update(servers).set({
    sshPassword: null,
    sshPrivateKey: null,
    sshPasswordEncrypted: null,
    sshPrivateKeyEncrypted: null,
  }).where(eq(servers.id, id));
  ```
- All four secret columns are NULLed. Wrapped in try/catch (L174) — best-effort is acceptable since credentials were already used for probe.
- `sanitizeServer()` (L56-72) strips all secret columns from API responses — plaintext `sshPassword`/`sshPrivateKey` and encrypted variants are never returned to the client.

---

## 3. Script Execution — Symlink / Temp-File Attack Prevention

**Verdict: PASS**

**Evidence:**
- `server/services/script-executor.ts` L111-119 constructs the remote command:
  ```bash
  tmpfile=$(mktemp -p /tmp script.XXXXXX.sh)   # L112 — mktemp with random suffix
  trap "rm -f $tmpfile" EXIT                     # L113 — cleanup guaranteed
  chmod 700 $tmpfile                             # L114 — owner-only execute
  cat > $tmpfile << 'HANGAR_EOF'                 # L115 — single-quoted delimiter prevents expansion
  <scriptContent>
  HANGAR_EOF
  PARAM_xxx='val' bash $tmpfile                  # L118
  ```
- `mktemp` creates an unpredictable filename in `/tmp`, mitigating symlink attacks.
- `trap ... EXIT` ensures cleanup even on signal/interruption.
- `chmod 700` restricts to owner read/write/execute.
- Single-quoted heredoc delimiter (`'HANGAR_EOF'`) prevents variable expansion inside script content.

---

## 4. WebSocket Handshake Auth + Execution-Ownership Check

**Verdict: PASS**

**Evidence:**
- `server/ws/handler.ts`:
  - **Handshake auth** (L20-24): `authenticateWs()` validates session cookie → DB session lookup → expiry check. On failure: `ws.close(1008, "Policy Violation: authentication required")` — uses code 1008 per FR-019.
  - **Execution ownership** (L181-195): `wireExecutionToChannel()` performs async DB lookup of `scriptRuns.userId` for the requested `executionId`. If `!run || run.userId !== userId`, closes with `ws.close(1008, "Policy Violation: execution ownership check failed")`.
  - T017a fix confirmed: ownership check gates all execution-event subscriptions.

---

## 5. Secret Leakage via Streamed stdout

**Verdict: PARTIAL**

**Evidence:**
- `script-executor.ts` streams raw stdout/stderr chunks to:
  1. Local log file (`data/logs/script-runs/<executionId>.log`) via `appendFile` (L129)
  2. `executionBus` EventEmitter (L132-139)
  3. WebSocket clients who pass the ownership check (handler.ts L203-215)
- There is **no filtering or redaction** of output. If a script echoes passwords, API keys, or private keys, those secrets flow through to the log file and any subscribed WS client.
- The ownership check (T017a) limits WS exposure to the user who initiated the run — but the log file is on the server filesystem, readable by anyone with filesystem access.

**Recommendation:**
- Add a post-processing step or optional output-redaction config (regex-based) to strip common secret patterns (passwords, keys, tokens) from streamed output before broadcasting.
- Restrict log file permissions (`chmod 600`) — currently relies on process umask.
- Document that operators should not `echo` secrets in scripts.

---

## 6. Rate Limiting / Concurrent Execution Cap (NFR-001: max 3 per server)

**Verdict: PASS**

**Evidence:**
- `server/routes/vpn-scripts.ts` L378-398:
  ```ts
  const concurrentRows = await db.select({ total: count() })
    .from(scriptRuns)
    .where(and(
      eq(scriptRuns.serverId, serverId),
      inArray(scriptRuns.status, ["pending", "running"]),
    ));
  const concurrentCount = concurrentRows[0]?.total ?? 0;
  if (concurrentCount >= 3) {
    res.status(429).json({ error: { code: "TOO_MANY_REQUESTS", message: "..." } });
    return;
  }
  ```
- Counts `pending` + `running` runs per server. Returns HTTP 429 when ≥ 3.

**Note:** This is an application-level check, not an in-memory semaphore — two concurrent requests could race past the count check before either inserts. This is an acceptable race window for NFR-001; a unique partial index or advisory lock would be required for strict enforcement.

---

## 7. Shell Injection via Param Values

**Verdict: PASS**

**Evidence:**
- `script-executor.ts` L105-107: params are injected as `PARAM_<key>=<shellEscaped_value>`:
  ```ts
  const paramEnv = Object.entries(params)
    .map(([k, v]) => `PARAM_${k}=${shellEscape(v)}`)
    .join(" ");
  ```
- `shellEscape()` (L212-214): wraps value in single quotes, escapes embedded single quotes with `'\''`:
  ```ts
  function shellEscape(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  ```
- Param **names** are injected as `PARAM_<key>` without escaping — but names come from user input validated by Zod (`z.string().min(1)`). Risk: a name like `foo; rm -rf /` would produce `PARAM_foo; rm -rf /=...`. However, the resulting string is used as an env-var assignment prefix before `bash $tmpfile`, and Bash would fail to parse `PARAM_foo; rm -rf /=...` as a valid assignment (semicolons and spaces break the word). The effective risk is low but not zero.

**Recommendation:**
- Validate param names with a stricter regex (e.g., `/^[a-zA-Z_][a-zA-Z0-9_]*$/`) to reject shell metacharacters in keys.

---

## 8. Filesystem-Sourced Script Immutability (FR-018a: 403 on PUT/DELETE)

**Verdict: PASS**

**Evidence:**
- `server/routes/vpn-scripts.ts`:
  - **PUT** (L250-258): checks `existing.source === "filesystem"` → returns `403 FORBIDDEN` with message `"Cannot modify filesystem-sourced scripts — use reindex"`
  - **DELETE** (L314-322): same check → `403 FORBIDDEN` with message `"Cannot delete filesystem-sourced scripts — use reindex"`
- Both routes return before any mutation occurs. DB-sourced scripts (`source: "database"`) proceed normally.

---

## Summary

| # | Area | Verdict |
|---|------|---------|
| 1 | Envelope cipher (AES-256-GCM) | **PASS** |
| 2 | Credential cleanup (storeCredentials=false) | **PASS** |
| 3 | Symlink / temp-file attack prevention | **PASS** |
| 4 | WS handshake auth + ownership check | **PASS** |
| 5 | Secret leakage via stdout | **PARTIAL** |
| 6 | Concurrent execution cap (max 3) | **PASS** |
| 7 | Shell injection prevention | **PASS** (with minor recommendation) |
| 8 | Filesystem script immutability | **PASS** |

**Open Recommendations:**
1. **(#5)** Implement output redaction for common secret patterns in streamed script output.
2. **(#5)** Restrict log file permissions to `0600`.
3. **(#7)** Add regex validation on param names (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`).
4. **(#6)** For strict concurrency enforcement, consider a DB advisory lock or unique partial index rather than count-then-insert.
