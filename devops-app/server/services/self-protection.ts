import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../lib/logger.js";

const execAsync = promisify(exec);

export class SelfProtectionService {
  private _containerId: string | null = null;
  private _containerName: string | null = null;
  private _composeProject: string | null = null;
  private _initialized = false;

  get containerId(): string | null {
    return this._containerId;
  }

  get composeProject(): string | null {
    return this._composeProject;
  }

  get containerName(): string | null {
    return this._containerName;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      // 1. Try reading /proc/1/cpuset
      if (existsSync("/proc/1/cpuset")) {
        const cpuset = await readFile("/proc/1/cpuset", "utf8");
        const match = cpuset.trim().match(/\/docker\/([a-f0-9]{64})/i) || cpuset.trim().match(/\/([a-f0-9]{64})/i);
        if (match && match[1]) {
          this._containerId = match[1];
        }
      }

      // 2. Try reading /proc/self/cgroup
      if (!this._containerId && existsSync("/proc/self/cgroup")) {
        const cgroup = await readFile("/proc/self/cgroup", "utf8");
        const match = cgroup.match(/\/docker\/([a-f0-9]{64})/i) || cgroup.match(/\/([a-f0-9]{64})/i);
        if (match && match[1]) {
          this._containerId = match[1];
        }
      }

      // 3. Fallback to HOSTNAME
      if (!this._containerId && process.env.HOSTNAME) {
        const hostname = process.env.HOSTNAME.trim();
        if (hostname.length === 12 || hostname.length === 64) {
          this._containerId = hostname;
        }
      }

      if (this._containerId) {
        logger.info({ ctx: "self-protection", containerId: this._containerId }, "Dashboard container ID detected");

        // Try to inspect the container to get its name and compose project
        try {
          const { stdout: nameStdout } = await execAsync(`docker inspect --format '{{.Name}}' ${this._containerId}`);
          let name = nameStdout.trim();
          if (name.startsWith("/")) name = name.substring(1);
          if (name) {
            this._containerName = name;
            logger.info({ ctx: "self-protection", containerName: this._containerName }, "Dashboard container name detected");
          }
        } catch (err) {
          logger.debug({ ctx: "self-protection", err }, "Failed to inspect self container name");
        }

        try {
          const { stdout: projectStdout } = await execAsync(`docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' ${this._containerId}`);
          const project = projectStdout.trim();
          if (project && project !== "<no value>") {
            this._composeProject = project;
            logger.info({ ctx: "self-protection", composeProject: this._composeProject }, "Dashboard compose project detected");
          }
        } catch (err) {
          logger.debug({ ctx: "self-protection", err }, "Failed to inspect self container labels");
        }
      } else {
        if (existsSync("/.dockerenv")) {
          logger.warn({ ctx: "self-protection" }, "Running in Docker but container ID could not be resolved");
        } else {
          logger.warn({ ctx: "self-protection" }, "Self-protection disabled (not running in Docker)");
        }
      }
    } catch (err) {
      logger.error({ ctx: "self-protection", err }, "Error during self container detection");
    } finally {
      this._initialized = true;
    }
  }

  isSelf(containerIdOrName: string): boolean {
    if (!this._containerId) return false;
    const clean = containerIdOrName.trim().replace(/^\//, "").toLowerCase();
    
    if (clean === this._containerId.toLowerCase()) return true;
    if (this._containerId.length === 64 && clean === this._containerId.substring(0, 12).toLowerCase()) return true;
    if (this._containerName && clean === this._containerName.toLowerCase()) return true;
    
    return false;
  }

  excludeSelf(containerIds: string[]): string[] {
    if (!this._containerId) return containerIds;
    return containerIds.filter(id => !this.isSelf(id));
  }

  validateDockerCommand(command: string): string | null {
    if (!this._containerId) return null;

    const cmd = command.trim();

    // Check compose down in dashboard directory or similar
    if (cmd.includes("compose down") || cmd.includes("docker-compose down")) {
      return "Cannot bring down the dashboard's own compose stack";
    }

    // Check network prune
    if (cmd.includes("network prune")) {
      return "Cannot run network prune to protect the dashboard's network (ai-twins-network)";
    }

    // Check stop / rm / kill on self container ID or name
    const matches = cmd.match(/\b(stop|rm|kill)\b/i);
    if (matches && matches[1]) {
      const action = matches[1].toLowerCase();
      const parts = cmd.split(/\s+/);
      for (const part of parts) {
        const cleanPart = part.replace(/^-+/, "").replace(/['"]/g, ""); // strip leading dashes and quotes
        if (this.isSelf(cleanPart)) {
          if (action === "stop") return "Cannot stop the dashboard container";
          if (action === "rm") return "Cannot remove the dashboard container";
          if (action === "kill") return "Cannot kill the dashboard container";
          return `Cannot ${action} the dashboard container`;
        }
      }
    }

    return null;
  }
}

export const selfProtection = new SelfProtectionService();
