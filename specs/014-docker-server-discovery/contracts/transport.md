# Transport Contract: Local Server Transport

**Feature**: 014 | **Date**: 2026-05-22

## Transport Interface

`SSHPool` becomes the unified transport layer via the Proxy Pattern. For any method call where `serverId` matches `LOCAL_SERVER_ID`, the pool delegates to `local-executor.ts` instead of `ssh2`.

No new interface is introduced — `SSHPool` retains its existing public API. The contract below documents the behavioral split per method.

### Types (unchanged)

```typescript
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  sshUser: string;
  sshAuthMethod: "key" | "password";
  sshPrivateKey?: string | null;
  sshPassword?: string | null;
}
```

### LOCAL_SERVER_ID

```typescript
import { createHash } from "node:crypto";

export const LOCAL_SERVER_ID: string = createHash("sha256")
  .update("local-server")
  .digest("hex")
  .slice(0, 36)
  .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
```

Deterministic UUID derived from the string `"local-server"`. Cached in module scope — no DB query per call.

## Method Contract

### exec(serverId, command, timeoutMs?): Promise\<ExecResult\>

| Transport | Implementation |
|-----------|---------------|
| SSH | `ssh2.Client.exec()` → collect stdout/stderr → resolve on `close` event |
| Local | `child_process.execFile('bash', ['-c', cmd], { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs })` |

**Local details**:
- `maxBuffer`: 50MB (overrides Node.js default of 1MB) to handle large NDJSON outputs from Docker commands
- `timeout`: passed directly to `execFile` options; on timeout, child is killed with SIGTERM and the promise rejects with a timeout error
- Returns `{ stdout, stderr, exitCode }` where `exitCode` is extracted from the `ChildProcess` exit event (default `0` if null)

### execStream(serverId, command): Promise\<{stream: ClientChannel, kill: () => void}\>

| Transport | Implementation |
|-----------|---------------|
| SSH | `ssh2.Client.exec()` → returns `ClientChannel` + `kill()` via `stream.signal('KILL')` |
| Local | `child_process.spawn('bash', ['-c', cmd])` wrapped in `ClientChannelAdapter` |

**ClientChannelAdapter**:

Wraps `child_process.ChildProcess` to match the `ssh2.ClientChannel` event lifecycle expected by consumers (`ssh-executor.ts`, `scanner.ts`):

```typescript
class ClientChannelAdapter extends Duplex {
  // Events emitted:
  //   'data'   — from child.stdout
  //   'close'  — with exit code, after child 'exit' event
  //   'error'  — from child 'error' event
  //
  // Properties:
  //   .stderr  — EventEmitter proxying child.stderr 'data' events
  //   .signal(name) — child.kill(name)
  //   .close() — child.kill('SIGTERM')
  //
  // EOF: emitted after child.stdout 'end'
}
```

**kill()**: calls `child.kill('SIGKILL')` — matches SSH behavior of `stream.signal('KILL')` + `stream.close()`.

### connect(server: ServerConfig): Promise\<void\>

| Transport | Implementation |
|-----------|---------------|
| SSH | `ssh2.Client.connect()` with keepalive, readyTimeout, auth |
| Local | No-op. Resolves immediately. No connection state to manage. |

### disconnect(serverId): void

| Transport | Implementation |
|-----------|---------------|
| SSH | `client.end()`, remove from pool, suppress auto-reconnect |
| Local | No-op. Nothing to disconnect. |

### isConnected(serverId): boolean

| Transport | Implementation |
|-----------|---------------|
| SSH | `pool.get(serverId)?.connected ?? false` |
| Local | Always returns `true`. |

### openTunnel(serverId, opts): Promise\<{localPort: number, close: () => void}\>

| Transport | Implementation |
|-----------|---------------|
| SSH | Creates local TCP server on ephemeral port, forwards connections via `ssh2.forwardOut()` |
| Local | Direct TCP — no tunnel needed. Returns `{ localPort: opts.remotePort, close: () => {} }` |

**Local rationale**: The tunnel abstraction exists to reach a port on a remote host through SSH. When the server is local, the port is already directly accessible on `127.0.0.1`. Returning `remotePort` as `localPort` with a no-op `close` lets callers (e.g., `caddy-admin-client.ts`) use the same code path.

## Concurrency Control

Local transport enforces a concurrent spawn semaphore:

```typescript
const MAX_LOCAL_SPAWNS = 10;
```

Both `localExec` and `localExecStream` acquire a semaphore slot before spawning. If all 10 slots are occupied, the call waits until a slot is released. This prevents event loop starvation from excessive parallel `child_process` spawns.

## isLocalServer Detection

```typescript
isLocalServer(serverId: string): boolean {
  return serverId === LOCAL_SERVER_ID;
}
```

Called at the top of every proxied method. O(1) string comparison — no DB lookup, no async.

## Error Handling

| Scenario | SSH behavior | Local behavior |
|----------|-------------|----------------|
| Command not found | Exit code 127, stderr message | Exit code 127, stderr message (identical — bash handles both) |
| Timeout | `stream.close()` + reject | `child.kill('SIGTERM')` + reject |
| Process crash | `stream.on('error')` | `child.on('error')` → adapter emits `'error'` |
| Connection lost | `client.on('error')` → reconnect | N/A — always connected |
