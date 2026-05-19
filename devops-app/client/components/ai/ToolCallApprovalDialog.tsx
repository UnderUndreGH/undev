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
  const [cooldownActive, setCooldownActive] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  
  // C20: Use dangerLevel from server instead of substring matching
  const isHighDanger = toolCall.dangerLevel === "high";
  const isMediumDanger = toolCall.dangerLevel === "medium";

  // C22: The expected confirmation string is the target name
  const expectedConfirm = toolCall.targetServerName ?? toolCall.targetAppName ?? toolCall.manifestId;
  const typedMatch = typedConfirm === expectedConfirm;

  // C21: Cooldown starts after typed-confirm match, not on mount
  useEffect(() => {
    if (!isHighDanger || !typedMatch) {
      setCooldown(5);
      setCooldownActive(false);
      return;
    }
    setCooldownActive(true);
    const timer = setInterval(() => {
      setCooldown(c => {
        const next = Math.max(0, c - 1);
        if (next === 0) clearInterval(timer);
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isHighDanger, typedMatch]);

  // L2: Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // L2: Focus management on open
  useEffect(() => {
    if (isHighDanger) {
      inputRef.current?.focus();
    } else {
      cancelRef.current?.focus();
    }
  }, [isHighDanger]);

  const canApprove = !isHighDanger || (typedMatch && cooldown === 0 && cooldownActive);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title" className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 id="approval-dialog-title" className="text-xl font-bold mb-2">Confirm Action</h2>
        <p className="text-sm text-gray-400 mb-6">
          Review the parameters for <span className="text-gray-200 font-mono">{toolCall.manifestId}</span> before execution.
        </p>

        <div className="space-y-4 mb-8">
           {isHighDanger && (
             <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg space-y-3">
                <p className="text-xs text-red-400 font-bold uppercase tracking-wider">High Danger Action</p>
                <p className="text-sm text-red-200">This action is destructive. Type the target name to confirm.</p>
                <input
                  ref={inputRef}
                  type="text"
                  value={typedConfirm}
                  onChange={e => setTypedConfirm(e.target.value)}
                  placeholder={expectedConfirm}
                  className="w-full bg-gray-950 border border-red-900/50 rounded px-3 py-2 text-sm text-white focus:outline-none"
                />
             </div>
           )}

           {isMediumDanger && !isHighDanger && (
             <p className="text-sm text-amber-400">
               This action modifies system state. Proceed with caution.
             </p>
           )}
        </div>

        <div className="flex gap-3">
          <button
            ref={cancelRef}
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
