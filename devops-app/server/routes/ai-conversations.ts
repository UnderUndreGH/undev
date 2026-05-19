import { Router } from "express";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiConversations, aiMessages, aiProviderKeys, aiSettings, aiToolCalls } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { runIncidentAnalysis } from "../services/ai/incident-analyzer.js";
import { randomUUID } from "node:crypto";

export const aiConversationsRouter = Router();

const createConversationSchema = z.object({
  targetKind: z.enum(['app', 'server', 'deployment', 'audit_event', 'cert', 'script_run', 'manual', 'compose_review']),
  targetId: z.string().nullable(),
});

// GET /api/ai/conversations
aiConversationsRouter.get("/", async (req, res) => {
  const { trigger, targetKind, status, q } = req.query;
  const conditions = [];
  if (trigger) conditions.push(eq(aiConversations.trigger, trigger as any));
  if (targetKind) conditions.push(eq(aiConversations.targetKind, targetKind as any));
  if (status) conditions.push(eq(aiConversations.status, status as any));
  if (q) {
     // FTS search
     conditions.push(sql`to_tsvector('english', ${aiConversations.hypothesis}) @@ plainto_tsquery('english', ${q as string})`);
  }

  const rows = await db
    .select()
    .from(aiConversations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiConversations.createdAt))
    .limit(50);
    
  res.json(rows);
});

// POST /api/ai/conversations (Start analysis)
aiConversationsRouter.post("/", rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }

  // Check if active provider exists
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1));
  if (!settings?.enabled) throw AppError.forbidden("AI Copilot disabled");

  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.isActive, true))
    .limit(1);

  if (!providerKey) {
    throw AppError.badRequest("No active AI provider configured");
  }

  const id = randomUUID();
  await db.insert(aiConversations).values({
    id,
    trigger: "pull",
    targetKind: parsed.data.targetKind,
    targetId: parsed.data.targetId,
    providerKeyId: providerKey.id,
    model: providerKey.modelDefault,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Start background analysis
  void runIncidentAnalysis(id).catch(err => {
    console.error(`[AI] Async analysis failure for ${id}:`, err);
  });

  res.status(201).json({ id });
});

// GET /api/ai/conversations/:id
aiConversationsRouter.get("/:id", async (req, res) => {
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.id, req.params.id))
    .limit(1);

  if (!conversation) throw AppError.notFound();

  const messages = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, req.params.id))
    .orderBy(aiMessages.seq);

  const toolCalls = await db
    .select()
    .from(aiToolCalls)
    .where(eq(aiToolCalls.conversationId, req.params.id));

  res.json({
    ...conversation,
    messages,
    toolCalls,
  });
});
