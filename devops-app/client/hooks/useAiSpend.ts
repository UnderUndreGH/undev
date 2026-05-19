import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface AiSpend {
  monthStart: string;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
}

export function useAiSpend() {
  return useQuery<AiSpend>({
    queryKey: ["ai", "spend"],
    queryFn: () => api.get("/ai/spend"),
  });
}

export function useAiSpendConversations() {
  return useQuery<any[]>({
    queryKey: ["ai", "spend", "conversations"],
    queryFn: () => api.get("/ai/spend/conversations"),
  });
}
