from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

NodeKind = Literal["agent", "api", "service", "trigger", "end"]
WireKind = Literal["a2a", "x402", "algo_transfer"]
LogLevel = Literal["info", "success", "warning", "error"]


class Position(BaseModel):
    x: float
    y: float


class NodeData(BaseModel):
    label: str
    role: Optional[str] = None
    description: Optional[str] = None
    systemPrompt: Optional[str] = None
    enabledTools: List[str] = Field(default_factory=list)
    priceAlgo: float = 0
    serviceUrl: Optional[str] = None
    serviceKind: Optional[Literal["weather", "search", "custom"]] = None
    upstreamX402: bool = False
    treasuryAddress: Optional[str] = None


class PipelineNode(BaseModel):
    id: str
    type: NodeKind
    position: Position
    data: NodeData


class PipelineEdge(BaseModel):
    id: str
    source: str
    target: str
    wireType: WireKind
    label: Optional[str] = None


class DeployPipelineRequest(BaseModel):
    name: str
    network: Literal["algorand-testnet"] = "algorand-testnet"
    nodes: List[PipelineNode]
    edges: List[PipelineEdge]


class RuntimeLog(BaseModel):
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    level: LogLevel
    message: str
    nodeId: Optional[str] = None
    eventType: Optional[Literal["start", "progress", "output", "done", "error"]] = None
    output: Optional[str] = None
    txId: Optional[str] = None


class DeployedNode(BaseModel):
    id: str
    type: NodeKind
    walletAddress: Optional[str] = None
    balanceAlgo: Optional[float] = None
    explorerUrl: Optional[str] = None


class DeployPipelineResponse(BaseModel):
    pipelineId: str
    status: Literal["live"] = "live"
    endpoint: str
    priceAlgo: float
    network: str
    paymentWallet: Optional[str] = None
    loraUrl: Optional[str] = None
    nodes: List[DeployedNode]
    logs: List[RuntimeLog]


class WalletBalance(BaseModel):
    nodeId: str
    address: str
    balanceAlgo: float
    explorerUrl: Optional[str] = None


class BalanceResponse(BaseModel):
    pipelineId: str
    balances: List[WalletBalance]


class FundIntentResponse(BaseModel):
    pipelineId: str
    nodeId: str
    address: str
    faucetUrl: str
    loraUrl: Optional[str] = None
    qrValue: str


class RunPipelineRequest(BaseModel):
    query: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class RunPipelineResponse(BaseModel):
    runId: str
    pipelineId: str
    result: str
    settlementMode: Literal["demo", "payment_response"]
    logs: List[RuntimeLog]


class PaymentRequiredResponse(BaseModel):
    pipelineId: str
    amountAlgo: float
    wallet: str
    network: str
    facilitator: str
    endpoint: str
    message: str


class InternalToolInvokeResponse(BaseModel):
    tool: str
    title: str
    summary: str
    raw: Dict[str, Any] = Field(default_factory=dict)
