import { api } from "./api.js";

export interface VpnServer {
  id: string;
  label: string;
  host: string;
  port: number;
  sshUser: string;
  vpnStatus: "uninstalled" | "installing" | "installed" | "error";
  vpnDriftStatus: "in_sync" | "drifted" | "unknown";
  vpnInstalledAt: string | null;
  scriptsEnabled: boolean;
}

export interface CreateVpnServerRequest {
  label: string;
  host: string;
  port: number;
  sshUser: string;
  password?: string;
  privateKey?: string;
  storeCredentials: boolean;
  installVpn: boolean;
}

export interface InstallTriggerResponse {
  install_id: string;
}

export interface InstallStatusResponse {
  install_id: string;
  vpn_status: string;
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export const vpnApi = {
  list: (): Promise<VpnServer[]> => api.get<VpnServer[]>("/vpn/servers"),

  create: (data: CreateVpnServerRequest): Promise<VpnServer> =>
    api.post<VpnServer>("/vpn/servers", data),

  delete: (id: string): Promise<void> => api.delete(`/vpn/servers/${id}`),

  triggerInstall: (
    serverId: string,
    reinstall = false,
  ): Promise<InstallTriggerResponse> =>
    api.post<InstallTriggerResponse>(`/servers/${serverId}/vpn/install`, {
      reinstall,
    }),

  getInstallStatus: (
    serverId: string,
    installId: string,
  ): Promise<InstallStatusResponse> =>
    api.get<InstallStatusResponse>(
      `/servers/${serverId}/vpn/install-status/${installId}`,
    ),

  downloadConfig: (serverId: string): Promise<string> =>
    fetch(`/api/servers/${serverId}/vpn/config`, {
      credentials: "same-origin",
    }).then((res) => {
      if (!res.ok) {
        return res.json().then(
          (body) => {
            throw new Error(
              body?.error?.message ?? "Failed to download config",
            );
          },
          () => {
            throw new Error("Failed to download config");
          },
        );
      }
      return res.text();
    }),
};
