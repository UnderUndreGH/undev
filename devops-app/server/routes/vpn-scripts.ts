/**
 * Feature 016: VPN script management + execution routes.
 *
 *   GET    /scripts                        — list all scripts (tree by directory)
 *   GET    /scripts/:id                    — single script with content & params
 *   POST   /scripts                        — create DB-sourced script
 *   PUT    /scripts/:id                    — update content (DB-sourced only)
 *   DELETE /scripts/:id                    — delete (DB-sourced only)
 *   POST   /scripts/:id/execute            — run a script on a server
 *   GET    /scripts/executions/:executionId — return scriptRuns row
 *   POST   /scripts/reindex                — reindex filesystem scripts
 *
 * Mounted at /api/vpn by server/index.ts when FEATURE_VPN_ENABLED=1.
 * Auth is applied globally upstream (requireAuth on /api prefix).
 */

import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import { scripts, scriptParams, scriptRuns, servers } from "../db/schema.js";
import { eq, and, inArray, count } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";

export const vpnScriptsRouter = Router();
vpnScriptsRouter.use(requireAuth);

// ── Zod schemas ──────────────────────────────────────────────────────────────

const createScriptSchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    content: z.string().min(1),
    params: z
      .array(
        z.object({
          name: z.string().min(1),
          type: z.string().default("string"),
          defaultValue: z.string().optional(),
          description: z.string().optional(),
          options: z.array(z.string()).optional(),
          order: z.number().int().default(0),
        }),
      )
      .optional(),
  })
  .strict();

const updateScriptSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    content: z.string().min(1).optional(),
  })
  .strict();

const executeScriptSchema = z
  .object({
    serverId: z.string().min(1),
    params: z.record(z.string(), z.string()),
  })
  .strict();

// ── Helpers ──────────────────────────────────────────────────────────────────

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Group scripts into a tree shape by directory derived from their path.
 */
function groupByDirectory(
  rows: Array<Record<string, unknown>>,
): Record<string, Array<Record<string, unknown>>> {
  const tree: Record<string, Array<Record<string, unknown>>> = {};
  for (const row of rows) {
    const path = (row.path as string) ?? "";
    const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(row);
  }
  return tree;
}

// ── GET /scripts — list all scripts (tree-grouped) ───────────────────────────

vpnScriptsRouter.get("/scripts", async (_req, res) => {
  const rows = await db
    .select({
      id: scripts.id,
      path: scripts.path,
      name: scripts.name,
      description: scripts.description,
      source: scripts.source,
      contentHash: scripts.contentHash,
      createdAt: scripts.createdAt,
      updatedAt: scripts.updatedAt,
    })
    .from(scripts);

  // Fetch all params in one query
  const paramsRows = await db.select().from(scriptParams);
  const paramsByScript = new Map<string, Array<(typeof paramsRows)[number]>>();
  for (const p of paramsRows) {
    if (!paramsByScript.has(p.scriptId)) paramsByScript.set(p.scriptId, []);
    paramsByScript.get(p.scriptId)!.push(p);
  }

  const enriched = rows.map((r) => ({
    ...r,
    params: paramsByScript.get(r.id) ?? [],
  }));

  res.json({ scripts: groupByDirectory(enriched) });
});

// ── GET /scripts/:id — single script with content + params ───────────────────

vpnScriptsRouter.get("/scripts/:id", async (req, res) => {
  const id = req.params.id as string;

  const [script] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.id, id))
    .limit(1);

  if (!script) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Script not found" },
    });
    return;
  }

  const paramsRows = await db
    .select()
    .from(scriptParams)
    .where(eq(scriptParams.scriptId, id));

  res.json({ script: { ...script, params: paramsRows } });
});

// ── POST /scripts — create DB-sourced script ─────────────────────────────────

vpnScriptsRouter.post("/scripts", async (req, res) => {
  const parsed = createScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const body = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  const hash = contentHash(body.content);

  // Check unique path
  const [existing] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(eq(scripts.path, body.path))
    .limit(1);

  if (existing) {
    res.status(409).json({
      error: { code: "CONFLICT", message: "A script with this path already exists" },
    });
    return;
  }

  try {
    const [script] = await db
      .insert(scripts)
      .values({
        id,
        path: body.path,
        name: body.name,
        description: body.description ?? null,
        source: "database",
        content: body.content,
        contentHash: hash,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Insert params if provided
    if (body.params && body.params.length > 0) {
      await db.insert(scriptParams).values(
        body.params.map((p, i) => ({
          id: randomUUID(),
          scriptId: id,
          name: p.name,
          type: p.type,
          defaultValue: p.defaultValue ?? null,
          description: p.description ?? null,
          options: p.options ?? null,
          order: p.order ?? i,
        })),
      );
    }

    // Fetch with params
    const paramsRows = await db
      .select()
      .from(scriptParams)
      .where(eq(scriptParams.scriptId, id));

    res.status(201).json({ script: { ...script!, params: paramsRows } });
  } catch (err) {
    logger.error({ ctx: "vpn-script-create", err }, "Failed to create script");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Failed to create script",
      },
    });
  }
});

// ── PUT /scripts/:id — update script content ─────────────────────────────────

vpnScriptsRouter.put("/scripts/:id", async (req, res) => {
  const id = req.params.id as string;

  const [existing] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Script not found" },
    });
    return;
  }

  if (existing.source === "filesystem") {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Cannot modify filesystem-sourced scripts — use reindex",
      },
    });
    return;
  }

  const parsed = updateScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const body = parsed.data;
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.content !== undefined) {
    updates.content = body.content;
    updates.contentHash = contentHash(body.content);
  }

  const [updated] = await db
    .update(scripts)
    .set(updates)
    .where(eq(scripts.id, id))
    .returning();

  const paramsRows = await db
    .select()
    .from(scriptParams)
    .where(eq(scriptParams.scriptId, id));

  res.json({ script: { ...updated!, params: paramsRows } });
});

// ── DELETE /scripts/:id — delete DB-sourced script ───────────────────────────

vpnScriptsRouter.delete("/scripts/:id", async (req, res) => {
  const id = req.params.id as string;

  const [existing] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Script not found" },
    });
    return;
  }

  if (existing.source === "filesystem") {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Cannot delete filesystem-sourced scripts — use reindex",
      },
    });
    return;
  }

  // CASCADE on scriptParams handles param deletion
  await db.delete(scripts).where(eq(scripts.id, id));

  res.status(204).end();
});

// ── POST /scripts/:id/execute — run script on server ─────────────────────────

vpnScriptsRouter.post("/scripts/:id/execute", async (req, res) => {
  const id = req.params.id as string;
  const userId = (req as unknown as { userId: string }).userId;

  const parsed = executeScriptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
    });
    return;
  }

  const { serverId, params: scriptParamsInput } = parsed.data;

  // Verify script exists
  const [script] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.id, id))
    .limit(1);

  if (!script) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Script not found" },
    });
    return;
  }

  // Verify server exists
  const [server] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Server not found" },
    });
    return;
  }

  // Check concurrency: max 3 pending/running runs per server
  const concurrentRows = await db
    .select({ total: count() })
    .from(scriptRuns)
    .where(
      and(
        eq(scriptRuns.serverId, serverId),
        inArray(scriptRuns.status, ["pending", "running"]),
      ),
    );

  const concurrentCount = concurrentRows[0]?.total ?? 0;
  if (concurrentCount >= 3) {
    res.status(429).json({
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many concurrent script executions on this server (max 3)",
      },
    });
    return;
  }

  try {
    // Dynamic import — script-executor is a Feature 016 service
    const { executeScript } = await import("../services/script-executor.js");
    const executionId = await executeScript(
      id,
      serverId,
      scriptParamsInput,
      userId,
    );

    res.status(201).json({ executionId });
  } catch (err) {
    logger.error(
      { ctx: "vpn-script-execute", scriptId: id, serverId, err },
      "Script execution failed to start",
    );
    res.status(500).json({
      error: {
        code: "EXECUTION_ERROR",
        message: err instanceof Error ? err.message : "Failed to execute script",
      },
    });
  }
});

// ── GET /scripts/executions/:executionId — return scriptRuns row ──────────────

vpnScriptsRouter.get(
  "/scripts/executions/:executionId",
  async (req, res) => {
    const executionId = req.params.executionId as string;

    const [run] = await db
      .select()
      .from(scriptRuns)
      .where(eq(scriptRuns.id, executionId))
      .limit(1);

    if (!run) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Execution not found" },
      });
      return;
    }

    res.json({ execution: run });
  },
);

// ── POST /scripts/reindex — reindex filesystem scripts ────────────────────────

vpnScriptsRouter.post("/scripts/reindex", async (_req, res) => {
  try {
    // Dynamic import — scripts directory indexer is a Feature 016 service
    const { indexScriptsDirectory } = await import(
      "../services/script-indexer.js"
    );
    // Resolve scripts root from env or default to ./scripts
    const scriptsRoot = process.env.VPN_SCRIPTS_ROOT || "./scripts";
    const result = await indexScriptsDirectory(scriptsRoot);

    res.json({
      indexed: result.indexed,
      added: result.added,
      updated: result.updated,
      removed: result.removed,
    });
  } catch (err) {
    logger.error({ ctx: "vpn-scripts-reindex", err }, "Script reindex failed");
    res.status(500).json({
      error: {
        code: "REINDEX_ERROR",
        message: err instanceof Error ? err.message : "Failed to reindex scripts",
      },
    });
  }
});
