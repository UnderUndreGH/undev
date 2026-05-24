import React, { useState } from "react";
import QRCode from "react-qr-code";
import { vpnApi } from "../../lib/vpn-api.js";

interface Props {
  serverId: string;
  disabled?: boolean;
}

export function ConfigQRCode({
  serverId,
  disabled = false,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [configText, setConfigText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    if (configText) {
      setOpen(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const content = await vpnApi.downloadConfig(serverId);
      setConfigText(content);
      setOpen(true);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load config");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled || loading}
        className="border border-gray-700 hover:border-gray-500 hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded text-sm font-medium transition-colors text-gray-200"
      >
        {loading ? "Loading…" : "Show QR Code"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && configText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={handleClose}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">VPN Config QR Code</h3>
              <button
                type="button"
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-300"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Scan with Amnezia or WireGuard mobile client.
            </p>
            <div className="flex justify-center bg-white p-4 rounded-lg">
              <QRCode
                value={configText}
                size={220}
                level="M"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
