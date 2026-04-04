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
  selected,
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
      <BaseEdge
        id={id}
        interactionWidth={28}
        path={path}
        style={{
          stroke: style.color,
          strokeWidth: selected ? 4.5 : 3,
          filter: selected ? `drop-shadow(0 0 8px ${style.color})` : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={selected ? "wire-label wire-label-selected" : "wire-label"}
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
