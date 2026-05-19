import React from "react";
import { AiConversation } from "../../hooks/useAiConversation.js";

interface Props {
  conversation: AiConversation;
}

export function ContextSummary({ conversation }: Props) {
  // Extract summary from first message (the context document)
  const contextMsg = conversation.messages.find(m => m.role === 'user' && m.contentText.includes('<context-source'));
  
  if (!contextMsg) return null;

  const sourceCount = (contextMsg.contentText.match(/<context-source/g) || []).length;

  return (
    <div className="flex items-center gap-4 text-sm text-gray-400">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
        <span>{sourceCount} data sources aggregated</span>
      </div>
      <div className="text-gray-700">|</div>
      <div>Target: <span className="text-gray-300 font-medium">manual</span></div>
    </div>
  );
}
