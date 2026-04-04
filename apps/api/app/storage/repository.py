from dataclasses import dataclass, field
from threading import Lock
from typing import Dict, Optional

from app.models.pipeline import DeployPipelineRequest, RunPipelineResponse


@dataclass
class WalletRecord:
    node_id: str
    address: str
    private_key: str


@dataclass
class PipelineRecord:
    pipeline_id: str
    definition: DeployPipelineRequest
    endpoint: str
    price_algo: float
    payment_wallet: Optional[str]
    wallets: Dict[str, WalletRecord] = field(default_factory=dict)
    runs: Dict[str, RunPipelineResponse] = field(default_factory=dict)


class InMemoryPipelineRepository:
    def __init__(self) -> None:
        self._pipelines: Dict[str, PipelineRecord] = {}
        self._lock = Lock()

    def save_pipeline(self, record: PipelineRecord) -> PipelineRecord:
        with self._lock:
            self._pipelines[record.pipeline_id] = record
            return record

    def get_pipeline(self, pipeline_id: str) -> Optional[PipelineRecord]:
        return self._pipelines.get(pipeline_id)

    def save_run(self, pipeline_id: str, run: RunPipelineResponse) -> RunPipelineResponse:
        with self._lock:
            pipeline = self._pipelines[pipeline_id]
            pipeline.runs[run.runId] = run
            return run

