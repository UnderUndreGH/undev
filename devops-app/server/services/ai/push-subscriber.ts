import { eq, and, gt, sql, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiSettings, aiConversations, aiProviderKeys, aiMessages, auditEntries, notificationPreferences } from "../../db/schema.js";
import { runIncidentAnalysis } from "./incident-analyzer.js";
import { logger } from "../../lib/logger.js";
import { randomUUID } from "node:crypto";

type DedupKey = `${string}::${string}::${string}`; // targetKind::targetId::eventClass
type DedupEntry = {
  firstEventAt: number;
  conversationId: string;
};

const dedupMap = new Map<DedupKey, DedupEntry>();
const DEDUP_WINDOW_MS = 300_000; // 5 minutes

const TERMINAL_STATUSES = new Set([
  "completed",
  "error",
  "cap_exhausted",
  "aborted_by_kill_switch",
  "provider_rate_limited",
  "aborted_by_timeout",
]);

const IN_FLIGHT_STATUSES = new Set([
  "pending",
  "streaming",
]);

// Lifecycle-managed dedup cleanup timer (matches ai-tool-calls.ts challenge pattern)
let dedupCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startPushDedupCleanup(): void {
  if (dedupCleanupTimer) return;
  dedupCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of dedupMap.entries()) {
      if (now - entry.firstEventAt > DEDUP_WINDOW_MS) {
        dedupMap.delete(key);
      }
    }
  }, 60_000);
}

export function stopPushDedupCleanup(): void {
  if (dedupCleanupTimer) {
    clearInterval(dedupCleanupTimer);
    dedupCleanupTimer = null;
  }
}

/**
 * Feature 013: Subscriber for high-severity events to trigger automatic AI analysis.
 */
export async function onPushEvent(opts: {
  targetKind: 'app' | 'server' | 'deployment' | 'cert' | 'script_run';
  targetId: string | null;
  eventClass: string;
}) {
  const key: DedupKey = `${opts.targetKind}::${opts.targetId ?? 'all'}::${opts.eventClass}`;
  const now = Date.now();

  // Track prior conversation for FR-017 spawn linkage
  let priorConversationId: string | null = null;
  let isPostDedupSpawn = false;

  // Check dedup map SYNCHRONOUSLY before any await
  const existing = dedupMap.get(key);

  if (existing && (now - existing.firstEventAt < DEDUP_WINDOW_MS)) {
    // C2: FR-017 absorb/spawn semantics — check the existing conversation's status
    const [existingConvo] = await db
      .select({ status: aiConversations.status })
      .from(aiConversations)
      .where(eq(aiConversations.id, existing.conversationId))
      .limit(1);

    if (existingConvo && IN_FLIGHT_STATUSES.has(existingConvo.status)) {
      // Absorb: append tool message to in-flight conversation
      const [maxSeq] = await db
        .select({ maxSeq: sql<number>`coalesce(max(${aiMessages.seq}), -1)` })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, existing.conversationId));
      const nextSeq = (maxSeq?.maxSeq ?? -1) + 1;

      await db.insert(aiMessages).values({
        id: randomUUID(),
        conversationId: existing.conversationId,
        role: "tool",
        seq: nextSeq,
        contentText: JSON.stringify(opts),
        createdAt: new Date().toISOString(),
      });

      // Emit audit
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.push_event_absorbed_by_in_flight",
          targetType: "ai_conversation",
          targetId: existing.conversationId,
          details: JSON.stringify({ eventClass: opts.eventClass, dedupKey: key }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error({ ctx: "ai:push-subscriber", err }, "Audit emit failed for absorbed event");
      }

      logger.info({ ctx: "ai:push-subscriber", key, conversationId: existing.conversationId }, "Event absorbed by in-flight conversation");
      return;
    }

    if (existingConvo && TERMINAL_STATUSES.has(existingConvo.status)) {
      // Spawn new conversation with prior_conversation_id linkage
      priorConversationId = existing.conversationId;
      isPostDedupSpawn = true;
      logger.info({ ctx: "ai:push-subscriber", key, priorConversationId: existing.conversationId }, "Spawning new conversation after terminal dedup hit");
      // Don't return — fall through to create a new conversation
    } else {
      logger.info({ ctx: "ai:push-subscriber", key }, "Event absorbed by existing dedup window (unknown status)");
      return;
    }
  }

  // C1: Generate UUID and set dedup IMMEDIATELY, before any await
  // This prevents race conditions: two concurrent calls cannot both pass the dedup check
  const conversationId = randomUUID();
  dedupMap.set(key, { firstEventAt: now, conversationId });

  // Check if AI is enabled globally
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
  if (!settings?.enabled || settings.globalKillSwitchEngaged) {
    dedupMap.delete(key);
    return;
  }

  // C12: Check notification_preferences for this event class
  try {
    const [pref] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.eventType, opts.eventClass))
      .limit(1);
    if (pref && !pref.enabled) {
      logger.info({ ctx: "ai:push-subscriber", eventClass: opts.eventClass }, "Event class disabled in notification preferences");
      dedupMap.delete(key);
      return;
    }
  } catch (err) {
    logger.error({ ctx: "ai:push-subscriber", err }, "Failed to check notification preferences");
  }

  // Resolve active provider
  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.isActive, true))
    .orderBy(desc(aiProviderKeys.createdAt))
    .limit(1);

  if (!providerKey) {
    dedupMap.delete(key);
    return;
  }

  try {
    await db.insert(aiConversations).values({
      id: conversationId,
      trigger: "push",
      targetKind: opts.targetKind,
      targetId: opts.targetId,
      providerKeyId: providerKey.id,
      model: providerKey.modelDefault,
      status: "pending",
      priorConversationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    logger.info({ ctx: "ai:push-subscriber", conversationId, key, isPostDedupSpawn, priorConversationId }, "Starting automatic push analysis");

    // Emit audit for new conversation
    try {
      await db.insert(auditEntries).values({
        id: randomUUID(),
        userId: "system",
        action: isPostDedupSpawn ? "ai.push_event_new_conversation_post_dedup" : "ai.push_event_created",
        targetType: "ai_conversation",
        targetId: conversationId,
        details: JSON.stringify({ eventClass: opts.eventClass, dedupKey: key, priorConversationId }),
        result: "success",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ ctx: "ai:push-subscriber", err }, "Audit emit failed for new conversation");
    }

    // Fire and forget
    void runIncidentAnalysis(conversationId).catch(err => {
      logger.error({ ctx: "ai:push-subscriber", conversationId, err }, "Async push analysis failed");
    });

  } catch (err) {
    logger.error({ ctx: "ai:push-subscriber", err }, "Failed to create push conversation");
    dedupMap.delete(key);
  }
}
