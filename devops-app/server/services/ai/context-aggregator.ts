import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  auditEntries,
  appHealthProbes,
  scriptRuns,
  deployments,
  appCertEvents,
  appCerts,
} from "../../db/schema.js";
import { maskContextDocument, containsHighConfidenceSecrets } from "../../lib/mask-context-document.js";
import { logger } from "../../lib/logger.js";
import { randomUUID } from "node:crypto";

// Rough char→token ratio: Anthropic ~3.5 char/token, OpenAI ~4 char/token.
// 400K chars ≈ 100-115K tokens depending on model. If precise per-model
// budgets matter later, switch to token-counting via tiktoken or model libs.
const MAX_CONTEXT_CHARS = 400_000;

interface ContextSection {
  section: string;
  redactions: Record<string, number>;
}

async function fetchAuditEntries(targetKind: string, targetId: string | null): Promise<ContextSection> {
  try {
    const conditions = [eq(auditEntries.targetType, targetKind)];
    if (targetId) {
      conditions.push(eq(auditEntries.targetId, targetId));
    }
    const rows = await db
      .select()
      .from(auditEntries)
      .where(and(...conditions))
      .orderBy(desc(auditEntries.timestamp))
      .limit(100);
    const sanitized = rows.map((r) => {
      const { details, ...safe } = r;
      return JSON.stringify({ ...safe, details: "[MASKED]" });
    }).join("\n");
    if (containsHighConfidenceSecrets(sanitized)) {
      logger.warn({ ctx: "ai:context-aggregator", source: "audit_entries" }, "Blocking context source: high-confidence secrets detected");
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.context_blocked_high_confidence_secret",
          targetType: "ai_context",
          targetId: targetId ?? "global",
          details: JSON.stringify({ source: "audit_entries" }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }
      return { section: "", redactions: {} };
    }
    const { masked, redactions } = maskContextDocument(sanitized, "audit_entries", false);
    return { section: masked, redactions };
  } catch (err) {
    logger.error({ ctx: "ai:context-aggregator", err }, "Failed to query audit_entries");
    return { section: "", redactions: {} };
  }
}

async function fetchHealthProbes(targetKind: string, targetId: string | null): Promise<ContextSection> {
  try {
    let rows;
    if (targetKind === "app" && targetId) {
      rows = await db.select().from(appHealthProbes).where(eq(appHealthProbes.appId, targetId)).orderBy(desc(appHealthProbes.probedAt)).limit(50);
    } else if (targetKind === "server" && targetId) {
      rows = await db.select().from(appHealthProbes).where(eq(appHealthProbes.serverId, targetId)).orderBy(desc(appHealthProbes.probedAt)).limit(50);
    } else {
      rows = await db.select().from(appHealthProbes).orderBy(desc(appHealthProbes.probedAt)).limit(50);
    }
    const raw = rows.map((r) => JSON.stringify(r)).join("\n");
    if (containsHighConfidenceSecrets(raw)) {
      logger.warn({ ctx: "ai:context-aggregator", source: "app_health_probes" }, "Blocking context source: high-confidence secrets detected");
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.context_blocked_high_confidence_secret",
          targetType: "ai_context",
          targetId: targetId ?? "global",
          details: JSON.stringify({ source: "app_health_probes" }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }
      return { section: "", redactions: {} };
    }
    const { masked, redactions } = maskContextDocument(raw, "app_health_probes", false);
    return { section: masked, redactions };
  } catch (err) {
    logger.error({ ctx: "ai:context-aggregator", err }, "Failed to query app_health_probes");
    return { section: "", redactions: {} };
  }
}

async function fetchScriptRuns(targetKind: string, targetId: string | null): Promise<ContextSection> {
  try {
    let rows;
    if (targetKind === "server" && targetId) {
      rows = await db.select().from(scriptRuns).where(eq(scriptRuns.serverId, targetId)).orderBy(desc(scriptRuns.startedAt)).limit(5);
    } else {
      rows = await db.select().from(scriptRuns).orderBy(desc(scriptRuns.startedAt)).limit(5);
    }
    const sanitized = rows.map((r) => {
      const { params, ...safe } = r as any;
      return JSON.stringify(safe);
    }).join("\n");
    if (containsHighConfidenceSecrets(sanitized)) {
      logger.warn({ ctx: "ai:context-aggregator", source: "script_runs" }, "Blocking context source: high-confidence secrets detected");
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.context_blocked_high_confidence_secret",
          targetType: "ai_context",
          targetId: targetId ?? "global",
          details: JSON.stringify({ source: "script_runs" }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }
      return { section: "", redactions: {} };
    }
    const { masked, redactions } = maskContextDocument(sanitized, "script_runs", false);
    return { section: masked, redactions };
  } catch (err) {
    logger.error({ ctx: "ai:context-aggregator", err }, "Failed to query script_runs");
    return { section: "", redactions: {} };
  }
}

async function fetchDeployments(targetKind: string, targetId: string | null): Promise<ContextSection> {
  try {
    let rows;
    if (targetKind === "app" && targetId) {
      rows = await db.select().from(deployments).where(eq(deployments.applicationId, targetId)).orderBy(desc(deployments.startedAt)).limit(5);
    } else if (targetKind === "server" && targetId) {
      rows = await db.select().from(deployments).where(eq(deployments.serverId, targetId)).orderBy(desc(deployments.startedAt)).limit(5);
    } else {
      rows = await db.select().from(deployments).orderBy(desc(deployments.startedAt)).limit(5);
    }
    const raw = rows.map((r) => JSON.stringify(r)).join("\n");
    if (containsHighConfidenceSecrets(raw)) {
      logger.warn({ ctx: "ai:context-aggregator", source: "deployments" }, "Blocking context source: high-confidence secrets detected");
      try {
        await db.insert(auditEntries).values({
          id: randomUUID(),
          userId: "system",
          action: "ai.context_blocked_high_confidence_secret",
          targetType: "ai_context",
          targetId: targetId ?? "global",
          details: JSON.stringify({ source: "deployments" }),
          result: "success",
          timestamp: new Date().toISOString(),
        });
      } catch { /* audit best-effort */ }
      return { section: "", redactions: {} };
    }
    const { masked, redactions } = maskContextDocument(raw, "deployments", false);
    return { section: masked, redactions };
  } catch (err) {
    logger.error({ ctx: "ai:context-aggregator", err }, "Failed to query deployments");
    return { section: "", redactions: {} };
  }
}

async function fetchCertEvents(targetKind: string, targetId: string | null): Promise<ContextSection> {
  try {
    let raw: string | null = null;
    if (targetKind === "app" && targetId) {
      const certRows = await db.select({ id: appCerts.id }).from(appCerts).where(eq(appCerts.appId, targetId));
      const certIds = certRows.map((r) => r.id);
      if (certIds.length > 0) {
        const rows = await db.select().from(appCertEvents).where(inArray(appCertEvents.certId, certIds)).orderBy(desc(appCertEvents.occurredAt)).limit(20);
        raw = rows.map((r) => JSON.stringify(r)).join("\n");
      }
    } else {
      const rows = await db.select().from(appCertEvents).orderBy(desc(appCertEvents.occurredAt)).limit(20);
      raw = rows.map((r) => JSON.stringify(r)).join("\n");
    }
    if (raw !== null) {
      if (containsHighConfidenceSecrets(raw)) {
        logger.warn({ ctx: "ai:context-aggregator", source: "app_cert_events" }, "Blocking context source: high-confidence secrets detected");
        try {
          await db.insert(auditEntries).values({
            id: randomUUID(),
            userId: "system",
            action: "ai.context_blocked_high_confidence_secret",
            targetType: "ai_context",
            targetId: targetId ?? "global",
            details: JSON.stringify({ source: "app_cert_events" }),
            result: "success",
            timestamp: new Date().toISOString(),
          });
        } catch { /* audit best-effort */ }
        return { section: "", redactions: {} };
      }
      const { masked, redactions } = maskContextDocument(raw, "app_cert_events", false);
      return { section: masked, redactions };
    }
    return { section: "", redactions: {} };
  } catch (err) {
    logger.error({ ctx: "ai:context-aggregator", err }, "Failed to query app_cert_events");
    return { section: "", redactions: {} };
  }
}

/**
 * Aggregates operational context from multiple database sources for AI consumption.
 * Queries audit entries, health probes, script runs, deployments, and cert events,
 * masks secrets via maskContextDocument(), and returns a single truncated string.
 */
export async function aggregateContext(
  targetKind: string,
  targetId: string | null,
): Promise<string> {
  logger.info(
    { ctx: "ai:context-aggregator", targetKind, targetId },
    "Aggregating AI context",
  );

  // C17: Guard against cross-context leak when no target specified
  if (targetId === null && targetKind !== 'manual') {
    return `<context-source type="insufficient-context">No target specified. Aggregation requires a target identifier.</context-source>`;
  }

  const [sec1, sec2, sec3, sec4, sec5] = await Promise.all([
    fetchAuditEntries(targetKind, targetId),
    fetchHealthProbes(targetKind, targetId),
    fetchScriptRuns(targetKind, targetId),
    fetchDeployments(targetKind, targetId),
    fetchCertEvents(targetKind, targetId),
  ]);

  const sections: string[] = [];
  const totalRedactions: Record<string, number> = {};
  for (const { section, redactions } of [sec1, sec2, sec3, sec4, sec5]) {
    if (section) sections.push(section);
    for (const [name, count] of Object.entries(redactions)) {
      totalRedactions[name] = (totalRedactions[name] || 0) + count;
    }
  }

  // C14: Emit audit warning if any secrets were redacted
  if (Object.keys(totalRedactions).length > 0) {
    try {
      await db.insert(auditEntries).values({
        id: randomUUID(),
        userId: "system",
        action: "ai.context_masking_warning",
        targetType: "ai_context",
        targetId: targetId ?? "global",
        details: JSON.stringify({ patternCounts: totalRedactions, sourceType: "aggregated_context" }),
        result: "success",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ ctx: "ai:context-aggregator", err }, "Audit emit failed for masking warning");
    }
  }

  const combined = sections.join("\n\n");

  // Truncate to ~400K characters as rough proxy for ~100K tokens
  if (combined.length > MAX_CONTEXT_CHARS) {
    logger.info(
      { ctx: "ai:context-aggregator", originalLen: combined.length },
      "Truncating context to MAX_CONTEXT_CHARS",
    );
    return combined.slice(0, MAX_CONTEXT_CHARS);
  }

  return combined;
}
