#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { zodToJsonSchema } from "zod-to-json-schema";
import { manifest } from "../server/scripts-manifest.js";
import { z } from "zod";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/devops";

async function main() {
  const sql = postgres(DATABASE_URL);
  console.log("Migrating Feature 005 scripts to unified_scripts table...\n");

  let migrated = 0;
  let skipped = 0;

  for (const entry of manifest) {
    if (entry.locus !== "target") {
      console.log(`  SKIP: ${entry.id} (locus=${entry.locus})`);
      skipped++;
      continue;
    }

    const existing = await sql`
      SELECT id FROM unified_scripts WHERE name = ${entry.id}
    `;

    if (existing.length > 0) {
      console.log(`  SKIP: ${entry.id} (already exists)`);
      skipped++;
      continue;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const contentHash = createHash("sha256")
      .update(`manifest:${entry.id}`)
      .digest("hex");
    const filePath = `manifest/${entry.id}.sh`;

    let parameterSchema = null;
    try {
      const jsonSchema = zodToJsonSchema(entry.params, { target: "openApi3" });
      if (jsonSchema && typeof jsonSchema === "object") {
        parameterSchema = jsonSchema;
      }
    } catch (err) {
      console.log(`  WARN: ${entry.id} — failed to convert Zod schema to JSON Schema: ${err.message}`);
    }

    await sql`
      INSERT INTO unified_scripts (id, name, description, content_hash, file_path, parameter_schema, source, created_by, created_at, updated_at)
      VALUES (${id}, ${entry.id}, ${entry.description}, ${contentHash}, ${filePath}, ${parameterSchema ? JSON.stringify(parameterSchema) : null}, 'feature-005', 'system', ${now}, ${now})
    `;

    console.log(`  MIGRATED: ${entry.id} → ${id}`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
