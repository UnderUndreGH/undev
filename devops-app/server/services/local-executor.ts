import { Duplex, Readable } from "node:stream";
import { spawn, execFile, ChildProcess } from "node:child_process";
import { logger } from "../lib/logger.js";

// Simple Promise-based Semaphore queue to prevent event loop starvation
class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }
}

const localSpawnSemaphore = new Semaphore(10);

export class ClientChannelAdapter extends Duplex {
  public stderr: Readable;
  private child: ChildProcess;

  constructor(child: ChildProcess, onCleanup: () => void) {
    super({
      write(chunk, encoding, callback) {
        if (child.stdin && child.stdin.writable) {
          if (!child.stdin.write(chunk, encoding)) {
            child.stdin.once("drain", callback);
          } else {
            process.nextTick(callback);
          }
        } else {
          callback(new Error("stdin is not writable"));
        }
      },
      final(callback) {
        if (child.stdin) {
          child.stdin.end(callback);
        } else {
          callback();
        }
      },
      read() {
        if (child.stdout) {
          child.stdout.resume();
        }
      }
    });

    this.child = child;
    this.stderr = child.stderr || new Readable({ read() { this.push(null); } });

    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        onCleanup();
      }
    };

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        if (!this.push(chunk)) {
          child.stdout?.pause();
        }
      });
      child.stdout.on("end", () => {
        this.push(null);
      });
      child.stdout.on("error", (err) => {
        this.emit("error", err);
      });
    } else {
      this.push(null);
    }

    let exitCode: number | null = null;

    child.on("exit", (code) => {
      exitCode = code;
    });

    child.on("close", (code) => {
      cleanup();
      const finalCode = code ?? exitCode ?? 0;
      this.emit("close", finalCode);
    });

    child.on("error", (err) => {
      cleanup();
      this.emit("error", err);
    });
  }

  signal(name: string) {
    const signalName = name.startsWith("SIG") ? name : `SIG${name}`;
    this.child.kill(signalName as NodeJS.Signals);
  }

  close() {
    this.child.kill("SIGTERM");
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function localExec(command: string, timeoutMs?: number): Promise<ExecResult> {
  await localSpawnSemaphore.acquire();
  logger.debug({ command, timeoutMs }, "Acquired local spawn slot for exec");

  try {
    return await new Promise<ExecResult>((resolve) => {
      const options = {
        maxBuffer: 50 * 1024 * 1024,
        timeout: timeoutMs,
      };

      execFile("bash", ["-c", command], options, (error, stdout, stderr) => {
        localSpawnSemaphore.release();
        logger.debug("Released local spawn slot after exec");

        if (error) {
          const exitCode = typeof error.code === "number" ? error.code : 1;
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString() || error.message,
            exitCode,
          });
        } else {
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
          });
        }
      });
    });
  } catch (err) {
    localSpawnSemaphore.release();
    logger.error({ err, command }, "Failed to execute local command");
    throw err;
  }
}

export interface StreamResult {
  stream: ClientChannelAdapter;
  kill: () => void;
}

export async function localExecStream(command: string): Promise<StreamResult> {
  await localSpawnSemaphore.acquire();
  logger.debug({ command }, "Acquired local spawn slot for execStream");

  let released = false;
  const releaseSlot = () => {
    if (!released) {
      released = true;
      localSpawnSemaphore.release();
      logger.debug("Released local spawn slot after execStream process closed");
    }
  };

  try {
    const child = spawn("bash", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stream = new ClientChannelAdapter(child, releaseSlot);

    child.on("error", () => {
      releaseSlot();
    });

    return {
      stream,
      kill: () => {
        child.kill("SIGKILL");
        releaseSlot();
      },
    };
  } catch (err) {
    releaseSlot();
    logger.error({ err, command }, "Failed to spawn local stream process");
    throw err;
  }
}
