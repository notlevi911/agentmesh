import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  type EdgeMouseHandler,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  deployPipeline,
  getBalances,
  getFundIntent,
  getPipelineDetail,
  listPipelines,
  preflightPipelinePayment,
  runPipeline,
} from "./api/client";
import {
  createWire,
  defaultWorkflowTemplate,
  getDefaultNodeData,
  initialEdges,
  initialNodes,
  workflowTemplates,
  type WorkflowTemplate,
} from "./canvas/initialGraph";
import { NodePalette } from "./components/NodePalette";
import { WireEdge } from "./edges/WireEdge";
import { AgentNode } from "./nodes/AgentNode";
import { EndNode } from "./nodes/EndNode";
import { ServiceNode } from "./nodes/ServiceNode";
import { TriggerNode } from "./nodes/TriggerNode";
import { FundingModal } from "./panels/FundingModal";
import { InspectorPanel } from "./panels/InspectorPanel";
import { RunLogPanel } from "./panels/RunLogPanel";
import "./styles/app.css";
import type {
  BuilderEdge,
  BuilderNode,
  DeployRequest,
  DeployResponse,
  FundIntentResponse,
  LogEntry,
  NodeKind,
  PipelineSummary,
  PipelineNodeData,
  WireKind,
} from "./types/pipeline";

const WORKFLOW_STORAGE_KEY = "agentmesh.workflow.v8";

interface StoredWorkflowDraft {
  pipelineName: string;
  activeWireType: WireKind;
  runtimeQuery?: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

type AppMode = "landing" | "studio";
type LeftPanel = "palette" | "flows";

const nodeTypes = {
  agent: AgentNode,
  api: ServiceNode,
  service: ServiceNode,
  trigger: TriggerNode,
  end: EndNode,
};

const edgeTypes = {
  wire: WireEdge,
};

const MODEL_SERVICE_KINDS = new Set(["gemini", "openai", "claude", "mistral"]);

function isModelServiceNode(node?: BuilderNode | null) {
  return Boolean(node && MODEL_SERVICE_KINDS.has(String(node.data.serviceKind ?? "").toLowerCase()));
}

function isToolNode(node?: BuilderNode | null) {
  return Boolean(node && (node.type === "service" || node.type === "api") && !isModelServiceNode(node));
}

function normalizeConnectionEdge(edge: BuilderEdge): BuilderEdge {
  const sourceHandle = edge.sourceHandle ?? undefined;
  const targetHandle = edge.targetHandle ?? undefined;
  const wireType = edge.data?.wireType;

  if (
    (wireType === "connection" || wireType === "x402") &&
    sourceHandle === "agent-tools" &&
    targetHandle === "agent-tool"
  ) {
    return {
      ...edge,
      source: edge.target,
      target: edge.source,
      sourceHandle: "tool-out",
      targetHandle: "tools",
    };
  }

  if (
    wireType === "x402" &&
    !sourceHandle &&
    targetHandle === "tools"
  ) {
    return {
      ...edge,
      source: edge.target,
      target: edge.source,
      sourceHandle: "tool-out",
      targetHandle: "tools",
      data: {
        ...(edge.data ?? {}),
        wireType: "connection",
        label: edge.data?.label ?? "Agent tool access",
      },
    };
  }

  return edge;
}

function normalizeConnectionEdges(edges: BuilderEdge[]): BuilderEdge[] {
  return edges.map(normalizeConnectionEdge);
}

function cloneTemplate(template: WorkflowTemplate) {
  return {
    nodes: JSON.parse(JSON.stringify(template.nodes)) as BuilderNode[],
    edges: JSON.parse(JSON.stringify(template.edges)) as BuilderEdge[],
  };
}

function validatePipelineConfiguration(nodes: BuilderNode[], edges: BuilderEdge[]): string | null {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const agentNodes = nodes.filter((node) => node.type === "agent");

  if (!agentNodes.length) {
    return "Add at least one AI Agent before deploying.";
  }

  for (const agent of agentNodes) {
    const modelEdges = edges.filter(
      (edge) =>
        edge.target === agent.id &&
        edge.targetHandle === "model" &&
        edge.data?.wireType === "connection",
    );

    if (!modelEdges.length) {
      return `Connect an AI model to "${agent.data.label}" before deploying.`;
    }

    if (modelEdges.length > 1) {
      return `"${agent.data.label}" has multiple AI model connections. Keep only one model per agent.`;
    }

    const modelNode = nodeMap.get(modelEdges[0].source);
    if (!isModelServiceNode(modelNode)) {
      return `"${agent.data.label}" must be connected to a valid AI model node.`;
    }

    const apiKey = String(modelNode?.data?.apiKey ?? "").trim();
    if (!apiKey) {
      const modelLabel = modelNode?.data?.label ?? "Connected model";
      return `Add an API key to "${modelLabel}" before deploying "${agent.data.label}".`;
    }
  }

  return null;
}

function resolveWireMeta(
  connection: Connection,
  nodes: BuilderNode[],
  activeWireType: WireKind,
): { wireType: WireKind; label: string } | null {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const sourceHandle = connection.sourceHandle ?? undefined;
  const targetHandle = connection.targetHandle ?? undefined;

  if (sourceHandle === "model-out" || targetHandle === "model") {
    if (isModelServiceNode(sourceNode) && targetNode.type === "agent" && targetHandle === "model") {
      return { wireType: "connection", label: "Model connection" };
    }
    return null;
  }

  if (sourceHandle === "tool-out" || targetHandle === "tools") {
    if (isToolNode(sourceNode) && targetNode.type === "agent" && targetHandle === "tools") {
      return { wireType: "connection", label: "Agent tool access" };
    }
    return null;
  }

  if (activeWireType === "connection") {
    return null;
  }

  const labelMap: Record<WireKind, string> = {
    a2a: "A2A message",
    x402: "Tool/payment call",
    algo_transfer: "ALGO transfer",
    connection: "Connection",
  };

  return {
    wireType: activeWireType,
    label: labelMap[activeWireType],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extractRuntimeQuery(raw: string | undefined, method?: string): string {
  const text = (raw ?? "").trim();
  if (!text) {
    return "ALGO";
  }

  if ((method ?? "POST") === "GET") {
    const params = new URLSearchParams(text.startsWith("?") ? text.slice(1) : text);
    return params.get("token") ?? params.get("prompt") ?? params.get("query") ?? params.get("q") ?? text;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["token", "prompt", "query", "message", "input"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return text;
  }

  return text;
}

function loadStoredWorkflow(): StoredWorkflowDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(WORKFLOW_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredWorkflowDraft;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }

    const nodeIds = new Set(parsed.nodes.map((node) => node.id));
    const hasLegacyMarketAnalyzerShape =
      parsed.pipelineName === "Market Analyzer" &&
      nodeIds.has("trigger-1") &&
      nodeIds.has("agent-analyzer") &&
      nodeIds.has("service-weather") &&
      nodeIds.has("service-search") &&
      !parsed.nodes.some(
        (node) =>
          node.id === "service-gmail" ||
          node.id === "service-crypto" ||
          node.data.serviceKind === "gmail" ||
          node.data.serviceKind === "crypto",
      );

    if (hasLegacyMarketAnalyzerShape) {
      return null;
    }

    return {
      ...parsed,
      edges: normalizeConnectionEdges(parsed.edges),
    };
  } catch {
    return null;
  }
}

function createNodeFromKind(kind: NodeKind, title?: string, index = 0): BuilderNode {
  const data = getDefaultNodeData(kind);
  const presetTitle = title ?? data.label;

  // AI Model nodes (Gemini, OpenAI, Claude, Mistral)
  const AI_MODEL_MAP: Record<string, NonNullable<PipelineNodeData["serviceKind"]>> = {
    gemini: "gemini",
    openai: "openai",
    claude: "claude",
    mistral: "mistral",
  };
  const titleLower = (title ?? "").toLowerCase();
  const matchedModel = Object.keys(AI_MODEL_MAP).find((m) => titleLower.includes(m));
  if ((kind === "service" || kind === "api") && matchedModel) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: "service",
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: title ?? matchedModel.charAt(0).toUpperCase() + matchedModel.slice(1),
        description: `${title ?? matchedModel} LLM — connect to the Agent's AI Model handle.`,
        serviceKind: AI_MODEL_MAP[matchedModel],
        priceAlgo: 0,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("weather")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "Open-Meteo Weather",
        description: "Free live weather lookup via Open-Meteo.",
        serviceKind: "weather",
        serviceUrl: "https://api.open-meteo.com/v1/forecast",
        priceAlgo: 0,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("search")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "DuckDuckGo Search",
        description: "Free instant-answer/search-style lookup via DuckDuckGo.",
        serviceKind: "search",
        serviceUrl: "https://api.duckduckgo.com/",
        priceAlgo: 0,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("gmail")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "Gmail",
        description: "Compose and optionally send an email from the agent workflow.",
        serviceKind: "gmail",
        gmailTo: "",
        priceAlgo: 0.02,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("crypto")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "Crypto Prices",
        description: "Live crypto price lookup via CoinGecko.",
        serviceKind: "crypto",
        serviceUrl: "https://api.coingecko.com/api/v3/simple/price",
        cryptoSymbols: "BTC,ETH,ALGO",
        priceAlgo: 0.01,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("chart")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "Chart Signal",
        description: "Technical bias from recent market data.",
        serviceKind: "chart",
        cryptoSymbols: "BTC,ETH,ALGO",
        priceAlgo: 0.01,
      },
    };
  }

  if ((kind === "service" || kind === "api") && title?.toLowerCase().includes("risk")) {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: "Risk Model",
        description: "Volatility-aware trade sizing and risk assessment.",
        serviceKind: "risk",
        cryptoSymbols: "BTC,ETH,ALGO",
        priceAlgo: 0.01,
      },
    };
  }

  if (kind === "api") {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: presetTitle,
        description: "Generic HTTP API block. Agents can route requests here.",
        serviceKind: "custom",
        serviceUrl: "https://example.com/api?q={{query}}",
        priceAlgo: 0,
      },
    };
  }

  if (kind === "agent") {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: presetTitle,
        enabledTools: [],
      },
    };
  }

  return {
    id: `${kind}-${Date.now()}-${index}`,
    type: kind,
    position: { x: 320 + index * 40, y: 220 + index * 40 },
    data: {
      ...data,
      label: presetTitle,
    },
  };
}

function BuilderApp() {
  const storedWorkflow = loadStoredWorkflow();
  const defaultTemplateClone = useMemo(() => cloneTemplate(defaultWorkflowTemplate), []);
  const [mode, setMode] = useState<AppMode>("landing");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("palette");
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(
    storedWorkflow?.nodes ?? defaultTemplateClone.nodes ?? initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(
    storedWorkflow?.edges ?? defaultTemplateClone.edges ?? initialEdges,
  );
  const [pipelineName, setPipelineName] = useState(storedWorkflow?.pipelineName ?? defaultWorkflowTemplate.name);
  const [runtimeQuery, setRuntimeQuery] = useState(
    storedWorkflow?.runtimeQuery ?? defaultWorkflowTemplate.runtimeQuery,
  );
  const [deployment, setDeployment] = useState<DeployResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runResult, setRunResult] = useState<string>();
  const [activeWireType, setActiveWireType] = useState<WireKind>(
    storedWorkflow?.activeWireType ?? "a2a",
  );
  const [reactFlowInstance, setReactFlowInstance] = useState<
    ReactFlowInstance<BuilderNode, BuilderEdge> | null
  >(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    storedWorkflow?.nodes?.[0]?.id ?? initialNodes[1]?.id ?? null,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedFundNode, setSelectedFundNode] = useState<BuilderNode | null>(null);
  const [fundIntent, setFundIntent] = useState<FundIntentResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const [error, setError] = useState<string>();
  const [deployedWorkflows, setDeployedWorkflows] = useState<PipelineSummary[]>([]);
  const [flowsPending, setFlowsPending] = useState(false);
  const [selectedExampleId, setSelectedExampleId] = useState(defaultWorkflowTemplate.id);
  const playbackIdRef = useRef(0);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const runtimePrompt = useMemo(() => {
    const selectedAgentPrompt =
      selectedNode?.type === "agent" ? selectedNode.data.systemPrompt?.trim() : undefined;
    if (selectedAgentPrompt) {
      return selectedAgentPrompt;
    }

    const firstAgentPrompt = nodes.find((node) => node.type === "agent")?.data.systemPrompt?.trim();
    if (firstAgentPrompt) {
      return firstAgentPrompt;
    }

    return "Generate a structured trade signal using the connected specialist agents and tools.";
  }, [nodes, selectedNode]);

  const resetExecutionState = useCallback(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionState: "idle",
          executionNote: undefined,
          executionMessage: undefined,
          executionOutput: undefined,
        },
      })),
    );
  }, [setNodes]);

  const applyLogToNodes = useCallback(
    (log: LogEntry) => {
      if (!log.nodeId) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === log.nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  executionState:
                    log.eventType === "error"
                      ? "error"
                      : log.eventType === "done"
                        ? "done"
                        : "running",
                  executionNote: log.message,
                  executionMessage: log.message,
                  executionOutput:
                    typeof log.output === "string" && log.output.trim()
                      ? log.output
                      : node.data.executionOutput,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const playRunFeedback = useCallback(
    async (runLogs: LogEntry[], result: string) => {
      playbackIdRef.current += 1;
      const playbackId = playbackIdRef.current;
      setLogs([]);
      setRunResult(undefined);
      resetExecutionState();
      setBottomOpen(true);

      for (const log of runLogs) {
        if (playbackIdRef.current !== playbackId) {
          return;
        }

        setLogs((currentLogs) => [...currentLogs, log]);
        applyLogToNodes(log);
        await sleep(log.eventType === "output" ? 650 : 340);
      }

      if (playbackIdRef.current === playbackId) {
        setRunResult(result);
      }
    },
    [applyLogToNodes, resetExecutionState],
  );

  const handleOpenFunding = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId) ?? null;
      setSelectedFundNode(node);

      if (!node || !deployment) {
        setFundIntent(null);
        return;
      }

      try {
        const intent = await getFundIntent(deployment.pipelineId, nodeId);
        setFundIntent(intent);
      } catch {
        setFundIntent(null);
      }
    },
    [deployment, nodes],
  );

  const handleCopyWallet = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      const address = node?.data.walletAddress;
      if (!address) {
        return;
      }

      try {
        await navigator.clipboard.writeText(address);
        setLogs((currentLogs) => [
          ...currentLogs,
          {
            timestamp: new Date().toISOString(),
            level: "success",
            message: `Copied wallet address for ${node?.data.label ?? "agent"}.`,
          },
        ]);
      } catch {
        setLogs((currentLogs) => [
          ...currentLogs,
          {
            timestamp: new Date().toISOString(),
            level: "warning",
            message: "Unable to copy wallet address from the browser clipboard API.",
          },
        ]);
      }
    },
    [nodes],
  );

  const handleTriggerTestChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  testRequestBody: value,
                },
              }
            : node,
        ),
      );
      setRuntimeQuery(value);
    },
    [setNodes],
  );

  const handleApiKeyChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  apiKey: value,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const handleRuntimeQueryChange = useCallback(
    (value: string) => {
      setRuntimeQuery(value);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.type === "trigger"
            ? {
                ...node,
                data: {
                  ...node.data,
                  testRequestBody: value,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
        data:
          node.type === "agent"
            ? {
                ...node.data,
                onFundWallet: handleOpenFunding,
                onCopyWallet: handleCopyWallet,
              }
            : node.type === "trigger"
              ? {
                  ...node.data,
                  onTriggerTestChange: handleTriggerTestChange,
                }
            : node.type === "service" || node.type === "api"
              ? {
                  ...node.data,
                  onApiKeyChange: handleApiKeyChange,
                }
              : node.data,
      })),
    [handleCopyWallet, handleOpenFunding, handleTriggerTestChange, handleApiKeyChange, nodes, selectedNodeId],
  );

  const serializePipeline = useCallback((): DeployRequest => {
    return {
      name: pipelineName,
      network: "algorand-testnet",
      nodes: nodes.map((node) => {
        let computedEnabledTools = node.data.enabledTools;
        let computedApiKey = node.data.apiKey;

        if (node.type === "agent") {
          const connectedToolNodes = edges
            .filter(
              (edge) =>
                edge.target === node.id &&
                edge.targetHandle === "tools" &&
                (edge.data?.wireType === "connection" || edge.data?.wireType === "x402"),
            )
            .map((edge) => nodes.find((n) => n.id === edge.source))
            .filter(Boolean);

          const modelEdge = edges.find(
            (edge) => edge.target === node.id && edge.targetHandle === "model",
          );
          const modelNode = modelEdge ? nodes.find((n) => n.id === modelEdge.source) : null;

          const activeTools = [
            ...new Set([
              ...(node.data.enabledTools ?? []),
              ...connectedToolNodes.map((t) => t?.data?.serviceKind).filter(Boolean) as string[],
            ]),
          ];

          computedEnabledTools = activeTools;
          if (modelNode?.data?.apiKey) {
            computedApiKey = modelNode.data.apiKey;
          }
        }

        return {
          id: node.id,
          type: node.type as NodeKind,
          position: node.position,
          data: {
            requestMethod: node.data.requestMethod,
            testRequestBody: node.data.testRequestBody,
            label: node.data.label,
            role: node.data.role,
            description: node.data.description,
            systemPrompt: node.data.systemPrompt,
            enabledTools: computedEnabledTools,
            priceAlgo: node.data.priceAlgo,
            serviceUrl: node.data.serviceUrl,
            serviceKind: node.data.serviceKind,
            upstreamX402: node.data.upstreamX402,
            treasuryAddress: node.data.treasuryAddress,
            gmailTo: node.data.gmailTo,
            cryptoSymbols: node.data.cryptoSymbols,
            apiKey: computedApiKey,
          },
        };
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
        wireType: edge.data?.wireType ?? "a2a",
        label: edge.data?.label,
      })),
    };
  }, [edges, nodes, pipelineName]);

  const handleNodeChange = useCallback(
    (nodeId: string, updates: Partial<PipelineNodeData>) => {
      if (typeof updates.testRequestBody === "string") {
        setRuntimeQuery(updates.testRequestBody);
      }
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...updates,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const handleQuickAdd = useCallback(
    (kind: NodeKind, presetTitle?: string) => {
      const node = createNodeFromKind(kind, presetTitle, nodes.length);
      setNodes((currentNodes) => [...currentNodes, node]);
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setMode("studio");
      setLeftOpen(true);
      setLeftPanel("palette");
      setRightOpen(true);
    },
    [nodes.length, setNodes],
  );

  const handleLoadExample = useCallback(() => {
    const template = workflowTemplates.find((candidate) => candidate.id === selectedExampleId) ?? defaultWorkflowTemplate;
    const cloned = cloneTemplate(template);
    setNodes(cloned.nodes);
    setEdges(cloned.edges);
    setPipelineName(template.name);
    setRuntimeQuery(template.runtimeQuery);
    setSelectedNodeId(cloned.nodes[1]?.id ?? null);
    setSelectedEdgeId(null);
    setDeployment(null);
    setLogs([]);
    setRunResult(undefined);
    setMode("studio");
    setLeftOpen(false);
    setRightOpen(false);
    setBottomOpen(false);
    setLeftPanel("palette");
  }, [selectedExampleId, setEdges, setNodes]);

  const refreshDeployedWorkflows = useCallback(async () => {
    setFlowsPending(true);
    try {
      const items = await listPipelines();
      setDeployedWorkflows(items);
    } catch {
      setDeployedWorkflows([]);
    } finally {
      setFlowsPending(false);
    }
  }, []);

  const handleLoadDeployedWorkflow = useCallback(
    async (pipelineId: string) => {
      setFlowsPending(true);
      setError(undefined);

      try {
        const detail = await getPipelineDetail(pipelineId);

        const hydratedNodes: BuilderNode[] = detail.definition.nodes.map((node) => {
          const deployedNode = detail.nodes.find((candidate) => candidate.id === node.id);
          const nodeData: PipelineNodeData = {
            ...(node.data as PipelineNodeData),
            kind: node.type,
            status: "live",
            walletAddress: deployedNode?.walletAddress,
            balanceAlgo: deployedNode?.balanceAlgo,
            executionState: "idle",
            executionNote: undefined,
            executionMessage: undefined,
            executionOutput: undefined,
          };

          return {
            id: node.id,
            type: node.type,
            position: node.position,
            data: nodeData,
          };
        });

        const hydratedEdges: BuilderEdge[] = normalizeConnectionEdges(
          detail.definition.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            type: "wire",
            data: {
              wireType: edge.wireType,
              label: edge.label,
            },
          })),
        );

        setNodes(hydratedNodes);
        setEdges(hydratedEdges);
        setPipelineName(detail.definition.name);
        setDeployment({
          pipelineId: detail.pipelineId,
          status: "live",
          endpoint: detail.endpoint,
          priceAlgo: detail.priceAlgo,
          network: detail.network,
          paymentWallet: detail.paymentWallet,
          loraUrl: detail.loraUrl,
          nodes: detail.nodes,
          logs: [],
        });
        const triggerNode = hydratedNodes.find((node) => node.type === "trigger");
        setRuntimeQuery(
          triggerNode?.data.testRequestBody ?? '{ "prompt": "" }',
        );
        setSelectedNodeId(hydratedNodes.find((node) => node.type === "agent")?.id ?? hydratedNodes[0]?.id ?? null);
        setSelectedEdgeId(null);
        setLogs([]);
        setRunResult(undefined);
        setMode("studio");
        setLeftPanel("flows");
        setLeftOpen(true);
        setRightOpen(false);
        setBottomOpen(false);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load deployed workflow.");
      } finally {
        setFlowsPending(false);
      }
    },
    [setEdges, setNodes],
  );

  async function handleDeploy() {
    const validationError = validatePipelineConfiguration(nodes, edges);
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);
    setError(undefined);

    try {
      playbackIdRef.current += 1;
      const response = await deployPipeline(serializePipeline());
      setDeployment(response);
      setLogs(response.logs);
      setRunResult(undefined);
      setSelectedEdgeId(null);
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const deployedNode = response.nodes.find((candidate) => candidate.id === node.id);
          if (!deployedNode) {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              status: "live",
              walletAddress: deployedNode.walletAddress,
              balanceAlgo: deployedNode.balanceAlgo,
              executionState: "idle",
              executionNote: undefined,
              executionMessage: undefined,
              executionOutput: undefined,
            },
          };
        }),
      );
      setMode("studio");
      setBottomOpen(true);
      setRightOpen(false);
      refreshDeployedWorkflows();
    } catch (deployError) {
      setError(deployError instanceof Error ? deployError.message : "Unable to deploy pipeline.");
    } finally {
      setPending(false);
    }
  }

  async function handleRunDemo() {
    if (!deployment) {
      setError("Deploy the workflow first so AgentMesh can create the run endpoint.");
      return;
    }

    setRunPending(true);
    setError(undefined);
    setBottomOpen(true);
    setLogs([]);
    resetExecutionState();

    try {
      const triggerNode = nodes.find((node) => node.type === "trigger");
      const requestQuery = extractRuntimeQuery(
        triggerNode?.data.testRequestBody ?? runtimeQuery,
        triggerNode?.data.requestMethod,
      );
      const requestPayload = {
        query: requestQuery,
        payload: {
          definition: serializePipeline(),
        },
      };
      const preflight = await preflightPipelinePayment(deployment.pipelineId, requestPayload);
      const preflightLogs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: preflight.paymentRequired ? "warning" : "info",
          message: preflight.paymentRequired
            ? "402 Payment Required returned by the pipeline endpoint."
            : "Pipeline preflight completed.",
          eventType: "progress",
          details: {
            status: preflight.status,
            facilitator: preflight.facilitator ?? preflight.body.facilitator,
            wallet: preflight.body.wallet,
            amount_algo: preflight.body.amountAlgo.toFixed(3),
            network: preflight.body.network,
          },
          output: preflight.body.message,
        },
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Studio is continuing in local test mode after the 402 preflight.",
          eventType: "progress",
          details: {
            mode: "studio_test",
            demo_bypass: true,
          },
        },
      ];

      const response = await runPipeline(deployment.pipelineId, requestPayload);
      await playRunFeedback([...preflightLogs, ...response.logs], response.result);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Pipeline run failed.";
      setError(message);
      setLogs((currentLogs) => [
        ...currentLogs,
        {
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Runtime execution aborted.",
          eventType: "error",
          output: message,
        },
      ]);
    } finally {
      setRunPending(false);
    }
  }

  useEffect(() => {
    if (!leftOpen || leftPanel !== "flows") {
      return;
    }

    refreshDeployedWorkflows();
  }, [leftOpen, leftPanel, refreshDeployedWorkflows]);

  useEffect(() => {
    if (!deployment) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await getBalances(deployment.pipelineId);
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            const balance = response.balances.find((entry) => entry.nodeId === node.id);
            if (!balance) {
              return node;
            }

            return {
              ...node,
              data: {
                ...node.data,
                walletAddress: balance.address,
                balanceAlgo: balance.balanceAlgo,
              },
            };
          }),
        );
      } catch {
        // Ignore intermittent polling failures.
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [deployment, setNodes]);

  useEffect(() => {
    const draft: StoredWorkflowDraft = {
      pipelineName,
      activeWireType,
      runtimeQuery,
      nodes: nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onFundWallet: undefined,
          onCopyWallet: undefined,
          onTriggerTestChange: undefined,
          executionState: undefined,
          executionNote: undefined,
          executionMessage: undefined,
          executionOutput: undefined,
        },
      })),
      edges,
    };

    window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(draft));
  }, [activeWireType, edges, nodes, pipelineName, runtimeQuery]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const wireMeta = resolveWireMeta(connection, nodes, activeWireType);
      if (!wireMeta) {
        setError("That connection is not valid. Use a node's top dot for AI links and the agent's bottom model/tools dots as targets. Side dots are for workflow wires.");
        return;
      }

      const wire = createWire(
        `edge-${connection.source}-${connection.target}-${Date.now()}`,
        connection.source,
        connection.target,
        wireMeta.wireType,
        wireMeta.label,
        connection.sourceHandle ?? undefined,
        connection.targetHandle ?? undefined,
      );

      setEdges((currentEdges) => {
        const dedupedEdges = currentEdges.filter((edge) => {
          if (
            edge.source === wire.source &&
            edge.target === wire.target &&
            edge.sourceHandle === wire.sourceHandle &&
            edge.targetHandle === wire.targetHandle
          ) {
            return false;
          }

          if (wire.targetHandle === "model" && edge.target === wire.target && edge.targetHandle === "model") {
            return false;
          }

          return true;
        });

        return [
          ...dedupedEdges,
          {
            ...wire,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
          },
        ];
      });
      setError(undefined);
      setSelectedEdgeId(null);
    },
    [activeWireType, nodes, setEdges],
  );

  const onNodeClick = useCallback<NodeMouseHandler<BuilderNode>>((_, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setRightOpen(true);
  }, []);

  const onEdgeClick = useCallback<EdgeMouseHandler<BuilderEdge>>((event, edge) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping =
        tagName === "input" || tagName === "textarea" || target?.isContentEditable === true;

      if (isTyping || !selectedEdgeId || (event.key !== "Delete" && event.key !== "Backspace")) {
        return;
      }

      event.preventDefault();
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
      setLogs((currentLogs) => [
        ...currentLogs,
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Wire deleted from the workflow.",
        },
      ]);
    }

    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [selectedEdgeId, setEdges]);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/agentmesh-node");
      if (!raw || !reactFlowInstance) {
        return;
      }

      const parsed = JSON.parse(raw) as { kind: NodeKind; presetTitle?: string };
      const node = createNodeFromKind(parsed.kind, parsed.presetTitle, nodes.length);
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      node.position = position;
      setNodes((currentNodes) => [...currentNodes, node]);
      setSelectedNodeId(node.id);
      setRightOpen(true);
    },
    [nodes.length, reactFlowInstance, setNodes],
  );

  const liveStatus = deployment ? "Live endpoint ready" : "Draft workflow";

  if (mode === "landing") {
    return (
      <div className="landing-shell">
        <div className="landing-noise" />
        <section className="landing-hero">
          <div className="landing-nav">
            <div className="landing-brand">
              <span className="brand-mark">AM</span>
              <div>
                <span className="eyebrow">AgentMesh</span>
                <strong>Algorand agent workflow studio</strong>
              </div>
            </div>
            <div className="landing-actions">
              <button className="ghost-button" onClick={handleLoadExample} type="button">
                Load Demo
              </button>
              <button className="primary-button launch-button" onClick={() => setMode("studio")} type="button">
                Open Studio
              </button>
            </div>
          </div>

          <div className="landing-grid">
            <div className="hero-copy-card">
              <div className="hero-kicker">Visual drag-and-drop canvas for agentic commerce</div>
              <h1>Design, fund, and run wallet-backed AI agents on Algorand.</h1>
              <p>
                AgentMesh turns autonomous agent workflows into something you can actually wire,
                inspect, and execute visually. Build a network of agents and services, deploy it,
                then run prompt-driven flows where agents choose connected tools.
              </p>
              <div className="hero-cta-row">
                <button className="primary-button hero-primary" onClick={() => setMode("studio")} type="button">
                  Go To Playground
                </button>
                <button className="ghost-button hero-secondary" onClick={handleLoadExample} type="button">
                  Test It Now
                </button>
              </div>
              <div className="hero-stat-row">
                <div className="hero-stat-card">
                  <span>Agent wallets</span>
                  <strong>Real Algorand testnet accounts</strong>
                </div>
                <div className="hero-stat-card">
                  <span>Tooling</span>
                  <strong>Weather + Search working today</strong>
                </div>
                <div className="hero-stat-card">
                  <span>UX</span>
                  <strong>No auth, local drafts, instant canvas</strong>
                </div>
              </div>
            </div>

            <div className="hero-visual-card">
              <div className="visual-header">
                <span className="eyebrow">Live Flow</span>
                <strong>Signal Ops Router</strong>
              </div>
              <div className="visual-flow">
                <div className="visual-node">
                  <span>Trigger</span>
                  <strong>Incoming Request</strong>
                </div>
                <div className="visual-link" />
                <div className="visual-node">
                  <span>Agent</span>
                  <strong>Research Agent</strong>
                </div>
                <div className="visual-link dual-link">
                  <i />
                  <i />
                </div>
                <div className="visual-service-stack">
                  <div className="visual-service">
                    <span>Service</span>
                    <strong>Open-Meteo</strong>
                  </div>
                  <div className="visual-service">
                    <span>Service</span>
                    <strong>DuckDuckGo</strong>
                  </div>
                </div>
                <div className="visual-link" />
                <div className="visual-node">
                  <span>Agent</span>
                  <strong>Responder</strong>
                </div>
              </div>
              <div className="visual-footer">
                <div className="visual-pill">x402-ready wires</div>
                <div className="visual-pill">fundable wallets</div>
                <div className="visual-pill">run endpoint</div>
              </div>
            </div>
          </div>

          <div className="landing-feature-grid">
            <div className="feature-tile">
              <span>Canvas</span>
              <strong>n8n-style editing, but for autonomous agent networks</strong>
            </div>
            <div className="feature-tile">
              <span>Funding</span>
              <strong>Each agent gets a real wallet you can fund and inspect</strong>
            </div>
            <div className="feature-tile">
              <span>Runtime</span>
              <strong>Deploy to a callable pipeline and test prompts immediately</strong>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="studio-shell">
      <header className="studio-topbar">
        <div className="studio-topbar-left">
          <div className="studio-brand">
            <span className="brand-mark small-mark">AM</span>
            <div className="studio-brand-copy">
              <span className="eyebrow">Studio</span>
              <input
                className="studio-title-input"
                onChange={(event) => setPipelineName(event.target.value)}
                value={pipelineName}
              />
            </div>
          </div>
        </div>

        <div className="studio-topbar-center">
          <div className="segmented-control">
            {(["a2a", "connection", "x402", "algo_transfer"] as WireKind[]).map((wireType) => (
              <button
                key={wireType}
                className={wireType === activeWireType ? "segment-button segment-active" : "segment-button"}
                onClick={() => setActiveWireType(wireType)}
                type="button"
              >
                {wireType === "a2a"
                  ? "A2A"
                  : wireType === "connection"
                    ? "Connection"
                    : wireType === "x402"
                      ? "x402"
                      : "Transfer"}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-topbar-right">
          <div className="toolbar-panel-group">
            <button
              className={leftOpen && leftPanel === "palette" ? "compact-button toolbar-panel-button toolbar-panel-active" : "compact-button toolbar-panel-button"}
              onClick={() => {
                if (leftOpen && leftPanel === "palette") {
                  setLeftOpen(false);
                  return;
                }
                setLeftPanel("palette");
                setLeftOpen(true);
              }}
              type="button"
            >
              Blocks
            </button>
            <button
              className={leftOpen && leftPanel === "flows" ? "compact-button toolbar-panel-button toolbar-panel-active" : "compact-button toolbar-panel-button"}
              onClick={() => {
                if (leftOpen && leftPanel === "flows") {
                  setLeftOpen(false);
                  return;
                }
                setLeftPanel("flows");
                setLeftOpen(true);
              }}
              type="button"
            >
              Flows
            </button>
          </div>

          <div className="toolbar-example-row">
            <label className="example-picker" htmlFor="workflow-example">
              <span className="sr-only">Sample workflow</span>
              <select
                className="example-select"
                id="workflow-example"
                onChange={(event) => setSelectedExampleId(event.target.value)}
                value={selectedExampleId}
              >
                {workflowTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost-button compact-button toolbar-inline-action" onClick={handleLoadExample} type="button">
              Load
            </button>
          </div>

          <div className="toolbar-actions">
            <button className="ghost-button compact-button toolbar-run-button" disabled={runPending} onClick={handleRunDemo} type="button">
              {runPending ? "Running..." : "Run"}
            </button>
            <button className="primary-button compact-button toolbar-deploy-button" disabled={pending} onClick={handleDeploy} type="button">
              {pending ? "Deploying..." : "Deploy"}
            </button>
          </div>
        </div>
      </header>

      {error ? <div className="error-banner floating-error">{error}</div> : null}

      <main className="playground-stage">
        <section className="playground-shell canvas-super-shell">
          <div className="canvas-overlay-top">
            <div className="canvas-badge-cluster">
              <div className="canvas-status-pill">{liveStatus}</div>
              <div className="canvas-status-pill">{nodes.length} nodes</div>
              <div className="canvas-status-pill">{edges.length} wires</div>
            </div>
            <div className="canvas-status-pill strong-pill">
              {deployment ? deployment.pipelineId : "Not deployed"}
            </div>
          </div>

          <div
            className="canvas-flow-wrap"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={handleDrop}
          >
            <ReactFlow<BuilderNode, BuilderEdge>
              connectionLineStyle={{ stroke: "#8b5cf6", strokeWidth: 2.5 }}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={32}
              edgeTypes={edgeTypes}
              edges={edges.map((edge) => ({
                ...edge,
                selected: edge.id === selectedEdgeId,
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                },
              }))}
              fitView
              nodeTypes={nodeTypes}
              nodes={decoratedNodes}
              onConnect={onConnect}
              onEdgeClick={onEdgeClick}
              onEdgesChange={onEdgesChange}
              onInit={setReactFlowInstance}
              onNodeClick={onNodeClick}
              onNodesChange={onNodesChange}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setRightOpen(false);
              }}
            >
              <Background color="#2a1358" gap={28} />
              <MiniMap
                pannable
                style={{ background: "#0d0818", border: "1px solid #251048" }}
                zoomable
              />
              <Controls />
            </ReactFlow>
          </div>

          <button
            className={bottomOpen ? "console-fab console-fab-active" : "console-fab"}
            onClick={() => setBottomOpen((value) => !value)}
            type="button"
          >
            Console
          </button>

          <section
            className={leftOpen ? "overlay-panel overlay-panel-left" : "overlay-panel overlay-panel-left overlay-hidden-left"}
          >
            <button
              aria-label="Close left panel"
              className="overlay-close"
              onClick={() => setLeftOpen(false)}
              type="button"
            >
              ×
            </button>
            {leftPanel === "palette" ? (
              <NodePalette onQuickAdd={handleQuickAdd} />
            ) : (
              <div className="drawer-placeholder studio-panel panel-pad">
                <span className="eyebrow">Flows</span>
                <h2>Deployed workflows</h2>
                {flowsPending ? <p className="empty-state">Loading deployed workflows...</p> : null}
                {!flowsPending && deployedWorkflows.length === 0 ? (
                  <p className="empty-state">No deployed workflows yet. Deploy one and it will appear here.</p>
                ) : null}
                {!flowsPending
                  ? deployedWorkflows.map((workflow) => (
                      <button
                        key={workflow.pipelineId}
                        className="snapshot-card snapshot-card-button"
                        onClick={() => handleLoadDeployedWorkflow(workflow.pipelineId)}
                        type="button"
                      >
                        <strong>{workflow.name}</strong>
                        <span>{workflow.pipelineId}</span>
                        <span>
                          {workflow.nodeCount} nodes • {workflow.wireCount} wires • {workflow.runCount} runs
                        </span>
                        <span>{workflow.priceAlgo.toFixed(3)} ALGO • {workflow.network}</span>
                      </button>
                    ))
                  : null}
              </div>
            )}
          </section>

          <section
            className={rightOpen ? "overlay-panel overlay-panel-right" : "overlay-panel overlay-panel-right overlay-hidden-right"}
          >
            <button
              aria-label="Close inspector"
              className="overlay-close"
              onClick={() => setRightOpen(false)}
              type="button"
            >
              ×
            </button>
            <InspectorPanel
              deployment={deployment}
              onCopyEndpoint={() => {
                if (deployment) {
                  navigator.clipboard.writeText(deployment.endpoint);
                }
              }}
              onNodeChange={handleNodeChange}
              selectedNode={selectedNode}
            />
          </section>

          <section
            className={bottomOpen ? "overlay-panel overlay-panel-bottom" : "overlay-panel overlay-panel-bottom overlay-hidden-bottom"}
          >
            <div className="overlay-bottom-header">
              <div className="overlay-console-title">
                <span className="eyebrow">Console</span>
                <h3>Runtime terminal</h3>
              </div>
              <button
                aria-label="Close bottom panel"
                className="overlay-close overlay-close-inline"
                onClick={() => setBottomOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="overlay-bottom-body">
              <RunLogPanel
                logs={logs}
                onQueryChange={handleRuntimeQueryChange}
                onRun={handleRunDemo}
                query={runtimeQuery}
                result={runResult}
                runPending={runPending}
                runtimePrompt={runtimePrompt}
              />
            </div>
          </section>
        </section>
      </main>

      <FundingModal
        fundIntent={fundIntent}
        node={selectedFundNode}
        onClose={() => {
          setSelectedFundNode(null);
          setFundIntent(null);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <BuilderApp />
    </ReactFlowProvider>
  );
}
