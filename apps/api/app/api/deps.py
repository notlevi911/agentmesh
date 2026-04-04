from functools import lru_cache

from app.algorand.client import AlgorandService
from app.orchestrator.service import PipelineOrchestrator
from app.runtime.executor import RuntimeExecutor
from app.storage.repository import InMemoryPipelineRepository
from app.wallets.service import WalletService
from app.x402.service import X402Service


@lru_cache
def get_repository() -> InMemoryPipelineRepository:
    return InMemoryPipelineRepository()


@lru_cache
def get_wallet_service() -> WalletService:
    return WalletService()


@lru_cache
def get_algorand_service() -> AlgorandService:
    return AlgorandService()


@lru_cache
def get_runtime_executor() -> RuntimeExecutor:
    return RuntimeExecutor()


@lru_cache
def get_orchestrator() -> PipelineOrchestrator:
    return PipelineOrchestrator(
        repository=get_repository(),
        wallet_service=get_wallet_service(),
        algorand_service=get_algorand_service(),
        runtime=get_runtime_executor(),
    )


@lru_cache
def get_x402_service() -> X402Service:
    return X402Service()

