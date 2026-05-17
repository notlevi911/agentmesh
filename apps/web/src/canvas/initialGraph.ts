import type { BuilderEdge, BuilderNode, NodeKind, PipelineNodeData, WireKind } from "../types/pipeline";

export interface WorkflowTemplate {
  id: string;
  name: string;
  runtimeQuery: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

const nodeTemplates: Record<NodeKind, PipelineNodeData> = {
  trigger: {
    kind: "trigger",
    label: "HTTP Trigger",
    description: "Incoming HTTP request kicks off the workflow.",
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

function assistantBasicsTemplate(): WorkflowTemplate {
  const nodes: BuilderNode[] = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 70, y: 250 },
      data: {
        ...getDefaultNodeData("trigger"),
        label: "Manual Trigger",
        description: "Incoming HTTP request kicks off the workflow.",
        testRequestBody: '{ "token": "what do u mean by a water bottle" }',
      },
    },
    {
      id: "agent-main",
      type: "agent",
      position: { x: 470, y: 170 },
      data: {
        ...getDefaultNodeData("agent"),
        label: "AI Agent",
        role: "operator",
        description: "Autonomous AI node with a live Algorand wallet.",
        systemPrompt: "Choose the best available tool, then summarize the result for the next node.",
      },
    },
    {
      id: "tool-gmail",
      type: "api",
      position: { x: 940, y: 250 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Gmail",
        description: "Compose and optionally send an email from the workflow.",
        serviceKind: "gmail",
        gmailTo: "",
        priceAlgo: 0.02,
      },
    },
    {
      id: "end-1",
      type: "end",
      position: { x: 1280, y: 250 },
      data: {
        ...getDefaultNodeData("end"),
        label: "HTTP Response",
        description: "Returns the final HTTP response.",
      },
    },
    {
      id: "tool-gemini",
      type: "service",
      position: { x: 360, y: 560 },
      data: {
        ...getDefaultNodeData("service"),
        label: "Gemini",
        description: "Gemini LLM — connect to the Agent's AI Model handle.",
        serviceKind: "gemini",
        apiKey: "",
      },
    },
    {
      id: "tool-search",
      type: "api",
      position: { x: 650, y: 630 },
      data: {
        ...getDefaultNodeData("api"),
        label: "DuckDuckGo Search",
        description: "Free instant-answer/search-style lookup via DuckDuckGo.",
        serviceKind: "search",
        serviceUrl: "https://api.duckduckgo.com/",
      },
    },
    {
      id: "tool-weather",
      type: "api",
      position: { x: 930, y: 590 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Open-Meteo Weather",
        description: "Free live weather lookup via Open-Meteo.",
        serviceKind: "weather",
        serviceUrl: "https://api.open-meteo.com/v1/forecast",
      },
    },
  ];

  const edges: BuilderEdge[] = [
    createWire("edge-trigger-agent", "trigger-1", "agent-main", "a2a", "Start"),
    createWire("edge-agent-gmail", "agent-main", "tool-gmail", "a2a", "Next workflow step"),
    createWire("edge-gmail-end", "tool-gmail", "end-1", "a2a", "Final response"),
    createWire("edge-gemini-agent", "tool-gemini", "agent-main", "connection", "Model connection", "model-out", "model"),
    createWire("edge-search-agent", "tool-search", "agent-main", "connection", "Agent tool access", "tool-out", "tools"),
    createWire("edge-weather-agent", "tool-weather", "agent-main", "connection", "Agent tool access", "tool-out", "tools"),
  ];

  return {
    id: "assistant-basics",
    name: "Assistant Basics",
    runtimeQuery: '{ "token": "what do u mean by a water bottle" }',
    nodes,
    edges,
  };
}

function weatherConciergeTemplate(): WorkflowTemplate {
  const nodes: BuilderNode[] = [
    {
      id: "trigger-weather",
      type: "trigger",
      position: { x: 90, y: 260 },
      data: {
        ...getDefaultNodeData("trigger"),
        label: "Manual Trigger",
        description: "Incoming weather request.",
        testRequestBody: '{ "prompt": "weather in kolkata" }',
      },
    },
    {
      id: "agent-weather",
      type: "agent",
      position: { x: 470, y: 190 },
      data: {
        ...getDefaultNodeData("agent"),
        label: "Weather Concierge",
        role: "operator",
        description: "Answers location weather questions clearly and concisely.",
        systemPrompt: "Answer weather questions clearly. Use the connected weather tool when needed and return a concise response.",
      },
    },
    {
      id: "end-weather",
      type: "end",
      position: { x: 930, y: 260 },
      data: {
        ...getDefaultNodeData("end"),
        label: "HTTP Response",
        description: "Returns the weather response.",
      },
    },
    {
      id: "gemini-weather",
      type: "service",
      position: { x: 310, y: 560 },
      data: {
        ...getDefaultNodeData("service"),
        label: "Gemini",
        description: "Gemini LLM — connect to the Agent's AI Model handle.",
        serviceKind: "gemini",
        apiKey: "",
      },
    },
    {
      id: "tool-weather-city",
      type: "api",
      position: { x: 680, y: 560 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Open-Meteo Weather",
        description: "Free live weather lookup via Open-Meteo.",
        serviceKind: "weather",
        serviceUrl: "https://api.open-meteo.com/v1/forecast",
      },
    },
  ];

  const edges: BuilderEdge[] = [
    createWire("edge-trigger-weather-agent", "trigger-weather", "agent-weather", "a2a", "Start"),
    createWire("edge-weather-agent-end", "agent-weather", "end-weather", "a2a", "Answer"),
    createWire("edge-weather-gemini", "gemini-weather", "agent-weather", "connection", "Model connection", "model-out", "model"),
    createWire("edge-weather-tool", "tool-weather-city", "agent-weather", "connection", "Agent tool access", "tool-out", "tools"),
  ];

  return {
    id: "weather-concierge",
    name: "Weather Concierge",
    runtimeQuery: '{ "prompt": "weather in kolkata" }',
    nodes,
    edges,
  };
}

function researchMailerTemplate(): WorkflowTemplate {
  const nodes: BuilderNode[] = [
    {
      id: "trigger-research",
      type: "trigger",
      position: { x: 80, y: 260 },
      data: {
        ...getDefaultNodeData("trigger"),
        label: "Manual Trigger",
        description: "Incoming research request.",
        testRequestBody: '{ "prompt": "Find a quick explanation of zero-knowledge proofs and prepare an email summary for demo@agentmesh.dev" }',
      },
    },
    {
      id: "agent-research",
      type: "agent",
      position: { x: 450, y: 180 },
      data: {
        ...getDefaultNodeData("agent"),
        label: "Research Agent",
        role: "operator",
        description: "Looks up information and prepares a concise summary.",
        systemPrompt: "Research the request using the connected search tool when useful, then prepare a clean summary for the next workflow step.",
      },
    },
    {
      id: "gmail-research",
      type: "api",
      position: { x: 900, y: 250 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Gmail",
        description: "Draft or send the summary by email.",
        serviceKind: "gmail",
        gmailTo: "",
        priceAlgo: 0.02,
      },
    },
    {
      id: "end-research",
      type: "end",
      position: { x: 1250, y: 250 },
      data: {
        ...getDefaultNodeData("end"),
        label: "HTTP Response",
        description: "Returns the final summary response.",
      },
    },
    {
      id: "gemini-research",
      type: "service",
      position: { x: 320, y: 560 },
      data: {
        ...getDefaultNodeData("service"),
        label: "Gemini",
        description: "Gemini LLM — connect to the Agent's AI Model handle.",
        serviceKind: "gemini",
        apiKey: "",
      },
    },
    {
      id: "search-research",
      type: "api",
      position: { x: 670, y: 600 },
      data: {
        ...getDefaultNodeData("api"),
        label: "DuckDuckGo Search",
        description: "Free instant-answer/search-style lookup via DuckDuckGo.",
        serviceKind: "search",
        serviceUrl: "https://api.duckduckgo.com/",
      },
    },
  ];

  const edges: BuilderEdge[] = [
    createWire("edge-research-trigger-agent", "trigger-research", "agent-research", "a2a", "Start"),
    createWire("edge-research-agent-gmail", "agent-research", "gmail-research", "a2a", "Prepare email"),
    createWire("edge-research-gmail-end", "gmail-research", "end-research", "a2a", "Final response"),
    createWire("edge-research-model", "gemini-research", "agent-research", "connection", "Model connection", "model-out", "model"),
    createWire("edge-research-search", "search-research", "agent-research", "connection", "Agent tool access", "tool-out", "tools"),
  ];

  return {
    id: "research-mailer",
    name: "Research Mailer",
    runtimeQuery: '{ "prompt": "Find a quick explanation of zero-knowledge proofs and prepare an email summary for demo@agentmesh.dev" }',
    nodes,
    edges,
  };
}

function tradeSignalDeskTemplate(): WorkflowTemplate {
  const nodes: BuilderNode[] = [
    {
      id: "trigger-trade",
      type: "trigger",
      position: { x: 60, y: 260 },
      data: {
        ...getDefaultNodeData("trigger"),
        label: "Manual Trigger",
        description: "Incoming token analysis request.",
        testRequestBody: '{ "token": "ALGO" }',
      },
    },
    {
      id: "agent-trade",
      type: "agent",
      position: { x: 430, y: 170 },
      data: {
        ...getDefaultNodeData("agent"),
        label: "Lead Signal Agent",
        role: "lead_analyst",
        description: "Chooses the right market tools and returns a trade-ready view.",
        systemPrompt:
          "You are the lead analyst for a crypto trade desk. Use the connected tools to assess the token and return a concise BUY, SELL, or HOLD view with confidence and brief reasoning.",
        priceAlgo: 0.05,
      },
    },
    {
      id: "gmail-trade",
      type: "api",
      position: { x: 960, y: 250 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Gmail",
        description: "Draft or send the final trade note.",
        serviceKind: "gmail",
        gmailTo: "",
        priceAlgo: 0.02,
      },
    },
    {
      id: "end-trade",
      type: "end",
      position: { x: 1310, y: 250 },
      data: {
        ...getDefaultNodeData("end"),
        label: "HTTP Response",
        description: "Returns the final market response.",
      },
    },
    {
      id: "gemini-trade",
      type: "service",
      position: { x: 320, y: 560 },
      data: {
        ...getDefaultNodeData("service"),
        label: "Gemini",
        description: "Gemini LLM — connect to the Agent's AI Model handle.",
        serviceKind: "gemini",
        apiKey: "",
      },
    },
    {
      id: "crypto-trade",
      type: "api",
      position: { x: 640, y: 610 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Crypto Prices",
        description: "Live crypto price lookup via CoinGecko.",
        serviceKind: "crypto",
        serviceUrl: "https://api.coingecko.com/api/v3/simple/price",
        cryptoSymbols: "BTC,ETH,ALGO,SOL",
        priceAlgo: 0.01,
      },
    },
    {
      id: "chart-trade",
      type: "api",
      position: { x: 880, y: 600 },
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
      id: "risk-trade",
      type: "api",
      position: { x: 1120, y: 610 },
      data: {
        ...getDefaultNodeData("api"),
        label: "Risk Model",
        description: "Estimates volatility, risk level, and position sizing.",
        serviceKind: "risk",
        cryptoSymbols: "BTC,ETH,ALGO,SOL",
        priceAlgo: 0.01,
      },
    },
  ];

  const edges: BuilderEdge[] = [
    createWire("edge-trade-trigger-agent", "trigger-trade", "agent-trade", "a2a", "Start"),
    createWire("edge-trade-agent-gmail", "agent-trade", "gmail-trade", "a2a", "Prepare trade email"),
    createWire("edge-trade-gmail-end", "gmail-trade", "end-trade", "a2a", "Final response"),
    createWire("edge-trade-model", "gemini-trade", "agent-trade", "connection", "Model connection", "model-out", "model"),
    createWire("edge-trade-crypto", "crypto-trade", "agent-trade", "connection", "Agent tool access", "tool-out", "tools"),
    createWire("edge-trade-chart", "chart-trade", "agent-trade", "connection", "Agent tool access", "tool-out", "tools"),
    createWire("edge-trade-risk", "risk-trade", "agent-trade", "connection", "Agent tool access", "tool-out", "tools"),
  ];

  return {
    id: "trade-signal-desk",
    name: "Trade Signal Desk",
    runtimeQuery: '{ "token": "ALGO" }',
    nodes,
    edges,
  };
}

export const workflowTemplates: WorkflowTemplate[] = [
  assistantBasicsTemplate(),
  weatherConciergeTemplate(),
  researchMailerTemplate(),
  tradeSignalDeskTemplate(),
];

export const defaultWorkflowTemplate = workflowTemplates[0];
export const initialNodes: BuilderNode[] = defaultWorkflowTemplate.nodes;
export const initialEdges: BuilderEdge[] = defaultWorkflowTemplate.edges;
