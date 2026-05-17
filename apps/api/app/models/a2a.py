from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class AgentToolConfig(BaseModel):
    node_id: str
    label: str
    service_kind: Literal["weather", "search", "custom", "gmail", "crypto", "chart", "risk"]
    service_url: Optional[str] = None
    price_algo: float = 0
    upstream_x402: bool = False
    gmail_to: Optional[str] = None
    crypto_symbols: Optional[str] = None


class AgentRuntimeConfig(BaseModel):
    id: str
    name: str
    port: int
    role: Optional[str] = None
    system_prompt: str
    wallet_address: str
    wallet_private_key: str
    is_entry: bool = False
    price_algo: float = 0
    connected_agents: List[str] = Field(default_factory=list)
    tools: List[AgentToolConfig] = Field(default_factory=list)
    api_key: Optional[str] = None


class RuntimeWireConfig(BaseModel):
    id: str
    type: Literal["a2a", "x402", "algo_transfer"]
    from_agent_id: str = Field(alias="from")
    to_agent_id: Optional[str] = Field(default=None, alias="to")
    to_service_url: Optional[str] = None
    price_algo: float = 0
    description: Optional[str] = None

    model_config = {"populate_by_name": True}


class PipelineRuntimeConfig(BaseModel):
    pipeline_id: str
    agents: List[AgentRuntimeConfig]
    wires: List[RuntimeWireConfig]


class AgentLogEntry(BaseModel):
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    level: Literal["info", "success", "warning", "error"] = "info"
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)


class AgentStatusResponse(BaseModel):
    agent_id: str
    state: Literal["idle", "running", "completed", "error"] = "idle"
    wallet_address: str
    wallet_balance: float = 0
    last_result: Optional[str] = None
    port: int


class A2ATextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class A2AMessageContent(BaseModel):
    role: Literal["user", "assistant"] = "user"
    parts: List[A2ATextPart]


class A2AMessageMetadata(BaseModel):
    from_agent: str
    from_address: str
    pipeline_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class A2ATaskParams(BaseModel):
    id: str
    message: A2AMessageContent
    metadata: A2AMessageMetadata


class A2ARequest(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    method: Literal["tasks/send"] = "tasks/send"
    params: A2ATaskParams


class A2AStatus(BaseModel):
    state: Literal["completed"] = "completed"


class A2AArtifact(BaseModel):
    parts: List[A2ATextPart]


class A2AResult(BaseModel):
    id: str
    status: A2AStatus = Field(default_factory=A2AStatus)
    artifacts: List[A2AArtifact]


class A2AResponse(BaseModel):
    jsonrpc: Literal["2.0"] = "2.0"
    id: str
    result: A2AResult


class AgentRunRequest(BaseModel):
    task: str
    pipeline_config: PipelineRuntimeConfig


class MultiAgentBootAgent(BaseModel):
    agent_id: str
    name: str
    port: int
    url: str


class MultiAgentBootResponse(BaseModel):
    pipeline_id: str
    agents: List[MultiAgentBootAgent]
    status: Literal["running"] = "running"
