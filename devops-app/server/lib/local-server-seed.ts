import { db } from "../db/index.js";
import { servers } from "../db/schema.js";
import { LOCAL_SERVER_ID } from "./constants.js";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Automatically seeds the local server entry into the database on startup.
 * If the entry already exists, updates its status to 'online'.
 */
export async function seedLocalServer(): Promise<void> {
  try {
    const [existing] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, LOCAL_SERVER_ID))
      .limit(1);

    if (!existing) {
      logger.info({ serverId: LOCAL_SERVER_ID }, "Seeding local server row");
      await db.insert(servers).values({
        id: LOCAL_SERVER_ID,
        label: "This Server",
        host: "__local__",
        port: 0,
        sshUser: "root",
        sshAuthMethod: "key",
        connectionType: "local",
        setupState: "ready",
        status: "online",
        aiWriteAccess: "disabled",
        scriptsPath: "/app/scripts",
        createdAt: new Date().toISOString(),
      });
    } else {
      logger.info({ serverId: LOCAL_SERVER_ID }, "Local server row exists, setting status to online");
      await db
        .update(servers)
        .set({ status: "online" })
        .where(eq(servers.id, LOCAL_SERVER_ID));
    }
  } catch (err) {
    logger.error({ err }, "Failed to seed/update local server row");
    throw err;
  }
}
