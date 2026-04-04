import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import type { PipelineEdgeData } from "../types/pipeline";

const wireStyles = {
  a2a: {
    color: "#8b5cf6",
    label: "A2A",
  },
  x402: {
    color: "#10b981",
    label: "x402",
  },
  algo_transfer: {
    color: "#2563eb",
    label: "ALGO",
  },
} as const;

export function WireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const edgeData = (data ?? {}) as unknown as PipelineEdgeData;
  const style = wireStyles[edgeData.wireType ?? "a2a"];
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: style.color, strokeWidth: 3 }} />
      <EdgeLabelRenderer>
        <div
          className="wire-label"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: style.color,
          }}
        >
          <strong>{style.label}</strong>
          {edgeData.label ? <span>{edgeData.label}</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
