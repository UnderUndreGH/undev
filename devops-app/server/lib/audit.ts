import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { auditEntries } from "../db/schema.js";

export interface CreateAuditEntryInput {
  actorType?: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

export async function createAuditEntry(input: CreateAuditEntryInput): Promise<void> {
  await db.insert(auditEntries).values({
    id: randomUUID(),
    userId: input.actorId,
    action: input.action,
    targetType: input.resourceType,
    targetId: input.resourceId,
    details: JSON.stringify({
      resourceName: input.resourceName,
      actorType: input.actorType ?? "operator",
      ...input.metadata,
    }),
    result: "success",
    timestamp: new Date().toISOString(),
  });
}
