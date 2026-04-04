import type { LogEntry } from "../types/pipeline";

interface RunLogPanelProps {
  logs: LogEntry[];
  onRun: () => void;
  result?: string;
  runPending: boolean;
  runtimePrompt: string;
}

export function RunLogPanel({ logs, onRun, result, runPending, runtimePrompt }: RunLogPanelProps) {
  return (
    <section className="studio-panel panel-pad log-panel">
      <div className="panel-header-block">
        <span className="eyebrow">Runtime</span>
        <h2>Pipeline logs</h2>
      </div>
      <div className="console-toolbar">
        <div className="console-prompt-preview">
          <span>Execution prompt</span>
          <strong>{runtimePrompt}</strong>
        </div>
        <button className="primary-button compact-button" disabled={runPending} onClick={onRun} type="button">
          {runPending ? "Running..." : "Run Workflow"}
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <div className="log-item muted">Deploy or run the pipeline to stream execution steps here.</div>
        ) : (
          logs.map((log, index) => (
            <div key={`${log.timestamp}-${index}`} className={`log-item log-${log.level}`}>
              <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
              <strong>{log.message}</strong>
              {log.txId ? <code>{log.txId}</code> : null}
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
