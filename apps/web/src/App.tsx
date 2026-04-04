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

const WORKFLOW_STORAGE_KEY = "agentmesh.workflow.v3";

interface StoredWorkflowDraft {
  pipelineName: string;
  activeWireType: WireKind;
  promptInput: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
}

type AppMode = "landing" | "studio";
type LeftPanel = "palette" | "flows";
type BottomPanel = "console" | "prompt";

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
  const [mode, setMode] = useState<AppMode>("landing");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("palette");
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>("prompt");
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
      setMode("studio");
      setLeftOpen(true);
      setLeftPanel("palette");
      setRightOpen(true);
    },
    [nodes.length, setNodes],
  );

  const handleLoadExample = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setPipelineName("Market Analyzer");
    setPromptInput("Search current sentiment for BTC and summarize it.");
    setSelectedNodeId(initialNodes[1]?.id ?? null);
    setDeployment(null);
    setLogs([]);
    setRunResult(undefined);
    setMode("studio");
    setLeftOpen(false);
    setRightOpen(false);
    setBottomOpen(false);
    setLeftPanel("palette");
    setBottomPanel("prompt");
  }, [setEdges, setNodes]);

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
      setMode("studio");
      setBottomOpen(true);
      setBottomPanel("console");
      setRightOpen(false);
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
      setBottomOpen(true);
      setBottomPanel("console");
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
        // Ignore intermittent polling failures.
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
    setRightOpen(true);
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
                <strong>Market Analyzer</strong>
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
          <button className="ghost-button compact-button" onClick={() => setMode("landing")} type="button">
            Dashboard
          </button>
          <div className="studio-brand">
            <span className="brand-mark small-mark">AM</span>
            <div>
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
            {(["a2a", "x402", "algo_transfer"] as WireKind[]).map((wireType) => (
              <button
                key={wireType}
                className={wireType === activeWireType ? "segment-button segment-active" : "segment-button"}
                onClick={() => setActiveWireType(wireType)}
                type="button"
              >
                {wireType === "a2a" ? "Purple Wire" : wireType === "x402" ? "Green Wire" : "Blue Wire"}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-topbar-right">
          <button className="ghost-button compact-button" onClick={handleLoadExample} type="button">
            Load Example
          </button>
          <button className="primary-button compact-button" disabled={pending} onClick={handleDeploy} type="button">
            {pending ? "Deploying..." : "Deploy"}
          </button>
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

          <div className="playground-launchers playground-launchers-left">
            <button
              className={leftOpen && leftPanel === "palette" ? "launcher-button launcher-active" : "launcher-button"}
              onClick={() => {
                setLeftPanel("palette");
                setLeftOpen(true);
              }}
              type="button"
            >
              Blocks
            </button>
            <button
              className={leftOpen && leftPanel === "flows" ? "launcher-button launcher-active" : "launcher-button"}
              onClick={() => {
                setLeftPanel("flows");
                setLeftOpen(true);
              }}
              type="button"
            >
              Flows
            </button>
            <button
              className={rightOpen ? "launcher-button launcher-active" : "launcher-button"}
              onClick={() => setRightOpen(true)}
              type="button"
            >
              Inspector
            </button>
          </div>

          <div className="playground-launchers playground-launchers-right">
            <button
              className={bottomOpen && bottomPanel === "prompt" ? "launcher-button launcher-active" : "launcher-button"}
              onClick={() => {
                setBottomPanel("prompt");
                setBottomOpen(true);
              }}
              type="button"
            >
              Prompt
            </button>
            <button
              className={bottomOpen && bottomPanel === "console" ? "launcher-button launcher-active" : "launcher-button"}
              onClick={() => {
                setBottomPanel("console");
                setBottomOpen(true);
              }}
              type="button"
            >
              Console
            </button>
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
              <Background color="#113023" gap={28} />
              <MiniMap
                pannable
                style={{ background: "#08110d", border: "1px solid #183126" }}
                zoomable
              />
              <Controls />
            </ReactFlow>
          </div>

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
                <h2>Workflow snapshots</h2>
                <div className="snapshot-card">
                  <strong>Market Analyzer</strong>
                  <span>Research Agent to tools to responder</span>
                </div>
                <div className="snapshot-card">
                  <strong>Weather Lookup</strong>
                  <span>Prompt weather, return forecast summary</span>
                </div>
                <div className="snapshot-card">
                  <strong>Search Explainer</strong>
                  <span>Run search, send result into final formatter</span>
                </div>
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
              <div className="overlay-tabs">
                <button
                  className={bottomPanel === "prompt" ? "dock-tab dock-tab-active" : "dock-tab"}
                  onClick={() => setBottomPanel("prompt")}
                  type="button"
                >
                  Prompt Input
                </button>
                <button
                  className={bottomPanel === "console" ? "dock-tab dock-tab-active" : "dock-tab"}
                  onClick={() => setBottomPanel("console")}
                  type="button"
                >
                  Runtime Console
                </button>
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
              {bottomPanel === "prompt" ? (
                <div className="dock-panel-grid">
                  <PromptRunner
                    onChange={setPromptInput}
                    onRun={handleRunDemo}
                    prompt={promptInput}
                    runPending={runPending}
                  />
                  <div className="dock-helper-card">
                    <span className="eyebrow">Prompt Suggestions</span>
                    <h3>Try these inputs</h3>
                    <button
                      className="prompt-suggestion"
                      onClick={() => setPromptInput("What's the weather in Bengaluru today?")}
                      type="button"
                    >
                      Weather in Bengaluru today
                    </button>
                    <button
                      className="prompt-suggestion"
                      onClick={() => setPromptInput("Search BTC sentiment and explain what BTC is.")}
                      type="button"
                    >
                      Search BTC sentiment and explain BTC
                    </button>
                    <button
                      className="prompt-suggestion"
                      onClick={() =>
                        setPromptInput("Find current weather in Mumbai and summarize it cleanly.")
                      }
                      type="button"
                    >
                      Find weather in Mumbai and summarize it
                    </button>
                  </div>
                </div>
              ) : (
                <RunLogPanel logs={logs} result={runResult} />
              )}
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
