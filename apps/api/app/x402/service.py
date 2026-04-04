import os
from typing import Optional, Tuple

from fastapi.responses import JSONResponse
from x402 import x402ResourceServer
from x402.http import FacilitatorConfig, HTTPFacilitatorClient, PaymentOption
from x402.http.types import RouteConfig
from x402.mechanisms.avm import ALGORAND_TESTNET_CAIP2
from x402.mechanisms.avm.exact import register_exact_avm_server

from app.algorand.client import AlgorandService
from app.models.pipeline import PaymentRequiredResponse
from app.storage.repository import LocalPipelineRepository, PipelineRecord


class X402Service:
    def __init__(
        self,
        repository: LocalPipelineRepository,
        algorand_service: AlgorandService,
    ) -> None:
        self.repository = repository
        self.algorand_service = algorand_service
        self.facilitator_url = self._normalize_facilitator_url(
            os.getenv("GOPLAUSIBLE_FACILITATOR_URL", "https://facilitator.goplausible.xyz")
        )
        self.asset_id = str(os.getenv("AGENTMESH_X402_ASSET_ID", "10458941"))
        facilitator = HTTPFacilitatorClient(FacilitatorConfig(url=self.facilitator_url))
        self.server = x402ResourceServer(facilitator)
        register_exact_avm_server(self.server, ALGORAND_TESTNET_CAIP2)
        self.middleware_routes = {
            "GET /internal/x402/[pipeline_id]/[node_id]/invoke": RouteConfig(
                accepts=[
                    PaymentOption(
                        scheme="exact",
                        pay_to=self._tool_pay_to,
                        price=self._tool_price,
                        network=ALGORAND_TESTNET_CAIP2,
                    )
                ],
                description="AgentMesh internal x402 tool execution",
            )
        }

    def requires_payment(self, payment_response: Optional[str], demo_paid: Optional[str]) -> bool:
        if demo_paid and demo_paid.lower() == "true":
            return False

        if payment_response:
            return False

        return True

    def payment_required_response(self, record: PipelineRecord) -> JSONResponse:
        payload = PaymentRequiredResponse(
            pipelineId=record.pipeline_id,
            amountAlgo=record.price_algo,
            wallet=record.payment_wallet or "",
            network=record.definition.network,
            facilitator=self.facilitator_url,
            endpoint=record.endpoint,
            message="This pipeline is x402-gated. Pay the listed amount to start execution.",
        )
        return JSONResponse(
            status_code=402,
            content=payload.model_dump(),
            headers={
                "PAYMENT-REQUIRED": "true",
                "PAYMENT-FACILITATOR": self.facilitator_url,
            },
        )

    def _tool_pay_to(self, context) -> str:
        _, node_id = self._pipeline_and_node_from_path(context.path)
        record = self._get_record_from_path(context.path)
        node = next((candidate for candidate in record.definition.nodes if candidate.id == node_id), None)
        if node is None:
            raise KeyError("Unable to resolve x402 payee for {path}".format(path=context.path))

        if node.data.treasuryAddress:
            return node.data.treasuryAddress

        wallet = record.wallets.get(node_id)
        if wallet is None:
            raise KeyError("Node {node_id} has no x402 wallet".format(node_id=node_id))

        return wallet.address

    def _tool_price(self, context) -> dict:
        _, node_id = self._pipeline_and_node_from_path(context.path)
        record = self._get_record_from_path(context.path)
        node = next((candidate for candidate in record.definition.nodes if candidate.id == node_id), None)
        if node is None:
            raise KeyError("Unable to resolve x402 price for {path}".format(path=context.path))

        atomic_amount = max(1, int(round((node.data.priceAlgo or 0) * 1_000_000)))
        return {
            "amount": str(atomic_amount),
            "asset": self.asset_id,
            "extra": {"decimals": 6},
        }

    def _get_record_from_path(self, path: str) -> PipelineRecord:
        pipeline_id, _ = self._pipeline_and_node_from_path(path)
        record = self.repository.get_pipeline(pipeline_id)
        if record is None:
            raise KeyError("Pipeline {pipeline_id} not found".format(pipeline_id=pipeline_id))
        return record

    def _pipeline_and_node_from_path(self, path: str) -> Tuple[str, str]:
        cleaned = path.strip("/")
        parts = cleaned.split("/")
        if len(parts) < 5:
            raise KeyError("Unexpected x402 internal route: {path}".format(path=path))
        return parts[2], parts[3]

    def _normalize_facilitator_url(self, value: str) -> str:
        normalized = value.rstrip("/")
        if normalized == "https://x402.goplausible.xyz":
            return "https://facilitator.goplausible.xyz"
        return normalized
