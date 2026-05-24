import { eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { servers, applications, deployments } from "../db/schema.js";
import { createAuditEntry } from "../lib/audit.js";
import { serializeServer, serializeServers } from "../lib/serializer.js";

const GRACE_PERIOD_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export class ServerNotFoundError extends Error {
  override readonly name = "ServerNotFoundError";
  constructor(public readonly serverId: string) {
    super(`Server ${serverId} not found`);
  }
}

export class ServerAlreadyDeletedError extends Error {
  override readonly name = "ServerAlreadyDeletedError";
  constructor(public readonly serverId: string) {
    super(`Server ${serverId} is already soft-deleted`);
  }
}

export class ServerNotDeletedError extends Error {
  override readonly name = "ServerNotDeletedError";
  constructor(public readonly serverId: string) {
    super(`Server ${serverId} is not in archived state`);
  }
}

export class ConfirmNameMismatchError extends Error {
  override readonly name = "ConfirmNameMismatchError";
  constructor() {
    super("Confirmation name does not match server label");
  }
}

export class ActiveDeploymentsError extends Error {
  override readonly name = "ActiveDeploymentsError";
  constructor(public readonly serverId: string, public readonly count: number) {
    super(`Server has ${count} active application(s). Remove or migrate them first.`);
  }
}

export async function softDeleteServer(
  serverId: string,
  confirmName: string,
  actorId: string,
): Promise<void> {
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server) throw new ServerNotFoundError(serverId);
  if (server.deletedAt) throw new ServerAlreadyDeletedError(serverId);
  if (server.label !== confirmName) throw new ConfirmNameMismatchError();

  const activeApps = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.serverId, serverId));

  if (activeApps.length > 0) {
    throw new ActiveDeploymentsError(serverId, activeApps.length);
  }

  const now = new Date().toISOString();

  await db
    .update(servers)
    .set({ deletedAt: now, status: "offline" })
    .where(eq(servers.id, serverId));

  await createAuditEntry({
    actorId,
    action: "server.soft_deleted",
    resourceType: "server",
    resourceId: serverId,
    resourceName: server.label,
    metadata: { deletedAt: now, gracePeriodDays: GRACE_PERIOD_DAYS },
  });
}

export async function restoreServer(
  serverId: string,
  actorId: string,
): Promise<void> {
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server) throw new ServerNotFoundError(serverId);
  if (!server.deletedAt) throw new ServerNotDeletedError(serverId);

  await db
    .update(servers)
    .set({ deletedAt: null, status: "unknown" })
    .where(eq(servers.id, serverId));

  await createAuditEntry({
    actorId,
    action: "server.restored",
    resourceType: "server",
    resourceId: serverId,
    resourceName: server.label,
    metadata: { previousDeletedAt: server.deletedAt },
  });
}

export interface ArchivedServer {
  id: string;
  label: string;
  host: string;
  deletedAt: string;
  remainingDays: number;
  approachingDeadline: boolean;
}

export async function getArchivedServers(): Promise<ArchivedServer[]> {
  const rows = await db
    .select()
    .from(servers)
    .where(isNotNull(servers.deletedAt));

  const now = Date.now();

  return rows.map((row) => {
    const deletedMs = new Date(row.deletedAt!).getTime();
    const elapsed = now - deletedMs;
    const remainingDays = Math.max(0, Math.ceil((GRACE_PERIOD_DAYS * MS_PER_DAY - elapsed) / MS_PER_DAY));

    return {
      ...serializeServer(row),
      deletedAt: row.deletedAt!,
      remainingDays,
      approachingDeadline: remainingDays <= 7,
    };
  });
}

export { GRACE_PERIOD_DAYS, MS_PER_DAY };
