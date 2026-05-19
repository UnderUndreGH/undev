import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export interface AiProviderKey {
  id: string;
  provider: "anthropic" | "openai" | "ollama";
  modelDefault: string;
  endpointUrl: string | null;
  isActive: boolean;
  rateCardInputPerMtok: number | null;
  rateCardOutputPerMtok: number | null;
  createdAt: string;
  rotatedAt: string | null;
}

export interface CreateProviderData {
  provider: string;
  modelDefault: string;
  endpointUrl?: string | null;
  apiKey: string;
  rateCardInputPerMtok?: number;
  rateCardOutputPerMtok?: number;
}

export function useAiProviders() {
  return useQuery<AiProviderKey[]>({
    queryKey: ["ai", "providers"],
    queryFn: () => api.get("/ai/providers"),
  });
}

export function useCreateAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProviderData) => api.post("/ai/providers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "providers"] });
    },
  });
}

export function useDeleteAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/ai/providers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai", "providers"] });
    },
  });
}

export function useTestAiProvider() {
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; latencyMs: number; error?: string }>(`/ai/providers/${id}/test`),
  });
}
