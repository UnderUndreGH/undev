import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../../server/db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    run: vi.fn(),
  },
}));

vi.mock("../../server/services/ai/incident-analyzer.js", () => ({
  runIncidentAnalysis: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger to suppress noise
vi.mock("../../server/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocking
const { onPushEvent } = await import("../../server/services/ai/push-subscriber.js");
const { db } = await import("../../server/db/index.js");

// Helper to create a mock chain for drizzle select
function mockSelect(returnValue: any[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  };
  chain._result = returnValue;
  // Make the chain thenable (resolves to returnValue)
  chain.then = (resolve: any, reject: any) => Promise.resolve(returnValue).then(resolve, reject);
  (db.select as any).mockReturnValue(chain);
  return chain;
}

describe("push-subscriber dedup race condition (C1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create only ONE conversation for concurrent events with same dedup key", async () => {
    let insertCallCount = 0;

    // Mock settings check - enabled, no kill switch
    const settingsChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    // Mock provider check
    const providerChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    // Mock notification preferences check
    const prefChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain.then = (resolve: any) => resolve([]);

    // Mock insert
    const insertChain: any = {
      values: vi.fn().mockReturnThis(),
    };
    insertChain.then = (resolve: any) => {
      insertCallCount++;
      resolve(undefined);
      return undefined;
    };
    (db.insert as any).mockReturnValue(insertChain);

    let selectCallIndex = 0;
    (db.select as any).mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) return settingsChain; // settings
      if (selectCallIndex === 2) return prefChain; // preferences
      return providerChain; // provider
    });

    const opts = {
      targetKind: "server" as const,
      targetId: "server-1",
      eventClass: "health_critical",
    };

    // Fire two concurrent calls
    const [r1, r2] = await Promise.allSettled([
      onPushEvent(opts),
      onPushEvent(opts),
    ]);

    // Both should succeed
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");

    // Only ONE conversation should have been inserted (dedup prevents the second)
    expect(insertCallCount).toBe(1);
  });
});

describe("FR-017 absorb/spawn semantics (C2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should absorb event into in-flight conversation (pending status)", async () => {
    const existingConvoId = "existing-convo-123";

    // First select: existing conversation status check (returns 'pending')
    const convoStatusChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    convoStatusChain.then = (resolve: any) => resolve([{ status: "pending" }]);

    // Second select: max seq for absorb
    const maxSeqChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };
    maxSeqChain.then = (resolve: any) => resolve([{ maxSeq: 2 }]);

    // Insert chains: one for message, one for audit
    let insertCalls: any[] = [];
    (db.insert as any).mockImplementation((_table: any) => {
      const chain: any = {
        values: vi.fn().mockReturnThis(),
      };
      chain.then = (resolve: any) => {
        insertCalls.push("insert");
        resolve(undefined);
      };
      return chain;
    });

    let selectCallIndex = 0;
    (db.select as any).mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) return convoStatusChain;
      return maxSeqChain;
    });

    // Pre-populate dedup map by calling once first with a fresh event
    // We need to simulate: dedupMap already has an entry for this key
    // The simplest way is to call onPushEvent once, then call again
    // But since we mocked DB, let's use a two-step approach

    // First call: will create a new conversation (dedup miss)
    // Reset mocks for first call
    vi.clearAllMocks();

    // For the first call, we need settings + pref + provider + insert
    const settingsChain1: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain1.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    const prefChain1: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain1.then = (resolve: any) => resolve([]);

    const providerChain1: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain1.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    const insertChain1: any = {
      values: vi.fn().mockReturnThis(),
    };
    insertChain1.then = (resolve: any) => { resolve(undefined); };

    const auditInsert1: any = {
      values: vi.fn().mockReturnThis(),
    };
    auditInsert1.then = (resolve: any) => { resolve(undefined); };

    let firstCallSelectIdx = 0;
    (db.select as any).mockImplementation(() => {
      firstCallSelectIdx++;
      if (firstCallSelectIdx === 1) return settingsChain1;
      if (firstCallSelectIdx === 2) return prefChain1;
      return providerChain1;
    });

    let firstInsertIdx = 0;
    (db.insert as any).mockImplementation((_table: any) => {
      firstInsertIdx++;
      if (firstInsertIdx === 1) return insertChain1;
      return auditInsert1;
    });

    const opts = {
      targetKind: "server" as const,
      targetId: "server-1",
      eventClass: "health_critical",
    };

    // First call - creates entry in dedupMap
    await onPushEvent(opts);

    // Second call - should hit dedup and absorb (existing status = pending)
    vi.clearAllMocks();

    const convoStatusChain2: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    convoStatusChain2.then = (resolve: any) => resolve([{ status: "pending" }]);

    const maxSeqChain2: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };
    maxSeqChain2.then = (resolve: any) => resolve([{ maxSeq: 2 }]);

    let secondSelectIdx = 0;
    (db.select as any).mockImplementation(() => {
      secondSelectIdx++;
      if (secondSelectIdx === 1) return convoStatusChain2;
      return maxSeqChain2;
    });

    const messageInsert: any = { values: vi.fn().mockReturnThis() };
    messageInsert.then = (resolve: any) => { resolve(undefined); };
    const auditInsert2: any = { values: vi.fn().mockReturnThis() };
    auditInsert2.then = (resolve: any) => { resolve(undefined); };

    let secondInsertIdx = 0;
    (db.insert as any).mockImplementation(() => {
      secondInsertIdx++;
      if (secondInsertIdx === 1) return messageInsert;
      return auditInsert2;
    });

    await onPushEvent(opts);

    // Should have called select (for status check + max seq)
    expect(db.select).toHaveBeenCalled();
    // Should have inserted a message (absorb) + audit
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it("should spawn new conversation when existing is in terminal status", async () => {
    const opts = {
      targetKind: "server" as const,
      targetId: "server-2",
      eventClass: "deploy_failed",
    };

    // First call: creates dedup entry
    const settingsChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    const prefChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain.then = (resolve: any) => resolve([]);

    const providerChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    const insertChain: any = { values: vi.fn().mockReturnThis() };
    insertChain.then = (resolve: any) => { resolve(undefined); };
    const auditChain: any = { values: vi.fn().mockReturnThis() };
    auditChain.then = (resolve: any) => { resolve(undefined); };

    let sIdx = 0;
    (db.select as any).mockImplementation(() => {
      sIdx++;
      if (sIdx === 1) return settingsChain;
      if (sIdx === 2) return prefChain;
      return providerChain;
    });

    let iIdx = 0;
    (db.insert as any).mockImplementation(() => {
      iIdx++;
      if (iIdx === 1) return insertChain;
      return auditChain;
    });

    await onPushEvent(opts);

    // Second call: existing conversation is in terminal status ('completed')
    vi.clearAllMocks();

    const convoStatusChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    convoStatusChain.then = (resolve: any) => resolve([{ status: "completed" }]);

    const settingsChain2: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain2.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    const prefChain2: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain2.then = (resolve: any) => resolve([]);

    const providerChain2: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain2.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    const spawnInsertChain: any = { values: vi.fn().mockReturnThis() };
    spawnInsertChain.then = (resolve: any) => { resolve(undefined); };
    const spawnAuditChain: any = { values: vi.fn().mockReturnThis() };
    spawnAuditChain.then = (resolve: any) => { resolve(undefined); };

    let s2Idx = 0;
    (db.select as any).mockImplementation(() => {
      s2Idx++;
      if (s2Idx === 1) return convoStatusChain;
      if (s2Idx === 2) return settingsChain2;
      if (s2Idx === 3) return prefChain2;
      return providerChain2;
    });

    let i2Idx = 0;
    (db.insert as any).mockImplementation(() => {
      i2Idx++;
      if (i2Idx === 1) return spawnInsertChain;
      return spawnAuditChain;
    });

    await onPushEvent(opts);

    // Should have spawned a new conversation (insert called for conversation + audit)
    expect(db.insert).toHaveBeenCalledTimes(2);

    // The conversation insert should include priorConversationId
    // (We can check the values that were passed)
    expect(spawnInsertChain.values).toHaveBeenCalled();
    const insertedValues = spawnInsertChain.values.mock.calls[0][0];
    expect(insertedValues.priorConversationId).toBeTruthy();
  });
});

describe("notification preferences check (C12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return early when notification preference is disabled for event class", async () => {
    const settingsChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    // Notification preference: exists but disabled
    const prefChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain.then = (resolve: any) => resolve([{ eventType: "health_critical", enabled: false }]);

    let sIdx = 0;
    (db.select as any).mockImplementation(() => {
      sIdx++;
      if (sIdx === 1) return settingsChain;
      return prefChain;
    });

    (db.insert as any).mockReturnValue({ values: vi.fn().mockReturnThis() });

    const opts = {
      targetKind: "server" as const,
      targetId: "server-1",
      eventClass: "health_critical",
    };

    await onPushEvent(opts);

    // Should NOT have called insert (no conversation created)
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("should proceed when notification preference is enabled for event class", async () => {
    const settingsChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    // Notification preference: exists and enabled
    const prefChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain.then = (resolve: any) => resolve([{ eventType: "health_critical", enabled: true }]);

    const providerChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    const insertChain: any = { values: vi.fn().mockReturnThis() };
    insertChain.then = (resolve: any) => { resolve(undefined); };

    let sIdx = 0;
    (db.select as any).mockImplementation(() => {
      sIdx++;
      if (sIdx === 1) return settingsChain;
      if (sIdx === 2) return prefChain;
      return providerChain;
    });

    let iIdx = 0;
    (db.insert as any).mockImplementation(() => {
      iIdx++;
      return insertChain;
    });

    const opts = {
      targetKind: "server" as const,
      targetId: "server-99",
      eventClass: "health_critical_enabled_test",
    };

    await onPushEvent(opts);

    // Should have called insert (conversation created)
    expect(db.insert).toHaveBeenCalled();
  });

  it("should proceed when no notification preference row exists", async () => {
    const settingsChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    settingsChain.then = (resolve: any) => resolve([{ enabled: true, globalKillSwitchEngaged: false }]);

    // No preference row
    const prefChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    prefChain.then = (resolve: any) => resolve([]);

    const providerChain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
    providerChain.then = (resolve: any) => resolve([{ id: "provider-1", modelDefault: "claude-3" }]);

    const insertChain: any = { values: vi.fn().mockReturnThis() };
    insertChain.then = (resolve: any) => { resolve(undefined); };

    let sIdx = 0;
    (db.select as any).mockImplementation(() => {
      sIdx++;
      if (sIdx === 1) return settingsChain;
      if (sIdx === 2) return prefChain;
      return providerChain;
    });

    let iIdx = 0;
    (db.insert as any).mockImplementation(() => {
      iIdx++;
      return insertChain;
    });

    const opts = {
      targetKind: "app" as const,
      targetId: "app-no-pref",
      eventClass: "some_new_event_type",
    };

    await onPushEvent(opts);

    expect(db.insert).toHaveBeenCalled();
  });
});
