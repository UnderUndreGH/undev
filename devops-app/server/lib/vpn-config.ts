import { open, type EnvelopeBlob } from "./envelope-cipher.js";

export type VpnConfigFormat = "wg-quick" | "amnezia" | "openvpn" | "unknown";

export function decryptVpnConfig(encryptedJson: string): string {
  const blob = JSON.parse(encryptedJson) as EnvelopeBlob;
  return open(blob);
}

export function detectConfigFormat(content: string): VpnConfigFormat {
  const trimmed = content.trim();
  if (trimmed.startsWith("[Interface]") || trimmed.includes("PrivateKey =")) {
    return "wg-quick";
  }
  if (trimmed.includes("client") && trimmed.includes("dev tun")) {
    return "openvpn";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("<")) {
    return "amnezia";
  }
  return "unknown";
}

export function configFileName(format: VpnConfigFormat): string {
  switch (format) {
    case "wg-quick":
      return "amnezia-wg.conf";
    case "openvpn":
      return "amnezia.ovpn";
    case "amnezia":
      return "amnezia-export.vpn";
    default:
      return "vpn-config.txt";
  }
}

export function configContentType(format: VpnConfigFormat): string {
  switch (format) {
    case "wg-quick":
      return "text/plain";
    case "openvpn":
      return "application/x-openvpn-profile";
    case "amnezia":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}
