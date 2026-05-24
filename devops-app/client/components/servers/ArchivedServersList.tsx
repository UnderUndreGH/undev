import React from "react";
import { useArchivedServers } from "../../hooks/useServerActions.js";
import { RestoreButton } from "./RestoreButton.js";

export function ArchivedServersList() {
  const { data: servers, isLoading, error } = useArchivedServers();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((n) => (
          <div key={n} className="bg-gray-900 border border-gray-800 rounded-lg p-4 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-950/40 border border-red-800 text-red-200 text-sm rounded-lg">
        {(error as Error)?.message ?? "Failed to load archived servers"}
      </div>
    );
  }

  if (!servers?.length) {
    return (
      <div className="text-gray-500 text-center py-12">
        No archived servers. Deleted servers will appear here for 30 days before permanent removal.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {servers.map((server) => (
        <div
          key={server.id}
          className={`bg-gray-900 border rounded-lg p-4 flex items-center justify-between ${
            server.approachingDeadline
              ? "border-amber-700 bg-amber-950/20"
              : "border-gray-800"
          }`}
        >
          <div>
            <h3 className="font-medium text-gray-200">{server.label}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {server.host} · Archived {new Date(server.deletedAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                server.approachingDeadline
                  ? "border-amber-700 bg-amber-950/40 text-amber-300"
                  : "border-gray-700 bg-gray-900 text-gray-400"
              }`}
            >
              {server.remainingDays}d remaining
            </span>
            <RestoreButton serverId={server.id} serverLabel={server.label} />
          </div>
        </div>
      ))}
    </div>
  );
}
