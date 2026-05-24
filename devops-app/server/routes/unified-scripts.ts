import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../db/index.js";
import { unifiedScripts, unifiedScriptAuditEntries, scripts as f016Scripts, scriptParams as f016ScriptParams } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin, auditScriptAction } from "../middleware/script-rbac.js";
import { scanScript } from "../services/script-scanner.js";
import { computeHash, verifyIntegrity } from "../services/script-integrity.js";
import { parseAnnotations, paramsToJsonSchema } from "../services/script-parser.js";
import { validateParams } from "../lib/ajv-validator.js";
import { executeSandboxed, isSandboxAvailable } from "../services/script-executor.js";
import { runRemoteCommand } from "../services/vpn-ssh.js";
import { AppError } from "../lib/app-error.js";
import { logger } from "../lib/logger.js";
import { readFile } from "node:fs/promises";

export const unifiedScriptsRouter = Router();
unifiedScriptsRouter.use(requireAuth);

const VPN_SCRIPTS_ROOT = () => process.env.VPN_SCRIPTS_ROOT || "./scripts";

function getScriptFilePath(name: string): string {
  return join(VPN_SCRIPTS_ROOT(), `${name}.sh`);
}

unifiedScriptsRouter.post("/scripts/upload", requireAdmin, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;

  try {
    const { file, name, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
      return;
    }

    if (!file || typeof file !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "file content is required" } });
      return;
    }

    const scriptName = name.trim();
    const scriptContent = file;

    const existing = await db
      .select({ id: unifiedScripts.id })
      .from(unifiedScripts)
      .where(eq(unifiedScripts.name, scriptName))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: { code: "CONFLICT", message: "Script with this name already exists" } });
      return;
    }

    const scanResult = scanScript(scriptContent);
    const contentHash = computeHash(scriptContent);
    const parsed = parseAnnotations(scriptContent);
    const parameterSchema = paramsToJsonSchema(parsed.params);
    const id = randomUUID();
    const now = new Date().toISOString();
    const filePath = getScriptFilePath(scriptName);

    await mkdir(VPN_SCRIPTS_ROOT(), { recursive: true });

    const tmpPath = `${filePath}.${id}.tmp`;
    await writeFile(tmpPath, scriptContent, "utf8");
    await rename(tmpPath, filePath);

    await db.insert(unifiedScripts).values({
      id,
      name: scriptName,
      description: description ?? parsed.description ?? null,
      contentHash,
      filePath,
      parameterSchema,
      source: "upload",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    await auditScriptAction({
      actorId: userId,
      actorRole: "admin",
      action: "upload",
      scriptId: id,
      scriptName,
      metadata: {
        contentHash,
        scannerViolations: scanResult.violations.length > 0 ? scanResult.violations : undefined,
      },
    });

    res.status(201).json({
      id,
      name: scriptName,
      contentHash,
      parameterSchema,
      source: "upload",
      scannerViolations: scanResult.violations,
    });
  } catch (err) {
    logger.error({ ctx: "unified-scripts-upload", err }, "Script upload failed");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Upload failed" },
    });
  }
});

unifiedScriptsRouter.get("/scripts", async (_req, res) => {
  const rows = await db
    .select({
      id: unifiedScripts.id,
      name: unifiedScripts.name,
      description: unifiedScripts.description,
      parameterSchema: unifiedScripts.parameterSchema,
      source: unifiedScripts.source,
      createdBy: unifiedScripts.createdBy,
      createdAt: unifiedScripts.createdAt,
      updatedAt: unifiedScripts.updatedAt,
    })
    .from(unifiedScripts);

  res.json(rows);
});

unifiedScriptsRouter.put("/scripts/:id", requireAdmin, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const scriptId = req.params.id as string;

  try {
    const [existing] = await db
      .select()
      .from(unifiedScripts)
      .where(eq(unifiedScripts.id, scriptId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Script not found" } });
      return;
    }

    const { file, name, description } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (name !== undefined && typeof name === "string") updates.name = name.trim();
    if (description !== undefined) updates.description = description;

    if (file !== undefined && typeof file === "string") {
      const scanResult = scanScript(file);
      const newHash = computeHash(file);
      const parsed = parseAnnotations(file);
      const parameterSchema = paramsToJsonSchema(parsed.params);

      updates.contentHash = newHash;
      updates.parameterSchema = parameterSchema;

      if (description === undefined && parsed.description) {
        updates.description = parsed.description;
      }

      const filePath = getScriptFilePath(updates.name as string ?? existing.name);
      const tmpPath = `${filePath}.${scriptId}.tmp`;
      await writeFile(tmpPath, file, "utf8");
      await rename(tmpPath, filePath);
      updates.filePath = filePath;

      await auditScriptAction({
        actorId: userId,
        actorRole: "admin",
        action: "scanner-warn",
        scriptId,
        scriptName: existing.name,
        metadata: { scannerViolations: scanResult.violations },
      });
    }

    const [updated] = await db
      .update(unifiedScripts)
      .set(updates)
      .where(eq(unifiedScripts.id, scriptId))
      .returning();

    await auditScriptAction({
      actorId: userId,
      actorRole: "admin",
      action: "update",
      scriptId,
      scriptName: updated!.name,
      metadata: { updatedFields: Object.keys(updates) },
    });

    res.json(updated);
  } catch (err) {
    logger.error({ ctx: "unified-scripts-update", err }, "Script update failed");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Update failed" },
    });
  }
});

unifiedScriptsRouter.delete("/scripts/:id", requireAdmin, async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const scriptId = req.params.id as string;

  try {
    const [existing] = await db
      .select()
      .from(unifiedScripts)
      .where(eq(unifiedScripts.id, scriptId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Script not found" } });
      return;
    }

    try {
      await unlink(existing.filePath);
    } catch {
      logger.warn({ ctx: "unified-scripts-delete", path: existing.filePath }, "Failed to delete script file from disk");
    }

    await db.delete(unifiedScripts).where(eq(unifiedScripts.id, scriptId));

    await auditScriptAction({
      actorId: userId,
      actorRole: "admin",
      action: "delete",
      scriptId,
      scriptName: existing.name,
    });

    res.json({ message: `Script '${existing.name}' deleted.` });
  } catch (err) {
    logger.error({ ctx: "unified-scripts-delete", err }, "Script deletion failed");
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Delete failed" },
    });
  }
});

unifiedScriptsRouter.post("/scripts/:id/execute", async (req, res) => {
  const userId = (req as unknown as { userId: string }).userId;
  const scriptId = req.params.id as string;
  const { serverId, parameters } = req.body;

  if (!serverId || typeof serverId !== "string") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "serverId is required" } });
    return;
  }

  if (parameters !== undefined && typeof parameters !== "object") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "parameters must be an object" } });
    return;
  }

  try {
    const [script] = await db
      .select()
      .from(unifiedScripts)
      .where(eq(unifiedScripts.id, scriptId))
      .limit(1);

    if (!script) {
      const [f016Script] = await db
        .select()
        .from(f016Scripts)
        .where(eq(f016Scripts.id, scriptId))
        .limit(1);

      if (f016Script) {
        logger.info(
          { ctx: "unified-scripts-execute", scriptId, source: "feature-016-fallback" },
          "Falling back to Feature 016 execution",
        );

        const paramEnv = Object.entries(parameters ?? {})
          .map(([k, v]) => `PARAM_${k}=${shellEscape(String(v))}`)
          .join(" ");

        const remoteCmd = [
          `tmpfile=$(mktemp -p /tmp script.XXXXXX.sh)`,
          `trap "rm -f $tmpfile" EXIT`,
          `chmod 700 $tmpfile`,
          `cat > $tmpfile << 'HANGAR_EOF'`,
          f016Script.content,
          `HANGAR_EOF`,
          `${paramEnv} bash $tmpfile`,
        ].join("\n");

        const start = Date.now();
        const remoteResult = await runRemoteCommand(serverId, remoteCmd, {
          timeoutMs: 10 * 60_000,
        });
        const durationMs = Date.now() - start;

        await auditScriptAction({
          actorId: userId,
          actorRole: "user",
          action: "execute",
          scriptId,
          scriptName: f016Script.name,
          metadata: { serverId, source: "feature-016-fallback", exitCode: remoteResult.exitCode, durationMs },
        });

        res.json({
          exitCode: remoteResult.exitCode,
          stdout: remoteResult.stdout,
          stderr: remoteResult.stderr,
          sandboxed: false,
          durationMs,
        });
        return;
      }

      res.status(404).json({ error: { code: "NOT_FOUND", message: "Script not found" } });
      return;
    }

    const integrity = await verifyIntegrity(scriptId);
    if (!integrity.valid) {
      res.status(400).json({
        error: {
          code: "INTEGRITY_FAILURE",
          message: "Script integrity check failed. File may have been tampered with.",
          expectedHash: integrity.expectedHash,
          actualHash: integrity.actualHash,
        },
      });
      return;
    }

    if (script.parameterSchema) {
      const validation = validateParams(
        script.parameterSchema as Record<string, unknown>,
        parameters ?? {},
      );
      if (!validation.valid) {
        res.status(400).json({
          error: {
            code: "INVALID_PARAMS",
            message: "Parameter validation failed",
            details: validation.errors,
          },
        });
        return;
      }
    }

    const sandboxReady = isSandboxAvailable();

    if (serverId === "local" || !serverId) {
      if (!sandboxReady) {
        res.status(503).json({
          error: { code: "SANDBOX_UNAVAILABLE", message: "Sandbox not available — execution blocked" },
        });
        return;
      }

      const content = await readFile(script.filePath, "utf8");
      const result = await executeSandboxed(content, parameters ?? {});

      await auditScriptAction({
        actorId: userId,
        actorRole: "user",
        action: "execute",
        scriptId,
        scriptName: script.name,
        metadata: {
          serverId,
          sandboxed: result.sandboxed,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      });

      res.json(result);
    } else {
      const content = await readFile(script.filePath, "utf8");
      const paramEnv = Object.entries(parameters ?? {})
        .map(([k, v]) => `PARAM_${k}=${shellEscape(String(v))}`)
        .join(" ");

      const remoteCmd = [
        `tmpfile=$(mktemp -p /tmp script.XXXXXX.sh)`,
        `trap "rm -f $tmpfile" EXIT`,
        `chmod 700 $tmpfile`,
        `cat > $tmpfile << 'HANGAR_EOF'`,
        content,
        `HANGAR_EOF`,
        `${paramEnv} bash $tmpfile`,
      ].join("\n");

      const start = Date.now();
      const remoteResult = await runRemoteCommand(serverId, remoteCmd, {
        timeoutMs: 10 * 60_000,
      });
      const durationMs = Date.now() - start;

      const result = {
        exitCode: remoteResult.exitCode,
        stdout: remoteResult.stdout,
        stderr: remoteResult.stderr,
        sandboxed: false,
        durationMs,
      };

      await auditScriptAction({
        actorId: userId,
        actorRole: "user",
        action: "execute",
        scriptId,
        scriptName: script.name,
        metadata: {
          serverId,
          sandboxed: false,
          exitCode: result.exitCode,
          durationMs,
        },
      });

      res.json(result);
    }
  } catch (err) {
    logger.error({ ctx: "unified-scripts-execute", scriptId, err }, "Script execution failed");
    res.status(500).json({
      error: { code: "EXECUTION_ERROR", message: err instanceof Error ? err.message : "Execution failed" },
    });
  }
});

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
