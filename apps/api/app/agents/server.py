from fastapi import FastAPI

from app.agents.runtime import AgentServiceRuntime
from app.models.a2a import A2ARequest, A2AResponse, AgentRunRequest, AgentStatusResponse


def create_agent_app(runtime: AgentServiceRuntime) -> FastAPI:
    app = FastAPI(title=f"AgentMesh Agent {runtime.agent_config.name}", version="0.1.0")

    @app.post("/run")
    async def run_agent(payload: AgentRunRequest) -> dict:
        return await runtime.run(payload)

    @app.post("/message", response_model=A2AResponse)
    async def message_agent(payload: A2ARequest) -> A2AResponse:
        return await runtime.message(payload)

    @app.get("/status", response_model=AgentStatusResponse)
    async def status_agent() -> AgentStatusResponse:
        return await runtime.status()

    @app.get("/logs")
    async def logs_agent() -> list:
        return await runtime.get_logs()

    return app
