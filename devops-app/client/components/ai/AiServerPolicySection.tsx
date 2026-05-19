import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";

interface Props {
  serverId: string;
}

export function AiServerPolicySection({ serverId }: Props) {
  const queryClient = useQueryClient();
  const { data: server, isLoading } = useQuery<any>({
    queryKey: ["server", serverId],
    queryFn: () => api.get(`/servers/${serverId}`),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/servers/${serverId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["server", serverId] });
    },
  });

  if (isLoading) return <div className="animate-pulse h-32 bg-gray-900 rounded-lg"></div>;
  if (!server) return null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">AI Copilot Access</h2>
        <p className="text-sm text-gray-400 mt-1">
          Control how the AI Copilot interacts with this server.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-gray-950 border border-gray-800 rounded-lg">
          <div>
            <div className="font-medium text-gray-200">Read Access</div>
            <div className="text-xs text-gray-500 mt-1">Allow AI to aggregate logs, audit events, and health data from this server.</div>
          </div>
          <button
            onClick={() => updateMutation.mutate({ aiReadAccess: !server.aiReadAccess })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              server.aiReadAccess ? "bg-brand-purple" : "bg-gray-700"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${server.aiReadAccess ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="flex items-center justify-between p-4 bg-gray-950 border border-gray-800 rounded-lg">
          <div>
            <div className="font-medium text-gray-200">Write Access</div>
            <div className="text-xs text-gray-500 mt-1">Control remediation tool-use permissions.</div>
          </div>
          <select
            value={server.aiWriteAccess}
            onChange={(e) => updateMutation.mutate({ aiWriteAccess: e.target.value })}
            className="bg-gray-900 border border-gray-700 text-sm rounded-md px-3 py-2 text-white focus:outline-none focus:border-brand-purple"
          >
            <option value="enabled">Full (Approval required)</option>
            <option value="sandbox-only">Sandbox Only (Dry-run)</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>
    </section>
  );
}
