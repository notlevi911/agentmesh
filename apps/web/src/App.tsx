import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
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
import { deployPipeline, getBalances, getFundIntent, runPipeline } from "./api/client";
import { createWire, getDefaultNodeData, initialEdges, initialNodes } from "./canvas/initialGraph";
import { NodePalette } from "./components/NodePalette";
import { WireEdge } from "./edges/WireEdge";
import { AgentNode } from "./nodes/AgentNode";
import { EndNode } from "./nodes/EndNode";
import { ServiceNode } from "./nodes/ServiceNode";
import { TriggerNode } from "./nodes/TriggerNode";
import { FundingModal } from "./panels/FundingModal";
import { InspectorPanel } from "./panels/InspectorPanel";
import { PromptRunner } from "./panels/PromptRunner";
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
  PipelineNodeData,
  WireKind,
} from "./types/pipeline";

const WORKFLOW_STORAGE_KEY = "agentmesh.workflow.v2";

interface StoredWorkflowDraft {
  pipelineName: string;
  activeWireType: WireKind;
  promptInput: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

const nodeTypes = {
  agent: AgentNode,
  service: ServiceNode,
  trigger: TriggerNode,
  end: EndNode,
};

const edgeTypes = {
  wire: WireEdge,
};

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

    return parsed;
  } catch {
    return null;
  }
}

function createNodeFromKind(kind: NodeKind, title?: string, index = 0): BuilderNode {
  const data = getDefaultNodeData(kind);
  const presetTitle = title ?? data.label;

  if (kind === "service" && title?.toLowerCase().includes("weather")) {
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

  if (kind === "service" && title?.toLowerCase().includes("search")) {
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

  if (kind === "agent") {
    return {
      id: `${kind}-${Date.now()}-${index}`,
      type: kind,
      position: { x: 320 + index * 40, y: 220 + index * 40 },
      data: {
        ...data,
        label: presetTitle,
        enabledTools: ["weather", "search"],
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
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>(
    storedWorkflow?.nodes ?? initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>(
    storedWorkflow?.edges ?? initialEdges,
  );
  const [pipelineName, setPipelineName] = useState(storedWorkflow?.pipelineName ?? "AgentMesh Canvas");
  const [promptInput, setPromptInput] = useState(
    storedWorkflow?.promptInput ?? "What's the weather in Bengaluru today?",
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
  const [selectedFundNode, setSelectedFundNode] = useState<BuilderNode | null>(null);
  const [fundIntent, setFundIntent] = useState<FundIntentResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [runPending, setRunPending] = useState(false);
  const [error, setError] = useState<string>();

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
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
              }
            : node.data,
      })),
    [handleOpenFunding, nodes, selectedNodeId],
  );

  const serializePipeline = useCallback((): DeployRequest => {
    return {
      name: pipelineName,
      network: "algorand-testnet",
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type as NodeKind,
        position: node.position,
        data: {
          label: node.data.label,
          role: node.data.role,
          description: node.data.description,
          systemPrompt: node.data.systemPrompt,
          enabledTools: node.data.enabledTools,
          priceAlgo: node.data.priceAlgo,
          serviceUrl: node.data.serviceUrl,
          serviceKind: node.data.serviceKind,
        },
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        wireType: edge.data?.wireType ?? "a2a",
        label: edge.data?.label,
      })),
    };
  }, [edges, nodes, pipelineName]);

  const handleNodeChange = useCallback(
    (nodeId: string, updates: Partial<PipelineNodeData>) => {
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
    },
    [nodes.length, setNodes],
  );

  async function handleDeploy() {
    setPending(true);
    setError(undefined);

    try {
      const response = await deployPipeline(serializePipeline());
      setDeployment(response);
      setLogs(response.logs);
      setRunResult(undefined);
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
            },
          };
        }),
      );
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

    try {
      const response = await runPipeline(deployment.pipelineId, {
        query: promptInput,
      });
      setLogs(response.logs);
      setRunResult(response.result);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Pipeline run failed.");
    } finally {
      setRunPending(false);
    }
  }

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
        // Ignore intermittent network issues during polling.
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [deployment, setNodes]);

  useEffect(() => {
    const draft: StoredWorkflowDraft = {
      pipelineName,
      activeWireType,
      promptInput,
      nodes: nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onFundWallet: undefined,
        },
      })),
      edges,
    };

    window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(draft));
  }, [activeWireType, edges, nodes, pipelineName, promptInput]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const labelMap: Record<WireKind, string> = {
        a2a: "A2A message",
        x402: "Tool/payment call",
        algo_transfer: "ALGO transfer",
      };

      const wire = createWire(
        `edge-${connection.source}-${connection.target}-${Date.now()}`,
        connection.source,
        connection.target,
        activeWireType,
        labelMap[activeWireType],
      );

      setEdges((currentEdges) => [
        ...currentEdges,
        {
          ...wire,
          markerEnd: {
            type: MarkerType.ArrowClosed,
          },
        },
      ]);
    },
    [activeWireType, setEdges],
  );

  const onNodeClick = useCallback<NodeMouseHandler<BuilderNode>>((_, node) => {
    setSelectedNodeId(node.id);
  }, []);

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
    },
    [nodes.length, reactFlowInstance, setNodes],
  );

  const loadExample = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setPipelineName("AgentMesh Canvas");
    setPromptInput("Search current sentiment for BTC and summarize it.");
    setSelectedNodeId(initialNodes[1]?.id ?? null);
    setDeployment(null);
    setLogs([]);
    setRunResult(undefined);
  }, [setEdges, setNodes]);

  return (
    <div className="agentmesh-shell">
      <header className="builder-header">
        <div className="header-copy">
          <span className="eyebrow">AgentMesh</span>
          <input
            className="builder-title"
            onChange={(event) => setPipelineName(event.target.value)}
            value={pipelineName}
          />
          <p>Visual agentic commerce builder for Algorand wallets, tools, and x402-ready flows.</p>
        </div>
        <div className="toolbar-cluster">
          <div className="wire-toggle">
            {(["a2a", "x402", "algo_transfer"] as WireKind[]).map((wireType) => (
              <button
                key={wireType}
                className={wireType === activeWireType ? "wire-button active-wire" : "wire-button"}
                onClick={() => setActiveWireType(wireType)}
                type="button"
              >
                {wireType === "a2a" ? "Purple" : wireType === "x402" ? "Green" : "Blue"}
              </button>
            ))}
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              setNodes([]);
              setEdges([]);
              setSelectedNodeId(null);
            }}
            type="button"
          >
            Clear nodes
          </button>
          <button className="secondary-button" onClick={loadExample} type="button">
            Load example
          </button>
          <button className="primary-button" disabled={pending} onClick={handleDeploy} type="button">
            {pending ? "Deploying..." : "Deploy"}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="editor-grid">
        <NodePalette onQuickAdd={handleQuickAdd} />

        <section className="canvas-panel">
          <div className="canvas-topline">
            <span className="canvas-hint">Drag from node handles to connect steps. Select any node to edit it.</span>
          </div>
          <div
            className="canvas-shell"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={handleDrop}
          >
            <ReactFlow<BuilderNode, BuilderEdge>
              edgeTypes={edgeTypes}
              edges={edges.map((edge) => ({
                ...edge,
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                },
              }))}
              fitView
              nodeTypes={nodeTypes}
              nodes={decoratedNodes}
              onConnect={onConnect}
              onEdgesChange={onEdgesChange}
              onInit={setReactFlowInstance}
              onNodeClick={onNodeClick}
              onNodesChange={onNodesChange}
            >
              <Background color="#e3e5ea" gap={24} />
              <MiniMap pannable style={{ background: "#fbfbfd", border: "1px solid #e4e6eb" }} zoomable />
              <Controls />
            </ReactFlow>
          </div>
          <PromptRunner
            onChange={setPromptInput}
            onRun={handleRunDemo}
            prompt={promptInput}
            runPending={runPending}
          />
          <RunLogPanel logs={logs} result={runResult} />
        </section>

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
