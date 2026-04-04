import os
from typing import Optional

from algosdk import transaction
from algosdk.v2client import algod

from app.storage.repository import WalletRecord


class AlgorandService:
    def __init__(self) -> None:
        self.algod_address = os.getenv("ALGOD_ADDRESS", "https://testnet-api.algonode.cloud")
        self.algod_token = os.getenv("ALGOD_TOKEN", "")
        self._client = algod.AlgodClient(self.algod_token, self.algod_address)
        self.testnet_usdc_asa_id = int(os.getenv("AGENTMESH_X402_ASSET_ID", "10458941"))

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

    def get_asset_balance(self, address: str, asset_id: Optional[int] = None) -> float:
        holding = self.get_asset_holding(address, asset_id)
        if not holding:
            return 0.0

        return round(holding.get("amount", 0) / 1_000_000, 6)

    def get_asset_holding(self, address: str, asset_id: Optional[int] = None) -> Optional[dict]:
        target_asset_id = asset_id or self.testnet_usdc_asa_id
        try:
            account_info = self._client.account_info(address)
        except Exception:
            return None

        for holding in account_info.get("assets", []):
            if holding.get("asset-id") == target_asset_id:
                return holding

        return None

    def is_asset_opted_in(self, address: str, asset_id: Optional[int] = None) -> bool:
        return self.get_asset_holding(address, asset_id) is not None

    def transfer_algo(
        self,
        sender_wallet: WalletRecord,
        receiver: str,
        amount_algo: float,
        note: Optional[str] = None,
    ) -> str:
        params = self._client.suggested_params()
        txn = transaction.PaymentTxn(
            sender=sender_wallet.address,
            sp=params,
            receiver=receiver,
            amt=int(amount_algo * 1_000_000),
            note=note.encode() if note else None,
        )
        signed = txn.sign(sender_wallet.private_key)
        txid = self._client.send_transaction(signed)
        transaction.wait_for_confirmation(self._client, txid, 4)
        return txid

    def ensure_asset_opt_in(self, wallet: WalletRecord, asset_id: Optional[int] = None) -> Optional[str]:
        target_asset_id = asset_id or self.testnet_usdc_asa_id
        if self.is_asset_opted_in(wallet.address, target_asset_id):
            return None

        params = self._client.suggested_params()
        txn = transaction.AssetTransferTxn(
            sender=wallet.address,
            sp=params,
            receiver=wallet.address,
            amt=0,
            index=target_asset_id,
            note=b"AgentMesh x402 opt-in",
        )
        signed = txn.sign(wallet.private_key)
        txid = self._client.send_transaction(signed)
        transaction.wait_for_confirmation(self._client, txid, 4)
        return txid
