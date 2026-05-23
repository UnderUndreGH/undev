/**
 * T034 [E2E] [US4] — Script execution E2E test.
 *
 * Exercises executeScript() and executionBus from script-executor.ts.
 * DB, runRemoteCommand, and fs operations are fully mocked.
 *
 * Key behaviors tested:
 *   - script_runs row inserted with status 'pending'
 *   - output streams via executionBus in real-time
 *   - exit event emitted with exit code
 *   - error event emitted on failure
 *   - shell escaping of PARAM_ env vars
 *   - remote command construction (mktemp + trap rm + chmod 700)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExecutionEvent } from "../../server/services/script-executor.js";

// ── Mutable mock state ──────────────────────────────────────────────────
const mockState = {
  /** Script rows returned by db.select for script lookup. */
  scriptRows: [] as any[],
  /** Captured db.insert calls. */
  insertValues: [] as any[],
  /** Captured db.update().set() calls. */
  updateSets: [] as Record<string, any>[],
  /** runRemoteCommand result. */
  sshResult: { exitCode: 0, stdout: "output", stderr: "" },
  /** If true, runRemoteCommand rejects. */
  sshThrows: false,
  /** Captured command passed to runRemoteCommand. */
  lastSshCommand: "",
  /** Captured opts passed to runRemoteCommand. */
  lastSshOpts: null as unknown,
};

// ── Mock: logger ─────────────────────────────────────────────────────────
vi.mock("../../server/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mock: DB ─────────────────────────────────────────────────────────────
vi.mock("../../server/db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockState.scriptRows),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        mockState.insertValues.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (fields: Record<string, any>) => {
        mockState.updateSets.push(fields);
        return {
          where: () => Promise.resolve(),
        };
      },
    }),
  },
}));

// ── Mock: runRemoteCommand ───────────────────────────────────────────────
vi.mock("../../server/services/vpn-ssh.js", () => ({
  runRemoteCommand: vi.fn(
    (serverId: string, command: string, opts?: any) => {
      mockState.lastSshCommand = command;
      mockState.lastSshOpts = opts;

      // Simulate streaming: call the stream callback if provided.
      if (opts?.stream) {
        opts.stream("hello ");
        opts.stream("world\n");
      }

      if (mockState.sshThrows) {
        return Promise.reject(new Error("SSH connection failed"));
      }
      return Promise.resolve(mockState.sshResult);
    },
  ),
}));

// ── Mock: node:fs/promises ───────────────────────────────────────────────
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  appendFile: vi.fn(() => Promise.resolve()),
}));

// ── Import SUT ───────────────────────────────────────────────────────────
const { executionBus, executeScript } = await import(
  "../../server/services/script-executor.js"
);

describe("T034 — Script execution E2E", () => {
  let receivedEvents: ExecutionEvent[];

  beforeEach(() => {
    mockState.scriptRows = [];
    mockState.insertValues = [];
    mockState.updateSets = [];
    mockState.sshResult = { exitCode: 0, stdout: "output", stderr: "" };
    mockState.sshThrows = false;
    mockState.lastSshCommand = "";
    mockState.lastSshOpts = null;
    receivedEvents = [];
  });

  afterEach(() => {
    executionBus.removeAllListeners();
  });

  /** Helper: set up a basic script in the mock DB and execute it. */
  function setupScript(overrides?: Record<string, string>) {
    mockState.scriptRows = [
      {
        id: "script-1",
        content: "#!/bin/bash\necho hello",
        ...overrides,
      },
    ];
  }

  it("executing a script creates a script_runs row with status 'pending'", async () => {
    setupScript();

    const result = await executeScript(
      "script-1",
      "server-1",
      { FOO: "bar" },
      "user-1",
    );

    expect(result.executionId).toBeDefined();
    expect(mockState.insertValues).toHaveLength(1);
    expect(mockState.insertValues[0].status).toBe("pending");
    expect(mockState.insertValues[0].scriptId).toBe("script-1");
    expect(mockState.insertValues[0].serverId).toBe("server-1");
  });

  it("script output streams via executionBus in real-time", async () => {
    setupScript();

    const result = await executeScript(
      "script-1",
      "server-1",
      {},
      "user-1",
    );

    // Subscribe to events for this execution.
    const events: ExecutionEvent[] = [];
    executionBus.on(result.executionId, (ev: ExecutionEvent) => {
      events.push(ev);
    });

    // Re-execute to capture events — the async runExecution fires after
    // executeScript returns. We need to subscribe before the async part runs.
    // Since executeScript returns immediately but runExecution is fire-and-forget,
    // we need a different approach: subscribe globally before the call.

    // Actually, let's test this properly by subscribing before calling.
    executionBus.removeAllListeners();
    const streamedChunks: string[] = [];

    // Subscribe to wildcard events before execution.
    executionBus.on("*", (ev: ExecutionEvent) => {
      if (ev.type === "stdout") {
        streamedChunks.push(ev.data);
      }
    });

    await executeScript("script-1", "server-1", {}, "user-1");

    // Allow async runExecution to complete.
    await new Promise((r) => setTimeout(r, 50));

    // The mock runRemoteCommand calls stream("hello ") and stream("world\n")
    expect(streamedChunks.length).toBeGreaterThanOrEqual(2);
    expect(streamedChunks[0]).toBe("hello ");
    expect(streamedChunks[1]).toBe("world\n");
  });

  it("script exit emits 'exit' event with exit code", async () => {
    setupScript();
    mockState.sshResult = { exitCode: 0, stdout: "ok", stderr: "" };

    const exitEvents: ExecutionEvent[] = [];
    executionBus.on("*", (ev: ExecutionEvent) => {
      if (ev.type === "exit") {
        exitEvents.push(ev);
      }
    });

    await executeScript("script-1", "server-1", {}, "user-1");
    await new Promise((r) => setTimeout(r, 50));

    expect(exitEvents.length).toBeGreaterThanOrEqual(1);
    expect(exitEvents[0].type).toBe("exit");
    expect(exitEvents[0].data).toBe("0");
  });

  it("script failure emits 'error' event", async () => {
    setupScript();
    mockState.sshThrows = true;

    const errorEvents: ExecutionEvent[] = [];
    executionBus.on("*", (ev: ExecutionEvent) => {
      if (ev.type === "error") {
        errorEvents.push(ev);
      }
    });

    await executeScript("script-1", "server-1", {}, "user-1");
    await new Promise((r) => setTimeout(r, 50));

    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].type).toBe("error");
    expect(errorEvents[0].data).toContain("SSH connection failed");
  });

  it("shell escaping of param values (PARAM_ env vars properly escaped)", async () => {
    setupScript();

    // Use a value containing a single quote to test shell escaping.
    await executeScript(
      "script-1",
      "server-1",
      { DB_PASS: "it's a secret", HOST: "my-host" },
      "user-1",
    );
    await new Promise((r) => setTimeout(r, 50));

    const cmd = mockState.lastSshCommand;
    // The command should contain properly escaped PARAM_ env vars.
    // shellEscape("it's a secret") => 'it'\''s a secret'
    expect(cmd).toContain("PARAM_DB_PASS=");
    expect(cmd).toContain("PARAM_HOST=");
    // Verify the single-quote value is properly escaped.
    // The line with params should look like:
    // PARAM_DB_PASS='it'\''s a secret' PARAM_HOST='my-host' bash $tmpfile
    const paramLine = cmd.split("\n").find((l: string) => l.includes("PARAM_DB_PASS"));
    expect(paramLine).toBeDefined();
    // Value should be wrapped in single quotes with escaped inner quotes.
    expect(paramLine).toContain("'it'\\''s a secret'");
  });

  it("temp file uses mktemp + trap rm + chmod 700", async () => {
    setupScript();

    await executeScript("script-1", "server-1", {}, "user-1");
    await new Promise((r) => setTimeout(r, 50));

    const cmd = mockState.lastSshCommand;

    // Verify the remote command construction.
    expect(cmd).toContain("tmpfile=$(mktemp -p /tmp script.XXXXXX.sh)");
    expect(cmd).toContain('trap "rm -f $tmpfile" EXIT');
    expect(cmd).toContain("chmod 700 $tmpfile");
    expect(cmd).toContain("cat > $tmpfile << 'HANGAR_EOF'");
    expect(cmd).toContain("HANGAR_EOF");
    expect(cmd).toContain("bash $tmpfile");
  });

  it("throws if script not found", async () => {
    mockState.scriptRows = [];

    await expect(
      executeScript("nonexistent", "server-1", {}, "user-1"),
    ).rejects.toThrow("Script not found: nonexistent");
  });
});
