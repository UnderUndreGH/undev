/**
 * T033 [E2E] [US3] — VPN drift detection tests.
 *
 * Exercises the tick() / checkServer() logic inside vpn-drift.ts
 * by calling startVpnDriftCron + advancing fake timers, then stopVpnDriftCron.
 *
 * DB + runRemoteCommand are fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock: logger ─────────────────────────────────────────────────────────
vi.mock("../../server/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mutable mock state ──────────────────────────────────────────────────
const mockState = {
  /** Results returned by sequential db.select().from().where() calls. */
  selectResults: [] as any[][],
  /** Captured db.update().set() calls. */
  updateSets: [] as Record<string, string>[],
  /** Result returned by runRemoteCommand. */
  sshResult: { exitCode: 0, stdout: "", stderr: "" },
  /** If true, runRemoteCommand rejects. */
  sshThrows: false,
};

// ── Select call counter (module-level, resettable via mockState) ────────
let selectIdx = 0;

// ── Mock: DB ─────────────────────────────────────────────────────────────
vi.mock("../../server/db/index.js", () => ({
  db: {
    select: () => {
      const idx = selectIdx++;
      const result = mockState.selectResults[idx] ?? [];
      return {
        from: () => ({
          where: () => Promise.resolve(result),
        }),
      };
    },
    update: () => ({
      set: (fields: Record<string, string>) => {
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
  runRemoteCommand: vi.fn(() => {
    if (mockState.sshThrows) {
      return Promise.reject(new Error("SSH connection refused"));
    }
    return Promise.resolve(mockState.sshResult);
  }),
}));

// ── Import SUT ───────────────────────────────────────────────────────────
const { startVpnDriftCron, stopVpnDriftCron } = await import(
  "../../server/services/vpn-drift.js"
);

describe("T033 — VPN drift detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockState.selectResults = [];
    mockState.updateSets = [];
    mockState.sshResult = { exitCode: 0, stdout: "", stderr: "" };
    mockState.sshThrows = false;
    selectIdx = 0;
  });

  afterEach(() => {
    stopVpnDriftCron();
    vi.useRealTimers();
  });

  /** Helper: tick the cron once and await all async work. */
  async function tickOnce(): Promise<void> {
    startVpnDriftCron();
    await vi.advanceTimersByTimeAsync(300_000);
  }

  /**
   * The tick() function in vpn-drift.ts makes 3 sequential select calls:
   *   [0] eligible servers (with credentials) — for checkServer loop
   *   [1] enabled servers (scriptsEnabled filter) — not used in current impl
   *   [2] no-cred servers — for marking 'unknown'
   *
   * We provide all 3 results. The second query (enabled) returns same IDs
   * as eligible for the first test cases; it's not actually used in the
   * current implementation (MVP skips scriptsEnabled in cron).
   */

  it("running Amnezia container → vpnDriftStatus 'in_sync'", async () => {
    mockState.sshResult = { exitCode: 0, stdout: "Up 2 hours", stderr: "" };

    mockState.selectResults = [
      // [0] eligible servers with credentials
      [
        {
          id: "srv-1",
          sshPasswordEncrypted: "enc-pw",
          sshPrivateKeyEncrypted: null,
        },
      ],
      // [1] enabled servers (unused in MVP)
      [{ id: "srv-1" }],
      // [2] no-cred servers
      [],
    ];

    await tickOnce();

    const syncUpdate = mockState.updateSets.find(
      (s: Record<string, string>) => s.vpnDriftStatus === "in_sync",
    );
    expect(syncUpdate).toBeDefined();
  });

  it("stopped/missing container → vpnDriftStatus 'drifted'", async () => {
    mockState.sshResult = { exitCode: 0, stdout: "", stderr: "" };

    mockState.selectResults = [
      [
        {
          id: "srv-2",
          sshPasswordEncrypted: "enc-pw",
          sshPrivateKeyEncrypted: null,
        },
      ],
      [{ id: "srv-2" }],
      [],
    ];

    await tickOnce();

    const driftedUpdate = mockState.updateSets.find(
      (s: Record<string, string>) => s.vpnDriftStatus === "drifted",
    );
    expect(driftedUpdate).toBeDefined();
  });

  it("server with no credentials (both NULL) → vpnDriftStatus 'unknown'", async () => {
    // No eligible servers, no enabled, but a no-cred server
    mockState.selectResults = [
      [], // eligible
      [], // enabled
      [{ id: "srv-3" }], // no-cred
    ];

    await tickOnce();

    const unknownUpdate = mockState.updateSets.find(
      (s: Record<string, string>) => s.vpnDriftStatus === "unknown",
    );
    expect(unknownUpdate).toBeDefined();
  });

  it("SSH command failure → vpnDriftStatus 'unknown'", async () => {
    mockState.sshThrows = true;

    mockState.selectResults = [
      [
        {
          id: "srv-4",
          sshPasswordEncrypted: "enc-pw",
          sshPrivateKeyEncrypted: null,
        },
      ],
      [{ id: "srv-4" }],
      [],
    ];

    await tickOnce();

    const unknownUpdate = mockState.updateSets.find(
      (s: Record<string, string>) => s.vpnDriftStatus === "unknown",
    );
    expect(unknownUpdate).toBeDefined();
  });

  it("drift cron skips servers without credentials (no SSH calls)", async () => {
    const { runRemoteCommand } = await import(
      "../../server/services/vpn-ssh.js"
    );
    const sshMock = vi.mocked(runRemoteCommand);
    sshMock.mockClear();

    // No servers at all
    mockState.selectResults = [[], [], []];

    await tickOnce();

    expect(sshMock).not.toHaveBeenCalled();
    expect(mockState.updateSets).toHaveLength(0);
  });
});
