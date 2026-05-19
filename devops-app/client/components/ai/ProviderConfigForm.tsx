import React, { useState } from "react";
import { useCreateAiProvider } from "../../hooks/useAiProviders.js";

interface Props {
  onClose: () => void;
}

export function ProviderConfigForm({ onClose }: Props) {
  const createProvider = useCreateAiProvider();
  
  const [form, setForm] = useState({
    provider: "anthropic",
    modelDefault: "claude-3-5-sonnet-20240620",
    endpointUrl: "",
    apiKey: "",
    rateCardInputPerMtok: "3.0",
    rateCardOutputPerMtok: "15.0",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createProvider.mutate({
      ...form,
      endpointUrl: form.endpointUrl || null,
      rateCardInputPerMtok: parseFloat(form.rateCardInputPerMtok),
      rateCardOutputPerMtok: parseFloat(form.rateCardOutputPerMtok),
    }, {
      onSuccess: onClose
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg w-full max-w-md p-6 shadow-2xl">
        <h2 className="text-xl font-bold mb-6">Add AI Provider</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">Provider</label>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT)</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">Default Model</label>
            <input
              type="text"
              value={form.modelDefault}
              onChange={(e) => setForm({ ...form, modelDefault: e.target.value })}
              placeholder="e.g. claude-3-5-sonnet-20240620"
              className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
              required
            />
          </div>

          {form.provider === "ollama" && (
            <div>
              <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">Endpoint URL</label>
              <input
                type="url"
                value={form.endpointUrl}
                onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })}
                placeholder="http://localhost:11434/v1"
                className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">Rate In ($/MTok)</label>
              <input
                type="number"
                step="0.01"
                value={form.rateCardInputPerMtok}
                onChange={(e) => setForm({ ...form, rateCardInputPerMtok: e.target.value })}
                className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase font-bold mb-1.5">Rate Out ($/MTok)</label>
              <input
                type="number"
                step="0.01"
                value={form.rateCardOutputPerMtok}
                onChange={(e) => setForm({ ...form, rateCardOutputPerMtok: e.target.value })}
                className="w-full bg-gray-950 border border-gray-700 rounded-md px-3 py-2 text-sm focus:border-brand-purple outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button
              type="submit"
              disabled={createProvider.isPending}
              className="flex-1 bg-brand-purple text-white py-2 rounded-md font-bold hover:opacity-90 disabled:opacity-50"
            >
              {createProvider.isPending ? "Adding..." : "Add Provider"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-800 text-gray-300 py-2 rounded-md font-bold hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
