import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx

from app.models.pipeline import PipelineNode


@dataclass
class ToolResult:
    tool: str
    title: str
    summary: str
    raw: Dict


class ToolRuntime:
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

    def call_api_node(self, node: PipelineNode, query: str) -> ToolResult:
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

    def _flatten_related_topics(self, related_topics: List[Dict]) -> List[str]:
        items: List[str] = []
        for topic in related_topics:
            if "Text" in topic:
                items.append(topic["Text"])
            elif "Topics" in topic:
                items.extend(self._flatten_related_topics(topic["Topics"]))
        return items
