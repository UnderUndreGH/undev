import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export interface Script {
  id: string;
  path: string;
  name: string;
  description: string | null;
  source: "filesystem" | "database" | "upload" | "feature-005" | "feature-016";
  content: string | null;
  contentHash: string | null;
  parameterSchema: Record<string, unknown> | null;
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

export interface ScannerViolation {
  pattern: string;
  line: number;
  description: string;
}

export interface UploadResult {
  id: number;
  name: string;
  contentHash: string;
  parameterSchema: Record<string, unknown> | null;
  source: string;
  warnings?: ScannerViolation[];
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxed: boolean;
  durationMs: number;
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

  upload: async (data: {
    file: File;
    name: string;
    description?: string;
  }): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", data.file);
    form.append("name", data.name);
    if (data.description) form.append("description", data.description);

    const res = await fetch("/api/scripts/upload", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });

    const body = await res.json();
    if (!res.ok) {
      throw { status: res.status, ...body };
    }
    return body as UploadResult;
  },

  uploadUpdate: async (
    id: number,
    data: {
      file?: File;
      name?: string;
      description?: string;
    },
  ): Promise<Script> => {
    const form = new FormData();
    if (data.file) form.append("file", data.file);
    if (data.name) form.append("name", data.name);
    if (data.description) form.append("description", data.description);

    const res = await fetch(`/api/scripts/${id}`, {
      method: "PUT",
      credentials: "same-origin",
      body: form,
    });

    const body = await res.json();
    if (!res.ok) {
      throw { status: res.status, ...body };
    }
    return body as Script;
  },

  executeScript: (
    id: string | number,
    payload: { serverId: number; parameters: Record<string, unknown> },
  ): Promise<ExecutionResult> =>
    api.post<ExecutionResult>(`/scripts/${id}/execute`, payload),
};

export function useScripts() {
  return useQuery({
    queryKey: ["scripts"],
    queryFn: () => scriptsApi.list(),
  });
}

export function useScript(id: string | null) {
  return useQuery({
    queryKey: ["scripts", id],
    queryFn: () => scriptsApi.get(id!),
    enabled: id !== null,
  });
}

export function useUploadScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: scriptsApi.upload,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });
}

export function useUpdateScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: number } & Parameters<typeof scriptsApi.uploadUpdate>[1]) =>
      scriptsApi.uploadUpdate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });
}

export function useDeleteScript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.delete(`/scripts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });
}

export function useExecuteScript() {
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string | number;
      serverId: number;
      parameters: Record<string, unknown>;
    }) => scriptsApi.executeScript(id, payload),
  });
}
