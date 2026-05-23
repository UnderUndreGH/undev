/** Feature 016 T023 — dynamic form rendered from parsed @param annotations. */
import React, { useState } from "react";
import type { ScriptParam } from "../../lib/scripts-api.js";

interface Props {
  params: ScriptParam[];
  onSubmit: (values: Record<string, string>) => void;
  disabled?: boolean;
}

export function ScriptForm({
  params,
  onSubmit,
  disabled,
}: Props): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of params) {
      out[p.name] = p.defaultValue ?? "";
    }
    return out;
  });

  if (params.length === 0) {
    return <></>;
  }

  const setValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Parameters
      </h3>
      {params
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((param) => (
          <div key={param.id}>
            <label className="block text-xs text-neutral-300 mb-1">
              {param.name}
              {param.description && (
                <span className="text-neutral-500 ml-1">
                  — {param.description}
                </span>
              )}
            </label>
            {param.type === "boolean" ? (
              <input
                type="checkbox"
                checked={values[param.name] === "true"}
                onChange={(e) =>
                  setValue(param.name, e.target.checked ? "true" : "false")
                }
                disabled={disabled}
                className="rounded border-gray-600"
              />
            ) : param.type === "select" && param.options?.length ? (
              <select
                value={values[param.name]}
                onChange={(e) => setValue(param.name, e.target.value)}
                disabled={disabled}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {param.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={param.type === "number" ? "number" : "text"}
                value={values[param.name]}
                onChange={(e) => setValue(param.name, e.target.value)}
                disabled={disabled}
                className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
              />
            )}
          </div>
        ))}
      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={disabled}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-400 px-3 py-1.5 rounded text-sm"
        >
          Execute
        </button>
      </div>
    </form>
  );
}
