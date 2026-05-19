import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useWebSocket } from "./useWebSocket.js";

export interface AiMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  contentText: string;
  createdAt: string;
}

export interface AiToolCall {
  id: string;
  manifestId: string;
  paramsJson: any;
  status: string;
  dangerLevel: 'high' | 'medium' | 'low';
  targetServerName: string | null;
  targetAppName: string | null;
}

export interface AiConversation {
  id: string;
  status: string;
  sandboxMode: boolean;
  hypothesis: string | null;
  confidence: string | null;
  messages: AiMessage[];
  toolCalls: AiToolCall[];
}

export function useAiConversation(id: string | undefined) {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();

  const query = useQuery<AiConversation>({
    queryKey: ["ai", "conversation", id],
    queryFn: () => api.get(`/ai/conversations/${id}`),
    enabled: !!id,
  });

  const [streamedText, setStreamedText] = useState("");

  useEffect(() => {
    if (!id) return;

    const channel = `ai:${id}`;
    
    const handler = (event: any) => {
      if (event.type === "delta") {
        setStreamedText((prev) => prev + event.content);
      } else if (event.type === "complete" || event.type === "tool_call" || event.type === "error") {
        queryClient.invalidateQueries({ queryKey: ["ai", "conversation", id] });
        if (event.type === "complete") setStreamedText("");
      }
    };

    const unsubscribe = subscribe(channel, handler);
    return () => unsubscribe();
  }, [id, subscribe, queryClient]);

  return { ...query, streamedText };
}

export function useCreateAiConversation() {
  return useMutation({
    mutationFn: (data: { targetKind: string; targetId: string | null }) => 
      api.post<{ id: string }>("/ai/conversations", data),
  });
}
