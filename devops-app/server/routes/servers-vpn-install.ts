import { Router } from "express";
import { db } from "../db/index.js";
import { servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import {
  decryptVpnConfig,
  detectConfigFormat,
  configFileName,
  configContentType,
} from "../lib/vpn-config.js";

export const vpnInstallRouter = Router();
vpnInstallRouter.use(requireAuth);

vpnInstallRouter.post("/:id/vpn/install", async (req, res) => {
  const serverId = req.params.id as string;
  const reinstall = (req.body as { reinstall?: boolean }).reinstall === true;

  const [server] = await db
    .select({ id: servers.id, vpnStatus: servers.vpnStatus, deletedAt: servers.deletedAt })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server || server.deletedAt) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Server not found" },
    });
    return;
  }

  if (server.vpnStatus === "installing") {
    res.status(409).json({
      error: {
        code: "CONFLICT",
        message: "Installation already in progress",
      },
    });
    return;
  }

  if (server.vpnStatus === "installed" && !reinstall) {
    res.status(409).json({
      error: {
        code: "CONFLICT",
        message: "VPN already installed. Set reinstall=true to overwrite.",
      },
    });
    return;
  }

  try {
    const { startInstall } = await import("../workers/amnezia-installer.js");
    const installId = await startInstall(serverId);

    res.status(202).json({
      install_id: installId,
      serverId,
      status: "installing",
      message: "Installation started",
    });
  } catch (err) {
    logger.error(
      { ctx: "vpn-install-trigger", serverId, err },
      "Failed to start VPN install",
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Failed to start install",
      },
    });
  }
});

vpnInstallRouter.get("/:id/vpn/install-status/:install_id", async (req, res) => {
  const serverId = req.params.id as string;
  const installId = req.params.install_id as string;

  const [server] = await db
    .select({ id: servers.id, vpnStatus: servers.vpnStatus, deletedAt: servers.deletedAt })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server || server.deletedAt) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Server not found" },
    });
    return;
  }

  const { getInstallState } = await import("../workers/amnezia-installer.js");
  const state = getInstallState(installId);

  if (!state || state.serverId !== serverId) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Install not found" },
    });
    return;
  }

  res.json({
    install_id: state.installId,
    vpn_status: server.vpnStatus,
    stage: state.stage,
    progress: state.progress,
    message: state.message,
    error: state.error,
    started_at: state.startedAt,
    finished_at: state.finishedAt,
  });
});

vpnInstallRouter.get("/:id/vpn/config", async (req, res) => {
  const serverId = req.params.id as string;

  const [server] = await db
    .select({
      id: servers.id,
      vpnConfigEncrypted: servers.vpnConfigEncrypted,
      vpnConfigFormat: servers.vpnConfigFormat,
      deletedAt: servers.deletedAt,
    })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server || server.deletedAt) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Server not found" },
    });
    return;
  }

  if (!server.vpnConfigEncrypted) {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "No VPN config available for this server",
      },
    });
    return;
  }

  try {
    const plaintext = decryptVpnConfig(server.vpnConfigEncrypted);
    const format = detectConfigFormat(plaintext);

    const fileName = configFileName(format);
    const contentType = configContentType(format);

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", contentType);
    res.send(plaintext);
  } catch (err) {
    logger.error(
      { ctx: "vpn-config-download", serverId, err },
      "Failed to decrypt VPN config",
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to decrypt VPN config",
      },
    });
  }
});
