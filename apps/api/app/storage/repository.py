import json
import os
from dataclasses import dataclass, field
from pathlib import Path
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


class LocalPipelineRepository:
    def __init__(self, storage_path: Optional[str] = None) -> None:
        default_path = Path.cwd() / ".data" / "pipelines.json"
        self._storage_path = Path(
            storage_path or os.getenv("AGENTMESH_REPOSITORY_PATH") or str(default_path)
        )
        self._lock = Lock()
        self._pipelines: Dict[str, PipelineRecord] = {}
        self._load()

    def save_pipeline(self, record: PipelineRecord) -> PipelineRecord:
        with self._lock:
            sanitized_record = PipelineRecord(
                pipeline_id=record.pipeline_id,
                definition=self._sanitize_definition(record.definition),
                endpoint=record.endpoint,
                price_algo=record.price_algo,
                payment_wallet=record.payment_wallet,
                wallets=record.wallets,
                runs=record.runs,
            )
            self._pipelines[record.pipeline_id] = sanitized_record
            self._flush()
            return sanitized_record

    def get_pipeline(self, pipeline_id: str) -> Optional[PipelineRecord]:
        return self._pipelines.get(pipeline_id)

    def save_run(self, pipeline_id: str, run: RunPipelineResponse) -> RunPipelineResponse:
        with self._lock:
            pipeline = self._pipelines[pipeline_id]
            pipeline.runs[run.runId] = run
            self._flush()
            return run

    def list_pipelines(self) -> Dict[str, PipelineRecord]:
        return dict(self._pipelines)

    def _load(self) -> None:
        if not self._storage_path.exists():
            return

        raw = json.loads(self._storage_path.read_text())
        needs_flush = False
        for payload in raw.get("pipelines", {}).values():
            definition = payload.get("definition", {})
            if self._definition_payload_contains_api_keys(definition):
                needs_flush = True

        self._pipelines = {
            pipeline_id: self._record_from_dict(payload)
            for pipeline_id, payload in raw.get("pipelines", {}).items()
        }
        if needs_flush:
            self._flush()

    def _flush(self) -> None:
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "pipelines": {
                pipeline_id: self._record_to_dict(record)
                for pipeline_id, record in self._pipelines.items()
            }
        }
        self._storage_path.write_text(json.dumps(payload, indent=2, sort_keys=True))

    def _record_to_dict(self, record: PipelineRecord) -> Dict:
        return {
            "pipeline_id": record.pipeline_id,
            "definition": record.definition.model_dump(mode="json"),
            "endpoint": record.endpoint,
            "price_algo": record.price_algo,
            "payment_wallet": record.payment_wallet,
            "wallets": {
                node_id: {
                    "node_id": wallet.node_id,
                    "address": wallet.address,
                    "private_key": wallet.private_key,
                }
                for node_id, wallet in record.wallets.items()
            },
            "runs": {
                run_id: run.model_dump(mode="json")
                for run_id, run in record.runs.items()
            },
        }

    def _record_from_dict(self, payload: Dict) -> PipelineRecord:
        return PipelineRecord(
            pipeline_id=payload["pipeline_id"],
            definition=self._sanitize_definition(
                DeployPipelineRequest.model_validate(payload["definition"])
            ),
            endpoint=payload["endpoint"],
            price_algo=payload["price_algo"],
            payment_wallet=payload.get("payment_wallet"),
            wallets={
                node_id: WalletRecord(**wallet_payload)
                for node_id, wallet_payload in payload.get("wallets", {}).items()
            },
            runs={
                run_id: RunPipelineResponse.model_validate(run_payload)
                for run_id, run_payload in payload.get("runs", {}).items()
            },
        )

    def _sanitize_definition(self, definition: DeployPipelineRequest) -> DeployPipelineRequest:
        sanitized_nodes = []
        for node in definition.nodes:
            node_copy = node.model_copy(deep=True)
            if hasattr(node_copy.data, "apiKey"):
                node_copy.data.apiKey = None
            sanitized_nodes.append(node_copy)

        return definition.model_copy(update={"nodes": sanitized_nodes}, deep=True)

    def _definition_payload_contains_api_keys(self, definition_payload: Dict) -> bool:
        for node in definition_payload.get("nodes", []):
            data = node.get("data", {})
            if "apiKey" in data:
                return True
        return False
