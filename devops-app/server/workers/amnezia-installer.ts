import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/index.js";
import { servers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { seal } from "../lib/envelope-cipher.js";
import { logger } from "../lib/logger.js";
import { runRemoteCommand } from "../services/vpn-ssh.js";

const STAGE_REGEX = /^\[STAGE: ([a-z_-]+)\]( .*)?$/;

const VALID_STAGES = new Set([
  "installing_deps",
  "configuring_server",
  "generating_config",
  "extracting_config",
  "done",
]);

const STAGE_PROGRESS: Record<string, number> = {
  installing_deps: 10,
  configuring_server: 35,
  generating_config: 55,
  extracting_config: 75,
  done: 100,
};

const INSTALL_TIMEOUT_MS =
  (Number(process.env.AMNEZIA_INSTALL_TIMEOUT_MIN) || 30) * 60 * 1000;

interface InstallState {
  installId: string;
  serverId: string;
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const activeInstalls = new Map<string, InstallState>();

export function getInstallState(installId: string): InstallState | undefined {
  return activeInstalls.get(installId);
}

function parseStages(output: string): {
  stages: Array<{ name: string; message: string }>;
  lastStage: string;
  lastMessage: string;
} {
  const stages: Array<{ name: string; message: string }> = [];
  let lastStage = "installing_deps";
  let lastMessage = "";

  for (const line of output.split("\n")) {
    const match = line.match(STAGE_REGEX);
    if (match && VALID_STAGES.has(match[1])) {
      lastStage = match[1];
      lastMessage = match[2]?.trim() ?? "";
      stages.push({ name: lastStage, message: lastMessage });
    }
  }

  return { stages, lastStage, lastMessage };
}

export async function startInstall(serverId: string): Promise<string> {
  const [server] = await db
    .select({
      id: servers.id,
      vpnStatus: servers.vpnStatus,
    })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);

  if (!server) {
    throw new Error("Server not found");
  }

  if (server.vpnStatus === "installing") {
    throw new Error("Installation already in progress");
  }

  const installId = randomUUID();
  const now = new Date().toISOString();

  const state: InstallState = {
    installId,
    serverId,
    stage: "installing_deps",
    progress: 0,
    message: "Starting installation...",
    error: null,
    startedAt: now,
    finishedAt: null,
  };

  activeInstalls.set(installId, state);

  await db
    .update(servers)
    .set({ vpnStatus: "installing" })
    .where(eq(servers.id, serverId));

  runInstallAsync(installId, serverId).catch((err) => {
    logger.error(
      { ctx: "amnezia-installer", installId, serverId, err },
      "Install failed",
    );
  });

  return installId;
}

async function runInstallAsync(
  installId: string,
  serverId: string,
): Promise<void> {
  const state = activeInstalls.get(installId);
  if (!state) return;

  try {
    const scriptContent = await readFile(
      path.resolve(
        process.env.VPN_SCRIPTS_ROOT || "./scripts",
        "install-amnezia.sh",
      ),
      "utf8",
    );

    const uploadCmd = `cat > /tmp/install-amnezia.sh << 'INSTALL_SCRIPT_EOF'\n${scriptContent}\nINSTALL_SCRIPT_EOF\nchmod +x /tmp/install-amnezia.sh`;

    await runRemoteCommand(serverId, uploadCmd, { timeoutMs: 30_000 });

    const result = await runRemoteCommand(
      serverId,
      "bash /tmp/install-amnezia.sh",
      {
        timeoutMs: INSTALL_TIMEOUT_MS,
        stream: (chunk) => {
          const st = activeInstalls.get(installId);
          if (!st || st.finishedAt) return;

          const { lastStage, lastMessage } = parseStages(chunk);
          if (VALID_STAGES.has(lastStage)) {
            st.stage = lastStage;
            st.progress = STAGE_PROGRESS[lastStage] ?? st.progress;
            st.message = lastMessage;
          }
        },
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Install script failed (exit ${result.exitCode}): ${result.stderr.slice(-500)}`,
      );
    }

    const { lastStage } = parseStages(result.stdout + result.stderr);
    state.stage = lastStage;
    state.progress = STAGE_PROGRESS[lastStage] ?? 100;
    state.message = "Installation completed";

    let configContent: string | null = null;
    let configFormat: string | null = null;

    try {
      const wgResult = await runRemoteCommand(
        serverId,
        "cat /tmp/amnezia-wg.conf",
        { timeoutMs: 10_000 },
      );
      if (wgResult.exitCode === 0 && wgResult.stdout.trim().length > 0) {
        configContent = wgResult.stdout;
        configFormat = "wg-quick";
      }
    } catch {
      // wg.conf not available
    }

    if (!configContent) {
      try {
        const vpnResult = await runRemoteCommand(
          serverId,
          "cat /tmp/amnezia-export.vpn",
          { timeoutMs: 10_000 },
        );
        if (vpnResult.exitCode === 0 && vpnResult.stdout.trim().length > 0) {
          configContent = vpnResult.stdout;
          configFormat = "amnezia";
        }
      } catch {
        // export.vpn not available
      }
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      vpnStatus: "installed",
      vpnInstalledAt: now,
    };

    if (configContent) {
      const encrypted = JSON.stringify(seal(configContent));
      updates.vpnConfigEncrypted = encrypted;
      updates.vpnConfigFormat = configFormat;
    }

    await db
      .update(servers)
      .set(updates)
      .where(eq(servers.id, serverId));

    state.stage = "done";
    state.progress = 100;
    state.message = "Installation completed successfully";
    state.finishedAt = now;

    logger.info(
      { ctx: "amnezia-installer", installId, serverId, configFormat },
      "Install completed",
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await db
      .update(servers)
      .set({ vpnStatus: "error" })
      .where(eq(servers.id, serverId));

    state.stage = "done";
    state.error = errMsg;
    state.finishedAt = new Date().toISOString();

    logger.error(
      { ctx: "amnezia-installer", installId, serverId, err },
      "Install failed",
    );
  }
}
