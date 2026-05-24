import React, { useState } from "react";
import { useRestoreServer } from "../../hooks/useServerActions.js";

interface RestoreButtonProps {
  serverId: string;
  serverLabel: string;
}

export function RestoreButton({ serverId, serverLabel }: RestoreButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const restore = useRestoreServer();

  const handleRestore = () => {
    restore.mutate(serverId, {
      onSuccess: () => setShowConfirm(false),
    });
  };

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Restore {serverLabel}?</span>
        <button
          onClick={handleRestore}
          disabled={restore.isPending}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 px-2 py-1 rounded text-xs font-medium transition-colors"
        >
          {restore.isPending ? "Restoring..." : "Confirm"}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Cancel
        </button>
        {restore.isError && (
          <span className="text-xs text-red-400">
            {(restore.error as Error)?.message ?? "Restore failed"}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="border border-green-700 hover:bg-green-950/40 px-3 py-1 rounded text-xs font-medium transition-colors text-green-400"
    >
      Restore
    </button>
  );
}
