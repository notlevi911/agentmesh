import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

export function EndNode({ data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-end">
      <Handle className="node-handle node-handle-target" position={Position.Left} type="target" />
      <div className="node-header-row">
        <div className="node-badge">End</div>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <div className="node-inline">Returns the final HTTP response.</div>
    </div>
  );
}
