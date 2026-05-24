import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { unifiedScriptAuditEntries } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const userId = (req as Request & { userId: string }).userId;
  if (!userId) {
    next(new AppError("forbidden", "Authentication required", 401));
    return;
  }
  next();
}

export async function auditScriptAction(input: {
  actorId: string;
  actorRole: "admin" | "user" | "system";
  action: string;
  scriptId?: string | null;
  scriptName?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(unifiedScriptAuditEntries).values({
    id: randomUUID(),
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.action,
    scriptId: input.scriptId ?? null,
    scriptName: input.scriptName ?? null,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}
