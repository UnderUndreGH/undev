import { streamText, type ToolCallPart, type ToolResultPart } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  aiConversations,
  aiMessages,
  aiProviderKeys,
  aiSettings,
  aiToolCalls,
} from "../../db/schema.js";
import { resolveModel } from "./providers.js";
import { aggregateContext } from "./context-aggregator.js";
import {
  checkMonthlyBudget,
  reconcileTokens,
  reserveTokens,
} from "./budget-enforcer.js";
import { resolveSystemPrompt } from "./system-prompt.js";
import { manifestToAiTools, aiToolNameToManifestId } from "../../lib/ai-tool-registry.js";
import { channelManager } from "../../ws/channels.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/app-error.js";
import { randomUUID } from "node:crypto";

/**
 * Feature 013: Orchestrates AI incident analysis.
 * Handles context aggregation, LLM streaming, budget enforcement, and WS notification.
 */
export async function runIncidentAnalysis(conversationId: string) {
  logger.info({ ctx: "incident-analyzer", conversationId }, "Starting AI analysis");

  // 1. Load conversation and settings
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1);

  if (!conversation) {
    throw AppError.notFound(`Conversation ${conversationId} not found`);
  }

  const [settings] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1);

  if (!settings?.enabled) {
    throw AppError.forbidden("AI Copilot is disabled");
  }

  // 2. Enforce budgets
  const budget = await checkMonthlyBudget();
  if (!budget.allowed) {
    throw AppError.budgetExhausted();
  }

  // Reserve tokens (conservative estimate: per-incident cap)
  await reserveTokens(conversationId, settings.perIncidentTokenCapIn);

  // 3. Resolve model and context
  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.id, conversation.providerKeyId))
    .limit(1);

  if (!providerKey) {
    throw AppError.notFound(`Provider key ${conversation.providerKeyId} not found`);
  }

  const model = resolveModel(providerKey);
  const systemPrompt = await resolveSystemPrompt();
  const contextDocument = await aggregateContext(
    conversation.targetKind,
    conversation.targetId,
  );

  // 4. Persistence of initial context as user message
  const userMsgId = randomUUID();
  await db.insert(aiMessages).values({
    id: userMsgId,
    conversationId,
    role: "user",
    seq: 0,
    contentText: contextDocument,
    createdAt: new Date().toISOString(),
  });

  const wsChannel = `ai:${conversationId}`;

  // 5. Start streaming
  const abortController = new AbortController();
  
  // Wall-clock safety net
  const timeoutId = setTimeout(() => {
    logger.warn({ ctx: "incident-analyzer", conversationId }, "Analysis timed out");
    abortController.abort();
    db.update(aiConversations)
      .set({ status: "aborted_by_timeout" })
      .where(eq(aiConversations.id, conversationId))
      .execute();
  }, settings.maxConversationDurationMinutes * 60 * 1000);

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: contextDocument }],
      tools: manifestToAiTools(),
      abortSignal: abortController.signal,
      onFinish: async ({ usage, text }) => {

        clearTimeout(timeoutId);
        
        // Final updates
        const hypothesis = extractHypothesis(text);
        const confidence = extractConfidence(text);
        
        await db.update(aiConversations)
          .set({
            status: "completed",
            hypothesis,
            confidence: confidence as any,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(aiConversations.id, conversationId));

        await reconcileTokens(conversationId, usage.inputTokens || 0, usage.outputTokens || 0);
        
        channelManager.broadcast(wsChannel, { 
          type: "complete", 
          usage: { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 } 
        });
        
        logger.info({ ctx: "incident-analyzer", conversationId, usage }, "Analysis completed");
      },
    });

    // Stream text deltas
    for await (const delta of result.textStream) {
      channelManager.broadcast(wsChannel, { type: "delta", content: delta });
    }

    // Intercept tool calls
    const toolCalls = await result.toolCalls;
    for (const tc of toolCalls) {
      const toolCallId = randomUUID();
      const manifestId = aiToolNameToManifestId(tc.toolName);
      
      if (!manifestId) {
        logger.error({ ctx: "incident-analyzer", toolName: tc.toolName }, "Unknown tool proposed by LLM");
        continue;
      }

      await db.insert(aiToolCalls).values({
        id: toolCallId,
        conversationId,
        manifestId,
        paramsJson: (tc as any).args,
        status: "proposed",
        createdAt: new Date().toISOString(),
      });

      channelManager.broadcast(wsChannel, { 
        type: "tool_call", 
        toolCall: { id: toolCallId, manifestId, params: (tc as any).args, status: "proposed" } 
      });
    }

    // Persist assistant message
    const assistantText = await result.text;
    await db.insert(aiMessages).values({
      id: randomUUID(),
      conversationId,
      role: "assistant",
      seq: 1,
      contentText: assistantText,
      createdAt: new Date().toISOString(),
    });

  } catch (err) {
    clearTimeout(timeoutId);
    if (abortController.signal.aborted) {
       // Handled by timeout or external abort
       return;
    }
    
    logger.error({ ctx: "incident-analyzer", conversationId, err }, "Analysis failed");
    
    await db.update(aiConversations)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(aiConversations.id, conversationId));
      
    channelManager.broadcast(wsChannel, { 
      type: "error", 
      message: err instanceof Error ? err.message : String(err) 
    });
  }
}

/**
 * Regex-based extraction of hypothesis from LLM response.
 * Expects "## Hypothesis\n[text]" format.
 */
function extractHypothesis(text: string): string | null {
  const match = text.match(/## Hypothesis\s*\n([\s\S]+?)(?:\n\n|\n\*\*|$)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  // Fallback: first 200 chars
  return text.slice(0, 200).trim() + (text.length > 200 ? "..." : "");
}

/**
 * Regex-based extraction of confidence level.
 * Expects "**Confidence**: [high|medium|low]" format.
 */
function extractConfidence(text: string): string | null {
  const match = text.match(/\*\*Confidence\*\*:\s*(high|medium|low)/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return null;
}
