import type { LogEntry } from "../types/pipeline";

interface RunLogPanelProps {
  logs: LogEntry[];
  result?: string;
}

export function RunLogPanel({ logs, result }: RunLogPanelProps) {
  return (
    <section className="log-panel">
      <div className="panel-header">
        <span className="eyebrow">Runtime</span>
        <h2>Pipeline logs</h2>
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

