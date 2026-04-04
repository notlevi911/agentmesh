import type { Edge, Node } from "@xyflow/react";

export type NodeKind = "agent" | "api" | "service" | "trigger" | "end";
export type WireKind = "a2a" | "x402" | "algo_transfer";
export type LogLevel = "info" | "success" | "warning" | "error";

export interface PipelineNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  requestMethod?: "GET" | "POST" | "PUT";
  testRequestBody?: string;
  role?: string;
  description?: string;
  systemPrompt?: string;
  enabledTools?: string[];
  priceAlgo?: number;
  serviceUrl?: string;
  serviceKind?: "weather" | "search" | "custom";
  upstreamX402?: boolean;
  treasuryAddress?: string;
  walletAddress?: string;
  balanceAlgo?: number;
  runUrl?: string;
  status?: "draft" | "live";
  executionState?: "idle" | "running" | "done" | "error";
  executionNote?: string;
  onFundWallet?: (nodeId: string) => void;
  onCopyWallet?: (nodeId: string) => void;
  onTriggerTestChange?: (nodeId: string, value: string) => void;
}

export interface PipelineEdgeData extends Record<string, unknown> {
  wireType: WireKind;
  label?: string;
}

export type BuilderNode = Node<PipelineNodeData>;
export type BuilderEdge = Edge<PipelineEdgeData>;

export interface DeployRequest {
  name: string;
  network: "algorand-testnet";
  nodes: Array<{
    id: string;
    type: NodeKind;
    position: { x: number; y: number };
    data: Omit<
      PipelineNodeData,
      | "kind"
      | "walletAddress"
      | "balanceAlgo"
      | "runUrl"
      | "status"
      | "executionState"
      | "executionNote"
      | "onFundWallet"
      | "onCopyWallet"
      | "onTriggerTestChange"
    >;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    wireType: WireKind;
    label?: string;
  }>;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  nodeId?: string;
  eventType?: "start" | "progress" | "output" | "done" | "error";
  output?: string;
  txId?: string;
}

export interface DeployedNodeState {
  id: string;
  type: NodeKind;
  walletAddress?: string;
  balanceAlgo?: number;
  explorerUrl?: string;
}

export interface DeployResponse {
  pipelineId: string;
  status: "live";
  endpoint: string;
  priceAlgo: number;
  network: string;
  paymentWallet?: string;
  loraUrl?: string;
  nodes: DeployedNodeState[];
  logs: LogEntry[];
}

export interface BalanceRecord {
  nodeId: string;
  address: string;
  balanceAlgo: number;
  explorerUrl?: string;
}

export interface BalanceResponse {
  pipelineId: string;
  balances: BalanceRecord[];
}

export interface FundIntentResponse {
  pipelineId: string;
  nodeId: string;
  address: string;
  faucetUrl: string;
  loraUrl?: string;
  qrValue: string;
}

export interface RunResponse {
  runId: string;
  pipelineId: string;
  result: string;
  settlementMode: "demo" | "payment_response";
  logs: LogEntry[];
}
