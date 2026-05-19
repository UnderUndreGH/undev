import React from "react";

interface Props {
  findings: any[];
}

export function ComposeStaticLintInline({ findings }: Props) {
  if (findings.length === 0) return null;

  return (
    <div className="space-y-2 mt-2">
      {findings.map((f, i) => (
        <div key={i} className={`text-xs px-2 py-1 rounded border flex items-start gap-2 ${
          f.severity === 'error' ? 'bg-red-950/20 border-red-900 text-red-400' : 'bg-amber-950/20 border-amber-900 text-amber-400'
        }`}>
          <span className="font-bold">[{f.rule}]</span>
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  );
}
