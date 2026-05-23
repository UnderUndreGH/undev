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
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "events";
import { db } from "../db/index.js";
import { scriptRuns, scripts } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { runRemoteCommand } from "./vpn-ssh.js";
import { logger } from "../lib/logger.js";

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
