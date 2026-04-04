import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

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

export function ServiceNode({ data, type }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const isApi = type === "api";
  const executionState = payload.executionState ?? "idle";

  return (
    <div className={`node-shell node-service node-state-${executionState}`}>
      <Handle className="node-handle node-handle-target" position={Position.Left} type="target" />
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">{isApi ? "API" : "Service"}</div>
        <div className="node-chip-row">
          <span className="node-chip">{payload.serviceKind ?? "custom"}</span>
          <span className={`node-status node-status-${executionState}`}>
            {statusSymbol(executionState)}
          </span>
        </div>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <dl className="node-metrics">
        <div>
          <dt>Endpoint</dt>
          <dd>{payload.serviceUrl?.replace(/^https?:\/\//, "") ?? "Unset"}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{payload.upstreamX402 ? "Upstream x402" : `${(payload.priceAlgo ?? 0).toFixed(3)} ALGO`}</dd>
        </div>
      </dl>
      <div className="node-inline muted-inline">
        {payload.upstreamX402 ? "Agent will treat this as an upstream x402 API." : "Agent-callable API tool node"}
      </div>
      {payload.executionNote ? <div className="node-output-preview">{payload.executionNote}</div> : null}
    </div>
  );
}
