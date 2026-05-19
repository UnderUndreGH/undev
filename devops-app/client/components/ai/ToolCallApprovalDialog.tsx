import React, { useState, useEffect } from "react";
import { AiToolCall } from "../../hooks/useAiConversation.js";

interface Props {
  toolCall: AiToolCall;
  onClose: () => void;
  onApprove: (params?: any) => void;
  isPending: boolean;
}

export function ToolCallApprovalDialog({ toolCall, onClose, onApprove, isPending }: Props) {
  const [typedConfirm, setTypedConfirm] = useState("");
  const [cooldown, setCooldown] = useState(5);
  
  // Danger level detection (simplified for now)
  const isHighDanger = toolCall.manifestId.includes('hard-delete') || toolCall.manifestId.includes('restore');
  const isMediumDanger = !isHighDanger && (toolCall.manifestId.includes('deploy') || toolCall.manifestId.includes('rollback'));

  useEffect(() => {
    if (!isHighDanger) return;
    const timer = setInterval(() => {
      setCooldown(c => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isHighDanger]);

  const canApprove = !isHighDanger || (typedConfirm === toolCall.manifestId && cooldown === 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-xl font-bold mb-2">Confirm Action</h2>
        <p className="text-sm text-gray-400 mb-6">
          Review the parameters for <span className="text-gray-200 font-mono">{toolCall.manifestId}</span> before execution.
        </p>

        <div className="space-y-4 mb-8">
           {isHighDanger && (
             <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg space-y-3">
                <p className="text-xs text-red-400 font-bold uppercase tracking-wider">High Danger Action</p>
                <p className="text-sm text-red-200">This action is destructive. Type the tool ID to confirm.</p>
                <input 
                  type="text"
                  value={typedConfirm}
                  onChange={e => setTypedConfirm(e.target.value)}
                  placeholder={toolCall.manifestId}
                  className="w-full bg-gray-950 border border-red-900/50 rounded px-3 py-2 text-sm text-white focus:outline-none"
                />
             </div>
           )}

           {isMediumDanger && !isHighDanger && (
             <p className="text-sm text-amber-400">
               ⚠️ This action modifies system state. Proceed with caution.
             </p>
           )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 text-gray-300 py-2 rounded-lg font-bold hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onApprove()}
            disabled={!canApprove || isPending}
            className={`flex-1 py-2 rounded-lg font-bold transition-all disabled:opacity-50 ${
              isHighDanger ? "bg-red-600 text-white" : "bg-brand-purple text-white"
            }`}
          >
            {isPending ? "Starting..." : isHighDanger && cooldown > 0 ? `Wait ${cooldown}s` : "Execute Action"}
          </button>
        </div>
      </div>
    </div>
  );
}
