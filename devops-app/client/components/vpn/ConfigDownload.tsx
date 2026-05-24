import React, { useState } from "react";
import { vpnApi } from "../../lib/vpn-api.js";

interface Props {
  serverId: string;
  disabled?: boolean;
}

export function ConfigDownload({
  serverId,
  disabled = false,
}: Props): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);

    try {
      const content = await vpnApi.downloadConfig(serverId);
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = content.trim().startsWith("[Interface]")
        ? "amnezia-wg.conf"
        : "amnezia-export.vpn";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to download config");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={disabled || loading}
        className="border border-gray-700 hover:border-gray-500 hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm font-medium transition-colors text-gray-200"
      >
        {loading ? "Downloading…" : "Download VPN Config"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
