import os
import secrets
from dataclasses import replace
from typing import List, Optional

from app.a2a.orchestrator import MultiAgentOrchestrator
from app.a2a.protocol import build_runtime_config
from app.algorand.client import AlgorandService
from app.models.pipeline import (
    BalanceResponse,
    DeployPipelineRequest,
    DeployPipelineResponse,
    DeployedNode,
    FundIntentResponse,
    InternalToolInvokeResponse,
    PipelineDetailResponse,
    PipelineSummaryResponse,
    RunPipelineResponse,
    RuntimeLog,
    WalletBalance,
)
from app.runtime.executor import RuntimeExecutor
from app.storage.repository import LocalPipelineRepository, PipelineRecord
from app.wallets.service import WalletService

MODEL_SERVICE_KINDS = {"gemini", "openai", "claude", "mistral"}


class PipelineOrchestrator:
    def __init__(
        self,
        repository: LocalPipelineRepository,
        wallet_service: WalletService,
        algorand_service: AlgorandService,
        runtime: RuntimeExecutor,
        multi_agent: MultiAgentOrchestrator,
    ) -> None:
        self.repository = repository
        self.wallet_service = wallet_service
        self.algorand_service = algorand_service
        self.runtime = runtime
        self.multi_agent = multi_agent
        self.public_base_url = os.getenv("AGENTMESH_PUBLIC_BASE_URL", "http://localhost:8000").rstrip(
            "/"
        )

    def deploy(self, definition: DeployPipelineRequest) -> DeployPipelineResponse:
        self._validate_definition(definition)
        pipeline_id = "pm_{token}".format(token=secrets.token_hex(4))
        entrypoint_agent = self._entrypoint_agent(definition)
        price_algo = entrypoint_agent.data.priceAlgo if entrypoint_agent else 0.0
        endpoint = "{base}/{pipeline_id}/run".format(
            base=self.public_base_url,
            pipeline_id=pipeline_id,
        )

        deployed_nodes: List[DeployedNode] = []
        wallets = {}
        logs: List[RuntimeLog] = [
            RuntimeLog(level="info", message="Deploy started. Minting agent wallets and binding endpoint.")
        ]

        for node in definition.nodes:
            needs_wallet = node.type == "agent"

            if needs_wallet:
                wallet = self.wallet_service.create_agent_wallet(node.id)
                wallets[node.id] = wallet
                balance = self.algorand_service.get_balance_algo(wallet.address)
                logs.append(
                    RuntimeLog(
                        level="success",
                        nodeId=node.id,
                        eventType="done",
                        message="{label} wallet created: {address}".format(
                            label=node.data.label,
                            address=wallet.address,
                        ),
                        output=(
                            "Treasury wallet: {address}".format(address=node.data.treasuryAddress)
                            if node.data.treasuryAddress
                            else None
                        ),
                    )
                )
                deployed_nodes.append(
                    DeployedNode(
                        id=node.id,
                        type=node.type,
                        walletAddress=wallet.address,
                        balanceAlgo=balance,
                        explorerUrl=self.algorand_service.lora_account_url(wallet.address),
                    )
                )
            else:
                deployed_nodes.append(DeployedNode(id=node.id, type=node.type))

        payment_wallet = wallets.get(entrypoint_agent.id).address if entrypoint_agent else None

        logs.append(
            RuntimeLog(
                level="success",
                eventType="done",
                message="Pipeline endpoint reserved at {endpoint}".format(endpoint=endpoint),
            )
        )

        record = PipelineRecord(
            pipeline_id=pipeline_id,
            definition=definition,
            endpoint=endpoint,
            price_algo=price_algo,
            payment_wallet=payment_wallet,
            wallets=wallets,
        )
        self.repository.save_pipeline(record)

        return DeployPipelineResponse(
            pipelineId=pipeline_id,
            endpoint=endpoint,
            priceAlgo=price_algo,
            network=definition.network,
            paymentWallet=payment_wallet,
            loraUrl=self.algorand_service.lora_account_url(payment_wallet),
            nodes=deployed_nodes,
            logs=logs,
        )

    def balances(self, pipeline_id: str) -> BalanceResponse:
        record = self._get_record(pipeline_id)
        balances: List[WalletBalance] = []

        for node_id, wallet in record.wallets.items():
            balances.append(
                WalletBalance(
                    nodeId=node_id,
                    address=wallet.address,
                    balanceAlgo=self.algorand_service.get_balance_algo(wallet.address),
                    explorerUrl=self.algorand_service.lora_account_url(wallet.address),
                )
            )

        return BalanceResponse(pipelineId=pipeline_id, balances=balances)

    def list_pipelines(self) -> List[PipelineSummaryResponse]:
        records = sorted(
            self.repository.list_pipelines().values(),
            key=lambda record: record.pipeline_id,
            reverse=True,
        )
        return [
            PipelineSummaryResponse(
                pipelineId=record.pipeline_id,
                name=record.definition.name,
                endpoint=record.endpoint,
                network=record.definition.network,
                priceAlgo=record.price_algo,
                paymentWallet=record.payment_wallet,
                nodeCount=len(record.definition.nodes),
                wireCount=len(record.definition.edges),
                runCount=len(record.runs),
            )
            for record in records
        ]

    def pipeline_detail(self, pipeline_id: str) -> PipelineDetailResponse:
        record = self._get_record(pipeline_id)
        deployed_nodes: List[DeployedNode] = []

        for node in record.definition.nodes:
            wallet = record.wallets.get(node.id)
            if wallet is None:
                deployed_nodes.append(DeployedNode(id=node.id, type=node.type))
                continue

            deployed_nodes.append(
                DeployedNode(
                    id=node.id,
                    type=node.type,
                    walletAddress=wallet.address,
                    balanceAlgo=self.algorand_service.get_balance_algo(wallet.address),
                    explorerUrl=self.algorand_service.lora_account_url(wallet.address),
                )
            )

        return PipelineDetailResponse(
            pipelineId=record.pipeline_id,
            definition=record.definition,
            endpoint=record.endpoint,
            priceAlgo=record.price_algo,
            network=record.definition.network,
            paymentWallet=record.payment_wallet,
            loraUrl=self.algorand_service.lora_account_url(record.payment_wallet),
            nodes=deployed_nodes,
        )

    def fund_intent(self, pipeline_id: str, node_id: str) -> FundIntentResponse:
        record = self._get_record(pipeline_id)
        wallet = record.wallets.get(node_id)
        if wallet is None:
            raise KeyError("Node {node_id} has no deploy-time wallet".format(node_id=node_id))

        return FundIntentResponse(
            pipelineId=pipeline_id,
            nodeId=node_id,
            address=wallet.address,
            faucetUrl=self.algorand_service.faucet_url(),
            loraUrl=self.algorand_service.lora_account_url(wallet.address),
            qrValue=wallet.address,
        )

    def execute(
        self,
        pipeline_id: str,
        query: Optional[str],
        settlement_mode: str,
        definition_override: Optional[DeployPipelineRequest] = None,
    ) -> RunPipelineResponse:
        record = self._get_record(pipeline_id)
        effective_record = self._record_with_override(record, definition_override)
        self._validate_definition(effective_record.definition)
        if self.multi_agent.supports(effective_record):
            response = self.multi_agent.execute(
                record=effective_record,
                query=query or "analyze BTC sentiment",
                settlement_mode=settlement_mode,
            )
        else:
            response = self.runtime.execute(
                record=effective_record,
                query=query or "analyze BTC sentiment",
                settlement_mode=settlement_mode,
            )
        self.repository.save_run(pipeline_id, response)
        return response

    def boot_multi_agent(self, pipeline_id: str):
        return self.multi_agent.boot_pipeline_agents(pipeline_id)

    def multi_agent_statuses(self, pipeline_id: str):
        return self.multi_agent.agent_statuses_sync(pipeline_id)

    def runtime_config(self, pipeline_id: str):
        record = self._get_record(pipeline_id)
        return build_runtime_config(record)

    def get_record(self, pipeline_id: str) -> PipelineRecord:
        return self._get_record(pipeline_id)

    def invoke_internal_tool(self, pipeline_id: str, node_id: str, query: str) -> InternalToolInvokeResponse:
        record = self._get_record(pipeline_id)
        result = self.runtime.invoke_tool(record, node_id=node_id, query=query)
        return InternalToolInvokeResponse(
            tool=result.tool,
            title=result.title,
            summary=result.summary,
            raw=result.raw,
        )

    def _get_record(self, pipeline_id: str) -> PipelineRecord:
        record = self.repository.get_pipeline(pipeline_id)
        if record is None:
            raise KeyError("Pipeline {pipeline_id} not found".format(pipeline_id=pipeline_id))
        return record

    def _validate_definition(self, definition: DeployPipelineRequest) -> None:
        node_map = {node.id: node for node in definition.nodes}
        agent_nodes = [node for node in definition.nodes if node.type == "agent"]

        if not agent_nodes:
            raise ValueError("Add at least one AI Agent before deploying this workflow.")

        for agent in agent_nodes:
            model_edges = [
                edge
                for edge in definition.edges
                if edge.target == agent.id
                and edge.targetHandle == "model"
                and edge.wireType == "connection"
            ]

            if not model_edges:
                raise ValueError(
                    'Connect an AI model to "{label}" before deploying.'.format(
                        label=agent.data.label
                    )
                )

            if len(model_edges) > 1:
                raise ValueError(
                    '"{label}" has multiple AI model connections. Keep only one model per agent.'.format(
                        label=agent.data.label
                    )
                )

            model_node = node_map.get(model_edges[0].source)
            if (
                model_node is None
                or model_node.type not in {"service", "api"}
                or (model_node.data.serviceKind or "custom") not in MODEL_SERVICE_KINDS
            ):
                raise ValueError(
                    '"{label}" must be connected to a valid AI model node.'.format(
                        label=agent.data.label
                    )
                )

            if not (model_node.data.apiKey or "").strip():
                raise ValueError(
                    'Add an API key to "{model}" before deploying "{agent}".'.format(
                        model=model_node.data.label,
                        agent=agent.data.label,
                    )
                )

    def _entrypoint_agent(self, definition: DeployPipelineRequest):
        priced_agents = [
            node
            for node in definition.nodes
            if node.type == "agent" and node.data.priceAlgo and node.data.priceAlgo > 0
        ]
        if priced_agents:
            return priced_agents[0]

        for node in definition.nodes:
            if node.type == "agent":
                return node

        return None

    def _record_with_override(
        self,
        record: PipelineRecord,
        definition_override: Optional[DeployPipelineRequest],
    ) -> PipelineRecord:
        if definition_override is None:
            return record

        return replace(record, definition=definition_override)
