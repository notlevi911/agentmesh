import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

export function ServiceNode({ data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-service">
      <Handle position={Position.Left} type="target" />
      <Handle position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">Service</div>
        <span className="node-chip">{payload.serviceKind ?? "custom"}</span>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <dl className="node-metrics">
        <div>
          <dt>URL</dt>
          <dd>{payload.serviceUrl?.replace(/^https?:\/\//, "") ?? "Unset"}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{(payload.priceAlgo ?? 0).toFixed(3)} ALGO</dd>
        </div>
      </dl>
      <div className="node-inline muted-inline">Agent-callable tool node</div>
    </div>
  );
}
