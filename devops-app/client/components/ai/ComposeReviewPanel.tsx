import React from "react";
import { useComposeReview } from "../../hooks/useComposeReview.js";

interface Props {
  appId: string;
  content: string;
}

export function ComposeReviewPanel({ appId, content }: Props) {
  const { review } = useComposeReview();

  const handleReview = () => {
    review.mutate({ appId, content });
  };

  const allFindings = [...(review.data?.staticFindings ?? []), ...(review.data?.llmFindings ?? [])];

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Compose Review</h3>
        <button
          onClick={handleReview}
          disabled={review.isPending}
          className="text-xs bg-brand-purple/10 border border-brand-purple/30 text-brand-purple px-2 py-1 rounded hover:bg-brand-purple/20 transition-colors disabled:opacity-50"
        >
          {review.isPending ? "Analysing..." : "✨ Review with AI"}
        </button>
      </div>

      {review.data && (
        <div className="space-y-2">
           {allFindings.length === 0 ? (
             <div className="text-xs text-green-500">✓ No issues found.</div>
           ) : (
             allFindings.map((f, i) => (
               <div key={i} className="text-xs p-2 bg-gray-900 border border-gray-800 rounded">
                  <div className="flex items-center justify-between mb-1">
                     <span className={`font-bold uppercase text-[9px] px-1 rounded ${
                       f.severity === 'error' ? 'bg-red-900 text-red-100' : 'bg-amber-900 text-amber-100'
                     }`}>{f.severity}</span>
                     <span className="text-[9px] text-gray-600 font-mono">{f.rule}</span>
                  </div>
                  <div className="text-gray-300">{f.message}</div>
               </div>
             ))
           )}
        </div>
      )}
    </div>
  );
}
