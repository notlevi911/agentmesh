import json
import os
import re
from typing import Dict, List, Optional

from google import genai

from app.runtime.tools import ToolResult


class GeminiPlanner:
    def __init__(self) -> None:
        self.env_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.model = os.getenv("AGENTMESH_LLM_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

    @property
    def enabled(self) -> bool:
        return bool(self.env_api_key)

    def choose_tools(
        self,
        query: str,
        agent_prompt: str,
        available_tools: List[Dict[str, str]],
        allowed_tools: List[str],
        api_key: Optional[str] = None,
        allow_env_fallback: bool = True,
    ) -> dict:
        client = self._resolve_client(api_key=api_key, allow_env_fallback=allow_env_fallback)

        prompt = """
You are planning tool usage for an autonomous Algorand agent workflow.

User task:
{query}

Agent instructions:
{agent_prompt}

Available tools:
{available_tools}

Allowed tools:
{allowed_tools}

Return strict JSON with this shape:
{{
  "selected_tools": ["tool_id"],
  "analysis": "short explanation of what the analyzer agent is doing",
  "handoff": "short handoff text for the next agent"
}}

Rules:
- Only pick from available tools.
- Prefer the smallest useful tool set.
- If no tool is needed, return an empty selected_tools list.
- Keep analysis and handoff concise.
""".strip().format(
            query=query,
            agent_prompt=agent_prompt or "No extra instructions.",
            available_tools="\n".join(
                [
                    "- id={id}, label={label}, kind={kind}, url={url}".format(
                        id=tool["id"],
                        label=tool["label"],
                        kind=tool["kind"],
                        url=tool["url"],
                    )
                    for tool in available_tools
                ]
            )
            or "none",
            allowed_tools=", ".join(allowed_tools) or "all available tools",
        )

        response = client.models.generate_content(model=self.model, contents=prompt)
        payload = self._extract_json(response.text or "")
        available_ids = {tool["id"] for tool in available_tools}
        selected = [tool for tool in payload.get("selected_tools", []) if tool in available_ids]

        return {
            "selected_tools": selected,
            "analysis": payload.get("analysis", "").strip(),
            "handoff": payload.get("handoff", "").strip(),
        }

    def summarize_final(
        self,
        query: str,
        analyzer_prompt: str,
        responder_prompt: str,
        tool_results: List[ToolResult],
        api_key: Optional[str] = None,
        allow_env_fallback: bool = True,
    ) -> str:
        client = self._resolve_client(api_key=api_key, allow_env_fallback=allow_env_fallback)

        tool_lines = "\n".join(
            [
                "- {tool}: {summary}".format(tool=result.tool, summary=result.summary)
                for result in tool_results
            ]
        )

        prompt = """
You are the final responder agent in AgentMesh.

Original task:
{query}

Analyzer instructions:
{analyzer_prompt}

Responder instructions:
{responder_prompt}

Tool results:
{tool_lines}

Return only the final user-facing answer. Keep it concise but useful.
""".strip().format(
            query=query,
            analyzer_prompt=analyzer_prompt or "No analyzer prompt provided.",
            responder_prompt=responder_prompt or "Summarize clearly for the caller.",
            tool_lines=tool_lines or "- No tool output available.",
        )

        response = client.models.generate_content(model=self.model, contents=prompt)
        return (response.text or "").strip()

    def _resolve_client(
        self,
        api_key: Optional[str] = None,
        allow_env_fallback: bool = True,
    ):
        if api_key is not None:
            normalized = api_key.strip()
            if not normalized:
                raise RuntimeError("Gemini planner is not configured on the connected model node.")
            return genai.Client(api_key=normalized)

        if allow_env_fallback and self.env_api_key:
            return genai.Client(api_key=self.env_api_key)

        raise RuntimeError("Gemini planner is not configured.")

    def _extract_json(self, text: str) -> dict:
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
            stripped = re.sub(r"\s*```$", "", stripped)

        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", stripped, re.DOTALL)
            if not match:
                return {}
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return {}
