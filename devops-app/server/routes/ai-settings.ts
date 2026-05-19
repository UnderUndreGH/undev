import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiSettings } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { getOperatorId } from "../lib/get-operator-id.js";
import { randomUUID } from "node:crypto";

export const aiSettingsRouter = Router();

const settingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  defaultProvider: z.string().nullable().optional(),
  systemPromptContent: z.string().nullable().optional(),
  monthlyTokenBudgetIn: z.number().int().positive().optional(),
  monthlyTokenBudgetOut: z.number().int().positive().optional(),
  perIncidentTokenCapIn: z.number().int().positive().optional(),
  perIncidentTokenCapOut: z.number().int().positive().optional(),
  globalToolUseEnabled: z.boolean().optional(),
  defaultSandbox: z.boolean().optional(),
  conversationRetentionDays: z.number().int().min(1).optional(),
  maxConversationDurationMinutes: z.number().int().min(1).optional(),
});

// GET /api/ai/settings
aiSettingsRouter.get("/", async (req, res) => {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
  if (!row) {
    throw AppError.notFound("AI settings not found");
  }
  res.json(row);
});

// PUT /api/ai/settings
aiSettingsRouter.put("/", async (req, res) => {
  // requireAuth middleware guarantees userId is set
  const userId = getOperatorId(req);

  const parsed = settingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }

  await db
    .update(aiSettings)
    .set({
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(aiSettings.id, 1));

  res.json({ ok: true });
});

// PUT /api/ai/settings/kill-switch
aiSettingsRouter.put("/kill-switch", async (req, res) => {
  // requireAuth middleware guarantees userId is set
  const userId = getOperatorId(req);

  const schema = z.object({ engaged: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }

  await db
    .update(aiSettings)
    .set({
      globalKillSwitchEngaged: parsed.data.engaged,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(aiSettings.id, 1));

  res.json({ ok: true });
});
