import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiToolCalls, aiConversations, servers, applications, auditEntries } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { dispatchApprovedToolCall } from "../services/ai/tool-call-dispatcher.js";
import { getOperatorId } from "../lib/get-operator-id.js";
import { manifest } from "../scripts-manifest.js";
import { randomUUID } from "node:crypto";

export const aiToolCallsRouter = Router();

// Store for pending high-danger challenges (in-memory v1)
type ChallengeEntry = {
  toolCallId: string;
  expiresAt: number;
  createdAt: number;
};
const pendingChallenges = new Map<string, ChallengeEntry>();

// Cleanup expired challenges every 60s
let challengeCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startChallengeCleanup() {
  if (challengeCleanupTimer) return;
  challengeCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pendingChallenges.entries()) {
      if (entry.expiresAt < now) {
        pendingChallenges.delete(key);
      }
    }
  }, 60_000);
}

export function stopChallengeCleanup() {
  if (challengeCleanupTimer) {
    clearInterval(challengeCleanupTimer);
    challengeCleanupTimer = null;
  }
}

// POST /api/ai/tool-calls/:id/challenge
aiToolCallsRouter.post("/:id/challenge", async (req, res) => {
  const [tc] = await db.select().from(aiToolCalls).where(eq(aiToolCalls.id, req.params.id)).limit(1);
  if (!tc) throw AppError.notFound();

  const entry = manifest.find(m => m.id === tc.manifestId);
  if (!entry || entry.dangerLevel !== "high") {
    throw AppError.badRequest("Challenge only available for high-danger tool calls");
  }

  const challengeId = randomUUID();
  const now = Date.now();
  pendingChallenges.set(challengeId, {
    toolCallId: tc.id,
    expiresAt: now + 60_000, // 1 min expiry
    createdAt: now,
  });

  res.json({ challengeId, cooldownSeconds: 5 });
});

// POST /api/ai/tool-calls/:id/approve
aiToolCallsRouter.post("/:id/approve", async (req, res) => {
  const userId = getOperatorId(req);
  const { paramsOverride, challengeId, ackText, typedTarget } = req.body;

  const [tc] = await db.select().from(aiToolCalls).where(eq(aiToolCalls.id, req.params.id)).limit(1);
  if (!tc) throw AppError.notFound();

  // Look up manifest entry for danger level
  const entry = manifest.find(m => m.id === tc.manifestId);
  const dangerLevel = entry?.dangerLevel ?? "low";

  // Danger-tier enforcement
  if (dangerLevel === "high") {
    if (!challengeId) {
      throw AppError.forbidden("High-danger action requires valid challenge");
    }
    const challenge = pendingChallenges.get(challengeId);
    if (!challenge || challenge.toolCallId !== tc.id || challenge.expiresAt < Date.now()) {
      throw AppError.forbidden("High-danger action requires valid challenge");
    }
    // Cooldown enforcement: 5-second delay after challenge creation
    if (Date.now() - challenge.createdAt < 5_000) {
      throw AppError.forbidden("Challenge cooldown not yet elapsed");
    }
    // typedTarget must match the actual target server/app name
    if (!typedTarget || typeof typedTarget !== "string") {
      throw AppError.badRequest("High-danger action requires typed target confirmation");
    }
    const expectedNames: string[] = [];
    if (tc.targetServerId) {
      const [srv] = await db
        .select({ label: servers.label })
        .from(servers)
        .where(eq(servers.id, tc.targetServerId))
        .limit(1);
      if (srv) expectedNames.push(srv.label);
    }
    if (tc.targetAppId) {
      const [app] = await db
        .select({ name: applications.name })
        .from(applications)
        .where(eq(applications.id, tc.targetAppId))
        .limit(1);
      if (app) expectedNames.push(app.name);
    }
    if (expectedNames.length === 0 || !expectedNames.includes(typedTarget)) {
      // Audit the mismatch before throwing
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.tool_call_blocked_by_policy",
          targetType: "ai_tool_call",
          targetId: tc.id,
          details: JSON.stringify({ reason: "typed_target_mismatch", typedTarget, expectedNames }),
          result: "failure",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }
      throw AppError.forbidden("Typed target does not match the action target");
    }
    // Consume the challenge
    pendingChallenges.delete(challengeId);
  } else if (dangerLevel === "medium") {
    if (ackText !== "approve") {
      throw AppError.badRequest("Medium-danger action requires ackText='approve'");
    }
  }
  // low danger: no extra checks

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
  const userId = getOperatorId(req);
  
  await db.update(aiToolCalls)
    .set({
      status: "rejected",
      decidedBy: userId,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(aiToolCalls.id, req.params.id));

  res.json({ ok: true });
});
