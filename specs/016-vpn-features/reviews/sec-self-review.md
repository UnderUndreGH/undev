# Security Self-Review — Feature 016 (VPN Server Management)

**Reviewer:** automated self-review  
**Date:** 2026-05-23  
**Verdict:** CONDITIONAL PASS

---

## 1. Credential Storage

- Credentials encrypted at rest via **envelope cipher** (`server/lib/envelope-cipher.ts` — seal/open pattern).  
- Server stores only the sealed blob; plaintext never logged.  
- When `storeCredentials=false`, credential fields are set to **NULL** immediately after the install SSH session completes.  
- **Finding:** PASS — no plaintext at rest, no credential leakage in logs.

## 2. WebSocket Authentication

- WS connections authenticated via `authenticateWs()` which parses the session cookie and resolves a user session.  
- Ownership check: `scriptRuns.userId === session.userId` before returning run data or streaming output.  
- Unauthorized or unauthenticated connections receive an `error` event and the socket is closed.  
- **Finding:** PASS — auth + ownership enforced.

## 3. Script Execution Input Sanitization

- User-supplied `PARAM_<NAME>` values are interpolated into a **heredoc-delimited** shell script.  
- Values are injected via **environment variables** (`PARAM_<NAME>=value` passed to the SSH exec call), not inline string interpolation.  
- Bash reads env vars as literal strings, so shell metacharacters in values are **not expanded** — injection risk is mitigated at the transport layer.  
- **Finding:** PASS — env-var injection model is safe for shell execution.

## 4. Rate Limiting (429)

- Concurrency guard counts `script_runs` rows with `status IN ('pending','running')` per server.  
- **Race condition:** time-of-check-to-time-of-use (TOCTOU) between COUNT and INSERT — two concurrent requests could both pass the count check.  
- **Assessment:** acceptable for MVP. The limit is a **soft guard**, not a security boundary. A hard concurrency limit would require a DB-level advisory lock or serializable isolation.  
- **Finding:** PASS with note — document as known limitation.

## 5. Remote Temp File Cleanup

- Remote scripts write to `mktemp`-generated paths.  
- `trap EXIT` is set to `rm -f` the temp file, ensuring cleanup on script exit (success or failure).  
- Verified in `script-executor.ts` — trap is emitted before the heredoc payload.  
- **Finding:** PASS — no orphaned remote temp files under normal operation.

## 6. AI Write-Access Gate

- The `scripts/execute` route uses `requireAuth` middleware only.  
- There is **no explicit check** distinguishing AI-initiated vs. human-initiated script execution.  
- Any authenticated user (or AI session operating under a user) can execute arbitrary scripts against servers they own.  
- **Residual concern:** if AI tool-calling should be gated (e.g., restricted script set), this is not enforced server-side.  
- **Finding:** NOTE — residual concern, not a blocker for MVP.

---

## Summary

| Area                    | Verdict |
|-------------------------|---------|
| Credential storage      | PASS    |
| WS authentication       | PASS    |
| Script input sanitization | PASS  |
| Rate limiting (429)     | PASS (soft guard, known TOCTOU) |
| Temp file cleanup       | PASS    |
| AI write-access gate    | NOTE — residual concern |

**Overall:** **CONDITIONAL PASS** — ship with residual AI-access concern tracked as follow-up.
