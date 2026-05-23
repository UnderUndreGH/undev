/** Feature 016 T008 — typed REST client for VPN server management. */
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

export const vpnApi = {
  list: (): Promise<VpnServer[]> => api.get<VpnServer[]>("/vpn/servers"),

  create: (data: CreateVpnServerRequest): Promise<VpnServer> =>
    api.post<VpnServer>("/vpn/servers", data),

  delete: (id: string): Promise<void> => api.delete(`/vpn/servers/${id}`),
};
