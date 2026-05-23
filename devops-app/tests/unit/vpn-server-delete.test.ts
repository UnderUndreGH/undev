/**
 * T032 [E2E] [US2] — Add then delete server test.
 *
 * Tests DELETE /api/vpn/servers/:id endpoint:
 *  - Deleting an existing server returns 204
 *  - Deleting a non-existent server returns 404
 *  - Audit entry is created on delete
 *  - Verify server is removed from DB (mock verification)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ── Mutable DB state ───────────────────────────────────────────────────────

interface ServerRow {
  id: string;
  label: string;
  host: string;
}

let dbServers: Map<string, ServerRow> = new Map();
let dbAudits: Array<{ action: string; targetId: string; result: string }> = [];
let deletedIds: string[] = [];

function resetState() {
  dbServers = new Map();
  dbAudits = [];
  deletedIds = [];
}

// Seed a server for delete tests
const EXISTING_ID = "server-to-delete-001";

function seedExistingServer() {
  dbServers.set(EXISTING_ID, {
    id: EXISTING_ID,
    label: "delete-me",
    host: "10.0.0.50",
  });
}

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../server/db/index.js", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => {
              // Return server from the map if it exists
              const entries = [...dbServers.values()];
              const first = entries.length > 0 ? [entries[0]] : [];
              return Promise.resolve(first);
            },
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: (v: Record<string, unknown>) => {
          if (v.action) {
            dbAudits.push({
              action: v.action as string,
              targetId: v.targetId as string,
              result: v.result as string,
            });
          }
          return {
            returning: () => Promise.resolve([v]),
          };
        },
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      })),
      delete: vi.fn(() => ({
        where: () => {
          // Record deletion + remove from map
          if (dbServers.has(EXISTING_ID)) {
            deletedIds.push(EXISTING_ID);
            dbServers.delete(EXISTING_ID);
          }
          return Promise.resolve();
        },
      })),
    },
  };
});

vi.mock("../../server/lib/envelope-cipher.js", () => ({
  seal: vi.fn((plaintext: string) => ({
    ct: `encrypted(${plaintext})`,
    iv: "aWY9MTJieXRlcw==",
    tag: "dGFnPTE2Ynl0ZXM=",
  })),
}));

vi.mock("../../server/middleware/auth.js", () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.userId = "test-user-001";
    next();
  }),
}));

// ── Import SUT after mocks ─────────────────────────────────────────────────

const { vpnServersRouter } = await import(
  "../../server/routes/servers-vpn.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/vpn", vpnServersRouter);
  return app;
}

async function deleteServer(
  app: ReturnType<typeof makeApp>,
  id: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        resolve({ status: 0, body: null });
        return;
      }
      const port = addr.port;
      fetch(`http://127.0.0.1:${port}/api/vpn/servers/${id}`, {
        method: "DELETE",
      })
        .then(async (r) => {
          const text = await r.text();
          return {
            status: r.status,
            body: text ? JSON.parse(text) : null,
          };
        })
        .then((out) => {
          server.close();
          resolve(out);
        })
        .catch(() => {
          server.close();
          resolve({ status: 0, body: null });
        });
    });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("T032 — DELETE /api/vpn/servers/:id", () => {
  beforeEach(() => {
    resetState();
    seedExistingServer();
  });

  it("deleting an existing server returns 204", async () => {
    const app = makeApp();
    const r = await deleteServer(app, EXISTING_ID);

    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
  });

  it("deleting a non-existent server returns 404", async () => {
    // Clear the server so it doesn't exist
    dbServers.clear();

    const app = makeApp();
    const r = await deleteServer(app, "nonexistent-id-999");

    expect(r.status).toBe(404);
    const body = r.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("not found");
  });

  it("audit entry is created on delete", async () => {
    const app = makeApp();
    const r = await deleteServer(app, EXISTING_ID);

    expect(r.status).toBe(204);

    const audit = dbAudits.find((a) => a.action === "vpn.server.delete");
    expect(audit).toBeDefined();
    expect(audit!.targetId).toBe(EXISTING_ID);
    expect(audit!.result).toBe("success");
  });

  it("server is removed from DB after delete", async () => {
    // Verify server exists before delete
    expect(dbServers.has(EXISTING_ID)).toBe(true);

    const app = makeApp();
    const r = await deleteServer(app, EXISTING_ID);

    expect(r.status).toBe(204);

    // Verify the server was removed from the in-memory DB mock
    expect(dbServers.has(EXISTING_ID)).toBe(false);
    expect(deletedIds).toContain(EXISTING_ID);
  });
});
