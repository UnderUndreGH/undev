/**
 * Feature 013: Canned responses for tool calls in sandbox mode.
 */

export interface SandboxFixture {
  status: string;
  note: string;
  exitCode: number;
}

const FIXTURES: Record<string, SandboxFixture> = {
  "deploy/server-deploy": {
    status: "skipped",
    note: "sandbox: deploy execution bypassed",
    exitCode: 0,
  },
  "deploy/server-rollback": {
    status: "skipped",
    note: "sandbox: rollback execution bypassed",
    exitCode: 0,
  },
  "db/backup": {
    status: "ok",
    note: "sandbox: backup simulated (no file created)",
    exitCode: 0,
  },
  "db/restore": {
    status: "skipped",
    note: "sandbox: restore bypassed (destructive)",
    exitCode: 0,
  },
  "docker/cleanup": {
    status: "ok",
    note: "sandbox: cleanup simulated",
    exitCode: 0,
  },
  "server-ops/initialise": {
    status: "skipped",
    note: "sandbox: server initialization bypassed",
    exitCode: 0,
  },
};

const DEFAULT_FIXTURE: SandboxFixture = {
  status: "ok",
  note: "dry-run (sandbox)",
  exitCode: 0,
};

/**
 * Returns a canned response for a given manifest ID when in sandbox mode.
 */
export function getSandboxFixture(manifestId: string): SandboxFixture {
  return FIXTURES[manifestId] ?? DEFAULT_FIXTURE;
}
