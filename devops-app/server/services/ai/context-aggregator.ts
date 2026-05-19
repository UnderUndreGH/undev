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
import { maskContextDocument } from "../../lib/mask-context-document.js";
import { logger } from "../../lib/logger.js";

const MAX_CONTEXT_CHARS = 400_000; // ~100K tokens at ~4 chars/token

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
    { ctx: "context-aggregator", targetKind, targetId },
    "Aggregating AI context",
  );

  const sections: string[] = [];

  // 1. audit_entries — last 100 rows matching target
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
    const raw = rows.map((r) => JSON.stringify(r)).join("\n");
    sections.push(maskContextDocument(raw, "audit_entries", false));
  } catch (err) {
    logger.error({ ctx: "context-aggregator", err }, "Failed to query audit_entries");
  }

  // 2. app_health_probes — last 50 rows, filtered by targetKind
  try {
    if (targetKind === "app" && targetId) {
      const rows = await db
        .select()
        .from(appHealthProbes)
        .where(eq(appHealthProbes.appId, targetId))
        .orderBy(desc(appHealthProbes.probedAt))
        .limit(50);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "app_health_probes", false));
    } else if (targetKind === "server" && targetId) {
      const rows = await db
        .select()
        .from(appHealthProbes)
        .where(eq(appHealthProbes.serverId, targetId))
        .orderBy(desc(appHealthProbes.probedAt))
        .limit(50);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "app_health_probes", false));
    } else {
      const rows = await db
        .select()
        .from(appHealthProbes)
        .orderBy(desc(appHealthProbes.probedAt))
        .limit(50);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "app_health_probes", false));
    }
  } catch (err) {
    logger.error(
      { ctx: "context-aggregator", err },
      "Failed to query app_health_probes",
    );
  }

  // 3. script_runs — last 5 rows, filtered for server targetKind
  try {
    if (targetKind === "server" && targetId) {
      const rows = await db
        .select()
        .from(scriptRuns)
        .where(eq(scriptRuns.serverId, targetId))
        .orderBy(desc(scriptRuns.startedAt))
        .limit(5);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "script_runs", false));
    } else {
      const rows = await db
        .select()
        .from(scriptRuns)
        .orderBy(desc(scriptRuns.startedAt))
        .limit(5);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "script_runs", false));
    }
  } catch (err) {
    logger.error({ ctx: "context-aggregator", err }, "Failed to query script_runs");
  }

  // 4. deployments — last 5 rows, filtered by app or server targetKind
  try {
    if (targetKind === "app" && targetId) {
      const rows = await db
        .select()
        .from(deployments)
        .where(eq(deployments.applicationId, targetId))
        .orderBy(desc(deployments.startedAt))
        .limit(5);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "deployments", false));
    } else if (targetKind === "server" && targetId) {
      const rows = await db
        .select()
        .from(deployments)
        .where(eq(deployments.serverId, targetId))
        .orderBy(desc(deployments.startedAt))
        .limit(5);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "deployments", false));
    } else {
      const rows = await db
        .select()
        .from(deployments)
        .orderBy(desc(deployments.startedAt))
        .limit(5);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "deployments", false));
    }
  } catch (err) {
    logger.error({ ctx: "context-aggregator", err }, "Failed to query deployments");
  }

  // 5. app_cert_events — last 20 rows; for app targetKind, resolve cert IDs via appCerts first
  try {
    if (targetKind === "app" && targetId) {
      const certRows = await db
        .select({ id: appCerts.id })
        .from(appCerts)
        .where(eq(appCerts.appId, targetId));
      const certIds = certRows.map((r) => r.id);
      if (certIds.length > 0) {
        const rows = await db
          .select()
          .from(appCertEvents)
          .where(inArray(appCertEvents.certId, certIds))
          .orderBy(desc(appCertEvents.occurredAt))
          .limit(20);
        const raw = rows.map((r) => JSON.stringify(r)).join("\n");
        sections.push(maskContextDocument(raw, "app_cert_events", false));
      }
    } else {
      const rows = await db
        .select()
        .from(appCertEvents)
        .orderBy(desc(appCertEvents.occurredAt))
        .limit(20);
      const raw = rows.map((r) => JSON.stringify(r)).join("\n");
      sections.push(maskContextDocument(raw, "app_cert_events", false));
    }
  } catch (err) {
    logger.error(
      { ctx: "context-aggregator", err },
      "Failed to query app_cert_events",
    );
  }

  const combined = sections.join("\n\n");

  // Truncate to ~400K characters as rough proxy for ~100K tokens
  if (combined.length > MAX_CONTEXT_CHARS) {
    logger.info(
      { ctx: "context-aggregator", originalLen: combined.length },
      "Truncating context to MAX_CONTEXT_CHARS",
    );
    return combined.slice(0, MAX_CONTEXT_CHARS);
  }

  return combined;
}
