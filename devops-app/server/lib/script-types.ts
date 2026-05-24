export type ScriptSourceValue = "upload" | "feature-005" | "feature-016";

export type AuditActionValue =
  | "upload"
  | "update"
  | "delete"
  | "execute"
  | "integrity-failure"
  | "scanner-warn";

export type ActorRoleValue = "admin" | "user" | "system";

export interface ScriptParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      default?: unknown;
      enum?: string[];
      items?: Record<string, unknown>;
      "x-secret"?: boolean;
    }
  >;
  required?: string[];
}

export interface Script {
  id: string;
  name: string;
  description: string | null;
  contentHash: string;
  filePath: string;
  parameterSchema: ScriptParameterSchema | null;
  source: ScriptSourceValue;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorRole: ActorRoleValue;
  action: AuditActionValue;
  scriptId: string | null;
  scriptName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ScannerViolation {
  pattern: string;
  line: number;
  description: string;
  layer: "unescape" | "ast" | "regex" | "indirection";
}

export interface ScriptUploadResult {
  id: string;
  name: string;
  contentHash: string;
  parameterSchema: ScriptParameterSchema | null;
  source: ScriptSourceValue;
  scannerViolations: ScannerViolation[];
}

export interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxed: boolean;
  durationMs: number;
}
