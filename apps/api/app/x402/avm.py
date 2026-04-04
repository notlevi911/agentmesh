import base64
from dataclasses import dataclass

from algosdk import encoding
from x402 import x402ClientSync
from x402.http import decode_payment_response_header
from x402.http.clients import x402_requests
from x402.mechanisms.avm.exact import register_exact_avm_client

from app.storage.repository import WalletRecord


class AlgorandX402Signer:
    def __init__(self, wallet: WalletRecord) -> None:
        self._wallet = wallet

    @property
    def address(self) -> str:
        return self._wallet.address

    def sign_transactions(
        self,
        unsigned_txns: list[bytes],
        indexes_to_sign: list[int],
    ) -> list[bytes | None]:
        signed: list[bytes | None] = []

        for index, txn_bytes in enumerate(unsigned_txns):
            if index not in indexes_to_sign:
                signed.append(None)
                continue

            txn = encoding.msgpack_decode(base64.b64encode(txn_bytes).decode())
            signed_txn = txn.sign(self._wallet.private_key)
            signed.append(base64.b64decode(encoding.msgpack_encode(signed_txn)))

        return signed


@dataclass
class X402Settlement:
    transaction: str
    payer: str | None
    network: str | None


def create_x402_session(wallet: WalletRecord, algod_url: str):
    client = x402ClientSync()
    register_exact_avm_client(client, signer=AlgorandX402Signer(wallet), algod_url=algod_url)
    return x402_requests(client)


def decode_settlement_header(header_value: str | None) -> X402Settlement | None:
    if not header_value:
        return None

    response = decode_payment_response_header(header_value)
    return X402Settlement(
        transaction=response.transaction,
        payer=response.payer,
        network=response.network,
    )
