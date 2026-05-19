import React from "react";
import { useAiSpend, useAiSpendConversations } from "../../hooks/useAiSpend.js";
import { useAiSettings } from "../../hooks/useAiSettings.js";

export function CostDashboard() {
  const { data: spend } = useAiSpend();
  const { data: convos } = useAiSpendConversations();
  const { data: settings } = useAiSettings();

  if (!spend || !settings) return null;

  const inPct = Math.min(100, (spend.tokensIn / settings.monthlyTokenBudgetIn) * 100);
  const outPct = Math.min(100, (spend.tokensOut / settings.monthlyTokenBudgetOut) * 100);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
           <div className="text-xs text-gray-500 font-bold uppercase mb-1">Monthly Spend (Est)</div>
           <div className="text-3xl font-black text-white">${spend.estCostUsd.toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
           <div className="text-xs text-gray-500 font-bold uppercase mb-1">Input Tokens</div>
           <div className="text-2xl font-bold text-gray-200">{(spend.tokensIn / 1000000).toFixed(2)} M</div>
           <div className="mt-3 w-full bg-gray-950 h-1.5 rounded-full overflow-hidden">
              <div className="bg-brand-purple h-full" style={{ width: `${inPct}%` }}></div>
           </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
           <div className="text-xs text-gray-500 font-bold uppercase mb-1">Output Tokens</div>
           <div className="text-2xl font-bold text-gray-200">{(spend.tokensOut / 1000000).toFixed(2)} M</div>
           <div className="mt-3 w-full bg-gray-950 h-1.5 rounded-full overflow-hidden">
              <div className="bg-blue-500 h-full" style={{ width: `${outPct}%` }}></div>
           </div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
           <h3 className="font-bold">Per-Incident Cost</h3>
        </div>
        <table className="w-full text-sm text-left">
           <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                 <th className="px-6 py-3">Incident ID</th>
                 <th className="px-6 py-3 text-right">Tokens In</th>
                 <th className="px-6 py-3 text-right">Tokens Out</th>
                 <th className="px-6 py-3 text-right">Cost (USD)</th>
              </tr>
           </thead>
           <tbody>
              {convos?.map(c => (
                <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                   <td className="px-6 py-3 font-mono text-xs text-gray-400">{c.id}</td>
                   <td className="px-6 py-3 text-right text-gray-300">{c.tokensIn.toLocaleString()}</td>
                   <td className="px-6 py-3 text-right text-gray-300">{c.tokensOut.toLocaleString()}</td>
                   <td className="px-6 py-3 text-right font-medium text-white">${c.estCostUsd.toFixed(4)}</td>
                </tr>
              ))}
           </tbody>
        </table>
      </div>
    </div>
  );
}
