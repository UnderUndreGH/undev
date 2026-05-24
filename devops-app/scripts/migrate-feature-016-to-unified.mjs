#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { parseAnnotations, paramsToJsonSchema } from "../server/services/script-parser.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/devops";

async function main() {
  const sql = postgres(DATABASE_URL);
  console.log("Migrating Feature 016 # @param scripts to unified_scripts table...\n");

  const feature016Scripts = await sql`
    SELECT id, path, name, description, source, content, content_hash
    FROM scripts
    WHERE source = 'database'
  `;

  let migrated = 0;
  let skipped = 0;

  for (const script of feature016Scripts) {
    const existing = await sql`
      SELECT id FROM unified_scripts WHERE name = ${script.name}
    `;

    if (existing.length > 0) {
      console.log(`  SKIP: ${script.name} (already exists)`);
      skipped++;
      continue;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const parsed = parseAnnotations(script.content);
    const parameterSchema = paramsToJsonSchema(parsed.params);
    const contentHash = script.content_hash || createHash("sha256").update(script.content).digest("hex");

    await sql`
      INSERT INTO unified_scripts (id, name, description, content_hash, file_path, parameter_schema, source, created_by, created_at, updated_at)
      VALUES (${id}, ${script.name}, ${script.description ?? parsed.description ?? null}, ${contentHash}, ${script.path}, ${parameterSchema ? JSON.stringify(parameterSchema) : null}, 'feature-016', 'system', ${now}, ${now})
    `;

    console.log(`  MIGRATED: ${script.name} (${parsed.params.length} params) → ${id}`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
