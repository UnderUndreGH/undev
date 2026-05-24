import { db } from "../db/index.js";
import { servers } from "../db/schema.js";
import { isNull } from "drizzle-orm";
import { type ServerKind, ALL_SERVER_KINDS } from "../lib/server-types.js";

export interface UnifiedServerQuery {
  kind: ServerKind[] | "all";
}

export async function queryServers(kinds: ServerKind[]) {
  const filtered = kinds.length === 0 || kinds.length === ALL_SERVER_KINDS.length
    ? ALL_SERVER_KINDS
    : kinds;

  return db
    .select()
    .from(servers)
    .where(
      isNull(servers.deletedAt)
    )
    .then((rows) =>
      rows.filter((row) => {
        const kind = (row as Record<string, unknown>).kind as string | undefined;
        return filtered.includes((kind ?? "general") as ServerKind);
      })
    );
}
