import hashlib
import os
from typing import List

from app.models.a2a import AgentRuntimeConfig, AgentToolConfig, PipelineRuntimeConfig, RuntimeWireConfig
from app.storage.repository import PipelineRecord


def build_runtime_config(record: PipelineRecord) -> PipelineRuntimeConfig:
    agent_nodes = [node for node in record.definition.nodes if node.type == "agent"]
    entry_agent_id = _entry_agent_id(record)

    agents: List[AgentRuntimeConfig] = []
    wires: List[RuntimeWireConfig] = []

    for edge in record.definition.edges:
        if edge.wireType == "a2a":
            wires.append(
                RuntimeWireConfig(
                    id=edge.id,
                    type="a2a",
                    from_agent_id=edge.source,
                    to_agent_id=edge.target,
                    description=edge.label,
                )
            )
        elif edge.wireType == "x402":
            target_node = next((node for node in record.definition.nodes if node.id == edge.target), None)
            if target_node and target_node.type in {"service", "api"}:
                wires.append(
                    RuntimeWireConfig(
                        id=edge.id,
                        type="x402",
                        from_agent_id=edge.source,
                        to_agent_id=edge.target,
                        to_service_url=target_node.data.serviceUrl,
                        price_algo=target_node.data.priceAlgo or 0,
                        description=edge.label,
                    )
                )
        elif edge.wireType == "algo_transfer":
            wires.append(
                RuntimeWireConfig(
                    id=edge.id,
                    type="algo_transfer",
                    from_agent_id=edge.source,
                    to_agent_id=edge.target,
                    description=edge.label,
                )
            )

    for index, node in enumerate(agent_nodes):
        wallet = record.wallets.get(node.id)
        if wallet is None:
            continue

        connected_tools = []
        for edge in record.definition.edges:
            if edge.wireType not in {"x402", "connection"}:
                continue

            is_incoming_tool_link = edge.target == node.id and edge.targetHandle == "tools"
            is_legacy_outgoing_tool_link = (
                edge.source == node.id
                and edge.sourceHandle == "agent-tools"
                and edge.targetHandle in {"agent-tool", "tools"}
            )

            if not is_incoming_tool_link and not is_legacy_outgoing_tool_link:
                continue

            tool_node_id = edge.source if is_incoming_tool_link else edge.target
            target_node = next((candidate for candidate in record.definition.nodes if candidate.id == tool_node_id), None)
            if target_node is None or target_node.type not in {"service", "api"}:
                continue
            if (target_node.data.serviceKind or "custom") in {"gemini", "openai", "claude", "mistral"}:
                continue
            connected_tools.append(
                AgentToolConfig(
                    node_id=target_node.id,
                    label=target_node.data.label,
                    service_kind=target_node.data.serviceKind or "custom",
                    service_url=target_node.data.serviceUrl,
                    price_algo=target_node.data.priceAlgo or 0,
                    upstream_x402=target_node.data.upstreamX402,
                    gmail_to=target_node.data.gmailTo,
                    crypto_symbols=target_node.data.cryptoSymbols,
                )
            )

        connected_agents = []
        for edge in record.definition.edges:
            if edge.source != node.id or edge.wireType != "a2a":
                continue
            target_node = next((candidate for candidate in record.definition.nodes if candidate.id == edge.target), None)
            if target_node is None or target_node.type != "agent":
                continue
            connected_agents.append(edge.target)

        agents.append(
            AgentRuntimeConfig(
                id=node.id,
                name=node.data.label,
                port=_port_for(record.pipeline_id, index),
                role=node.data.role,
                system_prompt=node.data.systemPrompt or "You are an autonomous AgentMesh node.",
                wallet_address=wallet.address,
                wallet_private_key=wallet.private_key,
                is_entry=node.id == entry_agent_id,
                price_algo=node.data.priceAlgo or 0,
                connected_agents=connected_agents,
                tools=connected_tools,
                api_key=node.data.apiKey,
            )
        )

    return PipelineRuntimeConfig(
        pipeline_id=record.pipeline_id,
        agents=agents,
        wires=wires,
    )


def _entry_agent_id(record: PipelineRecord) -> str:
    priced_agents = [
        node.id
        for node in record.definition.nodes
        if node.type == "agent" and (node.data.priceAlgo or 0) > 0
    ]
    if priced_agents:
        return priced_agents[0]

    first_agent = next((node.id for node in record.definition.nodes if node.type == "agent"), "")
    return first_agent


def _port_for(pipeline_id: str, index: int) -> int:
    base_port = int(os.getenv("AGENTMESH_AGENT_PORT_BASE", "8800"))
    digest = hashlib.sha1(pipeline_id.encode("utf-8")).hexdigest()
    offset = int(digest[:4], 16) % 180
    return base_port + (offset * 10) + index
