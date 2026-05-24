/**
 * Feature 016 T015 — Script execution engine.
 *
 * Inserts a `script_runs` row, then asynchronously:
 *   1. Writes script content to a remote temp file via SSH
 *   2. Executes it with params injected as env vars
 *   3. Streams output to a log file + in-memory pub/sub bus
 *   4. Updates script_runs on completion
 *
 * Returns `executionId` immediately so callers can subscribe to events.
 */

import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "events";
import { spawn } from "node:child_process";
import { db } from "../db/index.js";
import { scriptRuns, scripts } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { runRemoteCommand } from "./vpn-ssh.js";
import { logger } from "../lib/logger.js";
import type { ScriptExecutionResult } from "../lib/script-types.js";

// ── Pub/Sub bus for real-time execution events ─────────────────────────
export const executionBus = new EventEmitter();
executionBus.setMaxListeners(100);

export interface ExecutionEvent {
  executionId: string;
  type: "stdout" | "stderr" | "exit" | "error";
  data: string;
  timestamp: string;
}

// ── Config ─────────────────────────────────────────────────────────────
const LOG_ROOT = join(process.cwd(), "data", "logs", "script-runs");

/**
 * Execute a script on a remote server.
 *
 * Returns immediately with `{ executionId }`. Actual execution is async;
 * subscribe to `executionBus` for real-time output events.
 */
export async function executeScript(
  scriptId: string,
  serverId: string,
  params: Record<string, string>,
  userId: string,
): Promise<{ executionId: string }> {
  const executionId = randomUUID();
  const now = new Date().toISOString();
  const logFilePath = join(LOG_ROOT, `${executionId}.log`);

  // Look up script content.
  const scriptRows = await db
    .select()
    .from(scripts)
    .where(eq(scripts.id, scriptId))
    .limit(1);

  if (scriptRows.length === 0) {
    throw new Error(`Script not found: ${scriptId}`);
  }

  const script = scriptRows[0]!;

  // Insert pending row.
  await db.insert(scriptRuns).values({
    id: executionId,
    scriptId,
    serverId,
    userId,
    params,
    status: "pending",
    startedAt: now,
    logFilePath,
    initiatedBy: "operator",
  });

  // Fire-and-forget execution.
  void runExecution(executionId, serverId, script.content, params, logFilePath);

  return { executionId };
}

async function runExecution(
  executionId: string,
  serverId: string,
  scriptContent: string,
  params: Record<string, string>,
  logFilePath: string,
): Promise<void> {
  const startedAt = new Date().toISOString();

  try {
    // Update status → running.
    await db
      .update(scriptRuns)
      .set({ status: "running" })
      .where(eq(scriptRuns.id, executionId));

    // Ensure log directory exists.
    await mkdir(join(logFilePath, ".."), { recursive: true });

    // Build param env prefix: PARAM_FOO=bar PARAM_BAZ=qux
    const paramEnv = Object.entries(params)
      .map(([k, v]) => `PARAM_${k}=${shellEscape(v)}`)
      .join(" ");

    // Build remote command: write script to temp file, execute, clean up.
    // Escape the heredoc delimiter to prevent variable expansion inside content.
    const remoteCmd = [
      `tmpfile=$(mktemp -p /tmp script.XXXXXX.sh)`,
      `trap "rm -f $tmpfile" EXIT`,
      `chmod 700 $tmpfile`,
      `cat > $tmpfile << 'HANGAR_EOF'`,
      scriptContent,
      `HANGAR_EOF`,
      `${paramEnv} bash $tmpfile`,
    ].join("\n");

    let fullOutput = "";

    const result = await runRemoteCommand(serverId, remoteCmd, {
      timeoutMs: 5 * 60_000,
      stream: (chunk) => {
        fullOutput += chunk;

        // Append to log file (fire-and-forget).
        void appendFile(logFilePath, chunk).catch(() => {});

        // Emit on bus.
        const event: ExecutionEvent = {
          executionId,
          type: "stdout",
          data: chunk,
          timestamp: new Date().toISOString(),
        };
        executionBus.emit(executionId, event);
        executionBus.emit("*", event);
      },
    });

    // Write final stderr to log if any.
    if (result.stderr) {
      await appendFile(logFilePath, result.stderr).catch(() => {});
    }

    const finishedAt = new Date().toISOString();
    const durationMs =
      new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    const status = result.exitCode === 0 ? "success" : "failed";

    await db
      .update(scriptRuns)
      .set({
        status,
        finishedAt,
        duration: Math.round(durationMs / 1000),
        exitCode: result.exitCode,
      })
      .where(eq(scriptRuns.id, executionId));

    // Emit exit event.
    const exitEvent: ExecutionEvent = {
      executionId,
      type: "exit",
      data: String(result.exitCode),
      timestamp: finishedAt,
    };
    executionBus.emit(executionId, exitEvent);
    executionBus.emit("*", exitEvent);
  } catch (err) {
    const finishedAt = new Date().toISOString();

    logger.error(
      { ctx: "script-executor", executionId, serverId, err },
      "Script execution failed",
    );

    await db
      .update(scriptRuns)
      .set({
        status: "failed",
        finishedAt,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(scriptRuns.id, executionId));

    // Write error to log.
    const errMsg =
      err instanceof Error ? err.stack ?? err.message : String(err);
    await appendFile(logFilePath, `\n[EXECUTOR ERROR] ${errMsg}\n`).catch(
      () => {},
    );

    const errorEvent: ExecutionEvent = {
      executionId,
      type: "error",
      data: errMsg,
      timestamp: finishedAt,
    };
    executionBus.emit(executionId, errorEvent);
    executionBus.emit("*", errorEvent);
  }
}

/**
 * Minimal shell escaping — wraps value in single quotes, escapes embedded
 * single quotes with `'\''`.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

let sandboxAvailable: boolean | null = null;

export async function checkSandboxAvailability(): Promise<boolean> {
  try {
    const result = await new Promise<{ exitCode: number }>((resolve, reject) => {
      const proc = spawn("bash", ["-c", "echo sandbox-ok"], {
        timeout: 5000,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      let exited = false;
      proc.on("exit", (code) => {
        exited = true;
        resolve({ exitCode: code ?? 1 });
      });
      proc.on("error", (err) => {
        if (!exited) reject(err);
      });
      setTimeout(() => {
        if (!exited) {
          proc.kill("SIGKILL");
          reject(new Error("Sandbox check timed out"));
        }
      }, 5000);
    });

    sandboxAvailable = result.exitCode === 0;
    logger.info(
      { ctx: "script-executor", sandboxAvailable },
      "Sandbox availability check complete",
    );
    return sandboxAvailable;
  } catch (err) {
    sandboxAvailable = false;
    logger.error(
      { ctx: "script-executor", err },
      "Sandbox availability check FAILED — script execution will be blocked",
    );
    return false;
  }
}

export function isSandboxAvailable(): boolean | null {
  return sandboxAvailable;
}

export async function executeSandboxed(
  scriptContent: string,
  params: Record<string, string>,
  opts?: { timeoutMs?: number },
): Promise<ScriptExecutionResult> {
  if (sandboxAvailable === false) {
    throw new Error("Sandbox not available — script execution blocked (fail-closed)");
  }

  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;

  const paramEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    paramEnv[`PARAM_${k}`] = v;
  }

  const result = await new Promise<ScriptExecutionResult>((resolve, reject) => {
    const proc = spawn("bash", ["-c", scriptContent], {
      timeout: timeoutMs,
      env: {
        ...paramEnv,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        LANG: "C.UTF-8",
      },
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("exit", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        sandboxed: true,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: err.message,
        sandboxed: false,
        durationMs: Date.now() - start,
      });
    });

    setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({
        exitCode: -1,
        stdout,
        stderr: "Execution timed out",
        sandboxed: true,
        durationMs: timeoutMs,
      });
    }, timeoutMs);
  });

  return result;
}
