import React, { useState, useEffect, useRef, useCallback } from "react";
import { vpnApi } from "../../lib/vpn-api.js";
import { ApiError } from "../../lib/api.js";

type VpnStatus = "uninstalled" | "installing" | "installed" | "error";

interface Props {
  serverId: string;
  vpnStatus: VpnStatus;
  onStatusChange: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  installing_deps: "Installing dependencies",
  configuring_server: "Configuring server",
  generating_config: "Generating config",
  extracting_config: "Extracting config",
  done: "Complete",
};

export function InstallButton({
  serverId,
  vpnStatus,
  onStatusChange,
}: Props): React.JSX.Element {
  const [installId, setInstallId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    if (vpnStatus !== "installing") {
      stopPolling();
      setInstallId(null);
      setStage(null);
      setProgress(0);
      setMessage(null);
      setError(null);
    }
  }, [vpnStatus, stopPolling]);

  const pollStatus = useCallback(
    (id: string) => {
      const poll = async () => {
        try {
          const status = await vpnApi.getInstallStatus(serverId, id);
          setStage(status.stage);
          setProgress(status.progress);
          setMessage(status.message);

          if (status.error) {
            setError(status.error);
            stopPolling();
            onStatusChange();
            return;
          }

          if (status.stage === "done" && status.finished_at) {
            stopPolling();
            onStatusChange();
          }
        } catch {
          stopPolling();
          setError("Lost connection to install worker");
          onStatusChange();
        }
      };

      poll();
      pollRef.current = setInterval(poll, 3000);
    },
    [serverId, onStatusChange, stopPolling],
  );

  const handleInstall = async () => {
    if (
      vpnStatus === "installed" &&
      !window.confirm(
        "VPN is already installed. Reinstall? This will invalidate the existing configuration.",
      )
    ) {
      return;
    }

    setTriggering(true);
    setError(null);

    try {
      const result = await vpnApi.triggerInstall(
        serverId,
        vpnStatus === "installed",
      );
      setInstallId(result.install_id);
      onStatusChange();
      pollStatus(result.install_id);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError("Installation already in progress");
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to start installation");
      }
    } finally {
      setTriggering(false);
    }
  };

  const isInstalling = vpnStatus === "installing" || !!installId;

  if (isInstalling) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-brand-purple border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-300">
            {stage ? STAGE_LABELS[stage] ?? stage : "Starting…"}
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-1.5">
          <div
            className="bg-brand-purple h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {message && (
          <p className="text-xs text-gray-500">{message}</p>
        )}
      </div>
    );
  }

  if (vpnStatus === "error") {
    return (
      <div className="space-y-2">
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={handleInstall}
          disabled={triggering}
          className="border border-amber-700 hover:bg-amber-950/40 disabled:opacity-50 px-3 py-1.5 rounded text-sm font-medium transition-colors text-amber-300"
        >
          {triggering ? "Retrying…" : "Retry Install"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleInstall}
        disabled={triggering}
        className="bg-brand-purple hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-sm font-medium transition-colors"
      >
        {triggering
          ? "Starting…"
          : vpnStatus === "installed"
            ? "Reinstall VPN"
            : "Install Amnezia VPN"}
      </button>
    </div>
  );
}
