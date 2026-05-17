import type { BuilderEdge, BuilderNode, NodeKind, PipelineNodeData, WireKind } from "../types/pipeline";

const nodeTemplates: Record<NodeKind, PipelineNodeData> = {
  trigger: {
    kind: "trigger",
    label: "HTTP Trigger",
    description: "Incoming HTTP request kicks off the trade-signal workflow.",
    requestMethod: "POST",
    testRequestBody: '{ "token": "ALGO" }',
    status: "draft",
  },
  agent: {
    kind: "agent",
    label: "New Agent",
    role: "operator",
    description: "Autonomous AI node with a live Algorand wallet.",
    systemPrompt: "Choose the best available tool, then summarize the result for the next node.",
    enabledTools: [],
    priceAlgo: 0,
    status: "draft",
  },
  api: {
    kind: "api",
    label: "API",
    description: "External HTTP API that an agent can call.",
    serviceUrl: "",
    serviceKind: "custom",
    upstreamX402: false,
    status: "draft",
  },
  service: {
    kind: "service",
    label: "New Service",
    description: "x402-gated external API.",
    serviceUrl: "",
    serviceKind: "custom",
    upstreamX402: false,
    status: "draft",
  },
  end: {
    kind: "end",
    label: "End",
    description: "Returns the final response to the caller.",
    status: "draft",
  },
};

export function getDefaultNodeData(kind: NodeKind): PipelineNodeData {
  return { ...nodeTemplates[kind] };
}

export const initialNodes: BuilderNode[] = [
  {
    id: "trigger-1",
    type: "trigger",
    position: { x: 40, y: 250 },
    data: getDefaultNodeData("trigger"),
  },
  {
    id: "agent-lead",
    type: "agent",
    position: { x: 330, y: 220 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Lead Signal Agent",
      role: "lead_analyst",
      description: "Coordinates the desk, gathers specialist inputs, and returns the final trade call.",
      systemPrompt:
        "You are the lead analyst for a crypto trade desk. When given a token like ALGO, gather specialist inputs from the connected agents, use your connected market data tool, and return only a JSON object with keys: signal, confidence, position_size, stop_loss, take_profit, thesis.",
      enabledTools: [],
      priceAlgo: 0.05,
    },
  },
  {
    id: "agent-tech",
    type: "agent",
    position: { x: 760, y: 60 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Technical Analyst",
      role: "technical_analyst",
      description: "Reads short-term price structure and momentum.",
      systemPrompt:
        "You are a technical analyst. Use your chart tool to determine whether the token is bullish, bearish, or neutral. Return a concise technical view with confidence.",
      enabledTools: [],
      priceAlgo: 0,
    },
  },
  {
    id: "agent-risk",
    type: "agent",
    position: { x: 760, y: 430 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Risk Analyst",
      role: "risk_manager",
      description: "Checks volatility, risk, and sizing constraints.",
      systemPrompt:
        "You are a risk analyst. Use your risk tool to recommend position size, stop loss, and take profit. Keep the output concise and risk-aware.",
      enabledTools: [],
      priceAlgo: 0,
    },
  },
  {
    id: "agent-report",
    type: "agent",
    position: { x: 1110, y: 250 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Report Writer Agent",
      role: "report_writer",
      description: "Turns specialist outputs into a polished final note before Gmail sends it.",
      systemPrompt:
        "You are the report writer for the trade desk. Take the specialist outputs and create a polished final trade note with BUY / SELL / HOLD, confidence, position size, stop loss, take profit, and thesis. If Gmail is available, use it to send the note.",
      enabledTools: [],
      priceAlgo: 0,
    },
  },
  {
    id: "tool-crypto",
    type: "api",
    position: { x: 710, y: 250 },
    data: {
      ...getDefaultNodeData("api"),
      label: "Crypto Prices",
      description: "Live crypto price lookup via CoinGecko.",
      serviceUrl: "https://api.coingecko.com/api/v3/simple/price",
      serviceKind: "crypto",
      cryptoSymbols: "BTC,ETH,ALGO,SOL",
      priceAlgo: 0.01,
    },
  },
  {
    id: "tool-gmail",
    type: "api",
    position: { x: 1460, y: 250 },
    data: {
      ...getDefaultNodeData("api"),
      label: "Gmail",
      description: "Sends the final trade note by email.",
      serviceKind: "gmail",
      gmailTo: "",
      priceAlgo: 0.02,
    },
  },
  {
    id: "tool-chart",
    type: "api",
    position: { x: 1140, y: 60 },
    data: {
      ...getDefaultNodeData("api"),
      label: "Chart Signal",
      description: "Computes a simple technical read from recent market data.",
      serviceKind: "chart",
      cryptoSymbols: "BTC,ETH,ALGO,SOL",
      priceAlgo: 0.01,
    },
  },
  {
    id: "tool-risk",
    type: "api",
    position: { x: 1140, y: 430 },
    data: {
      ...getDefaultNodeData("api"),
      label: "Risk Model",
      description: "Estimates volatility, risk level, and position sizing.",
      serviceKind: "risk",
      cryptoSymbols: "BTC,ETH,ALGO,SOL",
      priceAlgo: 0.01,
    },
  },
  {
    id: "tool-gemini",
    type: "service",
    position: { x: 330, y: 550 },
    data: {
      ...getDefaultNodeData("service"),
      label: "Gemini",
      description: "Gemini LLM — connect to the Agent's AI Model handle.",
      serviceKind: "gemini",
      apiKey: "",
      priceAlgo: 0,
    },
  },
  {
    id: "end-1",
    type: "end",
    position: { x: 1760, y: 250 },
    data: {
      ...getDefaultNodeData("end"),
      label: "HTTP Response",
      description: "Returns BUY / SELL / HOLD with trade parameters.",
    },
  },
];

export const initialEdges: BuilderEdge[] = [
  createWire("edge-trigger-lead", "trigger-1", "agent-lead", "a2a", "Start"),
  createWire("edge-lead-tech", "agent-lead", "agent-tech", "a2a", "Request technical view"),
  createWire("edge-lead-risk", "agent-lead", "agent-risk", "a2a", "Request risk view"),
  createWire("edge-lead-report", "agent-lead", "agent-report", "a2a", "Draft final report"),
  createWire(
    "edge-lead-crypto",
    "tool-crypto",
    "agent-lead",
    "connection",
    "Agent tool access",
    "tool-out",
    "tools",
  ),
  createWire(
    "edge-report-gmail",
    "tool-gmail",
    "agent-report",
    "connection",
    "Agent tool access",
    "tool-out",
    "tools",
  ),
  createWire(
    "edge-tech-chart",
    "tool-chart",
    "agent-tech",
    "connection",
    "Agent tool access",
    "tool-out",
    "tools",
  ),
  createWire(
    "edge-risk-model",
    "tool-risk",
    "agent-risk",
    "connection",
    "Agent tool access",
    "tool-out",
    "tools",
  ),
  createWire("edge-report-end", "agent-report", "end-1", "a2a", "Final signal"),
  createWire(
    "edge-model-lead",
    "tool-gemini",
    "agent-lead",
    "connection",
    "Model connection",
    "model-out",
    "model",
  ),
];

export function createWire(
  id: string,
  source: string,
  target: string,
  wireType: WireKind,
  label?: string,
  sourceHandle?: string,
  targetHandle?: string,
): BuilderEdge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: "wire",
    data: {
      wireType,
      label,
    },
  };
}
