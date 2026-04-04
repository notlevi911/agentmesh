import os
from typing import Optional

from algosdk.v2client import algod


class AlgorandService:
    def __init__(self) -> None:
        self.algod_address = os.getenv("ALGOD_ADDRESS", "https://testnet-api.algonode.cloud")
        self.algod_token = os.getenv("ALGOD_TOKEN", "")
        self._client = algod.AlgodClient(self.algod_token, self.algod_address)

    def get_balance_algo(self, address: str) -> float:
        try:
            account_info = self._client.account_info(address)
            return round(account_info.get("amount", 0) / 1_000_000, 6)
        except Exception:
            return 0.0

    def faucet_url(self) -> str:
        return "https://bank.testnet.algorand.network/"

    def lora_account_url(self, address: Optional[str]) -> Optional[str]:
        if not address:
            return None

        return "https://lora.algokit.io/testnet/account/{address}".format(address=address)

