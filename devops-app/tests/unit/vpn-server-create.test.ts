/**
 * T031 [E2E] [US1] — Add new VPS test.
 *
 * Tests POST /api/vpn/servers endpoint:
 *  - Creating a server with password auth stores encrypted credentials
 *  - Creating with storeCredentials=false NULLs out credentials after probe
 *  - installVpn=true + probe detects existing install → status stays 'installed'
 *  - Form fields match spec (host, sshUser, port, password, privateKey,
 *    storeCredentials, installVpn)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ── Mutable DB state ───────────────────────────────────────────────────────

interface ServerRow {
  id: string;
  label: string;
  host: string;
  port: number;
  sshUser: string;
  sshAuthMethod: string;
  sshPassword: string | null;
  sshPrivateKey: string | null;
  sshPasswordEncrypted: string | null;
  sshPrivateKeyEncrypted: string | null;
  scriptsPath: string;
  connectionType: string;
  vpnStatus: string;
  vpnInstalledAt: string | null;
  createdAt: string;
}

let dbServers: Map<string, ServerRow> = new Map();
let dbAudits: Array<{ action: string; targetId: string }> = [];
let probeReturnsInstalled = false;

function resetState() {
  dbServers = new Map();
  dbAudits = [];
  probeReturnsInstalled = false;
}

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../server/db/index.js", () => {
  return {
    db: {
      // select() → from() → where() → limit() — returns matching rows from
      // the in-memory dbServers map. This handles both the GET /servers list
      // query and the re-fetch after updates.
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([...dbServers.values()]),
          }),
        }),
      })),
      insert: vi.fn(() => ({
        values: (v: Record<string, unknown>) => {
          // Server insert — route code uses .returning() to destructure [server]
          if (v.id && v.host) {
            const row: ServerRow = {
              id: v.id as string,
              label: v.label as string,
              host: v.host as string,
              port: v.port as number,
              sshUser: v.sshUser as string,
              sshAuthMethod: v.sshAuthMethod as string,
              sshPassword: v.sshPassword as string | null,
              sshPrivateKey: v.sshPrivateKey as string | null,
              sshPasswordEncrypted: v.sshPasswordEncrypted as string | null,
              sshPrivateKeyEncrypted: v.sshPrivateKeyEncrypted as string | null,
              scriptsPath: v.scriptsPath as string,
              connectionType: v.connectionType as string,
              vpnStatus: v.vpnStatus as string,
              vpnInstalledAt: null,
              createdAt: v.createdAt as string,
            };
            dbServers.set(row.id, row);
            return {
              returning: () => Promise.resolve([row]),
            };
          }
          // Audit entry insert
          if (v.action) {
            dbAudits.push({
              action: v.action as string,
              targetId: v.targetId as string,
            });
          }
          return Promise.resolve();
        },
      })),
      update: vi.fn(() => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            // Apply patch to ALL servers in the map (simulates the eq filter)
            for (const [, row] of dbServers.entries()) {
              Object.assign(row, patch);
            }
            return Promise.resolve();
          },
        }),
      })),
      delete: vi.fn(() => ({
        where: () => Promise.resolve(),
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

vi.mock("../../server/services/vpn-install-probe.js", () => ({
  probeAmneziaInstalled: vi.fn(async () => probeReturnsInstalled),
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

async function postServer(
  app: ReturnType<typeof makeApp>,
  body: Record<string, unknown>,
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
      fetch(`http://127.0.0.1:${port}/api/vpn/servers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

describe("T031 — POST /api/vpn/servers (create VPN server)", () => {
  beforeEach(() => {
    resetState();
  });

  it("creating a server with password auth stores encrypted credentials", async () => {
    const app = makeApp();
    const r = await postServer(app, {
      label: "test-vps",
      host: "10.0.0.1",
      sshUser: "root",
      port: 22,
      password: "s3cret!",
    });

    expect(r.status).toBe(201);

    // Find the created server
    const serverEntry = [...dbServers.values()][0];
    expect(serverEntry).toBeDefined();
    expect(serverEntry!.sshAuthMethod).toBe("password");
    expect(serverEntry!.sshPasswordEncrypted).toBeTruthy();
    expect(serverEntry!.sshPasswordEncrypted).toContain("encrypted(s3cret!)");

    // Verify audit entry was created
    const audit = dbAudits.find((a) => a.action === "vpn.server.create");
    expect(audit).toBeDefined();
    expect(audit!.targetId).toBe(serverEntry!.id);
  });

  it("storeCredentials=false NULLs out credentials after probe", async () => {
    const app = makeApp();
    const r = await postServer(app, {
      label: "temp-vps",
      host: "10.0.0.2",
      sshUser: "admin",
      port: 2222,
      password: "temp-pass",
      storeCredentials: false,
    });

    expect(r.status).toBe(201);

    const serverEntry = [...dbServers.values()][0];
    expect(serverEntry).toBeDefined();

    // After storeCredentials=false, the route NULLs out credential columns
    expect(serverEntry!.sshPassword).toBeNull();
    expect(serverEntry!.sshPrivateKey).toBeNull();
    expect(serverEntry!.sshPasswordEncrypted).toBeNull();
    expect(serverEntry!.sshPrivateKeyEncrypted).toBeNull();
  });

  it("installVpn=true + probe detects existing install → status stays 'installed'", async () => {
    probeReturnsInstalled = true;

    const app = makeApp();
    const r = await postServer(app, {
      label: "preinstalled-vps",
      host: "10.0.0.3",
      sshUser: "root",
      port: 22,
      password: "pass",
      installVpn: true,
    });

    expect(r.status).toBe(201);

    const serverEntry = [...dbServers.values()][0];
    expect(serverEntry).toBeDefined();

    // Probe detected existing install → vpnStatus should be 'installed',
    // not 'installing' (because installVpn=true but it's already installed)
    expect(serverEntry!.vpnStatus).toBe("installed");
  });

  it("form fields match spec (host, sshUser, port, password, privateKey, storeCredentials, installVpn)", async () => {
    const app = makeApp();

    // Test with all fields provided (privateKey path)
    const r = await postServer(app, {
      label: "full-spec-vps",
      host: "192.168.1.100",
      sshUser: "deploy",
      port: 2222,
      privateKey: "[REDACTED PRIVATE KEY]",
      storeCredentials: true,
      installVpn: false,
    });

    expect(r.status).toBe(201);

    const serverEntry = [...dbServers.values()][0];
    expect(serverEntry).toBeDefined();
    expect(serverEntry!.host).toBe("192.168.1.100");
    expect(serverEntry!.sshUser).toBe("deploy");
    expect(serverEntry!.port).toBe(2222);
    expect(serverEntry!.sshAuthMethod).toBe("key");
    expect(serverEntry!.sshPrivateKeyEncrypted).toBeTruthy();
    expect(serverEntry!.sshPrivateKeyEncrypted).toContain("encrypted(");
    // storeCredentials=true keeps them intact (not nulled)
    expect(serverEntry!.sshPrivateKey).toBeTruthy();
  });

  it("returns 400 when neither password nor privateKey is provided", async () => {
    const app = makeApp();
    const r = await postServer(app, {
      label: "bad-vps",
      host: "10.0.0.4",
      sshUser: "root",
      port: 22,
    });

    expect(r.status).toBe(400);
    const body = r.body as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
