import asyncio
import hashlib
import json
import os
import socket
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
import uvicorn

from app.a2a.protocol import build_runtime_config
from app.agents.runtime import AgentServiceRuntime
from app.agents.server import create_agent_app
from app.algorand.client import AlgorandService
from app.llm.gemini import GeminiPlanner
from app.models.a2a import A2ARequest, AgentRunRequest, MultiAgentBootAgent, MultiAgentBootResponse
from app.models.pipeline import RunPipelineResponse, RuntimeLog
from app.runtime.tools import ToolRuntime
from app.storage.repository import LocalPipelineRepository, PipelineRecord


@dataclass
class AgentServerHandle:
    runtime: AgentServiceRuntime
    thread: threading.Thread


class MultiAgentOrchestrator:
    def __init__(
        self,
        repository: LocalPipelineRepository,
        algorand_service: AlgorandService,
    ) -> None:
        self.repository = repository
        self.algorand = algorand_service
        self.tool_runtime = ToolRuntime()
        self.gemini = GeminiPlanner()
        self._servers: Dict[str, Dict[str, AgentServerHandle]] = {}
        self._lock = threading.Lock()
        self.request_timeout = float(os.getenv("AGENTMESH_A2A_TIMEOUT_SECONDS", "180"))

    def supports(self, record: PipelineRecord) -> bool:
        agent_count = len([node for node in record.definition.nodes if node.type == "agent"])
        has_a2a = any(edge.wireType == "a2a" for edge in record.definition.edges)
        return agent_count > 1 and has_a2a

    def boot_pipeline_agents(self, pipeline_id: str) -> MultiAgentBootResponse:
        record = self._get_record(pipeline_id)
        return self.boot_pipeline_agents_for_record(record)

    def boot_pipeline_agents_for_record(self, record: PipelineRecord) -> MultiAgentBootResponse:
        pipeline_id = record.pipeline_id
        runtime_config = build_runtime_config(record)

        with self._lock:
            pipeline_handles = self._servers.setdefault(pipeline_id, {})

        for agent_config in runtime_config.agents:
            if agent_config.id in pipeline_handles:
                handle = pipeline_handles[agent_config.id]
                handle.runtime.agent_config = agent_config
                handle.runtime.record = record
                handle.runtime.pipeline_config = runtime_config
                continue

            runtime = AgentServiceRuntime(
                agent_config=agent_config,
                record=record,
                pipeline_config=runtime_config,
                algorand=self.algorand,
                tool_runtime=self.tool_runtime,
                gemini=self.gemini,
                send_a2a_message=self.send_a2a_message,
            )
            app = create_agent_app(runtime)
            server_config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=agent_config.port,
                log_level="warning",
            )
            server = uvicorn.Server(server_config)
            thread = threading.Thread(target=server.run, daemon=True)
            thread.start()
            self._wait_for_port(agent_config.port)
            pipeline_handles[agent_config.id] = AgentServerHandle(runtime=runtime, thread=thread)

        return MultiAgentBootResponse(
            pipeline_id=pipeline_id,
            agents=[
                MultiAgentBootAgent(
                    agent_id=agent.id,
                    name=agent.name,
                    port=agent.port,
                    url=f"http://127.0.0.1:{agent.port}",
                )
                for agent in runtime_config.agents
            ],
        )

    def execute(self, record: PipelineRecord, query: str, settlement_mode: str) -> RunPipelineResponse:
        return asyncio.run(self.execute_async(record, query, settlement_mode))

    async def execute_async(self, record: PipelineRecord, query: str, settlement_mode: str) -> RunPipelineResponse:
        pipeline_id = record.pipeline_id
        runtime_config = build_runtime_config(record)
        self.boot_pipeline_agents_for_record(record)

        entry_agent = next((agent for agent in runtime_config.agents if agent.is_entry), None)
        if entry_agent is None:
            raise RuntimeError("No entry agent configured for multi-agent runtime.")

        logs: List[RuntimeLog] = [
            RuntimeLog(
                level="warning" if settlement_mode == "demo" else "success",
                message=(
                    "Studio test mode bypassed the outer payment gate after a 402 preflight."
                    if settlement_mode == "demo"
                    else "Outer payment gate passed. Multi-agent runtime is starting."
                ),
                eventType="progress",
                details={
                    "runtime": "multi_agent",
                    "entry_agent": entry_agent.id,
                    "settlement_mode": settlement_mode,
                },
            ),
            RuntimeLog(
                level="info",
                message="Booted agent microservices for the pipeline.",
                eventType="progress",
                details={
                    "agent_count": len(runtime_config.agents),
                    "pipeline_id": pipeline_id,
                },
            ),
        ]

        try:
            async with httpx.AsyncClient(timeout=self.request_timeout) as client:
                response = await client.post(
                    f"http://127.0.0.1:{entry_agent.port}/run",
                    json=AgentRunRequest(task=query, pipeline_config=runtime_config).model_dump(mode="json"),
                )
                response.raise_for_status()
                payload = response.json()
        except httpx.ReadTimeout as error:
            raise RuntimeError(
                "Timed out waiting for the entry agent to finish. Increase AGENTMESH_A2A_TIMEOUT_SECONDS or reduce LLM/tool latency."
            ) from error

        for agent in runtime_config.agents:
            handle = self._servers[pipeline_id][agent.id]
            for entry in await handle.runtime.get_logs():
                logs.append(
                    RuntimeLog(
                        level=entry.level,
                        message=entry.message,
                        nodeId=agent.id,
                        eventType="progress" if entry.level in {"info", "warning"} else "done" if entry.level == "success" else "error",
                        output=_details_to_output(entry.details),
                        details=entry.details,
                    )
                )

        final_result = payload.get("result", "Multi-agent runtime completed.")
        logs.append(
            RuntimeLog(
                level="success",
                message="Multi-agent pipeline finished.",
                eventType="done",
                output=final_result,
                details={
                    "agents_involved": ",".join([agent.id for agent in runtime_config.agents]),
                },
            )
        )

        return RunPipelineResponse(
            runId="run_{token}".format(token=uuid.uuid4().hex[:10]),
            pipelineId=pipeline_id,
            result=final_result,
            settlementMode="demo" if settlement_mode == "demo" else "payment_response",
            logs=logs,
        )

    async def send_a2a_message(
        self,
        to_agent_id: str,
        message: str,
        pipeline_config,
        from_agent_id: str,
    ) -> str:
        target_agent = next(agent for agent in pipeline_config.agents if agent.id == to_agent_id)
        sender_agent = next(agent for agent in pipeline_config.agents if agent.id == from_agent_id)

        wire_exists = any(
            wire
            for wire in pipeline_config.wires
            if wire.type == "a2a"
            and wire.from_agent_id == from_agent_id
            and wire.to_agent_id == to_agent_id
        )
        if not wire_exists:
            raise RuntimeError(f"No A2A wire defined from {from_agent_id} to {to_agent_id}.")

        payload = A2ARequest(
            id=str(uuid.uuid4()),
            params={
                "id": str(uuid.uuid4()),
                "message": {
                    "role": "user",
                    "parts": [{"type": "text", "text": message}],
                },
                "metadata": {
                    "from_agent": from_agent_id,
                    "from_address": sender_agent.wallet_address,
                    "pipeline_id": pipeline_config.pipeline_id,
                    "timestamp": datetime.now(timezone.utc),
                },
            },
        )

        try:
            async with httpx.AsyncClient(timeout=self.request_timeout) as client:
                response = await client.post(
                    f"http://127.0.0.1:{target_agent.port}/message",
                    json=payload.model_dump(mode="json"),
                )
                response.raise_for_status()
                result = response.json()
        except httpx.ReadTimeout as error:
            raise RuntimeError(
                f"Timed out waiting for agent '{to_agent_id}' to respond. Increase AGENTMESH_A2A_TIMEOUT_SECONDS or reduce LLM/tool latency."
            ) from error

        sender_wallet = self.repository.get_pipeline(pipeline_config.pipeline_id).wallets.get(from_agent_id)
        if sender_wallet is not None:
            note = {
                "type": "a2a",
                "from": from_agent_id,
                "to": to_agent_id,
                "message_hash": hashlib.sha256(message.encode("utf-8")).hexdigest(),
                "pipeline": pipeline_config.pipeline_id,
            }
            try:
                await asyncio.to_thread(self.algorand.anchor_note_transaction, sender_wallet, note)
            except Exception:
                pass

        return result["result"]["artifacts"][0]["parts"][0]["text"]

    async def agent_statuses(self, pipeline_id: str) -> List[dict]:
        self.boot_pipeline_agents(pipeline_id)
        pipeline_handles = self._servers.get(pipeline_id, {})
        statuses = []
        for handle in pipeline_handles.values():
            statuses.append((await handle.runtime.status()).model_dump(mode="json"))
        return statuses

    def agent_statuses_sync(self, pipeline_id: str) -> List[dict]:
        return asyncio.run(self.agent_statuses(pipeline_id))

    def _wait_for_port(self, port: int, timeout: float = 5.0) -> None:
        start = time.time()
        while time.time() - start < timeout:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.2)
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    return
            time.sleep(0.05)
        raise TimeoutError(f"Timed out waiting for agent server on port {port}")

    def _get_record(self, pipeline_id: str) -> PipelineRecord:
        record = self.repository.get_pipeline(pipeline_id)
        if record is None:
            raise KeyError(f"Pipeline {pipeline_id} not found")
        return record


def _details_to_output(details: Dict) -> Optional[str]:
    if not details:
        return None
    try:
        return json.dumps(details, indent=2, sort_keys=True)
    except Exception:
        return str(details)
