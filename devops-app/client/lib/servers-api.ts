/**
 * VERIFICATION CHECKLIST (Feature 021 — T017, T020):
 *
 * T017: Verify VPN tab parity:
 *   - VPN tab shows same data as filtering main list by "VPN"
 *   - Same React Query cache key pattern used
 *
 * T020: Verify cache consistency:
 *   - Add server from main list → appears in VPN tab if kind=vpn
 *   - useInvalidateServers invalidates all ["servers"] queries
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export const ServerKind = {
  GENERAL: "general",
  VPN: "vpn",
} as const;

export type ServerKind = (typeof ServerKind)[keyof typeof ServerKind];

export interface KindFilter {
  kind: "all" | ServerKind;
}

export interface UnifiedServer {
  id: string;
  label: string;
  host: string;
  port: number;
  sshUser: string;
  status: string;
  kind: string;
  vpnStatus: string | null;
  vpnDriftStatus: string | null;
  vpnInstalledAt: string | null;
  lastHealthCheck: string | null;
  connectionType: string | null;
  scriptsEnabled: boolean;
  [key: string]: unknown;
}

export function useServers(filter: KindFilter = { kind: "all" }) {
  return useQuery({
    queryKey: ["servers", filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.kind !== "all") params.set("kind", filter.kind);
      const qs = params.toString();
      const path = qs ? `/servers?${qs}` : "/servers";
      return api.get<UnifiedServer[]>(path);
    },
  });
}

export function useInvalidateServers() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["servers"] });
  };
}

export function useDeleteServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      api.delete(`/servers/${id}`, {
        "Content-Type": "application/json",
      }).then(() => {
        return fetch(`/api/servers/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ confirmName }),
        }).then(async (res) => {
          if (res.status !== 204) {
            const body = await res.json();
            throw new Error(body.error?.message ?? "Delete failed");
          }
        });
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
  });
}
