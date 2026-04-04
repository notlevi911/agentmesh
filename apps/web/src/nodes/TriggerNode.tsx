import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

export function TriggerNode({ data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-trigger">
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">Trigger</div>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <div className="node-inline">HTTP request / event / schedule</div>
    </div>
  );
}
