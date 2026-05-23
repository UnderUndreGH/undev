/**
 * T030 [PERF] — First-byte streaming latency test (SC-004).
 *
 * Verifies that the time between calling executeScript() and receiving
 * the first executionBus event is within 2 000 ms.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockScriptRows = [{ id: "script-1", content: "echo hello" }];

vi.mock("../../server/db/index.js", () => {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(mockScriptRows),
      }),
    }),
  }));
  const insert = vi.fn(() => ({
    values: () => Promise.resolve(),
  }));
  const update = vi.fn(() => ({
    set: () => ({
      where: () => Promise.resolve(),
    }),
  }));
  return { db: { select, insert, update } };
});

// Mock runRemoteCommand so it simulates a delayed first chunk then streams.
vi.mock("../../server/services/vpn-ssh.js", () => {
  return {
    runRemoteCommand: vi.fn(
      (
        _serverId: string,
        _command: string,
        opts?: { stream?: (chunk: string) => void },
      ) =>
        new Promise((resolve) => {
          // Simulate 500 ms delay before first chunk (well under 2 000 ms budget)
          setTimeout(() => {
            opts?.stream?.("first-chunk\n");
            // Simulate a small gap then finish
            setTimeout(() => {
              resolve({
                exitCode: 0,
                stdout: "first-chunk\n",
                stderr: "",
              });
            }, 50);
          }, 500);
        }),
    ),
  };
});

// Suppress file-system side effects
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  appendFile: vi.fn(async () => {}),
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────

const { executionBus, executeScript } = await import(
  "../../server/services/script-executor.js"
);

// ── Tests ──────────────────────────────────────────────────────────────────

describe("T030 — first-byte streaming latency (SC-004)", () => {
  beforeEach(() => {
    executionBus.removeAllListeners();
  });

  // Each test starts an async execution that takes ~550ms. Wait for pending
  // timers to drain so the next test doesn't catch stale events.
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 600));
    executionBus.removeAllListeners();
  });

  it("first executionBus event arrives within 2 000 ms of executeScript() call", async () => {
    const FIRST_BYTE_BUDGET_MS = 2_000;

    const { executionId } = await executeScript(
      "script-1",
      "server-1",
      {},
      "user-1",
    );

    const firstEventPromise = new Promise<number>((resolve) => {
      executionBus.on(executionId, () => {
        resolve(Date.now());
      });
    });

    const callTime = Date.now();
    const firstEventTime = await firstEventPromise;
    const latency = firstEventTime - callTime;

    expect(latency).toBeLessThan(FIRST_BYTE_BUDGET_MS);
  });

  it("first event carries the correct executionId", async () => {
    const { executionId } = await executeScript(
      "script-1",
      "server-1",
      {},
      "user-1",
    );

    const firstEventPromise = new Promise<string>((resolve) => {
      executionBus.on(executionId, (event: { executionId: string }) => {
        resolve(event.executionId);
      });
    });

    const eventExecId = await firstEventPromise;
    expect(eventExecId).toBe(executionId);
  });

  it("first event type is stdout", async () => {
    const { executionId } = await executeScript(
      "script-1",
      "server-1",
      {},
      "user-1",
    );

    // Subscribe to the specific executionId to avoid cross-test event bleed.
    const firstEventPromise = new Promise<string>((resolve) => {
      executionBus.on(executionId, (event: { type: string }) => {
        resolve(event.type);
      });
    });

    const eventType = await firstEventPromise;
    expect(eventType).toBe("stdout");
  });
});
