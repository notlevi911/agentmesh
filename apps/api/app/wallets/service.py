from algosdk import account

from app.storage.repository import WalletRecord


class WalletService:
    def create_agent_wallet(self, node_id: str) -> WalletRecord:
        private_key, address = account.generate_account()
        return WalletRecord(node_id=node_id, address=address, private_key=private_key)

