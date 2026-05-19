import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useToolCallApproval(conversationId: string) {
  const queryClient = useQueryClient();

  const approve = useMutation({
    mutationFn: ({ id, paramsOverride, challengeId }: { id: string, paramsOverride?: any, challengeId?: string }) =>
      api.post(`/ai/tool-calls/${id}/approve`, { paramsOverride, challengeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "conversation", conversationId] });
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/ai/tool-calls/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "conversation", conversationId] });
    },
  });

  const getChallenge = useMutation({
    mutationFn: (id: string) => api.post<{ challengeId: string, cooldownSeconds: number }>(`/ai/tool-calls/${id}/challenge`),
  });

  return { approve, reject, getChallenge };
}
