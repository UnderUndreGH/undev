import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ScriptLibrary } from "../components/scripts/ScriptLibrary.js";
import { ScriptUpload } from "../components/scripts/ScriptUpload.js";

interface AuthUser {
  user: {
    username: string;
    role: string;
  };
}

export function ScriptsPage(): React.JSX.Element {
  const [showUpload, setShowUpload] = useState(false);

  const { data: auth } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthUser>("/auth/me"),
  });

  const isAdmin = auth?.user?.role === "admin";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Scripts</h1>
        {isAdmin && (
          <button
            type="button"
            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 rounded"
            onClick={() => setShowUpload(!showUpload)}
          >
            {showUpload ? "Cancel" : "Upload Script"}
          </button>
        )}
      </div>

      {showUpload && isAdmin && (
        <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Upload New Script</h2>
          <ScriptUpload onUploaded={() => setShowUpload(false)} />
        </div>
      )}

      <ScriptLibrary isAdmin={isAdmin} />
    </div>
  );
}
