import React, { useState, useRef } from "react";
import { useUploadScript, type ScannerViolation } from "../../lib/scripts-api.js";

interface Props {
  onUploaded?: () => void;
}

export function ScriptUpload({ onUploaded }: Props): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<ScannerViolation[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useUploadScript();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);

    if (!file) {
      setError("Select a file");
      return;
    }
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    try {
      const result = await uploadMutation.mutateAsync({
        file,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }
      setName("");
      setDescription("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onUploaded?.();
    } catch (err: unknown) {
      const e = err as { error?: string; violations?: ScannerViolation[] };
      setError(e.error ?? "Upload failed");
      if (e.violations) setWarnings(e.violations);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && (
        <div className="p-2 bg-red-900/30 border border-red-700 text-red-200 text-sm rounded">
          {error}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="p-2 bg-yellow-900/30 border border-yellow-700 text-yellow-200 text-sm rounded space-y-1">
          <div className="font-semibold">Scanner warnings:</div>
          {warnings.map((w, i) => (
            <div key={i}>
              Line {w.line}: <code className="text-yellow-100">{w.pattern}</code> — {w.description}
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="block text-xs text-neutral-300 mb-1">Name *</label>
        <input
          type="text"
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs text-neutral-300 mb-1">Description</label>
        <input
          type="text"
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs text-neutral-300 mb-1">Script file (.sh) *</label>
        <input
          ref={fileRef}
          type="file"
          accept=".sh"
          className="block w-full text-sm text-neutral-400 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-neutral-700 file:text-neutral-200 hover:file:bg-neutral-600"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <button
        type="submit"
        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-400 rounded"
        disabled={uploadMutation.isPending || !file || !name.trim()}
      >
        {uploadMutation.isPending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
