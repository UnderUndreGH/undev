import React from "react";
import { useAiSettings } from "../../hooks/useAiSettings.js";

export function KillSwitchBanner() {
  const { data: settings } = useAiSettings();

  if (!settings?.globalKillSwitchEngaged) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-center gap-3 font-bold shadow-lg">
      {/* <AlertTriangle size={18} /> */}
      <span>⚠️ AI COPILOT KILL-SWITCH ENGAGED — Inference and tool-use suspended dashboard-wide</span>
    </div>
  );
}
