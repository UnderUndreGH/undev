/**
 * Feature 016 T007a — Detect whether Amnezia VPN is installed on a server.
 *
 * Checks for running Docker containers matching "amnezia" *or* the presence
 * of the `amnezia` binary on PATH. Returns true as soon as any check passes.
 */

import { runRemoteCommand } from "./vpn-ssh.js";
import { logger } from "../lib/logger.js";

/**
 * Returns `true` if Amnezia VPN appears to be installed on the target server.
 * Never throws — errors are logged and treated as "not installed".
 */
export async function probeAmneziaInstalled(
  serverId: string,
): Promise<boolean> {
  try {
    // Check 1: running Docker containers with "amnezia" in the name.
    const docker = await runRemoteCommand(
      serverId,
      `docker ps --filter "name=amnezia" --format "{{.Names}}"`,
      { timeoutMs: 10_000 },
    );

    if (docker.exitCode === 0 && docker.stdout.trim().length > 0) {
      logger.debug(
        { ctx: "vpn-install-probe", serverId, names: docker.stdout.trim() },
        "Amnezia containers detected",
      );
      return true;
    }

    // Check 2: `amnezia` binary on PATH.
    const binCheck = await runRemoteCommand(
      serverId,
      "command -v amnezia",
      { timeoutMs: 5_000 },
    );

    if (binCheck.exitCode === 0) {
      logger.debug(
        { ctx: "vpn-install-probe", serverId },
        "Amnezia binary found on PATH",
      );
      return true;
    }

    return false;
  } catch (err) {
    logger.warn(
      { ctx: "vpn-install-probe", serverId, err },
      "probe failed — treating as uninstalled",
    );
    return false;
  }
}
