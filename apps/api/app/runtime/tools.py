import json
import re
from dataclasses import dataclass
from typing import Dict, List
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass
class ToolResult:
    tool: str
    title: str
    summary: str
    raw: Dict


class ToolRuntime:
    def search_duckduckgo(self, query: str) -> ToolResult:
        params = urlencode(
            {
                "q": query,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            }
        )
        url = f"https://api.duckduckgo.com/?{params}"
        payload = self._get_json(url)

        summary = payload.get("AbstractText") or ""
        heading = payload.get("Heading") or "DuckDuckGo"

        if not summary:
            related = self._flatten_related_topics(payload.get("RelatedTopics", []))
            if related:
                summary = " | ".join(related[:3])

        if not summary:
            summary = "DuckDuckGo returned no direct instant answer, but the search request completed."

        return ToolResult(
            tool="search",
            title=heading,
            summary=summary,
            raw=payload,
        )

    def weather_openmeteo(self, query: str) -> ToolResult:
        location = self._extract_location(query)
        geo_url = "https://geocoding-api.open-meteo.com/v1/search?{params}".format(
            params=urlencode(
                {
                    "name": location,
                    "count": 1,
                    "language": "en",
                    "format": "json",
                }
            )
        )
        geodata = self._get_json(geo_url)
        results = geodata.get("results") or []
        if not results:
            raise RuntimeError(f"Could not find weather coordinates for '{location}'.")

        place = results[0]
        forecast_url = "https://api.open-meteo.com/v1/forecast?{params}".format(
            params=urlencode(
                {
                    "latitude": place["latitude"],
                    "longitude": place["longitude"],
                    "current": "temperature_2m,apparent_temperature,wind_speed_10m,weather_code",
                    "timezone": "auto",
                }
            )
        )
        forecast = self._get_json(forecast_url)
        current = forecast.get("current", {})
        summary = (
            f"{place['name']}: {current.get('temperature_2m', 'n/a')}°C, feels like "
            f"{current.get('apparent_temperature', 'n/a')}°C, wind "
            f"{current.get('wind_speed_10m', 'n/a')} km/h, weather code {current.get('weather_code', 'n/a')}."
        )

        return ToolResult(
            tool="weather",
            title=place["name"],
            summary=summary,
            raw={"place": place, "forecast": forecast},
        )

    def choose_tools(self, query: str, available_tools: List[str], allowed_tools: List[str]) -> List[str]:
        available = [tool for tool in available_tools if tool in allowed_tools or not allowed_tools]
        lowered = query.lower()
        chosen: List[str] = []
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

        if "weather" in available and weather_intent:
            chosen.append("weather")

        if "search" in available and search_intent:
            chosen.append("search")

        if not chosen and "search" in available:
            chosen.append("search")

        if not chosen and available:
            chosen.append(available[0])

        return chosen

    def _extract_location(self, query: str) -> str:
        match = re.search(r"\b(?:in|for|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)", query)
        if match:
            return match.group(1).strip()

        lowercase_match = re.search(r"\b(?:in|for|at)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)*)", query)
        if lowercase_match:
            return lowercase_match.group(1).strip()

        return "Bengaluru"

    def _get_json(self, url: str) -> Dict:
        request = Request(url, headers={"User-Agent": "AgentMesh/0.1"})
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))

    def _flatten_related_topics(self, related_topics: List[Dict]) -> List[str]:
        items: List[str] = []
        for topic in related_topics:
            if "Text" in topic:
                items.append(topic["Text"])
            elif "Topics" in topic:
                items.extend(self._flatten_related_topics(topic["Topics"]))
        return items
