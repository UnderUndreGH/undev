import { eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { servers, applications, backups, deployments } from "../db/schema.js";
import { createAuditEntry } from "../lib/audit.js";
import { logger } from "../lib/logger.js";

const GRACE_PERIOD_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface FinalizationResult {
  finalized: number;
  servers: Array<{ id: string; name: string; permanentDeletedAt: string }>;
}

export async function finalizeDeletedServers(): Promise<FinalizationResult> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString();

  const expired = await db
    .select({ id: servers.id, label: servers.label, deletedAt: servers.deletedAt })
    .from(servers)
    .where(isNotNull(servers.deletedAt));

  const eligible = expired.filter((s) => s.deletedAt! < cutoff);

  if (eligible.length === 0) {
    return { finalized: 0, servers: [] };
  }

  const results: FinalizationResult["servers"] = [];

  for (const server of eligible) {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(applications).where(eq(applications.serverId, server.id));
        await tx.delete(backups).where(eq(backups.serverId, server.id));
        await tx.delete(deployments).where(eq(deployments.serverId, server.id));
        await tx.delete(servers).where(eq(servers.id, server.id));
      });

      const now = new Date().toISOString();
      results.push({ id: server.id, name: server.label, permanentDeletedAt: now });

      await createAuditEntry({
        actorId: "system",
        actorType: "system",
        action: "server.permanent_deleted",
        resourceType: "server",
        resourceId: server.id,
        resourceName: server.label,
        metadata: { permanentDeletedAt: now },
      });
    } catch (err) {
      logger.error(
        { ctx: "server-finalizer", serverId: server.id, err },
        "Failed to finalize server — will retry next run",
      );
    }
  }

  return { finalized: results.length, servers: results };
}
