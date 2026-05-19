import React from "react";
import { useAiConversation } from "../../hooks/useAiConversation.js";
import { useAiSettings, useUpdateAiSettings } from "../../hooks/useAiSettings.js";
import { HypothesisPanel } from "./HypothesisPanel.js";
import { ContextSummary } from "./ContextSummary.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ActivityTimeline } from "./ActivityTimeline.js";
import { SandboxBadge } from "./SandboxBadge.js";

interface Props {
  conversationId: string;
}

export function IncidentView({ conversationId }: Props) {
  const { data: convo, isLoading, streamedText } = useAiConversation(conversationId);

  if (isLoading) {
    return <div className="p-8 animate-pulse text-gray-500">Loading analysis...</div>;
  }

  if (!convo) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-bold">Incident Analysis</h1>
          <div className="text-xs text-gray-500 font-mono mt-0.5">{convo.id}</div>
        </div>
        <div className="flex items-center gap-3">
          {convo.sandboxMode && <SandboxBadge />}
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
            convo.status === 'completed' ? 'bg-green-900/20 border-green-800 text-green-400' :
            convo.status === 'streaming' ? 'bg-brand-purple/20 border-brand-purple text-brand-purple animate-pulse' :
            convo.status === 'error' ? 'bg-red-900/20 border-red-800 text-red-400' :
            'bg-gray-800 border-gray-700 text-gray-400'
          }`}>
            {convo.status}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        <ContextSummary conversation={convo} />
        
        <HypothesisPanel 
          hypothesis={convo.hypothesis} 
          confidence={convo.confidence} 
          streamedText={streamedText}
          status={convo.status}
        />

        {convo.toolCalls.length > 0 && (
          <div className="space-y-4">
             <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">Proposed Actions</h3>
             {convo.toolCalls.map(tc => (
               <ToolCallCard key={tc.id} toolCall={tc} conversationId={convo.id} />
             ))}
          </div>
        )}

        <ActivityTimeline />
      </div>
    </div>
  );
}
