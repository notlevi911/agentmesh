import { Handle, Position, useNodeConnections, useNodes, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

function formatAlgo(amount?: number) {
  return `${(amount ?? 0).toFixed(3)} ALGO`;
}

function shortenAddress(address?: string) {
  if (!address) return "Not deployed";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusSymbol(state?: PipelineNodeData["executionState"]) {
  if (state === "done") return "✓";
  if (state === "error") return "!";
  if (state === "running") return "●";
  return "○";
}

const AI_MODELS = ["gemini", "openai", "claude", "mistral"];

export function AgentNode({ id, data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const executionState = payload.executionState ?? "idle";

  const modelConnections = useNodeConnections({ handleType: 'target', handleId: 'model' });
  const toolsConnections = useNodeConnections({ handleType: 'target', handleId: 'tools' });
  const nodes = useNodes();

  const connectedModelNode = nodes.find(n => modelConnections.some(c => c.source === n.id));
  const connectedModel = connectedModelNode?.data?.serviceKind as string | undefined;
  
  const toolCount = toolsConnections.length;

  return (
    <div className={`node-shell node-agent node-state-${executionState}`}>
      {/* ── Workflow flow handles (left/right) ── */}
      <Handle
        className="node-handle node-handle-target"
        position={Position.Left}
        type="target"
      />
      <Handle
        className="node-handle node-handle-source"
        position={Position.Right}
        type="source"
      />

      {/* ── AI Model sub-handle (bottom-left) ── */}
      <Handle
        className="node-handle"
        id="model"
        position={Position.Bottom}
        style={{
          left: "25%",
          bottom: -9,
          background: "#a78bfa",
          width: 16,
          height: 16,
          border: "3px solid #08040f",
          boxShadow: "0 0 0 4px rgba(167,139,250,0.22)",
        }}
        type="target"
      />

      {/* ── Tools sub-handle (bottom-right) ── accepts connections from tool/API nodes ── */}
      <Handle
        className="node-handle"
        id="tools"
        position={Position.Bottom}
        style={{
          left: "72%",
          bottom: -9,
          background: "#7c3aed",
          width: 16,
          height: 16,
          border: "3px solid #08040f",
          boxShadow: "0 0 0 4px rgba(124,58,237,0.22)",
        }}
        type="target"
      />

      {/* Header */}
      <div className="node-header-row">
        <div className="node-badge">Agent</div>
        <div className="node-chip-row">
          <span className="node-chip">{payload.role ?? "operator"}</span>
          <span className={`node-status node-status-${executionState}`}>
            {statusSymbol(executionState)}
          </span>
        </div>
      </div>

      <h3>{payload.label}</h3>
      <p>{payload.description}</p>

      {/* n8n-style AI Model section */}
      <div className="node-section-label">
        <span className="node-section-icon">🤖</span>
        AI Model
        {connectedModel ? (
          <span className="node-section-badge">{connectedModel}</span>
        ) : (
          <span className="node-section-empty">connect ↓ left dot</span>
        )}
      </div>

      {/* n8n-style Tools section */}
      <div className="node-section-label">
        <span className="node-section-icon">🔧</span>
        Tools
        <span className="node-section-badge-count">{toolCount}</span>
      </div>

      {/* Algorand metrics */}
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
          <dd>
            {shortenAddress(payload.treasuryAddress) === "Not deployed"
              ? "Agent wallet"
              : shortenAddress(payload.treasuryAddress)}
          </dd>
        </div>
      </dl>

      {payload.executionNote ? (
        <div className="node-output-preview">{payload.executionNote}</div>
      ) : null}

      <button
        className="node-action"
        onClick={() => payload.onFundWallet?.(id)}
        type="button"
      >
        Fund Wallet
      </button>

      {/* Sub-handle labels — shown below the node */}
      <div className="node-handle-labels">
        <span>🤖 AI MODEL</span>
        <span>🔧 TOOLS</span>
      </div>
    </div>
  );
}
