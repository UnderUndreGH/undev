/**
 * Feature 016 T006 — Remote command runner for VPN operations.
 *
 * Delegates to the existing sshPool singleton, adding an optional
 * streaming callback so callers can tail stdout/stderr in real time.
 * Connection management (lookup, decrypt, connect) is handled by
 * sshPool + ensure-ssh; this module only wraps the exec layer.
 */

import { sshPool } from "./ssh-pool.js";
import { logger } from "../lib/logger.js";

export interface RunRemoteCommandOpts {
  /** Called for each stdout/stderr chunk as it arrives (streaming mode). */
  stream?: (chunk: string) => void;
  /** Max milliseconds before the command is killed. Default: 60 000. */
  timeoutMs?: number;
}

export interface RunRemoteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute `command` on the server identified by `serverId`.
 *
 * If `opts.stream` is provided the command runs through `sshPool.execStream`
 * so the caller receives incremental output; otherwise falls back to the
 * simpler `sshPool.exec` which buffers internally.
 */
export async function runRemoteCommand(
  serverId: string,
  command: string,
  opts?: RunRemoteCommandOpts,
): Promise<RunRemoteCommandResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  // Fast path — no streaming needed.
  if (!opts?.stream) {
    const result = await sshPool.exec(serverId, command, timeoutMs);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  // Streaming path — acquire raw channel, pipe chunks to callback.
  const { stream, kill } = await sshPool.execStream(serverId, command);

  return new Promise<RunRemoteCommandResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        kill();
        reject(new Error(`runRemoteCommand timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onChunk = (data: Buffer, target: "stdout" | "stderr") => {
      const text = data.toString();
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      try {
        opts.stream!(text);
      } catch (err) {
        logger.warn({ ctx: "vpn-ssh-stream", err }, "stream callback threw");
      }
    };

    stream.on("data", (d: Buffer) => onChunk(d, "stdout"));
    stream.stderr.on("data", (d: Buffer) => onChunk(d, "stderr"));

    stream.on("close", (code: number) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });

    stream.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}
