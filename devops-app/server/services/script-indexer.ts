/**
 * Feature 016 T014 — File-system script indexer.
 *
 * Walks a directory tree, reads `.sh` files, hashes their contents,
 * parses `# @param` / `# @description` annotations, and upserts into the
 * `scripts` + `script_params` tables. Filesystem source always wins over
 * database source on collision.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { scripts, scriptParams } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { parseAnnotations } from "./script-parser.js";
import { logger } from "../lib/logger.js";

export async function indexScriptsDirectory(
  rootDir: string,
): Promise<{ indexed: number; added: number; updated: number; removed: number }> {
  let indexed = 0;
  let added = 0;
  let updated = 0;

  // ── Walk filesystem ────────────────────────────────────────────────────
  const fsFiles = new Set<string>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs/files.
      if (entry.name.startsWith(".")) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".sh")) {
        const relPath = relative(rootDir, fullPath);
        fsFiles.add(relPath);
      }
    }
  }

  await walk(rootDir);

  // ── Process each .sh file ──────────────────────────────────────────────
  for (const relPath of fsFiles) {
    const fullPath = join(rootDir, relPath);
    try {
      const content = await readFile(fullPath, "utf8");
      const contentHash = createHash("sha256").update(content).digest("hex");
      const parsed = parseAnnotations(content);
      const name = relPath.replace(/\.sh$/, "").replace(/[/\\]+/g, " / ");

      // Check for existing row by path.
      const existing = await db
        .select()
        .from(scripts)
        .where(eq(scripts.path, relPath))
        .limit(1);

      const now = new Date().toISOString();

      if (existing.length === 0) {
        // Insert new script.
        const id = randomUUID();
        await db.insert(scripts).values({
          id,
          path: relPath,
          name,
          description: parsed.description ?? null,
          source: "filesystem",
          content,
          contentHash,
          createdAt: now,
          updatedAt: now,
        });

        // Insert params.
        if (parsed.params.length > 0) {
          await db.insert(scriptParams).values(
            parsed.params.map((p, order) => ({
              id: randomUUID(),
              scriptId: id,
              name: p.name,
              type: p.type,
              defaultValue: p.defaultValue ?? null,
              description: p.description || null,
              options: p.options ?? null,
              order,
            })),
          );
        }
        added++;
      } else {
        const row = existing[0]!;
        // Update if content changed, or force-overwrite database-sourced rows.
        if (row.contentHash !== contentHash || row.source === "database") {
          await db
            .update(scripts)
            .set({
              name,
              description: parsed.description ?? null,
              source: "filesystem",
              content,
              contentHash,
              updatedAt: now,
            })
            .where(eq(scripts.id, row.id));

          // Rebuild params — delete old, insert new.
          await db.delete(scriptParams).where(eq(scriptParams.scriptId, row.id));
          if (parsed.params.length > 0) {
            await db.insert(scriptParams).values(
              parsed.params.map((p, order) => ({
                id: randomUUID(),
                scriptId: row.id,
                name: p.name,
                type: p.type,
                defaultValue: p.defaultValue ?? null,
                description: p.description || null,
                options: p.options ?? null,
                order,
              })),
            );
          }
          updated++;
        }
      }

      indexed++;
    } catch (err) {
      logger.warn(
        { ctx: "script-indexer", path: relPath, err },
        "failed to index script file",
      );
    }
  }

  // ── Remove FS-sourced scripts no longer on disk ────────────────────────
  const dbRows = await db
    .select({ id: scripts.id, path: scripts.path, source: scripts.source })
    .from(scripts);

  let removed = 0;
  for (const row of dbRows) {
    if (row.source === "filesystem" && !fsFiles.has(row.path)) {
      // Cascade deletes script_params via FK.
      await db.delete(scripts).where(eq(scripts.id, row.id));
      removed++;
    }
  }

  logger.info(
    { ctx: "script-indexer", indexed, added, updated, removed, rootDir },
    "Script indexing complete",
  );

  return { indexed, added, updated, removed };
}
