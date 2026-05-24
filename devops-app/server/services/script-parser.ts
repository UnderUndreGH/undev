/**
 * Feature 016 T013 — Pure annotation parser for shell scripts.
 *
 * Extracts `# @description` and `# @param` annotations from shell script
 * source text. No I/O — pass a string, get structured metadata back.
 *
 * Supported annotation format:
 *   # @description Human-readable description of the script
 *   # @param name:type(default):description
 *   # @param name:type(opt1,opt2):(default):description
 *
 * Where type is one of: string | number | boolean | select
 */

export interface ParsedParam {
  name: string;
  type: string; // string | number | boolean | select
  defaultValue?: string;
  description: string;
  options?: string[]; // for select type
}

export interface ParseResult {
  description: string | null;
  params: ParsedParam[];
}

/**
 * Regex breakdown:
 *   Group 1 — param name  (\w+)
 *   Group 2 — type, possibly with select options  (\w+(?:\(([^)]+)\))?)
 *     Group 3 — select options string (opt1,opt2)  (optional)
 *   Group 4 — default value in parens  (\([^)]*\))?  (optional)
 *   Group 5 — description text  (.*)
 */
const PARAM_RE =
  /^#\s*@param\s+(\w+):(\w+(?:\(([^)]+)\))?):(\([^)]*\))?:?(.*)$/;

const DESC_RE = /^#\s*@description\s+(.+)$/;

export function parseAnnotations(content: string): ParseResult {
  const lines = content.split("\n");
  let description: string | null = null;
  const params: ParsedParam[] = [];

  for (const line of lines) {
    // Description — capture first occurrence only.
    if (description === null) {
      const descMatch = DESC_RE.exec(line);
      if (descMatch && descMatch[1]) {
        description = descMatch[1].trim();
        continue;
      }
    }

    // Param annotation.
    const m = PARAM_RE.exec(line);
    if (!m) continue;

    const name = m[1]!;
    const rawType = m[2] ?? "string";  // e.g. "select(fast,slow)" or "string"
    const optionsStr = m[3] ?? null;    // e.g. "fast,slow"  (inside type parens)
    const defaultRaw = m[4] ?? null;    // e.g. "(fast)" or "(mydefault)"
    const descText = (m[5] ?? "").trim();

    // Determine base type and select options.
    let type: string = rawType;
    let options: string[] | undefined;
    if (optionsStr) {
      type = "select";
      options = optionsStr.split(",").map((s) => s.trim()).filter(Boolean);
    }

    // Extract default value (strip surrounding parens).
    let defaultValue: string | undefined;
    if (defaultRaw) {
      // defaultRaw is like "(fast)" — strip parens.
      const inner = defaultRaw.slice(1, -1).trim();
      defaultValue = inner || undefined;
    }

    params.push({
      name,
      type,
      defaultValue,
      description: descText || "",
      ...(options ? { options } : {}),
    });
  }

  return { description, params };
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  "x-secret"?: boolean;
}

export interface ParamToJsonSchemaResult {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

const TYPE_MAP: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  select: "string",
};

export function paramsToJsonSchema(params: ParsedParam[]): ParamToJsonSchemaResult | null {
  if (params.length === 0) return null;

  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const p of params) {
    const jsonType = TYPE_MAP[p.type] ?? "string";
    const prop: JsonSchemaProperty = {
      type: jsonType,
      description: p.description || undefined,
    };

    if (p.type === "select" && p.options) {
      prop.enum = p.options;
    }

    if (p.defaultValue !== undefined) {
      if (jsonType === "number") {
        const num = Number(p.defaultValue);
        if (Number.isFinite(num)) prop.default = num;
      } else if (jsonType === "boolean") {
        prop.default = p.defaultValue === "true";
      } else {
        prop.default = p.defaultValue;
      }
    } else {
      required.push(p.name);
    }

    properties[p.name] = prop;
  }

  const schema: ParamToJsonSchemaResult = {
    type: "object",
    properties,
    required: required.length > 0 ? required : [],
  };

  return schema;
}
