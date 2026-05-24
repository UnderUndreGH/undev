import dns from "node:dns/promises";
import { AppError } from "./app-error.js";
import { logger } from "./logger.js";

interface IPv4 {
  type: "v4";
  octets: [number, number, number, number];
}

interface IPv6 {
  type: "v6";
  groups: number[];
}

type ParsedIP = IPv4 | IPv6;

function parseIPv4(s: string): IPv4 | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number) as [number, number, number, number];
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return { type: "v4", octets };
}

function parseIPv6(s: string): IPv6 | null {
  let addr = s;
  if (addr.startsWith("[")) addr = addr.slice(1);
  if (addr.endsWith("]")) addr = addr.slice(0, -1);

  const halves = addr.split("::");
  if (halves.length > 2) return null;

  let left: string[];
  let right: string[];

  if (halves.length === 2) {
    left = halves[0] ? halves[0].split(":") : [];
    right = halves[1] ? halves[1].split(":") : [];
  } else {
    left = addr.split(":");
    right = [];
  }

  const total = left.length + right.length;
  if (total > 8) return null;

  const groups: number[] = [];
  for (const part of left) {
    const n = parseInt(part, 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    groups.push(n);
  }
  for (let i = 0; i < 8 - total; i++) groups.push(0);
  for (const part of right) {
    const n = parseInt(part, 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    groups.push(n);
  }

  if (groups.length !== 8) return null;
  return { type: "v6", groups };
}

function isPrivateV4(ip: IPv4): boolean {
  const [a, b, c, d] = ip.octets;

  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

function isPrivateV6(ip: IPv6): boolean {
  if (ip.groups[0] === 0 && ip.groups[1] === 0 && ip.groups[2] === 0 && ip.groups[3] === 0 &&
      ip.groups[4] === 0 && ip.groups[5] === 0 && ip.groups[6] === 0 && ip.groups[7] === 1) return true;
  if (ip.groups[0] === 0xfe80) return true;
  if (ip.groups[0] === 0x100) return true;
  if (ip.groups[0] === 0x64 && ((ip.groups[1] ?? 0) & 0xffc0) === 0xff9b) return true;
  if (ip.groups[0] === 0xfc00 || ip.groups[0] === 0xfd00) return true;
  return false;
}

function isPrivateIP(parsed: ParsedIP): boolean {
  return parsed.type === "v4" ? isPrivateV4(parsed) : isPrivateV6(parsed);
}

function isLocalOverride(): boolean {
  return process.env.ALLOW_LOCAL_AI_ENDPOINTS === "true" ||
         process.env.ALLOW_LOCAL_AI_ENDPOINTS === "1";
}

export async function validateEndpointUrl(urlStr: string): Promise<void> {
  if (isLocalOverride()) {
    logger.warn({ url: urlStr }, "ALLOW_LOCAL_AI_ENDPOINTS override active — endpoint URL SSRF check skipped");
    return;
  }

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw AppError.badRequest("Invalid endpoint URL");
  }

  const hostname = url.hostname;
  if (!hostname) {
    throw AppError.badRequest("Endpoint URL must have a hostname");
  }

  const directParsed = parseIPv4(hostname) ?? parseIPv6(hostname);
  if (directParsed && isPrivateIP(directParsed)) {
    throw AppError.forbidden("Endpoint URL resolves to a private/reserved IP address");
  }

  if (!directParsed) {
    let address: string;
    try {
      const result = await dns.lookup(hostname);
      address = result.address;
    } catch {
      throw AppError.badRequest(`Cannot resolve hostname: ${hostname}`);
    }

    const resolvedParsed = parseIPv4(address) ?? parseIPv6(address);
    if (resolvedParsed && isPrivateIP(resolvedParsed)) {
      throw AppError.forbidden("Endpoint URL resolves to a private/reserved IP address");
    }
  }
}
