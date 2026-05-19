import React, { useState } from "react";
import { AiToolCall } from "../../hooks/useAiConversation.js";
import { useToolCallApproval } from "../../hooks/useToolCallApproval.js";
import { ToolCallApprovalDialog } from "./ToolCallApprovalDialog.js";

interface Props {
  toolCall: AiToolCall;
  conversationId: string;
}

export function ToolCallCard({ toolCall, conversationId }: Props) {
  const { approve, reject } = useToolCallApproval(conversationId);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);

  const statusColors: Record<string, string> = {
    proposed: "bg-amber-900/20 border-amber-800 text-amber-400",
    approved: "bg-green-900/20 border-green-800 text-green-400",
    executing: "bg-blue-900/20 border-blue-800 text-blue-400 animate-pulse",
    completed: "bg-green-500 text-black",
    failed: "bg-red-500 text-white",
    rejected: "bg-gray-800 border-gray-700 text-gray-500",
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-200">{toolCall.manifestId}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusColors[toolCall.status] ?? ""}`}>
            {toolCall.status}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="text-[10px] uppercase font-bold text-gray-500 block mb-1">Parameters</label>
          <pre className="text-xs bg-gray-950 p-2 rounded border border-gray-800 overflow-x-auto text-gray-400 font-mono">
            {JSON.stringify(toolCall.paramsJson, null, 2)}
          </pre>
        </div>

        {toolCall.status === 'proposed' && (
          <div className="flex gap-3 justify-end pt-2">
            <button
              onClick={() => reject.mutate(toolCall.id)}
              disabled={reject.isPending}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Reject
            </button>
            <button
              onClick={() => setIsApprovalOpen(true)}
              className="bg-brand-purple text-white px-4 py-1.5 rounded-md text-sm font-bold hover:opacity-90 transition-all shadow-lg"
            >
              Approve
            </button>
          </div>
        )}
      </div>

      {isApprovalOpen && (
        <ToolCallApprovalDialog
          toolCall={toolCall}
          onClose={() => setIsApprovalOpen(false)}
          onApprove={(params) => approve.mutate({ id: toolCall.id, paramsOverride: params })}
          isPending={approve.isPending}
        />
      )}
    </div>
  );
}
