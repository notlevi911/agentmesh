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

export function AgentNode({ id, data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-agent">
      <Handle className="node-handle node-handle-target" position={Position.Left} type="target" />
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">Agent</div>
        <span className="node-chip">{payload.role ?? "operator"}</span>
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
          <dd>{shortenAddress(payload.walletAddress)}</dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd>{formatAlgo(payload.balanceAlgo)}</dd>
        </div>
      </dl>
      <div className="node-inline muted-inline">
        Tools: {(payload.enabledTools ?? []).length ? (payload.enabledTools ?? []).join(", ") : "none"}
      </div>
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
