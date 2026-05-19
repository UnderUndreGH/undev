import { tool } from "ai";
import { manifest, type ScriptManifestEntry } from "../scripts-manifest.js";

/**
 * Converts the universal script runner manifest into Vercel AI SDK tool definitions.
 * Intercepts tool calls at the application layer for operator approval.
 */
export function manifestToAiTools() {
  const tools: Record<string, any> = {};

  for (const entry of manifest) {
    // Map tool ID to a snake_case name safe for LLM tool calling (e.g. deploy/logs -> deploy_logs)
    const toolName = entry.id.replace(/\//g, "_");

    tools[toolName] = tool({
      description: (() => {
        const dangerNote = entry.dangerLevel === "high"
          ? "DANGER: high — destructive action. Operator must type-confirm before execution."
          : entry.dangerLevel === "medium"
          ? "Caution: medium — modifies system state. Operator approval required."
          : "Low impact — safe to propose freely.";
        const reversibleNote = entry.reversible
          ? "Reversible — can be undone."
          : "IRREVERSIBLE — prefer reversible alternatives when possible.";
        return `${entry.description} ${dangerNote} ${reversibleNote}`;
      })(),
      parameters: entry.params,
      execute: undefined as any,
    } as any);
  }

  return tools;
}

/**
 * Resolves a snake_case tool name back to its manifest ID.
 */
export function aiToolNameToManifestId(name: string): string | undefined {
  const entry = manifest.find((e) => e.id.replace(/\//g, "_") === name);
  return entry?.id;
}
