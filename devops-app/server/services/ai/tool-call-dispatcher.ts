import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  aiConversations,
  aiToolCalls,
  servers,
} from "../../db/schema.js";
import { scriptsRunner } from "../scripts-runner.js";
import { manifest } from "../../scripts-manifest.js";
import { getSandboxFixture } from "./sandbox-fixtures.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/app-error.js";

/**
 * Feature 013: Dispatches approved AI tool calls to the scripts runner.
 * Checks server-level AI policies before execution.
 */
export async function dispatchApprovedToolCall(toolCallId: string, operatorId: string) {
  const [tc] = await db
    .select()
    .from(aiToolCalls)
    .where(eq(aiToolCalls.id, toolCallId))
    .limit(1);

  if (!tc) throw AppError.notFound("Tool call not found");
  if (tc.status !== "approved") throw AppError.badRequest("Tool call is not approved");

  const [convo] = await db
    .select()
    .from(aiConversations)
    .where(eq(aiConversations.id, tc.conversationId))
    .limit(1);

  if (!convo) throw AppError.notFound("Conversation not found");

  // Server policy check
  if (tc.targetServerId) {
    const [server] = await db
      .select({ aiWriteAccess: servers.aiWriteAccess })
      .from(servers)
      .where(eq(servers.id, tc.targetServerId))
      .limit(1);

    if (!server) throw AppError.notFound("Target server not found");
    
    if (server.aiWriteAccess === "disabled") {
      throw AppError.forbidden("AI write access is disabled for this server");
    }
    if (server.aiWriteAccess === "sandbox-only" && !tc.dry_run && !convo.sandboxMode) {
       throw AppError.forbidden("This server only allows sandbox (dry-run) AI actions");
    }
  }

  // Handle Sandbox / Dry-run
  if (convo.sandboxMode || tc.dry_run) {
     const fixture = getSandboxFixture(tc.manifestId);
     logger.info({ ctx: "tool-dispatcher", toolCallId, dryRun: true }, "Executing sandbox fixture");
     
     await db.update(aiToolCalls)
       .set({ 
         status: "completed", 
         executedAt: new Date().toISOString(),
       })
       .where(eq(aiToolCalls.id, toolCallId));
       
     return fixture;
  }

  // Real execution
  logger.info({ ctx: "tool-dispatcher", toolCallId }, "Dispatching real tool execution");
  
  await db.update(aiToolCalls).set({ status: "executing" }).where(eq(aiToolCalls.id, toolCallId));

  const { runId } = await scriptsRunner.runScript(
    tc.manifestId,
    tc.targetServerId!, // Assumed non-null for now, or use a default
    tc.paramsJson as Record<string, unknown>,
    operatorId,
    {
      initiatedBy: "ai_proposal",
      aiConversationId: convo.id,
      aiToolCallId: tc.id,
    }
  );

  await db.update(aiToolCalls)
    .set({ 
       scriptRunId: runId,
       status: "executing", // Will be updated to completed/failed by scriptsRunner terminal status hook
    })
    .where(eq(aiToolCalls.id, toolCallId));

  return { runId };
}
