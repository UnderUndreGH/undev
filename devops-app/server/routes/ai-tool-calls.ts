import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiToolCalls, aiConversations } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { dispatchApprovedToolCall } from "../services/ai/tool-call-dispatcher.js";
import { randomUUID } from "node:crypto";

export const aiToolCallsRouter = Router();

// Store for pending high-danger challenges (in-memory v1)
const pendingChallenges = new Map<string, { toolCallId: string, expiresAt: number }>();

// POST /api/ai/tool-calls/:id/challenge
aiToolCallsRouter.post("/:id/challenge", async (req, res) => {
  const [tc] = await db.select().from(aiToolCalls).where(eq(aiToolCalls.id, req.params.id)).limit(1);
  if (!tc) throw AppError.notFound();

  const challengeId = randomUUID();
  pendingChallenges.set(challengeId, {
    toolCallId: tc.id,
    expiresAt: Date.now() + 60000, // 1 min expiry
  });

  res.json({ challengeId, cooldownSeconds: 5 });
});

// POST /api/ai/tool-calls/:id/approve
aiToolCallsRouter.post("/:id/approve", async (req, res) => {
  const { userId } = (req as any);
  const { paramsOverride, challengeId } = req.body;

  const [tc] = await db.select().from(aiToolCalls).where(eq(aiToolCalls.id, req.params.id)).limit(1);
  if (!tc) throw AppError.notFound();

  // Validate challenge if high danger (mocked for now)
  // if (tc.dangerLevel === 'high' && !challengeId) throw AppError.badRequest("High danger requires challenge");

  await db.update(aiToolCalls)
    .set({
      status: "approved",
      decidedBy: userId,
      decidedAt: new Date().toISOString(),
      paramsJson: paramsOverride ?? tc.paramsJson,
    })
    .where(eq(aiToolCalls.id, tc.id));

  const result = await dispatchApprovedToolCall(tc.id, userId);
  res.json(result);
});

// POST /api/ai/tool-calls/:id/reject
aiToolCallsRouter.post("/:id/reject", async (req, res) => {
  const { userId } = (req as any);
  
  await db.update(aiToolCalls)
    .set({
      status: "rejected",
      decidedBy: userId,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(aiToolCalls.id, req.params.id));

  res.json({ ok: true });
});
