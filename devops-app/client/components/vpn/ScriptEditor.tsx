/** Feature 016 T021 — script content editor (DB-sourced only). */
import React, { useState } from "react";
import type { Script } from "../../lib/scripts-api.js";

interface Props {
  script: Script;
  onSave: (content: string) => void;
}

export function ScriptEditor({
  script,
  onSave,
}: Props): React.JSX.Element {
  const [content, setContent] = useState(script.content ?? "");
  const [saving, setSaving] = useState(false);

  if (script.source === "filesystem") {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Script Content
        </h3>
        <div className="bg-gray-950 border border-gray-800 rounded p-3">
          <p className="text-xs text-neutral-500 mb-2">
            This script is managed on the filesystem. Edits must be made on the
            server.
          </p>
          <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-auto max-h-96">
            {script.content ?? "(no content)"}
          </pre>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(content);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Edit Script
      </h3>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={16}
        className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-brand-purple resize-y"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-purple hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-sm font-medium"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
