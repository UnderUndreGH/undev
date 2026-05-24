import React from "react";
import { useTestAiProvider } from "../../hooks/useAiProviders.js";

interface Props {
  providerId: string;
}

export function ProviderTestButton({ providerId }: Props) {
  const testMutation = useTestAiProvider();

  const handleClick = () => {
    testMutation.mutate(providerId);
  };

  const result = testMutation.data;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={testMutation.isPending}
        className="bg-gray-800 text-gray-300 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
      >
        {testMutation.isPending ? "Testing..." : "Test Connection"}
      </button>
      {result && (
        <span className={`text-sm ${result.ok ? "text-green-400" : "text-red-400"}`}>
          {result.ok
            ? `OK (${result.latencyMs}ms)`
            : `Failed: ${result.error ?? "unknown error"}`}
        </span>
      )}
    </div>
  );
}
