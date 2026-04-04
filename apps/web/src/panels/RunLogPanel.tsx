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

export function RunLogPanel({
  logs,
  onQueryChange,
  onRun,
  query,
  result,
  runPending,
  runtimePrompt,
}: RunLogPanelProps) {
  return (
    <section className="studio-panel panel-pad log-panel">
      <div className="panel-header-block">
        <span className="eyebrow">Runtime</span>
        <h2>Pipeline terminal</h2>
      </div>
      <div className="console-toolbar">
        <div className="console-prompt-preview">
          <span>Incoming request</span>
          <input
            className="prop-input console-query-input"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="What is the weather of Africa?"
            value={query}
          />
          <span>Execution prompt</span>
          <strong>{runtimePrompt}</strong>
        </div>
        <button className="primary-button compact-button" disabled={runPending} onClick={onRun} type="button">
          {runPending ? "Running..." : "Run Workflow"}
        </button>
      </div>
      <div className="console-terminal">
        {logs.length === 0 ? (
          <div className="console-line console-line-muted">$ waiting for runtime output...</div>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className={`console-block console-block-${log.level}`}>
              <div className="console-line">
                <span className="console-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className="console-node">{log.nodeId ?? "system"}</span>
                <strong className="console-message">{log.message}</strong>
                {log.txId ? <code>{log.txId}</code> : null}
              </div>
              {log.output ? <div className="console-output">{log.output}</div> : null}
            </div>
          ))
        )}
      </div>
      {result ? (
        <div className="result-card">
          <span>Latest result</span>
          <strong>{result}</strong>
        </div>
      ) : null}
    </section>
  );
}
