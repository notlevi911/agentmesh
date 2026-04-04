import type {
  BuilderEdge,
  BuilderNode,
  NodeKind,
  PipelineNodeData,
  WireKind,
} from "../types/pipeline";

const nodeTemplates: Record<NodeKind, PipelineNodeData> = {
  trigger: {
    kind: "trigger",
    label: "HTTP Trigger",
    description: "Incoming HTTP request kicks off the workflow.",
    requestMethod: "POST",
    testRequestBody: '{ "prompt": "What is the weather of Africa?" }',
    status: "draft",
  },
  agent: {
    kind: "agent",
    label: "New Agent",
    role: "operator",
    description: "Autonomous AI node with a live Algorand wallet.",
    systemPrompt: "Choose the best available tool, then summarize the result for the next node.",
    enabledTools: ["weather", "search", "custom"],
    priceAlgo: 0,
    status: "draft",
  },
  api: {
    kind: "api",
    label: "API",
    description: "External HTTP API that an agent can call.",
    serviceUrl: "https://api.duckduckgo.com/",
    serviceKind: "search",
    upstreamX402: false,
    status: "draft",
  },
  service: {
    kind: "service",
    label: "New Service",
    description: "x402-gated external API.",
    serviceUrl: "https://api.duckduckgo.com/",
    serviceKind: "search",
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
    position: { x: 40, y: 200 },
    data: getDefaultNodeData("trigger"),
  },
  {
    id: "agent-analyzer",
    type: "agent",
    position: { x: 320, y: 120 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Routing Agent",
      role: "analyzer",
      description: "Chooses the right connected API tool for the incoming prompt.",
      systemPrompt:
        "You are an autonomous routing agent. Read the incoming HTTP request prompt. If it asks about weather, use the connected weather API. If it asks for facts, topics, or web-style lookup, use the connected search API. Return concise context for the next node.",
      enabledTools: ["weather", "search", "custom"],
      priceAlgo: 0.01,
    },
  },
  {
    id: "service-weather",
    type: "api",
    position: { x: 650, y: 70 },
    data: {
      ...getDefaultNodeData("api"),
      label: "Open-Meteo Weather",
      description: "Free live weather lookup via Open-Meteo.",
      serviceUrl: "https://api.open-meteo.com/v1/forecast",
      serviceKind: "weather",
      priceAlgo: 0.01,
    },
  },
  {
    id: "service-search",
    type: "api",
    position: { x: 660, y: 250 },
    data: {
      ...getDefaultNodeData("api"),
      label: "DuckDuckGo Search",
      description: "Free instant-answer/search-style lookup via DuckDuckGo.",
      serviceUrl: "https://api.duckduckgo.com/",
      serviceKind: "search",
      priceAlgo: 0.01,
    },
  },
  {
    id: "agent-responder",
    type: "agent",
    position: { x: 960, y: 170 },
    data: {
      ...getDefaultNodeData("agent"),
      label: "Response Agent",
      role: "responder",
      description: "Formats the final HTTP response for the caller.",
      systemPrompt: "Take the upstream tool result and produce a crisp HTTP response body.",
      enabledTools: [],
      priceAlgo: 0,
    },
  },
  {
    id: "end-1",
    type: "end",
    position: { x: 1240, y: 200 },
    data: {
      ...getDefaultNodeData("end"),
      label: "HTTP Response",
      description: "Shows and returns the final API output to the caller.",
    },
  },
];

export const initialEdges: BuilderEdge[] = [
  createWire("edge-trigger-analyzer", "trigger-1", "agent-analyzer", "a2a", "Start"),
  createWire(
    "edge-analyzer-weather",
    "agent-analyzer",
    "service-weather",
    "x402",
    "Weather tool",
  ),
  createWire(
    "edge-analyzer-search",
    "agent-analyzer",
    "service-search",
    "x402",
    "Search tool",
  ),
  createWire(
    "edge-analyzer-responder",
    "agent-analyzer",
    "agent-responder",
    "a2a",
    "Analysis context",
  ),
  createWire("edge-responder-end", "agent-responder", "end-1", "a2a", "Final output"),
];

export function createWire(
  id: string,
  source: string,
  target: string,
  wireType: WireKind,
  label?: string,
): BuilderEdge {
  return {
    id,
    source,
    target,
    type: "wire",
    data: {
      wireType,
      label,
    },
  };
}
