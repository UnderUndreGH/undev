import React, { useMemo, useState } from "react";
import {
  useExecuteScript,
  type Script,
  type ExecutionResult,
} from "../../lib/scripts-api.js";

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

interface Props {
  script: Script;
  onResult: (result: ExecutionResult) => void;
  onError: (error: string) => void;
}

interface FieldDef {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required: boolean;
  description?: string;
  enumValues?: string[];
  default?: unknown;
}

function extractFields(schema: Record<string, unknown> | null): FieldDef[] {
  if (!schema || !schema.properties) return [];
  const props = schema.properties as Record<string, JsonSchemaProperty>;
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );

  return Object.entries(props).map(([name, prop]) => {
    const base: FieldDef = {
      name,
      type: prop.enum ? "enum" : (prop.type as FieldDef["type"]) ?? "string",
      required: required.has(name),
      description: prop.description,
      default: prop.default,
    };
    if (prop.enum) base.enumValues = prop.enum;
    return base;
  });
}

function validate(fields: FieldDef[], values: Record<string, unknown>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.required && (v === undefined || v === null || v === "")) {
      errors[f.name] = "Required";
      continue;
    }
    if (f.type === "number" && v !== undefined && v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors[f.name] = "Must be a number";
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

interface ServerOption {
  id: number;
  label: string;
}

export function ScriptExecuteForm({ script, onResult, onError }: Props): React.JSX.Element {
  const fields = useMemo(() => extractFields(script.parameterSchema), [script.parameterSchema]);
  const executeMutation = useExecuteScript();

  const [serverId, setServerId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.default !== undefined) init[f.name] = f.default;
      else if (f.type === "boolean") init[f.name] = false;
      else init[f.name] = "";
    }
    return init;
  });
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  if (!serversLoaded) {
    setServersLoaded(true);
    fetch("/api/servers", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: ServerOption[]) => setServers(data))
      .catch(() => {});
  }

  const setValue = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors(null);

    if (!serverId) {
      onError("Select a target server");
      return;
    }

    const errs = validate(fields, values);
    if (errs) {
      setFieldErrors(errs);
      return;
    }

    const params: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (v === undefined || v === "") continue;
      if (f.type === "number") params[f.name] = Number(v);
      else params[f.name] = v;
    }

    try {
      const result = await executeMutation.mutateAsync({
        id: script.id,
        serverId: Number(serverId),
        parameters: params,
      });
      onResult(result);
    } catch (err: unknown) {
      const e = err as { error?: string };
      onError(e.error ?? "Execution failed");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-300 mb-1">Target Server *</label>
        <select
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
        >
          <option value="">— select server —</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-neutral-500 italic">No parameters.</p>
      )}

      {fields.map((f) => {
        const val = values[f.name];
        const err = fieldErrors?.[f.name];
        return (
          <div key={f.name}>
            <label className="block text-xs text-neutral-300 mb-1">
              {f.name}
              {f.required && <span className="text-red-400 ml-1">*</span>}
              {f.description && (
                <span className="text-neutral-500 ml-2">{f.description}</span>
              )}
            </label>
            {f.type === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => setValue(f.name, e.target.checked)}
              />
            ) : f.type === "enum" ? (
              <select
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={String(val ?? "")}
                onChange={(e) => setValue(f.name, e.target.value)}
              >
                <option value="">—</option>
                {(f.enumValues ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                value={String(val ?? "")}
                onChange={(e) => setValue(f.name, e.target.value)}
              />
            )}
            {err && <div className="text-xs text-red-400 mt-1">{err}</div>}
          </div>
        );
      })}

      <button
        type="submit"
        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-400 rounded"
        disabled={executeMutation.isPending}
      >
        {executeMutation.isPending ? "Executing…" : "Execute"}
      </button>
    </form>
  );
}
