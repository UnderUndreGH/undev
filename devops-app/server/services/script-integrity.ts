import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { db } from "../db/index.js";
import { unifiedScripts, unifiedScriptAuditEntries } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";

export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return computeHash(content);
}

export async function verifyIntegrity(scriptId: string): Promise<{
  valid: boolean;
  expectedHash: string;
  actualHash: string | null;
}> {
  const [script] = await db
    .select()
    .from(unifiedScripts)
    .where(eq(unifiedScripts.id, scriptId))
    .limit(1);

  if (!script) {
    return { valid: false, expectedHash: "", actualHash: null };
  }

  try {
    const actualHash = await computeFileHash(script.filePath);
    const valid = actualHash === script.contentHash;

    if (!valid) {
      logger.error(
        {
          ctx: "script-integrity",
          scriptId,
          scriptName: script.name,
          expectedHash: script.contentHash,
          actualHash,
        },
        "Script integrity check FAILED — hash mismatch",
      );

      await db.insert(unifiedScriptAuditEntries).values({
        id: randomUUID(),
        actorId: "system",
        actorRole: "system",
        action: "integrity-failure",
        scriptId,
        scriptName: script.name,
        metadata: { expectedHash: script.contentHash, actualHash },
        createdAt: new Date().toISOString(),
      });
    }

    return { valid, expectedHash: script.contentHash, actualHash };
  } catch (err) {
    logger.error(
      { ctx: "script-integrity", scriptId, err },
      "Failed to verify script integrity",
    );
    return { valid: false, expectedHash: script.contentHash, actualHash: null };
  }
}
