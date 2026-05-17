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

export function EndNode({ data }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const executionState = payload.executionState ?? "idle";

  return (
    <div className={`node-shell node-end node-state-${executionState}`}>
      <Handle className="node-handle node-handle-target" position={Position.Left} type="target" />
      <div className="node-header-row">
        <div className="node-badge">End</div>
        <span className={`node-status node-status-${executionState}`}>
          {statusSymbol(executionState)}
        </span>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <div className="node-inline">Returns the final HTTP response.</div>
      {payload.executionOutput || payload.executionMessage || payload.executionNote ? (
        <div className="node-output-preview">{payload.executionOutput ?? payload.executionMessage ?? payload.executionNote}</div>
      ) : null}
    </div>
  );
}
