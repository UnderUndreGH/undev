import React, { useState } from "react";
import type { VpnServer } from "../../lib/vpn-api.js";
import { InstallButton } from "./InstallButton.js";
import { ConfigDownload } from "./ConfigDownload.js";
import { ConfigQRCode } from "./ConfigQRCode.js";

interface Props {
  servers: VpnServer[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onAddServer: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  uninstalled: "bg-gray-800 text-gray-400 border-gray-600",
  installing: "bg-blue-900/50 text-blue-400 border-blue-700",
  installed: "bg-green-900/50 text-green-400 border-green-700",
  error: "bg-red-900/50 text-red-400 border-red-700",
};

const DRIFT_STYLES: Record<string, string> = {
  in_sync: "bg-green-900/50 text-green-400 border-green-700",
  drifted: "bg-red-900/50 text-red-400 border-red-700",
  unknown: "bg-gray-800 text-gray-400 border-gray-600",
};

function StatusPill({
  value,
  styles,
}: {
  value: string;
  styles: Record<string, string>;
}) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${
        styles[value] ?? styles.unknown ?? "bg-gray-800 text-gray-400 border-gray-600"
      }`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function ServerList({
  servers,
  onRefresh,
  onDelete,
  onAddServer,
}: Props): React.JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (servers.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">No VPN servers configured.</p>
        <button
          type="button"
          onClick={onAddServer}
          className="bg-brand-purple hover:bg-purple-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Add Server
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Servers ({servers.length})
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs uppercase text-gray-500">
              <th className="pb-2 pr-4">Label</th>
              <th className="pb-2 pr-4">Host</th>
              <th className="pb-2 pr-4">VPN Status</th>
              <th className="pb-2 pr-4">Drift</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <React.Fragment key={server.id}>
                <tr
                  className="border-b border-gray-800/50 hover:bg-gray-900/50 cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === server.id ? null : server.id)
                  }
                >
                  <td className="py-2 pr-4 font-medium">
                    {server.label}
                    <span className="ml-1 text-gray-600 text-xs">
                      {expandedId === server.id ? "▾" : "▸"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 font-mono text-xs">
                    {server.host}:{server.port}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusPill
                      value={server.vpnStatus}
                      styles={STATUS_STYLES}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <StatusPill
                      value={server.vpnDriftStatus}
                      styles={DRIFT_STYLES}
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete server "${server.label}"? This removes it from the dashboard but does NOT uninstall the VPN on the remote host.`,
                          )
                        ) {
                          onDelete(server.id);
                        }
                      }}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
                {expandedId === server.id && (
                  <tr className="border-b border-gray-800/50">
                    <td colSpan={5} className="py-3 px-2 bg-gray-950/50">
                      <div className="space-y-3">
                        <InstallButton
                          serverId={server.id}
                          vpnStatus={server.vpnStatus}
                          onStatusChange={onRefresh}
                        />
                        {server.vpnStatus === "installed" && (
                          <div className="flex gap-2">
                            <ConfigDownload serverId={server.id} />
                            <ConfigQRCode serverId={server.id} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
