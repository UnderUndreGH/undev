import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";

interface Props {
  targetKind: string;
  targetId: string | null;
}

export function AiBadge({ targetKind, targetId }: Props) {
  // Query for latest push conversation for this target
  const { data: conversations } = useQuery<any[]>({
    queryKey: ["ai", "conversations", "push", targetKind, targetId],
    queryFn: () => api.get(`/ai/conversations?trigger=push&targetKind=${targetKind}&targetId=${targetId || ''}`),
    refetchInterval: 30000, // Poll every 30s
  });

  const latest = conversations?.[0];
  if (!latest) return null;

  // Only show if created in the last hour
  const isRecent = (Date.now() - new Date(latest.createdAt).getTime()) < 3600000;
  if (!isRecent) return null;

  return (
    <Link
      to={`/incidents/${latest.id}`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-brand-purple/10 border border-brand-purple/30 text-brand-purple text-[10px] font-bold uppercase hover:bg-brand-purple/20 transition-colors"
    >
      <span className="animate-pulse">✨</span>
      AI Analyzed
    </Link>
  );
}
