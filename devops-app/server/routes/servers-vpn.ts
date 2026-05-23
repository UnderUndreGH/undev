/**
 * Feature 016: VPN server management routes.
 *
 *   POST   /servers        — create a VPN server (probe + optional install)
 *   GET    /servers        — list servers with VPN-relevant columns
 *   DELETE /servers/:id    — hard-delete server (CASCADE handles script_runs)
 *
 * Mounted at /api/vpn by server/index.ts when FEATURE_VPN_ENABLED=1.
 * Auth is applied globally upstream (requireAuth on /api prefix).
 */

import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { servers, auditEntries } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { seal } from "../lib/envelope-cipher.js";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";

export const vpnServersRouter = Router();
vpnServersRouter.use(requireAuth);

// ── Zod schemas ──────────────────────────────────────────────────────────────

const createServerSchema = z
  .object({
    label: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().default(22),
    sshUser: z.string().min(1),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    storeCredentials: z.boolean().default(true),
    installVpn: z.boolean().default(false),
  })
  .refine((data) => !data.password !== !data.privateKey, {
    message: "Provide exactly one of password or privateKey",
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string into a JSON-stringified envelope blob
 * suitable for storage in the sshPasswordEncrypted / sshPrivateKeyEncrypted
 * text columns.
 */
function encryptCredential(plaintext: string): string {
  return JSON.stringify(seal(plaintext));
}

/**
 * Strip secret columns from a server row before returning to the client.
 */
function sanitizeServer(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (
      k === "sshPrivateKey" ||
      k === "sshPassword" ||
      k === "sshPrivateKeyEncrypted" ||
      k === "sshPasswordEncrypted"
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

// ── POST /servers — create VPN server ────────────────────────────────────────

vpnServersRouter.post("/servers", async (req, res) => {
  const parsed = createServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const body = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  const userId = (req as unknown as { userId: string }).userId;

  // Determine auth method
  const sshAuthMethod = body.privateKey ? "key" : "password";

  // Encrypt credentials via envelope cipher
  let sshPasswordEncrypted: string | null = null;
  let sshPrivateKeyEncrypted: string | null = null;

  if (body.password) {
    sshPasswordEncrypted = encryptCredential(body.password);
  }
  if (body.privateKey) {
    sshPrivateKeyEncrypted = encryptCredential(body.privateKey);
  }

  let vpnStatus: string = "uninstalled";

  try {
    // Insert server row
    const [server] = await db
      .insert(servers)
      .values({
        id,
        label: body.label,
        host: body.host,
        port: body.port,
        sshUser: body.sshUser,
        sshAuthMethod,
        sshPassword: body.password ?? null,
        sshPrivateKey: body.privateKey ?? null,
        sshPasswordEncrypted,
        sshPrivateKeyEncrypted,
        scriptsPath: "",
        connectionType: "ssh",
        vpnStatus,
        createdAt: now,
      })
      .returning();

    // Probe for existing Amnezia installation
    try {
      // Dynamic import — vpn-install-probe is a Feature 016 service
      const { probeAmneziaInstalled } = await import(
        "../services/vpn-install-probe.js"
      );
      const installed = await probeAmneziaInstalled(id);
      if (installed) {
        vpnStatus = "installed";
        await db
          .update(servers)
          .set({ vpnStatus, vpnInstalledAt: new Date().toISOString() })
          .where(eq(servers.id, id));
      }
    } catch (err) {
      logger.warn(
        { ctx: "vpn-probe", serverId: id, err },
        "VPN install probe failed",
      );
    }

    // If requested and not already installed, mark as installing (deferred)
    if (body.installVpn && vpnStatus !== "installed") {
      vpnStatus = "installing";
      await db
        .update(servers)
        .set({ vpnStatus })
        .where(eq(servers.id, id));
    }

    // When storeCredentials=false, NULL out credential columns after probe/install
    if (!body.storeCredentials) {
      try {
        await db
          .update(servers)
          .set({
            sshPassword: null,
            sshPrivateKey: null,
            sshPasswordEncrypted: null,
            sshPrivateKeyEncrypted: null,
          })
          .where(eq(servers.id, id));
      } catch {
        // best-effort — credentials already used for probe
      }
    }

    // Re-fetch to get final state
    const [final] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, id))
      .limit(1);

    // Emit audit entry
    await db.insert(auditEntries).values({
      id: randomUUID(),
      userId,
      action: "vpn.server.create",
      targetType: "server",
      targetId: id,
      details: JSON.stringify({ label: body.label, host: body.host, vpnStatus }),
      result: "success",
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ server: sanitizeServer(final!) });
  } catch (err) {
    logger.error({ ctx: "vpn-server-create", err }, "Failed to create VPN server");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Failed to create server",
      },
    });
  }
});

// ── GET /servers — list VPN servers ──────────────────────────────────────────

vpnServersRouter.get("/servers", async (_req, res) => {
  const rows = await db
    .select({
      id: servers.id,
      label: servers.label,
      host: servers.host,
      port: servers.port,
      sshUser: servers.sshUser,
      vpnStatus: servers.vpnStatus,
      vpnDriftStatus: servers.vpnDriftStatus,
      vpnInstalledAt: servers.vpnInstalledAt,
      scriptsEnabled: servers.scriptsEnabled,
    })
    .from(servers);

  res.json({ servers: rows });
});

// ── DELETE /servers/:id — hard-delete VPN server ─────────────────────────────

vpnServersRouter.delete("/servers/:id", async (req, res) => {
  const id = req.params.id as string;
  const userId = (req as unknown as { userId: string }).userId;

  // Verify server exists
  const [existing] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Server not found" },
    });
    return;
  }

  // Delete (CASCADE handles script_runs)
  await db.delete(servers).where(eq(servers.id, id));

  // Emit audit entry
  await db.insert(auditEntries).values({
    id: randomUUID(),
    userId,
    action: "vpn.server.delete",
    targetType: "server",
    targetId: id,
    details: null,
    result: "success",
    timestamp: new Date().toISOString(),
  });

  res.status(204).end();
});
