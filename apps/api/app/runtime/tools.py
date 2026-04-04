import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx

from app.models.pipeline import PipelineNode
from app.storage.repository import PipelineRecord, WalletRecord
from app.x402.avm import create_x402_session, decode_settlement_header
from app.algorand.client import AlgorandService


@dataclass
class ToolResult:
    tool: str
    title: str
    summary: str
    raw: Dict
    payment_tx_id: Optional[str] = None
    payment_payer: Optional[str] = None
    payment_network: Optional[str] = None
    paid_via_x402: bool = False


class ToolRuntime:
    def __init__(self) -> None:
        self.algorand = AlgorandService()
        self.internal_base_url = os.getenv(
            "AGENTMESH_INTERNAL_API_BASE_URL",
            os.getenv("AGENTMESH_PUBLIC_BASE_URL", "http://127.0.0.1:8000"),
        ).rstrip("/")
        self.service_bootstrap_algo = float(os.getenv("AGENTMESH_X402_SERVICE_BOOTSTRAP_ALGO", "0.1"))
        self.asset_id = int(os.getenv("AGENTMESH_X402_ASSET_ID", "10458941"))
        self.payment_mode = os.getenv("AGENTMESH_PAYMENT_MODE", "algo").strip().lower()

    def search_duckduckgo(self, query: str) -> ToolResult:
        payload = self._get_json(
            "https://api.duckduckgo.com/",
            params={
                "q": query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            },
        )

        summary = payload.get("AbstractText") or ""
        heading = payload.get("Heading") or "DuckDuckGo"

        if not summary:
            related = self._flatten_related_topics(payload.get("RelatedTopics", []))
            if related:
                summary = " | ".join(related[:3])

        if not summary:
            summary = "DuckDuckGo returned no direct instant answer, but the search request completed."

        return ToolResult(tool="search", title=heading, summary=summary, raw=payload)

    def weather_openmeteo(self, query: str) -> ToolResult:
        location = self._extract_location(query)
        geodata = self._get_json(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={
                "name": location,
                "count": 1,
                "language": "en",
                "format": "json",
            },
        )
        results = geodata.get("results") or []
        if not results:
            raise RuntimeError(f"Could not find weather coordinates for '{location}'.")

        place = results[0]
        forecast = self._get_json(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,apparent_temperature,wind_speed_10m,weather_code",
                "timezone": "auto",
            },
        )
        current = forecast.get("current", {})
        summary = (
            f"{place['name']}: {current.get('temperature_2m', 'n/a')}°C, feels like "
            f"{current.get('apparent_temperature', 'n/a')}°C, wind "
            f"{current.get('wind_speed_10m', 'n/a')} km/h, weather code {current.get('weather_code', 'n/a')}."
        )

        return ToolResult(tool="weather", title=place["name"], summary=summary, raw={"place": place, "forecast": forecast})

    def choose_tools(
        self,
        query: str,
        available_tools: List[Dict],
        allowed_tools: List[str],
    ) -> List[str]:
        lowered = query.lower()
        allowed = set(allowed_tools or [])

        weather_intent = any(
            token in lowered
            for token in ["weather", "temperature", "rain", "forecast", "climate", "humid", "wind"]
        )
        search_intent = any(
            token in lowered
            for token in ["search", "news", "find", "look up", "sentiment", "btc", "price", "research"]
        ) or any(
            phrase in lowered
            for phrase in ["who is", "what is", "when did", "why did", "tell me about", "explain"]
        )

        candidates = [
            tool
            for tool in available_tools
            if not allowed or (tool.get("kind") in allowed or tool.get("id") in allowed)
        ]
        chosen: List[str] = []

        for tool in candidates:
            kind = tool.get("kind")
            label = (tool.get("label") or "").lower()
            url = (tool.get("url") or "").lower()
            if kind == "weather" and weather_intent:
                chosen.append(tool["id"])
            elif kind == "search" and search_intent:
                chosen.append(tool["id"])
            elif kind == "custom":
                if any(token in lowered for token in self._keywords_for_tool(label, url)):
                    chosen.append(tool["id"])

        if not chosen:
            search_like = next((tool["id"] for tool in candidates if tool.get("kind") == "search"), None)
            custom_like = next((tool["id"] for tool in candidates if tool.get("kind") == "custom"), None)
            weather_like = next((tool["id"] for tool in candidates if tool.get("kind") == "weather"), None)
            if search_like:
                chosen.append(search_like)
            elif custom_like:
                chosen.append(custom_like)
            elif weather_like:
                chosen.append(weather_like)

        return list(dict.fromkeys(chosen))

    def call_api_node_direct(self, node: PipelineNode, query: str) -> ToolResult:
        url = node.data.serviceUrl or ""
        kind = node.data.serviceKind or "custom"

        if kind == "weather" and ("open-meteo.com" in url or not url):
            return self.weather_openmeteo(query)

        if kind == "search" and ("duckduckgo.com" in url or not url):
            return self.search_duckduckgo(query)

        rendered_url, params = self._build_api_request(url, query, kind)
        payload = self._get_json(rendered_url, params=params)
        summary = self._summarize_payload(payload)

        return ToolResult(
            tool=kind,
            title=node.data.label,
            summary=summary,
            raw=payload,
        )

    def call_api_node_paid(
        self,
        record: PipelineRecord,
        payer_wallet: WalletRecord,
        node: PipelineNode,
        query: str,
    ) -> ToolResult:
        payee_wallet = record.wallets.get(node.id)
        if payee_wallet is None:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling x402.".format(
                    label=node.data.label
                )
            )

        self._prepare_x402_wallets(payer_wallet=payer_wallet, payee_wallet=payee_wallet)

        endpoint = "{base}/internal/x402/{pipeline_id}/{node_id}/invoke".format(
            base=self.internal_base_url,
            pipeline_id=record.pipeline_id,
            node_id=node.id,
        )

        session = create_x402_session(payer_wallet, algod_url=self.algorand.algod_address)
        try:
            response = session.get(endpoint, params={"query": query}, timeout=30)
            response.raise_for_status()
            settlement = decode_settlement_header(response.headers.get("PAYMENT-RESPONSE"))
            payload = response.json()
        finally:
            session.close()
        result = ToolResult(
            tool=payload.get("tool", node.data.serviceKind or "custom"),
            title=payload.get("title", node.data.label),
            summary=payload.get("summary", "x402 API call completed."),
            raw=payload.get("raw", {}),
            paid_via_x402=settlement is not None,
        )

        if settlement:
            result.payment_tx_id = settlement.transaction
            result.payment_payer = settlement.payer
            result.payment_network = settlement.network

        return result

    def call_api_node_algo_paid(
        self,
        record: PipelineRecord,
        payer_wallet: WalletRecord,
        node: PipelineNode,
        query: str,
    ) -> ToolResult:
        payee_wallet = record.wallets.get(node.id)
        if payee_wallet is None:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling paid execution.".format(
                    label=node.data.label
                )
            )

        self._prepare_algo_service_wallet(payer_wallet=payer_wallet, payee_wallet=payee_wallet)

        amount_algo = float(node.data.priceAlgo or 0)
        txid = self.algorand.transfer_algo(
            sender_wallet=payer_wallet,
            receiver=payee_wallet.address,
            amount_algo=amount_algo,
            note="AgentMesh paid API call",
        )
        result = self.call_api_node_direct(node, query)
        result.payment_tx_id = txid
        result.payment_payer = payer_wallet.address
        result.payment_network = "algorand-testnet"
        return result

    def _build_api_request(self, url: str, query: str, kind: str) -> Tuple[str, Dict]:
        if "{{query}}" in url:
            return url.replace("{{query}}", query), {}

        if "{{query_urlencoded}}" in url:
            return url.replace("{{query_urlencoded}}", urlencode({"q": query})[2:]), {}

        if "{{location}}" in url:
            return url.replace("{{location}}", self._extract_location(query)), {}

        params: Dict[str, str] = {"query": query}
        if kind == "weather":
            params["location"] = self._extract_location(query)
        else:
            params["q"] = query
        return url, params

    def _summarize_payload(self, payload: Dict) -> str:
        for key in ["summary", "result", "answer", "output", "message", "text", "response"]:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        flattened = []
        for key, value in payload.items():
            if isinstance(value, (str, int, float, bool)):
                flattened.append(f"{key}: {value}")
            if len(flattened) == 4:
                break

        if flattened:
            return " | ".join(flattened)

        return "API call completed successfully, but the response was mostly structured JSON."

    def _extract_location(self, query: str) -> str:
        match = re.search(r"\b(?:in|for|at|of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)", query)
        if match:
            return match.group(1).strip()

        lowercase_match = re.search(r"\b(?:in|for|at|of)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)", query)
        if lowercase_match:
            return lowercase_match.group(1).strip()

        return "Africa" if "africa" in query.lower() else "Bengaluru"

    def _keywords_for_tool(self, label: str, url: str) -> List[str]:
        tokens = re.findall(r"[a-z0-9]+", f"{label} {url}")
        return [token for token in tokens if len(token) > 3]

    def _get_json(self, url: str, params: Optional[Dict] = None) -> Dict:
        with httpx.Client(timeout=15.0, headers={"User-Agent": "AgentMesh/0.1"}) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            return response.json()

    def _prepare_x402_wallets(
        self,
        payer_wallet: WalletRecord,
        payee_wallet: WalletRecord,
    ) -> None:
        self._ensure_opted_in_with_algo(wallet=payer_wallet)

        if self.algorand.get_asset_balance(payer_wallet.address, self.asset_id) <= 0:
            raise RuntimeError(
                "Agent wallet {address} is opted in but has no testnet USDC for x402. "
                "Fund it from https://dispenser.testnet.aws.algodev.network/ and try again.".format(
                    address=payer_wallet.address
                )
            )

        if self.algorand.get_balance_algo(payee_wallet.address) < 0.002:
            self.algorand.transfer_algo(
                sender_wallet=payer_wallet,
                receiver=payee_wallet.address,
                amount_algo=self.service_bootstrap_algo,
                note="AgentMesh x402 service bootstrap",
            )

        self._ensure_opted_in_with_algo(wallet=payee_wallet)

    def _ensure_opted_in_with_algo(self, wallet: WalletRecord) -> None:
        if self.algorand.is_asset_opted_in(wallet.address, self.asset_id):
            return

        if self.algorand.get_balance_algo(wallet.address) < 0.002:
            raise RuntimeError(
                "Wallet {address} needs a little testnet ALGO before it can opt into USDC for x402.".format(
                    address=wallet.address
                )
            )

        self.algorand.ensure_asset_opt_in(wallet, self.asset_id)

    def _prepare_algo_service_wallet(
        self,
        payer_wallet: WalletRecord,
        payee_wallet: WalletRecord,
    ) -> None:
        current_balance = self.algorand.get_balance_algo(payee_wallet.address)
        required_balance = max(self.service_bootstrap_algo, 0.1)
        if current_balance >= required_balance:
            return

        top_up = round(required_balance - current_balance, 6)
        if top_up <= 0:
            return

        self.algorand.transfer_algo(
            sender_wallet=payer_wallet,
            receiver=payee_wallet.address,
            amount_algo=top_up,
            note="AgentMesh service min balance bootstrap",
        )

    def _flatten_related_topics(self, related_topics: List[Dict]) -> List[str]:
        items: List[str] = []
        for topic in related_topics:
            if "Text" in topic:
                items.append(topic["Text"])
            elif "Topics" in topic:
                items.extend(self._flatten_related_topics(topic["Topics"]))
        return items
