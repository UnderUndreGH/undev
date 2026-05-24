import React, { useState } from "react";
import {
  useScripts,
  useDeleteScript,
  type Script,
  type ExecutionResult,
} from "../../lib/scripts-api.js";
import { ScriptExecuteForm } from "./ScriptExecuteForm.js";
import { ScriptResult } from "./ScriptResult.js";

interface Props {
  isAdmin: boolean;
}

function paramCount(schema: Record<string, unknown> | null): number {
  if (!schema || !schema.properties) return 0;
  return Object.keys(schema.properties as Record<string, unknown>).length;
}

export function ScriptLibrary({ isAdmin }: Props): React.JSX.Element {
  const { data: scripts, isLoading, error } = useScripts();
  const deleteMutation = useDeleteScript();

  const [executing, setExecuting] = useState<Script | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  const handleDelete = async (s: Script) => {
    if (!confirm(`Delete script "${s.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(s.id);
    } catch {
      // mutation handles cache invalidation
    }
  };

  if (isLoading) return <div className="p-4 text-neutral-500">Loading scripts…</div>;
  if (error) return <div className="p-4 text-red-500">Failed to load scripts: {(error as Error).message}</div>;
  if (!scripts || scripts.length === 0) return <div className="p-4 text-neutral-500">No scripts available.</div>;

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-700 text-left text-xs text-neutral-400 uppercase">
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Source</th>
            <th className="pb-2 pr-4">Params</th>
            <th className="pb-2 pr-4">Last Modified</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map((s) => (
            <tr key={s.id} className="border-b border-neutral-800">
              <td className="py-2 pr-4">
                <div className="font-mono">{s.name}</div>
                {s.description && (
                  <div className="text-xs text-neutral-400 mt-0.5">{s.description}</div>
                )}
              </td>
              <td className="py-2 pr-4 text-neutral-400">{s.source}</td>
              <td className="py-2 pr-4 text-neutral-400">{paramCount(s.parameterSchema)}</td>
              <td className="py-2 pr-4 text-neutral-400">
                {new Date(s.updatedAt).toLocaleString()}
              </td>
              <td className="py-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs bg-blue-600 hover:bg-blue-500 rounded"
                    onClick={() => {
                      setExecuting(s);
                      setResult(null);
                      setExecError(null);
                    }}
                  >
                    Execute
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className="px-2 py-0.5 text-xs bg-neutral-700 hover:bg-neutral-600 rounded"
                        onClick={() => {
                          setExecuting(s);
                          setResult(null);
                          setExecError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="px-2 py-0.5 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded"
                        disabled={deleteMutation.isPending}
                        onClick={() => handleDelete(s)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {executing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Execute: {executing.name}</h2>
                {executing.description && (
                  <p className="text-sm text-neutral-400 mt-1">{executing.description}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Close"
                className="text-neutral-400 hover:text-white"
                onClick={() => {
                  setExecuting(null);
                  setResult(null);
                  setExecError(null);
                }}
              >
                ✕
              </button>
            </div>

            <ScriptExecuteForm
              script={executing}
              onResult={(r) => setResult(r)}
              onError={(e) => setExecError(e)}
            />

            {execError && (
              <div className="mt-3 p-2 bg-red-900/30 border border-red-700 text-red-200 text-sm rounded">
                {execError}
              </div>
            )}

            {result && <ScriptResult result={result} />}
          </div>
        </div>
      )}
    </div>
  );
}
