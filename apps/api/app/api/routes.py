from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.api.deps import get_orchestrator, get_x402_service
from app.models.a2a import MultiAgentBootResponse
from app.models.pipeline import (
    BalanceResponse,
    DeployPipelineRequest,
    DeployPipelineResponse,
    FundIntentResponse,
    InternalToolInvokeResponse,
    PipelineDetailResponse,
    PipelineSummaryResponse,
    RunPipelineRequest,
    RunPipelineResponse,
)
from app.orchestrator.service import PipelineOrchestrator
from app.x402.service import X402Service

router = APIRouter()


@router.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@router.post("/api/pipelines/deploy", response_model=DeployPipelineResponse)
def deploy_pipeline(
    payload: DeployPipelineRequest,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> DeployPipelineResponse:
    return orchestrator.deploy(payload)


@router.post("/api/pipelines/{pipeline_id}/agents/boot", response_model=MultiAgentBootResponse)
def boot_pipeline_agents(
    pipeline_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> MultiAgentBootResponse:
    try:
        return orchestrator.boot_multi_agent(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/api/pipelines/{pipeline_id}/agents/status")
def pipeline_agent_statuses(
    pipeline_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
):
    try:
        return orchestrator.multi_agent_statuses(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/api/pipelines/{pipeline_id}/runtime-config")
def pipeline_runtime_config(
    pipeline_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
):
    try:
        return orchestrator.runtime_config(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/api/pipelines", response_model=list[PipelineSummaryResponse])
def list_pipelines(
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> list[PipelineSummaryResponse]:
    return orchestrator.list_pipelines()


@router.get("/api/pipelines/{pipeline_id}", response_model=PipelineDetailResponse)
def pipeline_detail(
    pipeline_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> PipelineDetailResponse:
    try:
        return orchestrator.pipeline_detail(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/api/pipelines/{pipeline_id}/balances", response_model=BalanceResponse)
def pipeline_balances(
    pipeline_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> BalanceResponse:
    try:
        return orchestrator.balances(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get("/api/pipelines/{pipeline_id}/nodes/{node_id}/fund", response_model=FundIntentResponse)
def fund_node(
    pipeline_id: str,
    node_id: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> FundIntentResponse:
    try:
        return orchestrator.fund_intent(pipeline_id, node_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.get(
    "/internal/x402/{pipeline_id}/{node_id}/invoke",
    response_model=InternalToolInvokeResponse,
)
def invoke_internal_tool(
    pipeline_id: str,
    node_id: str,
    query: str,
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
) -> InternalToolInvokeResponse:
    try:
        return orchestrator.invoke_internal_tool(pipeline_id, node_id, query)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))


@router.post("/{pipeline_id}/run", response_model=RunPipelineResponse)
def run_pipeline(
    pipeline_id: str,
    payload: RunPipelineRequest,
    payment_response: Optional[str] = Header(default=None, alias="Payment-Response"),
    demo_paid: Optional[str] = Header(default=None, alias="X-AgentMesh-Demo-Paid"),
    orchestrator: PipelineOrchestrator = Depends(get_orchestrator),
    x402: X402Service = Depends(get_x402_service),
):
    try:
        record = orchestrator.get_record(pipeline_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error))

    if x402.requires_payment(payment_response=payment_response, demo_paid=demo_paid):
        return x402.payment_required_response(record)

    settlement_mode = "demo" if demo_paid and demo_paid.lower() == "true" else "payment_response"
    return orchestrator.execute(
        pipeline_id=pipeline_id,
        query=payload.query,
        settlement_mode=settlement_mode,
    )
