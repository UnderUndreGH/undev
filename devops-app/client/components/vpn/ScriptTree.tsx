/** Feature 016 T019 — navigable script tree grouped by directory prefix. */
import React, { useMemo } from "react";
import type { Script, ScriptParam } from "../../lib/scripts-api.js";

export type ScriptWithParams = Script & { params: ScriptParam[] };

interface Props {
  scripts: Script[];
  onSelect: (script: ScriptWithParams) => void;
  onRescan: () => void;
  rescanLoading?: boolean;
}

function dirPrefix(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "" : path.slice(0, idx);
}

export function ScriptTree({
  scripts,
  onSelect,
  onRescan,
  rescanLoading,
}: Props): React.JSX.Element {
  const grouped = useMemo(() => {
    const map = new Map<string, Script[]>();
    for (const s of scripts) {
      const dir = dirPrefix(s.path);
      const list = map.get(dir) ?? [];
      list.push(s);
      map.set(dir, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scripts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Scripts
        </h3>
        <button
          type="button"
          onClick={onRescan}
          disabled={rescanLoading}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          {rescanLoading ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {scripts.length === 0 ? (
        <p className="text-sm text-neutral-500 italic">No scripts found.</p>
      ) : (
        grouped.map(([dir, entries]) => (
          <div key={dir}>
            {dir && (
              <h4 className="text-xs font-mono text-gray-600 mb-1">{dir}/</h4>
            )}
            <div className="space-y-1 ml-2">
              {entries.map((script) => (
                <button
                  key={script.id}
                  type="button"
                  onClick={() => onSelect(script as ScriptWithParams)}
                  className="w-full text-left p-2 border border-neutral-700 rounded bg-neutral-900 hover:border-neutral-500 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm">{script.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        script.source === "filesystem"
                          ? "bg-neutral-800 text-neutral-500"
                          : "bg-purple-900/40 text-purple-400"
                      }`}
                    >
                      {script.source}
                    </span>
                  </div>
                  {script.description && (
                    <p className="text-xs text-neutral-400 mt-1 line-clamp-2">
                      {script.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
