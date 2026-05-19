import React from "react";

interface Props {
  hypothesis: string | null;
  confidence: string | null;
  streamedText: string;
  status: string;
}

export function HypothesisPanel({ hypothesis, confidence, streamedText, status }: Props) {
  const content = hypothesis || streamedText;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl">
      <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-800 flex items-center justify-between">
        <h3 className="font-bold text-sm uppercase tracking-tight text-gray-300">Root Cause Hypothesis</h3>
        {confidence && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
            confidence === 'high' ? 'bg-green-500 text-black' :
            confidence === 'medium' ? 'bg-amber-500 text-black' :
            'bg-gray-500 text-white'
          }`}>
            {confidence} Confidence
          </span>
        )}
      </div>
      
      <div className="p-4 md:p-6 prose prose-invert prose-sm max-w-none">
        {content ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div className="flex items-center gap-3 text-gray-500 italic">
            <div className="w-4 h-4 border-2 border-brand-purple border-t-transparent rounded-full animate-spin"></div>
            Analysing evidence...
          </div>
        )}
      </div>
    </div>
  );
}
