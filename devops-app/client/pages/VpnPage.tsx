/** Feature 016 T022/T024 — VPN management page. */
import React, { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vpnApi, type VpnServer } from "../lib/vpn-api.js";
import { scriptsApi, type Script, type ScriptParam } from "../lib/scripts-api.js";
import { ServerList } from "../components/vpn/ServerList.js";
import { ServerForm } from "../components/vpn/ServerForm.js";
import { ScriptTree, type ScriptWithParams } from "../components/vpn/ScriptTree.js";
import { ScriptOutput } from "../components/vpn/ScriptOutput.js";
import { ScriptEditor } from "../components/vpn/ScriptEditor.js";
import { ScriptForm } from "../components/vpn/ScriptForm.js";
import { ApiError } from "../lib/api.js";

type Panel = "servers" | "scripts";

export function VpnPage() {
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<Panel>("servers");
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedScript, setSelectedScript] = useState<ScriptWithParams | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // Fetch VPN servers
  const {
    data: servers = [],
    isLoading: serversLoading,
  } = useQuery({
    queryKey: ["vpn-servers"],
    queryFn: () => vpnApi.list(),
  });

  // Fetch scripts
  const {
    data: scripts = [],
    isLoading: scriptsLoading,
  } = useQuery({
    queryKey: ["scripts"],
    queryFn: () => scriptsApi.list(),
  });

  // Delete server mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => vpnApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vpn-servers"] });
    },
  });

  // Reindex scripts
  const reindexMutation = useMutation({
    mutationFn: () => scriptsApi.reindex(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
  });

  // Handle script selection — fetch full script with params
  const handleSelectScript = useCallback(async (script: ScriptWithParams) => {
    try {
      const full = await scriptsApi.get(script.id);
      setSelectedScript(full);
      setExecutionId(null);
      setExecError(null);
    } catch (err) {
      // Fallback: use the script data we already have
      setSelectedScript({ ...script, params: [] });
    }
  }, []);

  // Handle script execution
  const handleExecute = useCallback(
    async (values: Record<string, string>) => {
      if (!selectedScript || !selectedServerId) return;
      setExecError(null);
      try {
        const result = await scriptsApi.execute(
          selectedScript.id,
          selectedServerId,
          values,
        );
        setExecutionId(result.executionId);
      } catch (err) {
        if (err instanceof ApiError) {
          setExecError(`${err.code}: ${err.message}`);
        } else if (err instanceof Error) {
          setExecError(err.message);
        } else {
          setExecError("Execution failed");
        }
      }
    },
    [selectedScript, selectedServerId],
  );

  // Handle script content save
  const handleSaveContent = useCallback(
    async (content: string) => {
      if (!selectedScript) return;
      await scriptsApi.update(selectedScript.id, { content });
      queryClient.invalidateQueries({ queryKey: ["scripts"] });
    },
    [selectedScript, queryClient],
  );

  // Servers with stored credentials are eligible for script execution
  const executableServers = servers;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">VPN Management</h1>
      </div>

      {/* Panel tabs */}
      <div className="flex gap-1 border-b border-gray-800 mb-6" role="tablist">
        {(["servers", "scripts"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activePanel === tab}
            onClick={() => setActivePanel(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activePanel === tab
                ? "text-brand-purple border-brand-purple"
                : "text-gray-500 border-transparent hover:text-gray-300"
            }`}
          >
            {tab === "servers" ? "Servers" : "Scripts"}
          </button>
        ))}
      </div>

      {/* Servers panel */}
      {activePanel === "servers" && (
        <div className="space-y-4">
          {serversLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-gray-800 rounded w-full" />
            </div>
          ) : (
            <>
              <ServerList
                servers={servers}
                onRefresh={() =>
                  queryClient.invalidateQueries({ queryKey: ["vpn-servers"] })
                }
                onDelete={(id) => deleteMutation.mutate(id)}
                onAddServer={() => setShowAddForm(true)}
              />
              {!showAddForm && servers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded text-sm"
                >
                  Add Server
                </button>
              )}
            </>
          )}

          {showAddForm && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 max-w-lg">
              <h2 className="text-lg font-semibold mb-4">Add VPN Server</h2>
              <ServerForm
                onCreated={() => {
                  setShowAddForm(false);
                  queryClient.invalidateQueries({ queryKey: ["vpn-servers"] });
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </div>
          )}

          {deleteMutation.isError && (
            <p className="text-sm text-red-400">
              {(deleteMutation.error as Error)?.message ?? "Delete failed"}
            </p>
          )}
        </div>
      )}

      {/* Scripts panel */}
      {activePanel === "scripts" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Script tree */}
          <div className="lg:col-span-1">
            {scriptsLoading ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-10 bg-gray-800 rounded" />
                ))}
              </div>
            ) : (
              <ScriptTree
                scripts={scripts}
                onSelect={handleSelectScript}
                onRescan={() => reindexMutation.mutate()}
                rescanLoading={reindexMutation.isPending}
              />
            )}

            {/* Server selector for execution */}
            {selectedScript && (
              <div className="mt-4 p-3 border border-gray-800 rounded bg-gray-900">
                <label className="block text-xs text-neutral-300 mb-1">
                  Execute on server
                </label>
                <select
                  value={selectedServerId ?? ""}
                  onChange={(e) => setSelectedServerId(e.target.value || null)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">Select a server…</option>
                  {executableServers.map((s: VpnServer) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.host})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Right: Script detail + execution */}
          <div className="lg:col-span-2 space-y-6">
            {selectedScript ? (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {selectedScript.name}
                  </h2>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      selectedScript.source === "filesystem"
                        ? "bg-neutral-800 text-neutral-500"
                        : "bg-purple-900/40 text-purple-400"
                    }`}
                  >
                    {selectedScript.source}
                  </span>
                </div>
                {selectedScript.description && (
                  <p className="text-sm text-neutral-400">
                    {selectedScript.description}
                  </p>
                )}

                {/* Script editor (DB-sourced only) */}
                <ScriptEditor
                  script={selectedScript}
                  onSave={handleSaveContent}
                />

                {/* Parameter form + execute */}
                {selectedServerId && (
                  <>
                    <ScriptForm
                      params={selectedScript.params ?? []}
                      onSubmit={handleExecute}
                      disabled={!selectedServerId}
                    />
                    {execError && (
                      <p className="text-sm text-red-400">{execError}</p>
                    )}
                  </>
                )}

                {/* Output */}
                {executionId && <ScriptOutput executionId={executionId} />}
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                Select a script from the tree to view details and execute.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
