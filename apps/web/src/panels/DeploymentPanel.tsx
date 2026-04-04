import type { DeployResponse } from "../types/pipeline";

interface DeploymentPanelProps {
  deployment: DeployResponse | null;
  onCopyEndpoint: () => void;
  onRunDemo: () => void;
  runPending: boolean;
}

export function DeploymentPanel({
  deployment,
  onCopyEndpoint,
  onRunDemo,
  runPending,
}: DeploymentPanelProps) {
  if (!deployment) {
    return (
      <aside className="side-panel empty-panel">
        <div className="panel-header">
          <span className="eyebrow">Deploy</span>
          <h2>Ready for launch</h2>
        </div>
        <p>
          Deploy the canvas to mint agent wallets, reserve a live pipeline endpoint, and unlock
          the funding and run panels.
        </p>
      </aside>
    );
  }

  return (
    <aside className="side-panel">
      <div className="panel-header">
        <span className="eyebrow">Pipeline</span>
        <h2>{deployment.pipelineId}</h2>
      </div>
      <div className="stat-card success-card">
        <span>Status</span>
        <strong>LIVE on Algorand Testnet</strong>
      </div>
      <div className="stat-card">
        <span>Endpoint</span>
        <strong>{deployment.endpoint}</strong>
      </div>
      <div className="stat-row">
        <div className="stat-card">
          <span>Price per call</span>
          <strong>{deployment.priceAlgo.toFixed(3)} ALGO</strong>
        </div>
        <div className="stat-card">
          <span>Payment wallet</span>
          <strong>{deployment.paymentWallet ?? "No priced agent yet"}</strong>
        </div>
      </div>
      <div className="panel-actions">
        <button className="secondary-button" onClick={onCopyEndpoint} type="button">
          Copy Endpoint
        </button>
        {deployment.loraUrl ? (
          <a
            className="secondary-button link-button"
            href={deployment.loraUrl}
            rel="noreferrer"
            target="_blank"
          >
            View on Lora
          </a>
        ) : null}
      </div>
      <button className="primary-button full-width" disabled={runPending} onClick={onRunDemo} type="button">
        {runPending ? "Running pipeline..." : "Run Demo Request"}
      </button>
    </aside>
  );
}
