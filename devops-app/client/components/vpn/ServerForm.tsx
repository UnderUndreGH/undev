/** Feature 016 T008 — VPN server add form, mirrors Amnezia client fields. */
import React, { useState } from "react";
import { vpnApi, type CreateVpnServerRequest } from "../../lib/vpn-api.js";
import { ApiError } from "../../lib/api.js";

type AuthMode = "password" | "key";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function ServerForm({ onCreated, onCancel }: Props): React.JSX.Element {
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [sshUser, setSshUser] = useState("root");
  const [authMode, setAuthMode] = useState<AuthMode>("key");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [installVpn, setInstallVpn] = useState(true);
  const [storeCredentials, setStoreCredentials] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const data: CreateVpnServerRequest = {
      label,
      host,
      port,
      sshUser,
      password: authMode === "password" ? password : undefined,
      privateKey: authMode === "key" ? privateKey : undefined,
      storeCredentials,
      installVpn,
    };

    try {
      await vpnApi.create(data);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to add server");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs uppercase text-gray-500">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="production-vpn"
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
          <span className="text-xs uppercase text-gray-500">
            Server Host / IP
          </span>
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

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase text-gray-500">Auth mode</legend>
        <div className="flex gap-2">
          {(
            [
              ["key", "Private Key"],
              ["password", "Password"],
            ] as Array<[AuthMode, string]>
          ).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              onClick={() => setAuthMode(m)}
              className={`text-xs px-2 py-1 rounded border ${
                authMode === m
                  ? "bg-brand-purple border-brand-purple text-white"
                  : "bg-gray-950 border-gray-700 text-gray-400 hover:border-gray-500"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {authMode === "key" && (
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            rows={4}
            required
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----"}
            className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-brand-purple"
          />
        )}
        {authMode === "password" && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            onChange={(e) => setInstallVpn(e.target.checked)}
            className="rounded border-gray-600"
          />
          Install Amnezia VPN
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={storeCredentials}
            onChange={(e) => setStoreCredentials(e.target.checked)}
            className="rounded border-gray-600"
          />
          Remember credentials
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
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
          disabled={submitting}
          className="bg-brand-purple hover:bg-purple-600 disabled:opacity-50 px-3 py-1.5 rounded text-sm font-medium"
        >
          {submitting ? "Adding…" : "Add Server"}
        </button>
      </div>
    </form>
  );
}
