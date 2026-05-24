import React from "react";
import { ArchivedServersList } from "../components/servers/ArchivedServersList.js";

export function ArchivedServersPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Archived Servers</h1>
        <p className="text-sm text-gray-400 mt-1">
          Soft-deleted servers with a 30-day recovery window. After that, they are permanently removed.
        </p>
      </div>
      <ArchivedServersList />
    </div>
  );
}
