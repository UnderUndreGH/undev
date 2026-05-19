import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

export function IncidentsListPage() {
  const [q, setQ] = useState("");
  
  const { data: incidents, isLoading } = useQuery<any[]>({
    queryKey: ["ai", "conversations", "list", q],
    queryFn: () => api.get(`/ai/conversations?q=${q}`),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Incident History</h1>
        <div className="w-64">
           <input 
             type="text"
             value={q}
             onChange={e => setQ(e.target.value)}
             placeholder="Search hypotheses..."
             className="w-full bg-gray-900 border border-gray-800 rounded-md px-3 py-1.5 text-sm focus:border-brand-purple outline-none"
           />
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
           {[1, 2, 3].map(n => <div key={n} className="h-20 bg-gray-900 rounded-lg"></div>)}
        </div>
      ) : !incidents?.length ? (
        <div className="text-gray-500 py-12 text-center">No incidents found.</div>
      ) : (
        <div className="space-y-3">
           {incidents.map(inc => (
             <Link
               key={inc.id}
               to={`/incidents/${inc.id}`}
               className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
             >
                <div className="flex items-center justify-between mb-2">
                   <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500 uppercase">{inc.trigger}</span>
                      <span className="text-xs text-gray-700">|</span>
                      <span className="text-xs font-mono text-brand-purple">{inc.targetKind}</span>
                   </div>
                   <span className="text-xs text-gray-600">{new Date(inc.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm text-gray-200 line-clamp-2">{inc.hypothesis ?? 'Analysis in progress...'}</div>
                <div className="mt-3 flex items-center gap-4">
                   <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">{inc.model}</div>
                   {inc.confidence && (
                     <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">{inc.confidence} confidence</span>
                   )}
                </div>
             </Link>
           ))}
        </div>
      )}
    </div>
  );
}
