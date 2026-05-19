import React, { useState } from "react";
import { useAiSettings, useUpdateAiSettings, useToggleKillSwitch } from "../../hooks/useAiSettings.js";
import { useAiProviders, useDeleteAiProvider, useTestAiProvider } from "../../hooks/useAiProviders.js";
import { ProviderConfigForm } from "../ai/ProviderConfigForm.js";

export function AiSettingsSection() {
  const { data: settings, isLoading: settingsLoading } = useAiSettings();
  const { data: providers, isLoading: providersLoading } = useAiProviders();
  const updateSettings = useUpdateAiSettings();
  const toggleKillSwitch = useToggleKillSwitch();
  const deleteProvider = useDeleteAiProvider();
  const testProvider = useTestAiProvider();

  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; latency?: number; error?: string } | null>(null);

  if (settingsLoading || providersLoading) {
    return <div className="animate-pulse h-64 bg-gray-900 rounded-lg"></div>;
  }

  if (!settings) return null;

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await testProvider.mutateAsync(id);
      setTestResult({ id, ok: result.ok, latency: result.latencyMs, error: result.error });
    } catch (err) {
      setTestResult({ id, ok: false, error: String(err) });
    } finally {
      setTestingId(null);
    }
  };

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">AI Incident Copilot</h2>
          <p className="text-sm text-gray-400 mt-1">
            Automated root-cause analysis and remediation proposals.
          </p>
        </div>
        <button
          onClick={() => updateSettings.mutate({ enabled: !settings.enabled })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            settings.enabled ? "bg-brand-purple" : "bg-gray-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              settings.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {settings.enabled && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-800">
            <div className="space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">LLM Providers</h3>
              
              <div className="space-y-3">
                {providers?.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-gray-950 border border-gray-800 rounded-md">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize">{p.provider}</span>
                        {p.isActive && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/40 text-green-400 border border-green-800 uppercase">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{p.modelDefault}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTest(p.id)}
                        disabled={testingId === p.id}
                        className="text-xs text-gray-400 hover:text-white disabled:opacity-50"
                      >
                        {testingId === p.id ? "Testing..." : "Test"}
                      </button>
                      <button
                        onClick={() => deleteProvider.mutate(p.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

                {testResult && (
                  <div className={`text-xs px-3 py-2 rounded border ${
                    testResult.ok ? "bg-green-950/20 border-green-900 text-green-400" : "bg-red-950/20 border-red-900 text-red-400"
                  }`}>
                    {testResult.ok 
                      ? `Connection successful (${testResult.latency}ms)`
                      : `Connection failed: ${testResult.error}`}
                  </div>
                )}

                <button
                  onClick={() => setIsAddingProvider(true)}
                  className="w-full py-2 border border-dashed border-gray-700 rounded-md text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
                >
                  + Add Provider
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">Budget & Caps</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Monthly In (MTok)</label>
                  <input
                    type="number"
                    value={settings.monthlyTokenBudgetIn / 1_000_000}
                    onChange={(e) => updateSettings.mutate({ monthlyTokenBudgetIn: Number(e.target.value) * 1_000_000 })}
                    className="w-full px-2 py-1 bg-gray-950 border border-gray-800 rounded text-sm text-white focus:border-brand-purple outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Monthly Out (MTok)</label>
                  <input
                    type="number"
                    value={settings.monthlyTokenBudgetOut / 1_000_000}
                    onChange={(e) => updateSettings.mutate({ monthlyTokenBudgetOut: Number(e.target.value) * 1_000_000 })}
                    className="w-full px-2 py-1 bg-gray-950 border border-gray-800 rounded text-sm text-white focus:border-brand-purple outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Incident In (kTok)</label>
                  <input
                    type="number"
                    value={settings.perIncidentTokenCapIn / 1_000}
                    onChange={(e) => updateSettings.mutate({ perIncidentTokenCapIn: Number(e.target.value) * 1_000 })}
                    className="w-full px-2 py-1 bg-gray-950 border border-gray-800 rounded text-sm text-white focus:border-brand-purple outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Incident Out (kTok)</label>
                  <input
                    type="number"
                    value={settings.perIncidentTokenCapOut / 1_000}
                    onChange={(e) => updateSettings.mutate({ perIncidentTokenCapOut: Number(e.target.value) * 1_000 })}
                    className="w-full px-2 py-1 bg-gray-950 border border-gray-800 rounded text-sm text-white focus:border-brand-purple outline-none"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                 <div className="flex items-center justify-between">
                    <span className="text-sm">Tool-use enabled</span>
                    <input 
                      type="checkbox" 
                      checked={settings.globalToolUseEnabled}
                      onChange={(e) => updateSettings.mutate({ globalToolUseEnabled: e.target.checked })}
                      className="accent-brand-purple"
                    />
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-sm">Sandbox by default</span>
                    <input 
                      type="checkbox" 
                      checked={settings.defaultSandbox}
                      onChange={(e) => updateSettings.mutate({ defaultSandbox: e.target.checked })}
                      className="accent-brand-purple"
                    />
                 </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-800 flex items-center justify-between">
             <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-sm font-medium text-red-500">Emergency Kill Switch</span>
             </div>
             <button
               onClick={() => toggleKillSwitch.mutate(!settings.globalKillSwitchEngaged)}
               className={`px-4 py-1.5 rounded-md text-sm font-bold border transition-colors ${
                 settings.globalKillSwitchEngaged
                  ? "bg-red-950/20 border-red-500 text-red-500 hover:bg-red-950/40"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-red-600 hover:border-red-500 hover:text-white"
               }`}
             >
               {settings.globalKillSwitchEngaged ? "Release Kill Switch" : "ENGAGE KILL SWITCH"}
             </button>
          </div>
        </>
      )}

      {isAddingProvider && (
        <ProviderConfigForm 
          onClose={() => setIsAddingProvider(false)} 
        />
      )}
    </section>
  );
}
