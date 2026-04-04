import asyncio
import json
import re
import uuid
from typing import Awaitable, Callable, Dict, List, Optional

from app.algorand.client import AlgorandService
from app.llm.gemini import GeminiPlanner
from app.models.a2a import (
    A2AArtifact,
    A2ARequest,
    A2AResponse,
    A2AResult,
    AgentLogEntry,
    AgentRunRequest,
    AgentRuntimeConfig,
    AgentStatusResponse,
    PipelineRuntimeConfig,
)
from app.models.pipeline import PipelineNode
from app.runtime.tools import ToolResult, ToolRuntime
from app.storage.repository import PipelineRecord


SendA2AMessage = Callable[[str, str, PipelineRuntimeConfig, str], Awaitable[str]]


class AgentServiceRuntime:
    def __init__(
        self,
        agent_config: AgentRuntimeConfig,
        record: PipelineRecord,
        pipeline_config: PipelineRuntimeConfig,
        algorand: AlgorandService,
        tool_runtime: ToolRuntime,
        gemini: GeminiPlanner,
        send_a2a_message: SendA2AMessage,
    ) -> None:
        self.agent_config = agent_config
        self.record = record
        self.pipeline_config = pipeline_config
        self.algorand = algorand
        self.tool_runtime = tool_runtime
        self.gemini = gemini
        self.send_a2a_message = send_a2a_message
        self.state: str = "idle"
        self.logs: List[AgentLogEntry] = []
        self.last_result: Optional[str] = None

    async def run(self, payload: AgentRunRequest) -> Dict[str, str]:
        result = await self._reasoning_loop(payload.task)
        return {"result": result}

    async def message(self, payload: A2ARequest) -> A2AResponse:
        text = " ".join(part.text for part in payload.params.message.parts if part.type == "text").strip()
        result = await self._reasoning_loop(text, from_agent=payload.params.metadata.from_agent)
        return A2AResponse(
            id=payload.id,
            result=A2AResult(
                id=payload.params.id,
                artifacts=[A2AArtifact(parts=[{"type": "text", "text": result}])],
            ),
        )

    async def status(self) -> AgentStatusResponse:
        balance = await asyncio.to_thread(self.algorand.get_balance_algo, self.agent_config.wallet_address)
        return AgentStatusResponse(
            agent_id=self.agent_config.id,
            state=self.state,  # type: ignore[arg-type]
            wallet_address=self.agent_config.wallet_address,
            wallet_balance=balance,
            last_result=self.last_result,
            port=self.agent_config.port,
        )

    async def get_logs(self) -> List[AgentLogEntry]:
        return list(self.logs)

    async def _reasoning_loop(self, message: str, from_agent: Optional[str] = None) -> str:
        self.state = "running"
        self._log(
            "info",
            "Agent started reasoning.",
            {"from_agent": from_agent, "message": message},
        )

        balance = await asyncio.to_thread(self.algorand.get_balance_algo, self.agent_config.wallet_address)
        self._log("info", "Loaded wallet balance for reasoning context.", {"balance_algo": balance})

        tool_results: List[ToolResult] = []
        agent_results: Dict[str, str] = {}
        downstream_results: Dict[str, str] = {}

        if self.agent_config.connected_agents:
            specialist_agent_ids = [
                target_agent_id
                for target_agent_id in self.agent_config.connected_agents
                if not self._is_downstream_agent(target_agent_id)
            ]
            downstream_agent_ids = [
                target_agent_id
                for target_agent_id in self.agent_config.connected_agents
                if self._is_downstream_agent(target_agent_id)
            ]

            if specialist_agent_ids:
                parallel_messages = [
                    self.send_a2a_message(
                        target_agent_id,
                        self._delegation_message(target_agent_id, message),
                        self.pipeline_config,
                        self.agent_config.id,
                    )
                    for target_agent_id in specialist_agent_ids
                ]
                responses = await asyncio.gather(*parallel_messages, return_exceptions=True)
                for target_agent_id, response in zip(specialist_agent_ids, responses):
                    if isinstance(response, Exception):
                        self._log(
                            "error",
                            "A2A request failed.",
                            {"to_agent": target_agent_id, "error": str(response)},
                        )
                        continue
                    agent_results[target_agent_id] = response
                    self._log(
                        "success",
                        "A2A response received.",
                        {"to_agent": target_agent_id, "response": response},
                    )

        selected_tools = self._select_tools(message)
        selected_tools = sorted(selected_tools, key=lambda tool: 1 if tool.service_kind == "gmail" else 0)
        payer_wallet = self.record.wallets.get(self.agent_config.id)

        for tool in selected_tools:
            node = self._pipeline_node(tool.node_id)
            if node is None:
                continue

            tool_message = self._tool_message(message, tool_results, agent_results, tool.service_kind)
            self._log("info", "Executing tool.", {"tool": tool.label, "service_kind": tool.service_kind})
            try:
                if (tool.price_algo or 0) > 0 and payer_wallet is not None:
                    result = await asyncio.to_thread(
                        self.tool_runtime.call_api_node_algo_paid,
                        self.record,
                        payer_wallet,
                        node,
                        tool_message,
                    )
                else:
                    result = await asyncio.to_thread(
                        self.tool_runtime.call_api_node_direct,
                        node,
                        tool_message,
                    )
                tool_results.append(result)
                self._log(
                    "success",
                    "Tool completed.",
                    {
                        "tool": result.tool,
                        "summary": result.summary,
                        "tx_id": result.payment_tx_id,
                    },
                )
            except Exception as error:
                self._log(
                    "error",
                    "Tool execution failed.",
                    {"tool": tool.label, "error": str(error)},
                )

        downstream_agent_ids = [
            target_agent_id
            for target_agent_id in self.agent_config.connected_agents
            if self._is_downstream_agent(target_agent_id)
        ]
        for target_agent_id in downstream_agent_ids:
            try:
                downstream_message = self._downstream_handoff_message(
                    original_message=message,
                    tool_results=tool_results,
                    agent_results=agent_results,
                )
                response = await self.send_a2a_message(
                    target_agent_id,
                    downstream_message,
                    self.pipeline_config,
                    self.agent_config.id,
                )
                downstream_results[target_agent_id] = response
                self._log(
                    "success",
                    "Downstream response agent completed.",
                    {"to_agent": target_agent_id, "response": response},
                )
            except Exception as error:
                self._log(
                    "error",
                    "Downstream response agent failed.",
                    {"to_agent": target_agent_id, "error": str(error)},
                )

        final = await self._synthesize(message, tool_results, agent_results, downstream_results)
        self.last_result = final
        self.state = "completed"
        self._log("success", "Agent finished reasoning.", {"result": final})
        return final

    def _select_tools(self, message: str) -> List:
        available_tools = [
            {
                "id": tool.node_id,
                "label": tool.label,
                "kind": tool.service_kind,
                "url": tool.service_url or "",
            }
            for tool in self.agent_config.tools
        ]
        allowed_tools = [tool.service_kind for tool in self.agent_config.tools]

        if self.gemini.enabled and available_tools:
            try:
                plan = self.gemini.choose_tools(
                    query=message,
                    agent_prompt=self.agent_config.system_prompt,
                    available_tools=available_tools,
                    allowed_tools=allowed_tools,
                )
                selected_ids = set(plan.get("selected_tools", []))
                selected = [tool for tool in self.agent_config.tools if tool.node_id in selected_ids]
                if selected:
                    return selected
            except Exception as error:
                self._log("warning", "Gemini tool planning failed, falling back to heuristic router.", {"error": str(error)})

        selected_ids = set(
            self.tool_runtime.choose_tools(message, available_tools, allowed_tools)
        )
        return [tool for tool in self.agent_config.tools if tool.node_id in selected_ids]

    async def _synthesize(
        self,
        message: str,
        tool_results: List[ToolResult],
        agent_results: Dict[str, str],
        downstream_results: Dict[str, str],
    ) -> str:
        if downstream_results:
            return next(iter(downstream_results.values()))

        if self._is_trade_signal_agent():
            return self._compose_trade_signal(message, tool_results, agent_results)

        if self.gemini.enabled and (tool_results or agent_results):
            synthetic_tools = list(tool_results)
            for agent_id, result in agent_results.items():
                synthetic_tools.append(
                    ToolResult(
                        tool=f"agent:{agent_id}",
                        title=agent_id,
                        summary=result,
                        raw={"agent_id": agent_id, "result": result},
                    )
                )
            try:
                return self.gemini.summarize_final(
                    query=message,
                    analyzer_prompt=self.agent_config.system_prompt,
                    responder_prompt=self.agent_config.system_prompt,
                    tool_results=synthetic_tools,
                )
            except Exception as error:
                self._log("warning", "Gemini synthesis failed, falling back to string synthesis.", {"error": str(error)})

        parts: List[str] = []
        for agent_id, result in agent_results.items():
            parts.append(f"{agent_id}: {result}")
        for result in tool_results:
            parts.append(f"{result.tool}: {result.summary}")

        if not parts:
            return "No connected agents or tools returned useful output."

        return " | ".join(parts)

    def _compose_trade_signal(
        self,
        message: str,
        tool_results: List[ToolResult],
        agent_results: Dict[str, str],
    ) -> str:
        symbol = self._extract_symbol(message)
        combined_text = "\n".join(
            [result.summary for result in tool_results] + list(agent_results.values())
        )
        upper_text = combined_text.upper()

        if "SELL" in upper_text:
            signal = "SELL"
        elif "BUY" in upper_text:
            signal = "BUY"
        else:
            signal = "HOLD"

        confidence = self._extract_number(upper_text, r"CONFIDENCE\s+(\d{1,3})") or 64
        risk_payload = next((result.raw for result in tool_results if result.tool == "risk"), {})
        chart_payload = next((result.raw for result in tool_results if result.tool == "chart"), {})
        price_payload = next((result.raw for result in tool_results if result.tool == "crypto"), {})

        position_size = risk_payload.get("position_size") or "10%"
        stop_loss = risk_payload.get("stop_loss") or ("4%" if signal != "SELL" else "5%")
        take_profit = risk_payload.get("take_profit") or ("8%" if signal != "SELL" else "7%")

        thesis_parts = []
        if chart_payload:
            thesis_parts.append(
                "Technicals say {signal} with confidence {confidence}".format(
                    signal=chart_payload.get("signal", "HOLD"),
                    confidence=chart_payload.get("confidence", confidence),
                )
            )
        if risk_payload:
            thesis_parts.append(
                "Risk is {risk}".format(risk=risk_payload.get("risk_level", "MEDIUM"))
            )
        if price_payload:
            thesis_parts.append("Live pricing snapshot included")
        for agent_id, result in agent_results.items():
            thesis_parts.append(f"{agent_id}: {result}")

        output = {
            "token": symbol,
            "signal": signal,
            "confidence": int(confidence),
            "position_size": position_size,
            "stop_loss": stop_loss,
            "take_profit": take_profit,
            "thesis": "; ".join(thesis_parts) or "Signal synthesized from specialist agents.",
        }
        return json.dumps(output, indent=2)

    def _delegation_message(self, target_agent_id: str, message: str) -> str:
        wire = next(
            (
                candidate
                for candidate in self.pipeline_config.wires
                if candidate.type == "a2a"
                and candidate.from_agent_id == self.agent_config.id
                and candidate.to_agent_id == target_agent_id
            ),
            None,
        )
        if wire and wire.description:
            return f"{wire.description}\n\nIncoming task: {message}"
        return message

    def _downstream_handoff_message(
        self,
        original_message: str,
        tool_results: List[ToolResult],
        agent_results: Dict[str, str],
    ) -> str:
        context_lines = [f"{agent_id}: {result}" for agent_id, result in agent_results.items()]
        context_lines.extend([f"{result.tool}: {result.summary}" for result in tool_results])
        return (
            "You are receiving specialist outputs from the lead analyst.\n"
            "Create a polished final trade note, then use Gmail if available.\n\n"
            f"Original request: {original_message}\n\n"
            f"Collected context:\n{chr(10).join(context_lines)}"
        )

    def _tool_message(
        self,
        message: str,
        tool_results: List[ToolResult],
        agent_results: Dict[str, str],
        service_kind: str,
    ) -> str:
        if service_kind != "gmail":
            return message

        context_lines = [f"{agent_id}: {result}" for agent_id, result in agent_results.items()]
        context_lines.extend([f"{result.tool}: {result.summary}" for result in tool_results])
        if not context_lines:
            return (
                "Prepare an email based on this request.\n\n"
                f"Agent instructions:\n{self.agent_config.system_prompt}\n\n"
                f"Original request: {message}"
            )
        return (
            "Prepare an email based on this request.\n\n"
            f"Agent instructions:\n{self.agent_config.system_prompt}\n\n"
            f"Original request: {message}\n\n"
            f"Context:\n{chr(10).join(context_lines)}"
        )

    def _is_trade_signal_agent(self) -> bool:
        role = (self.agent_config.role or "").lower()
        prompt = self.agent_config.system_prompt.lower()
        return "lead" in role or "trade signal" in prompt or "lead analyst" in prompt

    def _is_downstream_agent(self, target_agent_id: str) -> bool:
        target = next((agent for agent in self.pipeline_config.agents if agent.id == target_agent_id), None)
        if target is None:
            return False
        role = (target.role or "").lower()
        prompt = target.system_prompt.lower()
        return any(token in role for token in ["responder", "report", "writer", "formatter"]) or any(
            token in prompt for token in ["final response", "final trade note", "report writer", "formatter"]
        )

    def _extract_symbol(self, message: str) -> str:
        try:
            payload = json.loads(message)
            token = payload.get("token")
            if isinstance(token, str) and token.strip():
                return token.strip().upper()
        except Exception:
            pass

        match = re.search(r"\b(ALGO|BTC|ETH|SOL|USDC|XRP|DOGE|BITCOIN|ETHEREUM|ALGORAND)\b", message, re.IGNORECASE)
        if not match:
            return "ALGO"
        token = match.group(1).upper()
        return {
            "BITCOIN": "BTC",
            "ETHEREUM": "ETH",
            "ALGORAND": "ALGO",
        }.get(token, token)

    def _extract_number(self, text: str, pattern: str) -> Optional[int]:
        match = re.search(pattern, text)
        if not match:
            return None
        try:
            return int(match.group(1))
        except Exception:
            return None

    def _pipeline_node(self, node_id: str) -> Optional[PipelineNode]:
        return next((node for node in self.record.definition.nodes if node.id == node_id), None)

    def _log(self, level: str, message: str, details: Optional[Dict] = None) -> None:
        self.logs.append(
            AgentLogEntry(
                level=level,  # type: ignore[arg-type]
                message=message,
                details=details or {},
            )
        )
