import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { PipelineNodeData } from "../types/pipeline";

function statusSymbol(state?: PipelineNodeData["executionState"]) {
  if (state === "done") return "✓";
  if (state === "error") return "!";
  if (state === "running") return "●";
  return "○";
}

// AI Model configs
const MODEL_CONFIGS: Record<string, { icon: string; color: string; name: string }> = {
  gemini:  { icon: "✦", color: "#a78bfa", name: "Google Gemini" },
  openai:  { icon: "⬡", color: "#c4b5fd", name: "OpenAI GPT" },
  claude:  { icon: "◈", color: "#ddd6fe", name: "Anthropic Claude" },
  mistral: { icon: "▲", color: "#8b5cf6", name: "Mistral AI" },
};

// Tool/API service configs
const TOOL_CONFIGS: Record<string, { icon: string; color: string }> = {
  gmail:   { icon: "✉",  color: "#fb923c" },
  crypto:  { icon: "₿",  color: "#f59e0b" },
  weather: { icon: "◔", color: "#38bdf8" },
  search:  { icon: "⌕", color: "#a3e635" },
  chart:   { icon: "↗", color: "#34d399" },
  risk:    { icon: "!",  color: "#f87171" },
  custom:  { icon: "⋯",  color: "#94a3b8" },
};

export function ServiceNode({ id, data, type }: NodeProps) {
  const payload = data as unknown as PipelineNodeData;
  const isApi = type === "api";
  const executionState = payload.executionState ?? "idle";
  const kind = (payload.serviceKind ?? "custom").toLowerCase();

  // Determine if this is an AI Model node
  const modelCfg = MODEL_CONFIGS[kind];
  const isModel = Boolean(modelCfg);
  const toolCfg = TOOL_CONFIGS[kind] ?? TOOL_CONFIGS.custom;
  const cfg = isModel ? { icon: modelCfg.icon, color: modelCfg.color } : toolCfg;

  const endpointLabel =
    kind === "gmail"
      ? payload.gmailTo ?? "From prompt"
      : kind === "crypto" || kind === "chart" || kind === "risk"
        ? payload.cryptoSymbols ?? "Unset"
        : payload.serviceUrl?.replace(/^https?:\/\//, "") ?? "Unset";

  const endpointTitle =
    kind === "gmail" ? "To"
    : kind === "crypto" || kind === "chart" || kind === "risk" ? "Symbols"
    : "Endpoint";

  const helperText = payload.upstreamX402
    ? "Agent will treat this as an upstream x402 API."
    : kind === "gmail" ? "Agent-generated email tool. Recipient can come from the prompt."
    : kind === "crypto" ? "Agent-callable crypto pricing tool"
    : kind === "chart" ? "Agent-callable chart interpretation tool"
    : kind === "risk" ? "Agent-callable risk sizing tool"
    : "Agent-callable API tool node";

  // ── AI MODEL NODE ──────────────────────────────────────────────
  if (isModel) {
    return (
      <div
        className={`node-shell node-service node-service-model node-state-${executionState}`}
        style={{ borderTopColor: cfg.color, borderLeftColor: cfg.color }}
      >
        <Handle
          className="node-handle node-handle-model-out"
          id="model-out"
          position={Position.Top}
          type="source"
        />

        <div className="node-header-row">
          <div className="node-badge" style={{ background: `${cfg.color}22`, color: cfg.color }}>
            AI Model
          </div>
          <div className="node-chip-row">
            <span className="node-chip">{kind}</span>
            <span className={`node-status node-status-${executionState}`}>
              {statusSymbol(executionState)}
            </span>
          </div>
        </div>

        <div className="service-icon-row">
          <span className="service-icon" style={{ color: cfg.color }}>{cfg.icon}</span>
          <h3>{payload.label ?? modelCfg.name}</h3>
        </div>

        <p style={{ marginBottom: 10 }}>
          {payload.description ?? `${modelCfg.name} LLM. Connect it to an agent's model port.`}
        </p>

        {/* API Key field — the only config needed */}
        <div className="model-apikey-field">
          <span className="model-apikey-label">API Key</span>
          <input
            className="prop-input model-apikey-input"
            onChange={(e) => payload.onApiKeyChange?.(id, e.target.value)}
            placeholder={`Enter your ${modelCfg.name} API key…`}
            type="password"
            value={payload.apiKey ?? ""}
          />
        </div>

        <div className="node-model-hint">
          Connect the top dot to an agent's bottom-left AI Model port.
        </div>

        {payload.executionOutput || payload.executionMessage || payload.executionNote
          ? <div className="node-output-preview">{payload.executionOutput ?? payload.executionMessage ?? payload.executionNote}</div>
          : null}
      </div>
    );
  }

  // ── TOOL / API NODE ────────────────────────────────────────────
  return (
    <div
      className={`node-shell node-service node-state-${executionState}`}
      style={{ borderTopColor: cfg.color }}
    >
      <Handle
        className="node-handle node-handle-agent-attach"
        id="tool-out"
        position={Position.Top}
        type="source"
      />
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

      <div className="node-header-row">
        <div className="node-badge" style={{ background: `${cfg.color}22`, color: cfg.color }}>
          {isApi ? "API" : "Service"}
        </div>
        <div className="node-chip-row">
          <span className="node-chip">{kind}</span>
          <span className={`node-status node-status-${executionState}`}>
            {statusSymbol(executionState)}
          </span>
        </div>
      </div>

      <div className="service-icon-row">
        <span className="service-icon" style={{ color: cfg.color }}>{cfg.icon}</span>
        <h3>{payload.label}</h3>
      </div>

      <p>{payload.description}</p>

      <dl className="node-metrics">
        <div>
          <dt>{endpointTitle}</dt>
          <dd>{endpointLabel}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{payload.upstreamX402 ? "Upstream x402" : `${(payload.priceAlgo ?? 0).toFixed(3)} ALGO`}</dd>
        </div>
      </dl>

      <div className="node-connection-banner node-connection-banner-tool">
        <span>Top dot</span>
        <strong>Connect this to an agent's bottom-right Tools port</strong>
      </div>
      <div className="node-inline muted-inline">{helperText}</div>
      {payload.executionOutput || payload.executionMessage || payload.executionNote
        ? <div className="node-output-preview">{payload.executionOutput ?? payload.executionMessage ?? payload.executionNote}</div>
        : null}
      <div className="node-handle-labels">
        <span>AI Link</span>
        <span>Workflow</span>
      </div>
    </div>
  );
}
