import { eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiConversations, aiSettings } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";

/**
 * Feature 013: Soft-delete/Archive logic for old conversations.
 */
export async function archiveOldConversations() {
  const [settings] = await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).limit(1);
  const retentionDays = settings?.conversationRetentionDays ?? 90;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();

  const result = await db
    .update(aiConversations)
    .set({ archivedAt: new Date().toISOString() })
    .where(sql`${aiConversations.createdAt} < ${cutoff} AND ${aiConversations.archivedAt} IS NULL`)
    .returning({ id: aiConversations.id });

  if (result.length > 0) {
    logger.info({ ctx: "archiver", count: result.length }, "Archived old AI conversations");
  }
}

let archiveTimer: NodeJS.Timeout | null = null;

export function startArchiverCron() {
  if (archiveTimer) return;
  // Run every 24h
  archiveTimer = setInterval(() => {
    archiveOldConversations().catch(err => logger.error({ ctx: "archiver", err }, "Archive cron failed"));
  }, 24 * 3600 * 1000);
}
