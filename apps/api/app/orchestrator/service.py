import os
import secrets
from typing import List, Optional

from app.algorand.client import AlgorandService
from app.models.pipeline import (
    BalanceResponse,
    DeployPipelineRequest,
    DeployPipelineResponse,
    DeployedNode,
    FundIntentResponse,
    InternalToolInvokeResponse,
    RunPipelineResponse,
    RuntimeLog,
    WalletBalance,
)
from app.runtime.executor import RuntimeExecutor
from app.storage.repository import LocalPipelineRepository, PipelineRecord
from app.wallets.service import WalletService


class PipelineOrchestrator:
    def __init__(
        self,
        repository: LocalPipelineRepository,
        wallet_service: WalletService,
        algorand_service: AlgorandService,
        runtime: RuntimeExecutor,
    ) -> None:
        self.repository = repository
        self.wallet_service = wallet_service
        self.algorand_service = algorand_service
        self.runtime = runtime
        self.public_base_url = os.getenv("AGENTMESH_PUBLIC_BASE_URL", "http://localhost:8000").rstrip(
            "/"
        )

    def deploy(self, definition: DeployPipelineRequest) -> DeployPipelineResponse:
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
            needs_wallet = node.type == "agent" or (
                node.type in {"service", "api"} and (node.data.priceAlgo > 0 or node.data.upstreamX402)
            )

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

    def execute(self, pipeline_id: str, query: Optional[str], settlement_mode: str) -> RunPipelineResponse:
        record = self._get_record(pipeline_id)
        response = self.runtime.execute(
            record=record,
            query=query or "analyze BTC sentiment",
            settlement_mode=settlement_mode,
        )
        self.repository.save_run(pipeline_id, response)
        return response

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
