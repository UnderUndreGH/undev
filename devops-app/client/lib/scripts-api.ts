/** Feature 016 T018 — typed REST client for script management & execution. */
import { api } from "./api.js";

export interface Script {
  id: string;
  path: string;
  name: string;
  description: string | null;
  source: "filesystem" | "database";
  content: string | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptParam {
  id: string;
  scriptId: string;
  name: string;
  type: "string" | "number" | "boolean" | "select";
  defaultValue: string | null;
  description: string | null;
  options: string[] | null;
  order: number;
}

export interface ScriptExecution {
  id: string;
  scriptId: string;
  serverId: string;
  status: "pending" | "running" | "completed" | "failed";
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logFilePath: string | null;
  initiatedBy: string;
  params: Record<string, string> | null;
}

export type ScriptWithParams = Script & { params: ScriptParam[] };

export interface ReindexResult {
  indexed: number;
  added: number;
  updated: number;
  removed: number;
}

export const scriptsApi = {
  list: (): Promise<Script[]> => api.get<Script[]>("/scripts"),

  get: (id: string): Promise<ScriptWithParams> =>
    api.get<ScriptWithParams>(`/scripts/${id}`),

  create: (data: {
    name: string;
    path: string;
    description?: string;
    content: string;
  }): Promise<Script> => api.post<Script>("/scripts", data),

  update: (
    id: string,
    data: {
      name?: string;
      description?: string;
      content?: string;
    },
  ): Promise<Script> => api.put<Script>(`/scripts/${id}`, data),

  delete: (id: string): Promise<void> => api.delete(`/scripts/${id}`),

  execute: (
    id: string,
    serverId: string,
    params?: Record<string, string>,
  ): Promise<{ executionId: string }> =>
    api.post<{ executionId: string }>(`/scripts/${id}/execute`, {
      serverId,
      params,
    }),

  getExecution: (executionId: string): Promise<ScriptExecution> =>
    api.get<ScriptExecution>(`/scripts/executions/${executionId}`),

  reindex: (): Promise<ReindexResult> =>
    api.post<ReindexResult>("/scripts/reindex"),
};
