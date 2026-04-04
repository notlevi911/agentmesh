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

export function TriggerNode({ data, id }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;

  return (
    <div className="node-shell node-trigger">
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />
      <div className="node-header-row">
        <div className="node-badge">Trigger</div>
        <div className="node-chip-row">
          <span className="node-chip">{payload.requestMethod ?? "POST"}</span>
          <span className={`node-status node-status-${payload.executionState ?? "idle"}`}>
            {statusSymbol(payload.executionState)}
          </span>
        </div>
      </div>
      <h3>{payload.label}</h3>
      <p>{payload.description}</p>
      <div className="node-inline">HTTP request entry for the agent workflow</div>
      <textarea
        className="node-request-input"
        onChange={(event) => payload.onTriggerTestChange?.(id, event.target.value)}
        placeholder='{"prompt":"What is the weather of Africa?"}'
        value={payload.testRequestBody ?? ""}
      />
      {payload.executionNote ? <div className="node-output-preview">{payload.executionNote}</div> : null}
    </div>
  );
}
