import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useComposeReview() {
  const lint = useMutation({
    mutationFn: (content: string) => api.post<{ findings: any[] }>("/ai/compose-review/lint", { content }),
  });

  const review = useMutation({
    mutationFn: ({ appId, content }: { appId: string, content: string }) => 
      api.post<{ staticFindings: any[], llmFindings: any[], cachedAt: string }>("/ai/compose-review/review", { appId, content }),
  });

  return { lint, review };
}
