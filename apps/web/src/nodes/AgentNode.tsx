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

function statusLabel(state?: PipelineNodeData["executionState"]) {
  if (state === "done") return "Completed";
  if (state === "error") return "Failed";
  if (state === "running") return "Running";
  return "Idle";
}

const TOOLLESS_SERVICE_KINDS = new Set(["gemini", "openai", "claude", "mistral"]);

export function AgentNode({ id, data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const executionState = payload.executionState ?? "idle";

  const modelConnections = useNodeConnections({ handleType: "target", handleId: "model" });
  const toolConnections = useNodeConnections({ handleType: "target", handleId: "tools" });
  const nodes = useNodes();

  const connectedModelNode = nodes.find((node) =>
    modelConnections.some((connection) => connection.source === node.id),
  );
  const connectedModel = connectedModelNode?.data?.serviceKind as string | undefined;
  const connectedToolNodes = nodes.filter((node) =>
    toolConnections.some(
      (connection) =>
        connection.source === node.id && !TOOLLESS_SERVICE_KINDS.has(String(node.data?.serviceKind ?? "")),
    ),
  );
  const toolCount = connectedToolNodes.length;
  const toolSummary =
    connectedToolNodes
      .map((node) => String(node.data?.label ?? node.id))
      .slice(0, 2)
      .join(", ") || null;

  return (
    <div className={`node-shell node-agent node-state-${executionState}`}>
      <Handle
        className="node-handle node-handle-target"
        id="workflow-in"
        position={Position.Left}
        type="target"
      />
      <Handle
        className="node-handle node-handle-source"
        id="workflow-out"
        position={Position.Right}
        type="source"
      />
      <Handle
        className="node-handle node-handle-model"
        id="model"
        position={Position.Bottom}
        type="target"
      />
      <Handle
        className="node-handle node-handle-tools"
        id="tools"
        position={Position.Bottom}
        type="target"
      />

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

      <div className="node-section-label">
        <span className="node-section-icon">🤖</span>
        AI Model
        {connectedModel ? (
          <span className="node-section-badge">{connectedModel}</span>
        ) : (
          <span className="node-section-empty">connect bottom-left dot</span>
        )}
      </div>

      <div className="node-section-label">
        <span className="node-section-icon">🔧</span>
        Tools
        <span className="node-section-badge-count">{toolCount}</span>
      </div>
      <div className="node-inline muted-inline">
        {toolSummary ? `${toolSummary}${toolCount > 2 ? ` +${toolCount - 2} more` : ""}` : "Connect a tool's top dot to the bottom-right tools dot."}
      </div>

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

      {payload.executionMessage || payload.executionOutput ? (
        <div className="node-runtime-card">
          <div className="node-runtime-header">
            <span>Last run</span>
            <strong>{statusLabel(executionState)}</strong>
          </div>
          {payload.executionMessage ? (
            <div className="node-runtime-message">{payload.executionMessage}</div>
          ) : null}
          {payload.executionOutput ? (
            <pre className="node-runtime-output">{payload.executionOutput}</pre>
          ) : null}
        </div>
      ) : null}

      <button
        className="node-action"
        onClick={() => payload.onFundWallet?.(id)}
        type="button"
      >
        Fund Wallet
      </button>

      <div className="node-handle-labels node-handle-labels-agent">
        <span>AI Model</span>
        <span>Tools</span>
      </div>
    </div>
  );
}
