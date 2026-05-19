import { streamText, generateObject, type ToolCallPart, type ToolResultPart } from "ai";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  aiConversations,
  aiMessages,
  aiProviderKeys,
  aiSettings,
  aiToolCalls,
  auditEntries,
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

async function nextSeq(conversationId: string): Promise<number> {
  const [row] = await db
    .select({ maxSeq: sql<number>`coalesce(max(${aiMessages.seq}), -1)` })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId));
  return (row?.maxSeq ?? -1) + 1;
}

/**
 * Feature 013: Orchestrates AI incident analysis.
 * Handles context aggregation, LLM streaming, budget enforcement, and WS notification.
 */
export async function runIncidentAnalysis(conversationId: string) {
  logger.info({ ctx: "ai:incident-analyzer", conversationId }, "Starting AI analysis");

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
  try {
    await reserveTokens(conversationId, settings.perIncidentTokenCapIn);
  } catch (err) {
    await db.update(aiConversations)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(aiConversations.id, conversationId));
    logger.error({ ctx: "ai:incident-analyzer", err, conversationId }, "Reserve tokens failed");
    try {
      await db.insert(auditEntries).values({
        id: randomUUID(),
        userId: "system",
        action: "ai.analysis_failed",
        targetType: "ai_conversation",
        targetId: conversationId,
        details: JSON.stringify({ reason: "reserve_tokens_failed" }),
        result: "failure",
        timestamp: new Date().toISOString(),
      });
    } catch { /* audit best-effort */ }
    throw AppError.internal("Failed to reserve tokens");
  }

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
  const systemPrompt = await resolveSystemPrompt(conversationId);
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
    seq: await nextSeq(conversationId),
    contentText: contextDocument,
    createdAt: new Date().toISOString(),
  });

  const wsChannel = `ai:${conversationId}`;

  // 5. Start streaming
  const abortController = new AbortController();
  
  // Wall-clock safety net
  const timeoutId = setTimeout(() => {
    logger.warn({ ctx: "ai:incident-analyzer", conversationId }, "Analysis timed out");
    abortController.abort();
    db.update(aiConversations)
      .set({ status: "aborted_by_timeout" })
      .where(eq(aiConversations.id, conversationId))
      .execute()
      .catch((err) => logger.error({ ctx: "ai:incident-analyzer", err, conversationId }, "Timeout status update failed"));
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
        
        // C11: Use structured output instead of regex
        let hypothesis: string | null = null;
        let confidence: 'high' | 'medium' | 'low' | null = null;

        try {
          const structured = await generateObject({
            model,
            system: systemPrompt,
            prompt: `Extract the structured analysis from this incident report. If the report contains a hypothesis and confidence level, extract them. Otherwise, provide a summary as hypothesis with low confidence.\n\nIncident Report:\n${text}`,
            schema: z.object({
              hypothesis: z.string(),
              confidence: z.enum(['high', 'medium', 'low']),
              evidence: z.array(z.string()),
              recommended_actions: z.array(z.string()),
            }),
          });
          hypothesis = structured.object.hypothesis;
          confidence = structured.object.confidence;
        } catch (err) {
          logger.warn({ ctx: "ai:incident-analyzer", conversationId, err }, "Structured extraction failed, using text fallback");
          hypothesis = text.slice(0, 200).trim() + (text.length > 200 ? "..." : "");
          confidence = null;
        }

        await db.update(aiConversations)
          .set({
            status: "completed",
            hypothesis,
            confidence,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(aiConversations.id, conversationId));

        await reconcileTokens(conversationId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
        
        channelManager.broadcast(wsChannel, { 
          type: "complete", 
          usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } 
        });
        
        logger.info({ ctx: "ai:incident-analyzer", conversationId, usage }, "Analysis completed");
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
        logger.error({ ctx: "ai:incident-analyzer", toolName: tc.toolName }, "Unknown tool proposed by LLM");
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

      // H4: Emit audit for tool call proposal
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.tool_call_proposed",
          targetType: "ai_tool_call",
          targetId: toolCallId,
          details: JSON.stringify({ manifestId, conversationId, params: (tc as any).args }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }

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
      seq: await nextSeq(conversationId),
      contentText: assistantText,
      createdAt: new Date().toISOString(),
    });

  } catch (err) {
    clearTimeout(timeoutId);
    if (abortController.signal.aborted) {
       // Handled by timeout or external abort
       return;
    }
    
    logger.error({ ctx: "ai:incident-analyzer", conversationId, err }, "Analysis failed");
    
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
 * H5 step 2: Resume a conversation after a tool call has been executed.
 * Inserts the tool result as a message and re-invokes the LLM for further analysis.
 * Step 3 (wiring into dispatcher) is deferred.
 */
export async function resumeConversationWithToolResult(
  conversationId: string,
  toolCallId: string,
  resultPayload: unknown,
): Promise<void> {
  logger.info({ ctx: "ai:incident-analyzer", conversationId, toolCallId }, "Resuming conversation with tool result");

  // Insert tool result message
  const toolSeq = await nextSeq(conversationId);
  await db.insert(aiMessages).values({
    id: randomUUID(),
    conversationId,
    role: "tool",
    seq: toolSeq,
    contentText: JSON.stringify(resultPayload),
    contentMeta: { toolCallId },
    createdAt: new Date().toISOString(),
  });

  // Load conversation + settings + provider for re-invocation
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1);
  if (!conversation) throw AppError.notFound(`Conversation ${conversationId} not found`);

  const [settings] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1);
  if (!settings?.enabled) throw AppError.forbidden("AI Copilot is disabled");

  const [providerKey] = await db
    .select()
    .from(aiProviderKeys)
    .where(eq(aiProviderKeys.id, conversation.providerKeyId))
    .limit(1);
  if (!providerKey) throw AppError.notFound(`Provider key ${conversation.providerKeyId} not found`);

  const model = resolveModel(providerKey);
  const systemPrompt = await resolveSystemPrompt(conversationId);

  // Load full message history
  const messageHistory = await db
    .select()
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.seq);

  const wsChannel = `ai:${conversationId}`;

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: messageHistory.map(m => ({
        role: m.role as "user" | "assistant" | "tool",
        content: m.contentText ?? "",
      })) as any,
      tools: manifestToAiTools(),
      onFinish: async ({ usage, text }) => {
        // Persist additional assistant turn
        const assistantSeq = await nextSeq(conversationId);
        await db.insert(aiMessages).values({
          id: randomUUID(),
          conversationId,
          role: "assistant",
          seq: assistantSeq,
          contentText: text,
          createdAt: new Date().toISOString(),
        });

        await reconcileTokens(conversationId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
        channelManager.broadcast(wsChannel, { type: "complete", usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } });
        logger.info({ ctx: "ai:incident-analyzer", conversationId, usage }, "Resumed analysis completed");
      },
    });

    for await (const delta of result.textStream) {
      channelManager.broadcast(wsChannel, { type: "delta", content: delta });
    }
  } catch (err) {
    logger.error({ ctx: "ai:incident-analyzer", conversationId, err }, "Resumed analysis failed");
    await db.update(aiConversations)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(aiConversations.id, conversationId));
  }
}
