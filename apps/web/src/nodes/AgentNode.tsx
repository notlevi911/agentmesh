import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

function formatAlgo(amount?: number) {
  return `${(amount ?? 0).toFixed(3)} ALGO`;
}

function shortenAddress(address?: string) {
  if (!address) {
    return "Not deployed";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusSymbol(state?: PipelineNodeData["executionState"]) {
  if (state === "done") {
    return "✓";
  }
  if (state === "error") {
    return "!";
  }
  if (state === "running") {
    return "•";
  }
  return "○";
}

export function AgentNode({ id, data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-agent">
      <Handle className="node-handle node-handle-target" position={Position.Left} type="target" />
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">Agent</div>
        <div className="node-chip-row">
          <span className="node-chip">{payload.role ?? "operator"}</span>
          <span className={`node-status node-status-${payload.executionState ?? "idle"}`}>
            {statusSymbol(payload.executionState)}
          </span>
        </div>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <dl className="node-metrics">
        <div>
          <dt>Price</dt>
          <dd>{formatAlgo(payload.priceAlgo)}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd className="wallet-row">
            <span>{shortenAddress(payload.walletAddress)}</span>
            {payload.walletAddress ? (
              <button
                className="wallet-copy-button"
                onClick={() => payload.onCopyWallet?.(id)}
                type="button"
              >
                Copy
              </button>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd>{formatAlgo(payload.balanceAlgo)}</dd>
        </div>
        <div>
          <dt>Treasury</dt>
          <dd>{shortenAddress(payload.treasuryAddress) === "Not deployed" ? "Agent wallet" : shortenAddress(payload.treasuryAddress)}</dd>
        </div>
      </dl>
      <div className="node-inline muted-inline">
        Tools: {(payload.enabledTools ?? []).length ? (payload.enabledTools ?? []).join(", ") : "none"}
      </div>
      {payload.executionNote ? <div className="node-output-preview">{payload.executionNote}</div> : null}
      <button
        className="node-action"
        onClick={() => payload.onFundWallet?.(id)}
        type="button"
      >
        Fund Wallet
      </button>
    </div>
  );
}
