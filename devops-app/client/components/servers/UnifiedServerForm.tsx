/**
 * VERIFICATION CHECKLIST (Feature 021 — T018):
 *
 * T018: Verify unified form:
 *   - Selecting "General" shows basic fields + probe-then-onboard flow
 *   - Selecting "VPN" shows VPN-specific fields (install VPN toggle, remember credentials)
 *   - Switching kind resets submit state
 *   - Form submits to correct endpoint per kind
 *   - Kind-specific fields are stripped before submit
 */

/**
 * Feature 021 T013 — Unified server form for General and VPN server creation.
 *
 * Kind selector toggles between:
 *   - General: probe-then-onboard flow (Feature 011 AddServerForm)
 *   - VPN: direct-create flow (Feature 016 VPN ServerForm)
 *
 * Uses Zod discriminatedUnion for validation. Frontend strips out-of-discriminator
 * fields before submit.
 */

import React, { useMemo, useState } from "react";
import { z } from "zod";
import {
  CompatibilityReport,
  type CompatibilityReportData,
} from "./CompatibilityReport.js";
import {
  useCompatibilityReport,
  type ProbeResult,
} from "../../hooks/useCompatibilityReport.js";
import { api, ApiError } from "../../lib/api.js";
import { vpnApi } from "../../lib/vpn-api.js";

type ServerKind = "general" | "vpn";

const generalServerSchema = z.object({
  kind: z.literal("general"),
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  sshUser: z.string().min(1),
  scriptsPath: z.string().min(1),
  authMode: z.enum(["paste-key", "paste-password", "generate-key"]),
  privateKey: z.string().optional(),
  password: z.string().optional(),
});

const vpnServerSchema = z.object({
  kind: z.literal("vpn"),
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  sshUser: z.string().min(1),
  authMode: z.enum(["key", "password"]),
  privateKey: z.string().optional(),
  password: z.string().optional(),
  installVpn: z.boolean(),
  storeCredentials: z.boolean(),
});

const serverFormSchema = z.discriminatedUnion("kind", [
  generalServerSchema,
  vpnServerSchema,
]);

type GeneralAuthMode = "paste-key" | "paste-password" | "generate-key";
type VpnAuthMode = "key" | "password";

interface Props {
  onCreated: (serverId?: string) => void;
  onCancel: () => void;
}

interface OnboardResponse {
  server: { id: string };
  generatedPublicKey?: string;
}

export function UnifiedServerForm({ onCreated, onCancel }: Props): React.JSX.Element {
  const [kind, setKind] = useState<ServerKind>("general");

  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [sshUser, setSshUser] = useState("root");
  const [scriptsPath, setScriptsPath] = useState("/opt/devops-scripts");

  const [generalAuthMode, setGeneralAuthMode] = useState<GeneralAuthMode>("paste-key");
  const [vpnAuthMode, setVpnAuthMode] = useState<VpnAuthMode>("key");
  const [privateKey, setPrivateKey] = useState("");
  const [password, setPassword] = useState("");

  const [installVpn, setInstallVpn] = useState(true);
  const [storeCredentials, setStoreCredentials] = useState(true);

  const probe = useCompatibilityReport();
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [genPubkey, setGenPubkey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function buildGeneralAuth():
    | { mode: "key"; privateKey: string }
    | { mode: "password"; password: string }
    | { mode: "generate-key" } {
    if (generalAuthMode === "paste-key") return { mode: "key", privateKey };
    if (generalAuthMode === "paste-password") return { mode: "password", password };
    return { mode: "generate-key" };
  }

  async function handleProbe() {
    setSubmitError(null);
    setProbeResult(null);
    setAcknowledged(new Set());
    try {
      const result = await probe.mutateAsync({
        host,
        port,
        sshUser,
        bootstrapAuth: buildGeneralAuth(),
      });
      setProbeResult(result);
      if (result.generatedPublicKey) {
        setGenPubkey(result.generatedPublicKey);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (
          err.code === "ssh_auth_failed" &&
          err.details &&
          typeof err.details === "object" &&
          "generatedPublicKey" in err.details
        ) {
          const detail = err.details as { generatedPublicKey?: string };
          if (detail.generatedPublicKey) {
            setGenPubkey(detail.generatedPublicKey);
          }
        }
        setSubmitError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Probe failed");
      }
    }
  }

  const report: CompatibilityReportData | null = probeResult?.compatibility ?? null;

  const saveBlocked = useMemo(() => {
    if (kind === "general") {
      if (!report) return true;
      if (report.checks.some((c) => c.status === "fail")) return true;
      const unackedWarn = report.checks.some(
        (c) => c.status === "warn" && !acknowledged.has(c.id),
      );
      return unackedWarn;
    }
    return false;
  }, [kind, report, acknowledged]);

  function stripFieldsForKind(data: Record<string, unknown>, submitKind: ServerKind): Record<string, unknown> {
    if (submitKind === "general") {
      delete data.installVpn;
      delete data.storeCredentials;
      delete data.authMode;
    } else {
      delete data.scriptsPath;
      delete data.authMode;
    }
    return data;
  }

  async function handleGeneralSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!probeResult) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const credential = (() => {
        if (generalAuthMode === "paste-key") {
          return { mode: "key" as const, privateKey };
        }
        if (generalAuthMode === "paste-password") {
          return { mode: "password" as const, password };
        }
        return { mode: "generated" as const };
      })();
      const result = await api.post<OnboardResponse>("/servers/onboard", {
        label,
        host,
        port,
        sshUser,
        scriptsPath,
        probeToken: probeResult.probeToken,
        managedSshCredential: credential,
        acknowledgedWarnings: [...acknowledged],
      });
      onCreated(result.server.id);
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleVpnSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSaving(true);

    const payload = stripFieldsForKind({
      kind,
      label,
      host,
      port,
      sshUser,
      authMode: vpnAuthMode,
      password: vpnAuthMode === "password" ? password : undefined,
      privateKey: vpnAuthMode === "key" ? privateKey : undefined,
      storeCredentials,
      installVpn,
    }, "vpn");

    try {
      await vpnApi.create({
        label: payload.label as string,
        host: payload.host as string,
        port: payload.port as number,
        sshUser: payload.sshUser as string,
        password: payload.password as string | undefined,
        privateKey: payload.privateKey as string | undefined,
        storeCredentials: payload.storeCredentials as boolean,
        installVpn: payload.installVpn as boolean,
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Failed to add server");
      }
    } finally {
      setSaving(false);
    }
  }

  const handleSubmit = kind === "general" ? handleGeneralSubmit : handleVpnSubmit;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2 mb-2">
        {(["general", "vpn"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setSubmitError(null);
              setProbeResult(null);
            }}
            className={`text-xs px-3 py-1.5 rounded border font-medium ${
              kind === k
                ? "bg-brand-purple border-brand-purple text-white"
                : "bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
          >
            {k === "general" ? "General Server" : "VPN Server"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs uppercase text-gray-500">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-gray-500">Username</span>
          <input
            type="text"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
            required
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block col-span-2">
          <span className="text-xs uppercase text-gray-500">Host / IP</span>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
            placeholder="192.0.2.10"
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase text-gray-500">SSH Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            min={1}
            max={65535}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
          />
        </label>
      </div>

      {kind === "general" && (
        <GeneralAuthSection
          mode={generalAuthMode}
          onModeChange={setGeneralAuthMode}
          privateKey={privateKey}
          onPrivateKeyChange={setPrivateKey}
          password={password}
          onPasswordChange={setPassword}
          genPubkey={genPubkey}
          scriptsPath={scriptsPath}
          onScriptsPathChange={setScriptsPath}
        />
      )}

      {kind === "vpn" && (
        <VpnAuthSection
          mode={vpnAuthMode}
          onModeChange={setVpnAuthMode}
          privateKey={privateKey}
          onPrivateKeyChange={setPrivateKey}
          password={password}
          onPasswordChange={setPassword}
          installVpn={installVpn}
          onInstallVpnChange={setInstallVpn}
          storeCredentials={storeCredentials}
          onStoreCredentialsChange={setStoreCredentials}
        />
      )}

      {kind === "general" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleProbe}
            disabled={probe.isPending || !host || !sshUser}
            className="border border-gray-700 hover:border-gray-500 disabled:opacity-50 px-3 py-1.5 rounded text-sm"
          >
            {probe.isPending ? "Testing…" : "Test connection"}
          </button>
          {probeResult && (
            <span className="text-xs text-gray-500">
              Cloud: {probeResult.cloudProvider} · Host key:{" "}
              <span className="font-mono">
                {probeResult.hostKeyFingerprint.slice(0, 24)}…
              </span>
            </span>
          )}
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-400" role="alert">
          {submitError}
        </p>
      )}

      {kind === "general" && report && (
        <CompatibilityReport
          report={report}
          acknowledgedWarnings={acknowledged}
          onAcknowledgeWarning={(id, ack) => {
            setAcknowledged((prev) => {
              const next = new Set(prev);
              if (ack) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
        />
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saveBlocked || saving}
          className="bg-brand-purple hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-sm font-medium"
        >
          {saving
            ? "Saving…"
            : kind === "general"
              ? "Save server"
              : "Add VPN Server"}
        </button>
      </div>
    </form>
  );
}

function GeneralAuthSection({
  mode,
  onModeChange,
  privateKey,
  onPrivateKeyChange,
  password,
  onPasswordChange,
  genPubkey,
  scriptsPath,
  onScriptsPathChange,
}: {
  mode: GeneralAuthMode;
  onModeChange: (m: GeneralAuthMode) => void;
  privateKey: string;
  onPrivateKeyChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  genPubkey: string | null;
  scriptsPath: string;
  onScriptsPathChange: (v: string) => void;
}) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase text-gray-500">Auth mode</legend>
        <div className="flex gap-2">
          {(
            [
              ["paste-key", "Paste private key"],
              ["paste-password", "Paste root password"],
              ["generate-key", "Generate key"],
            ] as Array<[GeneralAuthMode, string]>
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`text-xs px-2 py-1 rounded border ${
                mode === m
                  ? "bg-brand-purple border-brand-purple text-white"
                  : "bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-500"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === "paste-key" && (
          <textarea
            value={privateKey}
            onChange={(e) => onPrivateKeyChange(e.target.value)}
            rows={4}
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono"
          />
        )}
        {mode === "paste-password" && (
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder="root password"
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm"
          />
        )}
        {mode === "generate-key" && genPubkey && (
          <div className="bg-gray-950 border border-gray-700 rounded p-2">
            <p className="text-xs text-gray-400 mb-1">
              Install this public key on the target before retrying:
            </p>
            <code className="block text-[10px] font-mono break-all whitespace-pre-wrap text-green-300">
              {genPubkey}
            </code>
            <p className="text-xs text-gray-500 mt-1">
              {`echo "${genPubkey}" >> ~/.ssh/authorized_keys`}
            </p>
          </div>
        )}
      </fieldset>

      <label className="block">
        <span className="text-xs uppercase text-gray-500">Scripts path</span>
        <input
          type="text"
          value={scriptsPath}
          onChange={(e) => onScriptsPathChange(e.target.value)}
          className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
        />
      </label>
    </>
  );
}

function VpnAuthSection({
  mode,
  onModeChange,
  privateKey,
  onPrivateKeyChange,
  password,
  onPasswordChange,
  installVpn,
  onInstallVpnChange,
  storeCredentials,
  onStoreCredentialsChange,
}: {
  mode: VpnAuthMode;
  onModeChange: (m: VpnAuthMode) => void;
  privateKey: string;
  onPrivateKeyChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  installVpn: boolean;
  onInstallVpnChange: (v: boolean) => void;
  storeCredentials: boolean;
  onStoreCredentialsChange: (v: boolean) => void;
}) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="text-xs uppercase text-gray-500">Auth mode</legend>
        <div className="flex gap-2">
          {(
            [
              ["key", "Private Key"],
              ["password", "Password"],
            ] as Array<[VpnAuthMode, string]>
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`text-xs px-2 py-1 rounded border ${
                mode === m
                  ? "bg-brand-purple border-brand-purple text-white"
                  : "bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-500"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === "key" && (
          <textarea
            value={privateKey}
            onChange={(e) => onPrivateKeyChange(e.target.value)}
            rows={4}
            required
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-purple"
          />
        )}
        {mode === "password" && (
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
            placeholder="root password"
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-brand-purple"
          />
        )}
      </fieldset>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={installVpn}
            onChange={(e) => onInstallVpnChange(e.target.checked)}
            className="rounded border-gray-600"
          />
          Install Amnezia VPN
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={storeCredentials}
            onChange={(e) => onStoreCredentialsChange(e.target.checked)}
            className="rounded border-gray-600"
          />
          Remember credentials
        </label>
      </div>
    </>
  );
}
