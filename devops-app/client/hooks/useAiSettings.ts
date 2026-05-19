import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface AiSettings {
  enabled: boolean;
  defaultProvider: string | null;
  systemPromptContent: string | null;
  monthlyTokenBudgetIn: number;
  monthlyTokenBudgetOut: number;
  perIncidentTokenCapIn: number;
  perIncidentTokenCapOut: number;
  globalToolUseEnabled: boolean;
  globalKillSwitchEngaged: boolean;
  defaultSandbox: boolean;
  conversationRetentionDays: number;
  maxConversationDurationMinutes: number;
  updatedAt: string;
}

export function useAiSettings() {
  return useQuery<AiSettings>({
    queryKey: ["ai", "settings"],
    queryFn: () => api.get("/ai/settings"),
  });
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<AiSettings>) => api.put("/ai/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "settings"] });
    },
  });
}

export function useToggleKillSwitch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (engaged: boolean) => api.put("/ai/settings/kill-switch", { engaged }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "settings"] });
    },
  });
}
