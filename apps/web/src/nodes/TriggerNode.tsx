import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

// Trigger type configuration — n8n style
const TRIGGER_TYPES: Record<string, { icon: string; label: string; description: string }> = {
  webhook: {
    icon: "◉",
    label: "Webhook",
    description: "Triggered by an incoming HTTP request",
  },
  manual: {
    icon: "▷",
    label: "Manual",
    description: "Triggered manually from the studio",
  },
  schedule: {
    icon: "◷",
    label: "Schedule",
    description: "Triggered on a cron schedule",
  },
  chat: {
    icon: "◌",
    label: "Chat Message",
    description: "Triggered by an incoming chat message",
  },
};

function statusSymbol(state?: PipelineNodeData["executionState"]) {
  if (state === "done") return "✓";
  if (state === "error") return "!";
  if (state === "running") return "●";
  return "○";
}

export function TriggerNode({ data, id }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const executionState = payload.executionState ?? "idle";

  // Determine trigger type from requestMethod or default to webhook
  const triggerType = payload.triggerKind ?? "webhook";
  const config = TRIGGER_TYPES[triggerType] ?? TRIGGER_TYPES.webhook;

  return (
    <div className={`node-shell node-trigger node-state-${executionState}`}>
      <Handle className="node-handle node-handle-source" position={Position.Right} type="source" />

      <div className="node-header-row">
        <div className="node-badge">Trigger</div>
        <div className="node-chip-row">
          <span className="node-chip">{payload.requestMethod ?? "POST"}</span>
          <span className={`node-status node-status-${executionState}`}>
            {statusSymbol(executionState)}
          </span>
        </div>
      </div>

      <h3>{payload.label}</h3>
      <p>{payload.description}</p>

      {/* n8n-style trigger type selector */}
      <div className="trigger-type-grid">
        {Object.entries(TRIGGER_TYPES).map(([key, cfg]) => (
          <div
            key={key}
            className={`trigger-type-pill${triggerType === key ? " trigger-type-active" : ""}`}
            title={cfg.description}
          >
            <span>{cfg.icon}</span>
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      <div className="node-inline" style={{ marginTop: 8 }}>
        {config.icon} {config.description}
      </div>

      <textarea
        className="node-request-input"
        onChange={(event) => payload.onTriggerTestChange?.(id, event.target.value)}
        placeholder={'{"prompt":"Email me the latest ALGO price at founder@example.com"}'}
        value={payload.testRequestBody ?? ""}
      />
      {payload.executionOutput || payload.executionMessage || payload.executionNote ? (
        <div className="node-output-preview">{payload.executionOutput ?? payload.executionMessage ?? payload.executionNote}</div>
      ) : null}
    </div>
  );
}
