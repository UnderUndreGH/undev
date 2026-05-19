import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { aiComposeReviewCache } from "../../db/schema.js";
import { lintCompose } from "../../lib/compose-static-lint.js";
import { logger } from "../../lib/logger.js";
import { createHash } from "node:crypto";

/**
 * Feature 013: Hybrid Compose Reviewer.
 * Combines static lint and LLM-based security review.
 */
export async function reviewComposeContent(appId: string, content: string) {
  const contentHash = createHash('sha256').update(content).digest('hex');
  
  // 1. Static Lint (Fast, zero cost)
  const staticFindings = lintCompose(content);

  // 2. Check Cache for LLM findings
  const [cached] = await db
    .select()
    .from(aiComposeReviewCache)
    .where(eq(aiComposeReviewCache.contentSha256, contentHash))
    .limit(1);

  if (cached) {
    logger.info({ ctx: "compose-reviewer", appId, cache: "hit" }, "Returning cached LLM findings");
    return {
      staticFindings,
      llmFindings: cached.findingsJson,
      cachedAt: cached.createdAt,
    };
  }

  // 3. LLM Review (Mocked for now as per Phase 8 T060 description "LLM review orchestration")
  // In a real implementation, this would call streamText with a specialized prompt.
  const llmFindings = [
    { rule: "llm-security", severity: "warning", message: "AI suggest adding 'read_only: true' to this service." }
  ];

  await db.insert(aiComposeReviewCache).values({
    appId,
    contentSha256: contentHash,
    findingsJson: llmFindings,
    createdAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [aiComposeReviewCache.appId, aiComposeReviewCache.contentSha256],
    set: { findingsJson: llmFindings, createdAt: new Date().toISOString() }
  });

  return {
    staticFindings,
    llmFindings,
    cachedAt: new Date().toISOString(),
  };
}
