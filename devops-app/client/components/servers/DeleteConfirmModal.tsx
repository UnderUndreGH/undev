import React, { useState, useRef, useEffect } from "react";

interface DeleteConfirmModalProps {
  serverLabel: string;
  serverId: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
  error: string | null;
}

export function DeleteConfirmModal({
  serverLabel,
  onConfirm,
  onCancel,
  isDeleting,
  error,
}: DeleteConfirmModalProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = typed === serverLabel;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Delete server confirmation"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md mx-4 shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-red-400">Delete Server</h2>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-300">
            This will archive the server for <span className="font-semibold text-white">30 days</span>.
            After that, it will be permanently deleted along with all related data (apps, deployments, backups, certificates).
          </p>

          <div className="p-3 bg-gray-950 border border-gray-800 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">Server name</p>
            <p className="font-mono text-sm text-white">{serverLabel}</p>
          </div>

          <div>
            <label className="text-sm text-gray-400 mb-1 block">
              Type <span className="font-mono text-white">{serverLabel}</span> to confirm
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={serverLabel}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-red-500"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && (
            <div className="p-2 bg-red-950/40 border border-red-800 text-red-200 text-sm rounded">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || isDeleting}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {isDeleting ? "Deleting..." : "Delete Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
