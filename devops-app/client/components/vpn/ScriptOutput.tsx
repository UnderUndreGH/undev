/** Feature 016 T020 — real-time script execution output via WebSocket. */
import React, { useEffect, useRef, useState } from "react";
import { scriptsApi, type ScriptExecution } from "../../lib/scripts-api.js";

interface Props {
  executionId: string;
}

interface OutputLine {
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export function ScriptOutput({ executionId }: Props): React.JSX.Element {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [execution, setExecution] = useState<ScriptExecution | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // WebSocket for real-time output
  useEffect(() => {
    setLines([]);
    setExecution(null);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "subscribe", channel: `execution:${executionId}` }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "stdout" || msg.type === "stderr") {
          setLines((prev) => [
            ...prev,
            { stream: msg.type, text: msg.data ?? "" },
          ]);
        } else if (msg.type === "exit" || msg.type === "error") {
          setLines((prev) => [
            ...prev,
            { stream: "system", text: `Process exited with code ${msg.data ?? "?"}` },
          ]);
          fetchExecution();
        }
      } catch {
        // Raw text frame
        setLines((prev) => [
          ...prev,
          { stream: "stdout", text: event.data },
        ]);
      }
    };

    ws.onerror = () => {
      setLines((prev) => [
        ...prev,
        { stream: "system", text: "WebSocket connection error" },
      ]);
    };

    ws.onclose = () => {
      fetchExecution();
    };

    async function fetchExecution() {
      try {
        const exec = await scriptsApi.getExecution(executionId);
        setExecution(exec);
      } catch {
        // ignore
      }
    }

    // Fetch initial state
    fetchExecution();

    return () => {
      ws.close();
    };
  }, [executionId]);

  // Auto-scroll
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines]);

  const isRunning =
    execution?.status === "running" || execution?.status === "pending";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Output
        </h3>
        {execution && (
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="text-xs text-blue-400 animate-pulse">
                Running…
              </span>
            )}
            {execution.status === "completed" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-400 border border-green-700">
                Exit {execution.exitCode}
              </span>
            )}
            {execution.status === "failed" && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/50 text-red-400 border border-red-700">
                Exit {execution.exitCode ?? "?"}
              </span>
            )}
          </div>
        )}
      </div>
      <pre
        ref={preRef}
        className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono overflow-auto max-h-96 min-h-[8rem]"
      >
        {lines.length === 0 ? (
          <span className="text-gray-600">
            {isRunning ? "Waiting for output…" : "No output yet."}
          </span>
        ) : (
          lines.map((line, i) => (
            <span
              key={i}
              className={
                line.stream === "stderr"
                  ? "text-red-400"
                  : line.stream === "system"
                    ? "text-yellow-400"
                    : "text-gray-300"
              }
            >
              {line.text}
              {"\n"}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
