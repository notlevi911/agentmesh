import os
from typing import Optional

from fastapi.responses import JSONResponse

from app.models.pipeline import PaymentRequiredResponse
from app.storage.repository import PipelineRecord


class X402Service:
    def __init__(self) -> None:
        self.facilitator_url = os.getenv(
            "GOPLAUSIBLE_FACILITATOR_URL", "https://x402.goplausible.xyz"
        )

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

