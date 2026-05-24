import { z } from "zod";

export const ServerKind = {
  GENERAL: "general",
  VPN: "vpn",
} as const;

export type ServerKind = (typeof ServerKind)[keyof typeof ServerKind];

export const ALL_SERVER_KINDS: ServerKind[] = [ServerKind.GENERAL, ServerKind.VPN];

export const kindFilterSchema = z
  .enum(["all", ...ALL_SERVER_KINDS])
  .default("all");

export type KindFilter = z.infer<typeof kindFilterSchema>;

export function parseKindFilter(raw: unknown): ServerKind[] {
  const parsed = kindFilterSchema.safeParse(raw);
  if (!parsed.success) return ALL_SERVER_KINDS;
  const kind = parsed.data;
  if (kind === "all") return ALL_SERVER_KINDS;
  return [kind];
}

export function isUnifiedApiEnabled(): boolean {
  return process.env.UNIFIED_SERVERS_API_ENABLED === "true";
}
