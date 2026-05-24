import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";

export interface ArchivedServer {
  id: string;
  label: string;
  host: string;
  deletedAt: string;
  remainingDays: number;
  approachingDeadline: boolean;
}

export function useArchivedServers() {
  return useQuery<ArchivedServer[]>({
    queryKey: ["servers", "archived"],
    queryFn: () => api.get("/servers/archived"),
  });
}

async function deleteServerRequest(serverId: string, confirmName: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ confirmName }),
  });

  if (res.status === 204) return;

  const body = await res.json();
  if (!res.ok) {
    const err = body.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? "UNKNOWN",
      err.message ?? "Delete failed",
      err.details,
    );
  }
}

export function useDeleteServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ serverId, confirmName }: { serverId: string; confirmName: string }) =>
      deleteServerRequest(serverId, confirmName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["servers", "archived"] });
    },
  });
}

export function useRestoreServer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (serverId: string) =>
      api.post(`/servers/${serverId}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["servers", "archived"] });
    },
  });
}
