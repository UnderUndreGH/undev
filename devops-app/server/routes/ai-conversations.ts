import { Router } from "express";
import { z } from "zod";
import { eq, and, desc, sql, inArray, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { aiConversations, aiMessages, aiProviderKeys, aiSettings, aiToolCalls, servers, applications } from "../db/schema.js";
import { AppError } from "../lib/app-error.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { runIncidentAnalysis } from "../services/ai/incident-analyzer.js";
import { manifest } from "../scripts-manifest.js";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";

export const aiConversationsRouter = Router();

const createConversationSchema = z.object({
  targetKind: z.enum(['app', 'server', 'deployment', 'audit_event', 'cert', 'script_run', 'manual', 'compose_review']),
  targetId: z.string().nullable(),
});

// C18: Zod schema for query filter enums
const conversationQuerySchema = z.object({
  trigger: z.enum(['pull', 'push']).optional(),
  targetKind: z.enum(['app', 'server', 'deployment', 'audit_event', 'cert', 'script_run', 'manual', 'compose_review']).optional(),
  status: z.enum(['pending', 'streaming', 'completed', 'error', 'cap_exhausted', 'aborted_by_kill_switch', 'provider_rate_limited', 'aborted_by_timeout', 'aborted_by_operator']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /api/ai/conversations
aiConversationsRouter.get("/", async (req, res) => {
  const parsed = conversationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.badRequest(parsed.error.message);
  }
  const { trigger, targetKind, status, q, limit, offset } = parsed.data;
  const conditions = [];
  if (trigger) conditions.push(eq(aiConversations.trigger, trigger));
  if (targetKind) conditions.push(eq(aiConversations.targetKind, targetKind));
  if (status) conditions.push(eq(aiConversations.status, status));
  if (q) {
    conditions.push(sql`to_tsvector('english', ${aiConversations.hypothesis}) @@ plainto_tsquery('english', ${q})`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(aiConversations)
    .where(where)
    .orderBy(desc(aiConversations.createdAt))
    .limit(limit)
    .offset(offset);

  // Return total count when offset is 0 for UI pagination
  let total: number | undefined;
  if (offset === 0) {
    const [countRow] = await db
      .select({ total: count() })
      .from(aiConversations)
      .where(where);
    total = countRow?.total;
  }

  res.json({ rows, ...(total !== undefined ? { total } : {}) });
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
    .orderBy(desc(aiProviderKeys.createdAt))
    .limit(1);

  if (!providerKey) {
    throw AppError.badRequest("No active AI provider configured");
  }

  // H2: Check for existing in-flight conversation for same target
  const inFlightConditions = [
    eq(aiConversations.targetKind, parsed.data.targetKind),
    ...(parsed.data.targetId != null
      ? [eq(aiConversations.targetId, parsed.data.targetId)]
      : [sql`${aiConversations.targetId} IS NULL`]),
    inArray(aiConversations.status, ['pending', 'streaming']),
  ];
  const [existing] = await db
    .select()
    .from(aiConversations)
    .where(and(...inFlightConditions))
    .limit(1);

  if (existing) {
    res.setHeader('X-Existing-Conversation', 'true');
    res.status(200).json({ id: existing.id });
    return;
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
    logger.error({ ctx: "ai:conversations", err, conversationId: id }, "Async analysis failure");
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

  // C20+C22: Enrich tool calls with manifest data (dangerLevel) and target names
  const enrichedToolCalls = await Promise.all(toolCalls.map(async tc => {
    const entry = manifest.find(m => m.id === tc.manifestId);
    let targetServerName: string | null = null;
    let targetAppName: string | null = null;
    if (tc.targetServerId) {
      const [srv] = await db.select({ name: servers.label }).from(servers).where(eq(servers.id, tc.targetServerId)).limit(1);
      targetServerName = srv?.name ?? null;
    }
    if (tc.targetAppId) {
      const [app] = await db.select({ name: applications.name }).from(applications).where(eq(applications.id, tc.targetAppId)).limit(1);
      targetAppName = app?.name ?? null;
    }
    return {
      ...tc,
      dangerLevel: entry?.dangerLevel ?? "low",
      targetServerName,
      targetAppName,
    };
  }));

  res.json({
    ...conversation,
    messages,
    toolCalls: enrichedToolCalls,
  });
});
