import { Router } from "express";
import { z } from "zod";
import { sshPool } from "../services/ssh-pool.js";
import { scriptRunner } from "../services/ssh-executor.js";
import { validateBody } from "../middleware/validate.js";
import { db } from "../db/index.js";
import { servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { selfProtection } from "../services/self-protection.js";

export const dockerRouter = Router();

const cleanupSchema = z.object({
  mode: z.enum(["safe", "aggressive"]),
});

// GET /api/servers/:serverId/docker
dockerRouter.get("/servers/:serverId/docker", async (req, res) => {
  const serverId = req.params.serverId as string;

  const [server] = await db.select({ id: servers.id, deletedAt: servers.deletedAt }).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.deletedAt) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
    return;
  }

  if (!sshPool.isConnected(serverId)) {
    res.status(503).json({ error: { code: "NOT_CONNECTED", message: "Server not connected" } });
    return;
  }

  try {
    const [dfResult, psResult] = await Promise.all([
      sshPool.exec(serverId, "docker system df --format json 2>/dev/null || echo '{}'"),
      sshPool.exec(serverId, 'docker ps -a --format \'{"id":"{{.ID}}","name":"{{.Names}}","status":"{{.Status}}","image":"{{.Image}}"}\''),
    ]);

    const containers = psResult.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          const container = JSON.parse(line);
          return {
            ...container,
            isSelf: selfProtection.isSelf(container.id) || selfProtection.isSelf(container.name),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    let diskUsage = {};
    try {
      diskUsage = JSON.parse(dfResult.stdout.trim());
    } catch {
      // Fallback
    }

    res.json({ diskUsage, containers });
  } catch (err) {
    res.status(500).json({
      error: { code: "DOCKER_ERROR", message: "Failed to get Docker info" },
    });
  }
});

// POST /api/servers/:serverId/docker/cleanup
dockerRouter.post(
  "/servers/:serverId/docker/cleanup",
  validateBody(cleanupSchema),
  async (req, res) => {
    const serverId = req.params.serverId as string;
    const { mode } = req.body;

    const [server] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (!server || server.deletedAt) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
      return;
    }

    try {
      // Exclude self compose project from aggressive/safe cleanup
      const project = selfProtection.composeProject;
      const projectFilter = project ? ` --filter "label!=com.docker.compose.project=${project}"` : "";

      const cmd = mode === "aggressive"
        ? `docker system prune -af --volumes${projectFilter} 2>&1`
        : `docker system prune -f${projectFilter} 2>&1`;

      const { jobId } = await scriptRunner.runScript(
        serverId,
        cmd,
        [],
        { json: false, raw: true },
      );

      res.json({ jobId });
    } catch {
      res.status(500).json({
        error: { code: "CLEANUP_ERROR", message: "Failed to start Docker cleanup" },
      });
    }
  },
);

// POST /api/servers/:serverId/docker/containers/:containerId/stop
dockerRouter.post("/servers/:serverId/docker/containers/:containerId/stop", async (req, res) => {
  const { serverId, containerId } = req.params;

  if (selfProtection.isSelf(containerId)) {
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Cannot stop the dashboard container" }
    });
    return;
  }

  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.deletedAt) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
    return;
  }

  try {
    await sshPool.exec(serverId, `docker stop ${containerId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({
      error: { code: "DOCKER_ERROR", message: err.message || "Failed to stop container" }
    });
  }
});

// POST /api/servers/:serverId/docker/containers/:containerId/kill
dockerRouter.post("/servers/:serverId/docker/containers/:containerId/kill", async (req, res) => {
  const { serverId, containerId } = req.params;

  if (selfProtection.isSelf(containerId)) {
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Cannot kill the dashboard container" }
    });
    return;
  }

  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.deletedAt) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
    return;
  }

  try {
    await sshPool.exec(serverId, `docker kill ${containerId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({
      error: { code: "DOCKER_ERROR", message: err.message || "Failed to kill container" }
    });
  }
});

// DELETE /api/servers/:serverId/docker/containers/:containerId
dockerRouter.delete("/servers/:serverId/docker/containers/:containerId", async (req, res) => {
  const { serverId, containerId } = req.params;

  if (selfProtection.isSelf(containerId)) {
    res.status(403).json({
      error: { code: "FORBIDDEN", message: "Cannot remove the dashboard container" }
    });
    return;
  }

  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.deletedAt) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Server not found" } });
    return;
  }

  try {
    await sshPool.exec(serverId, `docker rm ${containerId}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({
      error: { code: "DOCKER_ERROR", message: err.message || "Failed to remove container" }
    });
  }
});
