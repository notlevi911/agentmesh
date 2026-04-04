from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from x402.http.types import PaywallConfig
from x402.http.middleware.fastapi import PaymentMiddlewareASGI

from app.api.deps import get_x402_service
from app.api.routes import router

load_dotenv()

app = FastAPI(title="AgentMesh API", version="0.1.0")
x402_service = get_x402_service()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["PAYMENT-REQUIRED", "PAYMENT-FACILITATOR", "PAYMENT-RESPONSE"],
)

app.add_middleware(
    PaymentMiddlewareASGI,
    routes=x402_service.middleware_routes,
    server=x402_service.server,
    paywall_config=PaywallConfig(app_name="AgentMesh Internal Tools", testnet=True),
)

app.include_router(router)
