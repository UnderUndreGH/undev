import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  aiConversations,
  aiMessages,
  aiToolCalls,
  auditEntries,
  servers,
} from "../../db/schema.js";
import { scriptsRunner } from "../scripts-runner.js";
import { manifest } from "../../scripts-manifest.js";
import { getSandboxFixture } from "./sandbox-fixtures.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../lib/app-error.js";
import { randomUUID } from "node:crypto";

/**
 * Emit an audit entry for tool-call lifecycle events.
 */
async function emitToolCallAudit(
  action: string,
  toolCallId: string,
  operatorId: string,
  details: Record<string, unknown>,
  result: "success" | "failure" = "success",
): Promise<void> {
  try {
    await db.insert(auditEntries).values({
      id: randomUUID(),
      userId: operatorId,
      action,
      targetType: "ai_tool_call",
      targetId: toolCallId,
      details: JSON.stringify(details),
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ ctx: "ai:tool-dispatcher", action, toolCallId, err }, "Audit emit failed");
  }
}

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

  // Look up manifest entry for validation and locus info
  const entry = manifest.find(m => m.id === tc.manifestId);
  if (!entry) {
    throw AppError.badRequest(`Unknown manifest ID: ${tc.manifestId}`);
  }

  // C3: Re-validate params with Zod at dispatch boundary
  const parsed = entry.params.safeParse(tc.paramsJson);
  if (!parsed.success) {
    await db.update(aiToolCalls)
      .set({ status: "failed" })
      .where(eq(aiToolCalls.id, toolCallId));
    await emitToolCallAudit("ai.tool_call_failed", toolCallId, operatorId, {
      reason: "param_validation_failed",
      errors: parsed.error.message,
    }, "failure");
    throw AppError.badRequest(`Parameter validation failed: ${parsed.error.message}`);
  }
  const validatedParams = parsed.data;

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
      await emitToolCallAudit("ai.tool_call_blocked_by_policy", toolCallId, operatorId, {
        reason: "ai_write_disabled",
        serverId: tc.targetServerId,
      }, "failure");
      throw AppError.forbidden("AI write access is disabled for this server");
    }
    if (server.aiWriteAccess === "sandbox-only" && !tc.dryRun && !convo.sandboxMode) {
      await emitToolCallAudit("ai.tool_call_blocked_by_policy", toolCallId, operatorId, {
        reason: "sandbox_only",
        serverId: tc.targetServerId,
      }, "failure");
      throw AppError.forbidden("This server only allows sandbox (dry-run) AI actions");
    }
  }

  // Handle Sandbox / Dry-run
  if (convo.sandboxMode || tc.dryRun) {
    const fixture = getSandboxFixture(tc.manifestId);
    logger.info({ ctx: "ai:tool-dispatcher", toolCallId, dryRun: true }, "Executing sandbox fixture");
    
    await db.update(aiToolCalls)
      .set({ 
        status: "completed", 
        executedAt: new Date().toISOString(),
      })
      .where(eq(aiToolCalls.id, toolCallId));

    await emitToolCallAudit("ai.tool_call_executed", toolCallId, operatorId, {
      dryRun: true,
      manifestId: tc.manifestId,
    });

    // H8: Insert tool result message for dry-run path
    try {
      const [maxSeqRow] = await db
        .select({ maxSeq: sql<number>`coalesce(max(${aiMessages.seq}), -1)` })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, convo.id));
      const nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;

      await db.insert(aiMessages).values({
        id: randomUUID(),
        conversationId: convo.id,
        role: "tool",
        seq: nextSeq,
        contentText: JSON.stringify(fixture),
        contentMeta: { dry_run: true, manifestId: tc.manifestId, toolCallId },
        createdAt: new Date().toISOString(),
      });
    } catch (msgErr) {
      logger.error({ ctx: "ai:tool-dispatcher", err: msgErr, toolCallId }, "Failed to insert dry-run tool message");
    }
        
    return fixture;
  }

  // C4: Handle targetServerId null based on manifest locus
  let serverId: string;
  if (tc.targetServerId === null) {
    if (entry.locus === "target") {
      await db.update(aiToolCalls)
        .set({ status: "failed" })
        .where(eq(aiToolCalls.id, toolCallId));
      await emitToolCallAudit("ai.tool_call_failed", toolCallId, operatorId, {
        reason: "missing_target_server",
        manifestId: tc.manifestId,
      }, "failure");
      throw AppError.badRequest("Tool call missing target server");
    }
    // locus is 'local' or 'bootstrap' — no server needed
    serverId = "";
  } else {
    serverId = tc.targetServerId;
  }

  // Real execution
  logger.info({ ctx: "ai:tool-dispatcher", toolCallId }, "Dispatching real tool execution");
  
  await db.update(aiToolCalls).set({ status: "executing" }).where(eq(aiToolCalls.id, toolCallId));

  // C6: Wrap in try/catch, transition to failed on error
  try {
    const { runId } = await scriptsRunner.runScript(
      tc.manifestId,
      serverId,
      validatedParams as Record<string, unknown>,
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

    await emitToolCallAudit("ai.tool_call_executed", toolCallId, operatorId, {
      runId,
      manifestId: tc.manifestId,
    });

    return { runId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    await db.update(aiToolCalls)
      .set({ status: "failed" })
      .where(eq(aiToolCalls.id, toolCallId));

    await emitToolCallAudit("ai.tool_call_failed", toolCallId, operatorId, {
      reason: "dispatch_error",
      error: errorMessage,
      manifestId: tc.manifestId,
    }, "failure");

    throw err;
  }
}
