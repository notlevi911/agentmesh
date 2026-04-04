import os
import re
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
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
    payment_payee: Optional[str] = None
    payment_network: Optional[str] = None
    paid_via_x402: bool = False
    payment_amount_algo: Optional[float] = None
    payment_amount_asset: Optional[str] = None
    payment_asset: Optional[str] = None
    payment_requirement: Optional[Dict] = None


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
        self.global_tool_payout_address = os.getenv("AGENTMESH_TOOL_PAYOUT_ADDRESS", "").strip()
        self.gmail_user = os.getenv("GMAIL_SMTP_USER", "").strip()
        self.gmail_password = os.getenv("GMAIL_SMTP_APP_PASSWORD", "").strip()
        self._coingecko_asset_map = {
            "BTC": "bitcoin",
            "ETH": "ethereum",
            "ALGO": "algorand",
            "SOL": "solana",
            "USDC": "usd-coin",
            "XRP": "ripple",
            "DOGE": "dogecoin",
        }

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

    def crypto_prices(self, query: str, symbols_hint: Optional[str] = None) -> ToolResult:
        requested_symbols = self._extract_crypto_symbols(query)
        if not requested_symbols and symbols_hint:
            requested_symbols = [token.strip().upper() for token in symbols_hint.split(",") if token.strip()]
        if not requested_symbols:
            requested_symbols = ["BTC", "ETH", "ALGO"]

        ids = [self._coingecko_asset_map[symbol] for symbol in requested_symbols if symbol in self._coingecko_asset_map]
        if not ids:
            raise RuntimeError("No supported crypto symbols were found in the request.")

        payload = self._get_json(
            "https://api.coingecko.com/api/v3/simple/price",
            params={
                "ids": ",".join(ids),
                "vs_currencies": "usd",
                "include_24hr_change": "true",
            },
        )

        summary_parts: List[str] = []
        for symbol in requested_symbols:
            asset_id = self._coingecko_asset_map.get(symbol)
            if not asset_id or asset_id not in payload:
                continue
            usd_value = payload[asset_id].get("usd")
            day_change = payload[asset_id].get("usd_24h_change")
            if usd_value is None:
                continue
            if isinstance(day_change, (int, float)):
                summary_parts.append(f"{symbol} ${usd_value:.4f} ({day_change:+.2f}% 24h)")
            else:
                summary_parts.append(f"{symbol} ${usd_value:.4f}")

        summary = ", ".join(summary_parts) if summary_parts else "Crypto price lookup completed."
        return ToolResult(tool="crypto", title="Crypto Prices", summary=summary, raw=payload)

    def chart_signal(self, query: str, symbols_hint: Optional[str] = None) -> ToolResult:
        symbol = self._primary_symbol(query, symbols_hint)
        asset_id = self._coingecko_asset_map.get(symbol)
        if not asset_id:
            raise RuntimeError(f"Chart signal does not support token '{symbol}'.")

        payload = self._get_json(
            f"https://api.coingecko.com/api/v3/coins/{asset_id}/market_chart",
            params={"vs_currency": "usd", "days": "7", "interval": "daily"},
        )
        prices = [point[1] for point in payload.get("prices", [])]
        if len(prices) < 3:
            raise RuntimeError("Not enough market chart data returned for technical analysis.")

        start_price = prices[0]
        end_price = prices[-1]
        mean_price = sum(prices) / len(prices)
        momentum_pct = ((end_price - start_price) / start_price) * 100 if start_price else 0
        extension_pct = ((end_price - mean_price) / mean_price) * 100 if mean_price else 0

        if momentum_pct > 4 and extension_pct > 1:
            signal = "BUY"
        elif momentum_pct < -4 and extension_pct < -1:
            signal = "SELL"
        else:
            signal = "HOLD"

        confidence = min(92, max(38, int(abs(momentum_pct) * 6 + abs(extension_pct) * 3 + 45)))
        summary = (
            f"{symbol} technical bias {signal} with confidence {confidence}. "
            f"7d momentum {momentum_pct:+.2f}% and price vs mean {extension_pct:+.2f}%."
        )
        return ToolResult(
            tool="chart",
            title="Chart Signal",
            summary=summary,
            raw={
                "symbol": symbol,
                "signal": signal,
                "confidence": confidence,
                "momentum_pct": round(momentum_pct, 2),
                "extension_pct": round(extension_pct, 2),
            },
        )

    def risk_model(self, query: str, symbols_hint: Optional[str] = None) -> ToolResult:
        symbol = self._primary_symbol(query, symbols_hint)
        asset_id = self._coingecko_asset_map.get(symbol)
        if not asset_id:
            raise RuntimeError(f"Risk model does not support token '{symbol}'.")

        payload = self._get_json(
            f"https://api.coingecko.com/api/v3/coins/{asset_id}/market_chart",
            params={"vs_currency": "usd", "days": "7", "interval": "daily"},
        )
        prices = [point[1] for point in payload.get("prices", [])]
        if len(prices) < 3:
            raise RuntimeError("Not enough market chart data returned for risk analysis.")

        latest_price = prices[-1]
        returns = []
        for left, right in zip(prices, prices[1:]):
            if left:
                returns.append(((right - left) / left) * 100)
        avg_abs_return = sum(abs(value) for value in returns) / len(returns) if returns else 0

        if avg_abs_return < 3:
            risk_level = "LOW"
            position_size = "18%"
            stop_loss = "3%"
            take_profit = "7%"
        elif avg_abs_return < 6:
            risk_level = "MEDIUM"
            position_size = "10%"
            stop_loss = "4.5%"
            take_profit = "9%"
        else:
            risk_level = "HIGH"
            position_size = "5%"
            stop_loss = "6%"
            take_profit = "12%"

        summary = (
            f"{symbol} risk is {risk_level}. Suggested position size {position_size}, "
            f"stop loss {stop_loss}, take profit {take_profit}, latest price ${latest_price:.4f}."
        )
        return ToolResult(
            tool="risk",
            title="Risk Model",
            summary=summary,
            raw={
                "symbol": symbol,
                "risk_level": risk_level,
                "position_size": position_size,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "latest_price": round(latest_price, 6),
                "avg_abs_return_pct": round(avg_abs_return, 2),
            },
        )

    def gmail_message(self, query: str, recipient: Optional[str]) -> ToolResult:
        to_address = self._extract_email_recipient(query) or (recipient or "").strip()
        if not to_address:
            raise RuntimeError(
                "No email recipient found. Put an email address in the prompt or set a fallback Gmail recipient in the node."
            )

        subject = self._gmail_subject(query)
        body = self._gmail_body(query)
        raw = {
            "to": to_address,
            "subject": subject,
            "body": body,
            "mode": "draft",
        }

        if self.gmail_user and self.gmail_password:
            message = EmailMessage()
            message["Subject"] = subject
            message["From"] = self.gmail_user
            message["To"] = to_address
            message.set_content(body)

            with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
                smtp.login(self.gmail_user, self.gmail_password)
                smtp.send_message(message)

            raw["mode"] = "sent"
            summary = "Email sent to {to} with subject '{subject}'.".format(
                to=to_address,
                subject=subject,
            )
        else:
            summary = "Email draft prepared for {to} with subject '{subject}'.".format(
                to=to_address,
                subject=subject,
            )

        return ToolResult(tool="gmail", title="Gmail", summary=summary, raw=raw)

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
            for token in ["search", "news", "find", "look up", "sentiment", "research"]
        ) or any(
            phrase in lowered
            for phrase in ["who is", "what is", "when did", "why did", "tell me about", "explain"]
        )
        crypto_intent = any(
            token in lowered
            for token in [
                "crypto",
                "bitcoin",
                "btc",
                "eth",
                "ethereum",
                "sol",
                "algo",
                "price",
                "prices",
                "token",
                "coin",
                "market cap",
            ]
        )
        chart_intent = any(
            token in lowered
            for token in ["chart", "technical", "momentum", "trend", "rsi", "support", "resistance"]
        )
        risk_intent = any(
            token in lowered
            for token in ["risk", "position size", "stop loss", "take profit", "volatility", "exposure"]
        )
        gmail_intent = any(
            token in lowered
            for token in ["email", "mail", "gmail", "send", "message", "@", "draft"]
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
            elif kind == "crypto" and crypto_intent:
                chosen.append(tool["id"])
            elif kind == "chart" and (chart_intent or crypto_intent):
                chosen.append(tool["id"])
            elif kind == "risk" and (risk_intent or crypto_intent):
                chosen.append(tool["id"])
            elif kind == "gmail" and gmail_intent:
                chosen.append(tool["id"])
            elif kind == "custom":
                if any(token in lowered for token in self._keywords_for_tool(label, url)):
                    chosen.append(tool["id"])

        if not chosen:
            crypto_like = next((tool["id"] for tool in candidates if tool.get("kind") == "crypto"), None)
            chart_like = next((tool["id"] for tool in candidates if tool.get("kind") == "chart"), None)
            risk_like = next((tool["id"] for tool in candidates if tool.get("kind") == "risk"), None)
            gmail_like = next((tool["id"] for tool in candidates if tool.get("kind") == "gmail"), None)
            search_like = next((tool["id"] for tool in candidates if tool.get("kind") == "search"), None)
            custom_like = next((tool["id"] for tool in candidates if tool.get("kind") == "custom"), None)
            weather_like = next((tool["id"] for tool in candidates if tool.get("kind") == "weather"), None)
            if gmail_like and gmail_intent:
                chosen.append(gmail_like)
            elif chart_like and chart_intent:
                chosen.append(chart_like)
            elif risk_like and risk_intent:
                chosen.append(risk_like)
            elif crypto_like and crypto_intent:
                chosen.append(crypto_like)
            elif search_like:
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

        if kind == "crypto":
            return self.crypto_prices(query, node.data.cryptoSymbols)

        if kind == "chart":
            return self.chart_signal(query, node.data.cryptoSymbols)

        if kind == "risk":
            return self.risk_model(query, node.data.cryptoSymbols)

        if kind == "gmail":
            return self.gmail_message(query, node.data.gmailTo)

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
        payee_address = self._resolve_tool_payee_address(record, node)
        payee_wallet = record.wallets.get(node.id)
        if not payee_address:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling x402.".format(
                    label=node.data.label
                )
            )

        if payee_wallet is None and not self.global_tool_payout_address:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling x402.".format(
                    label=node.data.label
                )
            )

        self._prepare_x402_wallets(
            payer_wallet=payer_wallet,
            payee_wallet=payee_wallet,
            payee_address=payee_address,
        )

        endpoint = "{base}/internal/x402/{pipeline_id}/{node_id}/invoke".format(
            base=self.internal_base_url,
            pipeline_id=record.pipeline_id,
            node_id=node.id,
        )

        payment_requirement = self._fetch_x402_requirement(
            endpoint=endpoint,
            query=query,
            payee_address=payee_address,
            amount_asset=int(round((node.data.priceAlgo or 0) * 1_000_000)),
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
            payment_payee=payee_address,
            payment_requirement=payment_requirement,
            payment_amount_asset=str(int(round((node.data.priceAlgo or 0) * 1_000_000))),
            payment_asset=str(self.asset_id),
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
        payee_address = self._resolve_tool_payee_address(record, node)
        payee_wallet = record.wallets.get(node.id)
        if not payee_address:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling paid execution.".format(
                    label=node.data.label
                )
            )

        if payee_wallet is None and not self.global_tool_payout_address:
            raise RuntimeError(
                "Node '{label}' does not have a payment wallet yet. Redeploy after enabling paid execution.".format(
                    label=node.data.label
                )
            )

        self._prepare_algo_service_wallet(
            payer_wallet=payer_wallet,
            payee_wallet=payee_wallet,
            payee_address=payee_address,
        )

        amount_algo = float(node.data.priceAlgo or 0)
        txid = self.algorand.transfer_algo(
            sender_wallet=payer_wallet,
            receiver=payee_address,
            amount_algo=amount_algo,
            note="AgentMesh paid API call",
        )
        result = self.call_api_node_direct(node, query)
        result.payment_tx_id = txid
        result.payment_payer = payer_wallet.address
        result.payment_payee = payee_address
        result.payment_network = "algorand-testnet"
        result.payment_amount_algo = amount_algo
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

    def _extract_crypto_symbols(self, query: str) -> List[str]:
        keyword_map = {
            "BTC": ["btc", "bitcoin"],
            "ETH": ["eth", "ethereum"],
            "ALGO": ["algo", "algorand"],
            "SOL": ["sol", "solana"],
            "USDC": ["usdc", "usd coin"],
            "XRP": ["xrp", "ripple"],
            "DOGE": ["doge", "dogecoin"],
        }
        lowered = query.lower()
        found = [
            symbol
            for symbol, keywords in keyword_map.items()
            if any(re.search(rf"\b{re.escape(keyword)}\b", lowered) for keyword in keywords)
        ]
        return found

    def _primary_symbol(self, query: str, symbols_hint: Optional[str] = None) -> str:
        found = self._extract_crypto_symbols(query)
        if found:
            return found[0]
        if symbols_hint:
            hinted = [token.strip().upper() for token in symbols_hint.split(",") if token.strip()]
            if hinted:
                return hinted[0]
        return "ALGO"

    def _gmail_subject(self, query: str) -> str:
        cleaned = re.sub(r"\s+", " ", query).strip()
        if len(cleaned) > 56:
            cleaned = cleaned[:53].rstrip() + "..."
        return f"AgentMesh update: {cleaned or 'workflow result'}"

    def _gmail_body(self, query: str) -> str:
        return (
            "Hello,\n\n"
            "The AgentMesh workflow generated this email based on the request below.\n\n"
            f"Request: {query.strip() or 'No request provided.'}\n\n"
            "This message was prepared by the Gmail tool node.\n\n"
            "Regards,\n"
            "AgentMesh"
        )

    def _extract_email_recipient(self, query: str) -> Optional[str]:
        match = re.search(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", query, re.IGNORECASE)
        if not match:
            return None
        return match.group(0).strip()

    def _get_json(self, url: str, params: Optional[Dict] = None) -> Dict:
        with httpx.Client(timeout=15.0, headers={"User-Agent": "AgentMesh/0.1"}) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            return response.json()

    def _prepare_x402_wallets(
        self,
        payer_wallet: WalletRecord,
        payee_wallet: Optional[WalletRecord],
        payee_address: str,
    ) -> None:
        self._ensure_opted_in_with_algo(wallet=payer_wallet)

        if self.algorand.get_asset_balance(payer_wallet.address, self.asset_id) <= 0:
            raise RuntimeError(
                "Agent wallet {address} is opted in but has no testnet USDC for x402. "
                "Fund it from https://dispenser.testnet.aws.algodev.network/ and try again.".format(
                    address=payer_wallet.address
                )
            )

        if payee_wallet is None:
            return

        if self.algorand.get_balance_algo(payee_address) < 0.002:
            self.algorand.transfer_algo(
                sender_wallet=payer_wallet,
                receiver=payee_address,
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
        payee_wallet: Optional[WalletRecord],
        payee_address: str,
    ) -> None:
        if payee_wallet is None:
            return

        current_balance = self.algorand.get_balance_algo(payee_address)
        required_balance = max(self.service_bootstrap_algo, 0.1)
        if current_balance >= required_balance:
            return

        top_up = round(required_balance - current_balance, 6)
        if top_up <= 0:
            return

        self.algorand.transfer_algo(
            sender_wallet=payer_wallet,
            receiver=payee_address,
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

    def _fetch_x402_requirement(
        self,
        endpoint: str,
        query: str,
        payee_address: str,
        amount_asset: int,
    ) -> Dict:
        with httpx.Client(timeout=15.0, headers={"User-Agent": "AgentMesh/0.1"}) as client:
            response = client.get(endpoint, params={"query": query}, follow_redirects=True)

        header_value = response.headers.get("payment-required") or response.headers.get("PAYMENT-REQUIRED")
        encoded_requirement = response.headers.get("x-payment-required") or response.headers.get("PAYMENT-REQUEST")

        return {
            "status": response.status_code,
            "phase": "payment_required" if response.status_code == 402 else "preflight",
            "scheme": "x402 exact",
            "network": "algorand-testnet",
            "asset": "USDC",
            "asset_id": str(self.asset_id),
            "amount_asset": str(amount_asset),
            "pay_to": payee_address,
            "endpoint": endpoint,
            "header_present": bool(header_value or encoded_requirement),
        }

    def _resolve_tool_payee_address(self, record: PipelineRecord, node: PipelineNode) -> Optional[str]:
        if self.global_tool_payout_address:
            return self.global_tool_payout_address
        if node.data.treasuryAddress:
            return node.data.treasuryAddress
        wallet = record.wallets.get(node.id)
        if wallet is not None:
            return wallet.address
        return None
