import { useEffect, useMemo, useRef } from "react";
import type { LogEntry } from "../types/pipeline";

interface RunLogPanelProps {
  logs: LogEntry[];
  onQueryChange: (value: string) => void;
  onRun: () => void;
  query: string;
  result?: string;
  runPending: boolean;
  runtimePrompt: string;
}

function formatTerminalTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function logPrefix(log: LogEntry) {
  if (log.eventType === "error") {
    return "!";
  }
  if (log.eventType === "done") {
    return "✓";
  }
  if (log.eventType === "start") {
    return ">";
  }
  if (log.eventType === "output") {
    return "$";
  }
  return "~";
}

function logLabel(log: LogEntry) {
  if (log.nodeId) {
    return log.nodeId;
  }
  if (log.details?.entrypoint) {
    return String(log.details.entrypoint);
  }
  return "system";
}

function orderedDetails(details?: LogEntry["details"]) {
  if (!details) {
    return [];
  }

  return Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== "");
}

export function RunLogPanel({
  logs,
  onQueryChange,
  onRun,
  query,
  result,
  runPending,
  runtimePrompt,
}: RunLogPanelProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [logs, result]);

  const terminalTitle = useMemo(() => {
    if (runPending) {
      return "live execution stream";
    }
    if (logs.length > 0) {
      return "last run captured";
    }
    return "idle";
  }, [logs.length, runPending]);

  return (
    <section className="studio-panel panel-pad log-panel terminal-shell">
      <div className="terminal-topbar">
        <div className="terminal-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="terminal-title-group">
          <span className="eyebrow">Console</span>
          <h2>AgentMesh runtime terminal</h2>
        </div>
        <div className="terminal-status-badge">{terminalTitle}</div>
      </div>

      <div className="terminal-control-row">
        <label className="terminal-input-group">
          <span>Incoming request</span>
          <textarea
            className="prop-input terminal-query-input"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder='{"prompt":"What is the weather of Africa?"}'
            value={query}
          />
        </label>

        <div className="terminal-sidecard">
          <span>Agent prompt</span>
          <strong>{runtimePrompt}</strong>
          <button className="primary-button compact-button terminal-run-button" disabled={runPending} onClick={onRun} type="button">
            {runPending ? "Streaming..." : "Run Workflow"}
          </button>
        </div>
      </div>

      <div className="console-terminal" ref={terminalRef}>
        <div className="terminal-session-meta">
          <div className="terminal-command-line">
            <span className="terminal-prompt">agentmesh@studio</span>
            <span className="terminal-command">run --query "{query || "What is the weather of Africa?"}"</span>
          </div>
          <div className="terminal-command-line terminal-command-line-muted">
            <span className="terminal-prompt">planner</span>
            <span className="terminal-command">{runtimePrompt}</span>
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="console-line console-line-muted terminal-idle-line">$ waiting for runtime output...</div>
        ) : (
          logs.map((log, index) => {
            const details = orderedDetails(log.details);

            return (
              <div key={`${log.timestamp}-${index}`} className={`console-block console-block-${log.level}`}>
                <div className="console-line terminal-log-line">
                  <span className="console-time">{formatTerminalTime(log.timestamp)}</span>
                  <span className={`terminal-prefix terminal-prefix-${log.level}`}>{logPrefix(log)}</span>
                  <span className="console-node">{logLabel(log)}</span>
                  <strong className="console-message">{log.message}</strong>
                  {log.txId ? <code className="terminal-code-chip">{log.txId}</code> : null}
                </div>

                {details.length > 0 ? (
                  <div className="terminal-detail-grid">
                    {details.map(([key, value]) => (
                      <div key={`${log.timestamp}-${key}`} className="terminal-detail-pill">
                        <span>{key.replace(/_/g, " ")}</span>
                        <strong>{String(value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {log.output ? <pre className="console-output">{log.output}</pre> : null}
              </div>
            );
          })
        )}

        {result ? (
          <div className="terminal-result-block">
            <div className="console-line terminal-log-line">
              <span className="console-time">final</span>
              <span className="terminal-prefix terminal-prefix-success">✓</span>
              <span className="console-node">response</span>
              <strong className="console-message">Pipeline returned the final HTTP response.</strong>
            </div>
            <pre className="console-output terminal-result-output">{result}</pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
