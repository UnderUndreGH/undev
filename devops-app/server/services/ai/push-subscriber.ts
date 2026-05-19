import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiSettings, aiConversations, aiProviderKeys } from "../../db/schema.js";
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

// Cleanup every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of dedupMap.entries()) {
    if (now - entry.firstEventAt > DEDUP_WINDOW_MS) {
      dedupMap.delete(key);
    }
  }
}, 60_000);

/**
 * Feature 013: Subscriber for high-severity events to trigger automatic AI analysis.
 */
export async function onPushEvent(opts: {
  targetKind: 'app' | 'server' | 'deployment' | 'cert' | 'script_run';
  targetId: string | null;
  eventClass: string;
}) {
  const key: DedupKey = `${opts.targetKind}::${opts.targetId ?? 'all'}::${opts.eventClass}`;
  
  // Synchronous critical section for dedup check-then-set
  const existing = dedupMap.get(key);
  const now = Date.now();

  if (existing && (now - existing.firstEventAt < DEDUP_WINDOW_MS)) {
    logger.info({ ctx: "push-subscriber", key }, "Event absorbed by existing dedup window");
    return;
  }

  // Check if AI is enabled globally
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
  if (!settings?.enabled || settings.globalKillSwitchEngaged) {
    return;
  }

  // Resolve active provider
  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.isActive, true))
    .limit(1);

  if (!providerKey) {
    return;
  }

  const conversationId = randomUUID();
  
  // Set dedup entry BEFORE async DB work to prevent races (Node.js single-thread sync part)
  dedupMap.set(key, { firstEventAt: now, conversationId });

  try {
    await db.insert(aiConversations).values({
      id: conversationId,
      trigger: "push",
      targetKind: opts.targetKind,
      targetId: opts.targetId,
      providerKeyId: providerKey.id,
      model: providerKey.modelDefault,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    logger.info({ ctx: "push-subscriber", conversationId, key }, "Starting automatic push analysis");
    
    // Fire and forget
    void runIncidentAnalysis(conversationId).catch(err => {
      logger.error({ ctx: "push-subscriber", conversationId, err }, "Async push analysis failed");
    });

  } catch (err) {
    logger.error({ ctx: "push-subscriber", err }, "Failed to create push conversation");
    dedupMap.delete(key);
  }
}
