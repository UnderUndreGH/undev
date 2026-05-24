import React from "react";
import type { ExecutionResult } from "../../lib/scripts-api.js";

interface Props {
  result: ExecutionResult;
}

export function ScriptResult({ result }: Props): React.JSX.Element {
  const success = result.exitCode === 0;
  const borderColor = success ? "border-green-700" : "border-red-700";
  const bgColor = success ? "bg-green-900/20" : "bg-red-900/20";

  return (
    <div className={`mt-4 border ${borderColor} ${bgColor} rounded p-4 space-y-3`}>
      <div className="flex items-center gap-3 text-sm">
        <span
          className={`px-2 py-0.5 rounded text-xs font-mono ${
            success
              ? "bg-green-900/60 text-green-200 border border-green-700"
              : "bg-red-900/60 text-red-200 border border-red-700"
          }`}
        >
          exit {result.exitCode}
        </span>
        <span className="text-neutral-400">
          {result.durationMs}ms
        </span>
        {result.sandboxed && (
          <span className="px-2 py-0.5 text-xs bg-blue-900/40 text-blue-300 border border-blue-700 rounded">
            sandboxed
          </span>
        )}
      </div>

      {result.stdout && (
        <div>
          <div className="text-xs text-neutral-400 mb-1">stdout</div>
          <pre className="bg-neutral-950 border border-neutral-800 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono">
            {result.stdout}
          </pre>
        </div>
      )}

      {result.stderr && (
        <div>
          <div className="text-xs text-red-400 mb-1">stderr</div>
          <pre className="bg-neutral-950 border border-red-900/50 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono text-red-300">
            {result.stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
