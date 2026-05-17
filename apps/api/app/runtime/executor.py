from collections import defaultdict, deque
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.llm.gemini import GeminiPlanner
from app.models.pipeline import DeployPipelineRequest, PipelineNode, RunPipelineResponse, RuntimeLog
from app.runtime.tools import ToolResult, ToolRuntime
from app.storage.repository import PipelineRecord


class RuntimeExecutor:
    def __init__(self) -> None:
        self.tools = ToolRuntime()
        self.gemini = GeminiPlanner()

    def execute(self, record: PipelineRecord, query: str, settlement_mode: str) -> RunPipelineResponse:
        ordered_nodes = self._topological_nodes(record.definition)
        logs: List[RuntimeLog] = []

        if settlement_mode == "demo":
            logs.append(
                RuntimeLog(
                    level="warning",
                    message="Studio test mode bypassed the outer payment gate after a 402 preflight.",
                    eventType="progress",
                    details={
                        "mode": "demo",
                        "entrypoint": "pipeline run endpoint",
                        "x402_bypassed": True,
                        "studio_test": True,
                    },
                )
            )
        else:
            logs.append(
                RuntimeLog(
                    level="success",
                    message="Payment response header received. Pipeline execution has started.",
                    eventType="progress",
                    details={
                        "mode": "payment_response",
                        "entrypoint": "pipeline run endpoint",
                        "x402_verified": True,
                    },
                )
            )

        responder = self._agent_by_role(record.definition, "responder")
        analyzer = self._agent_by_role(record.definition, "analyzer") or self._first_agent(record.definition)
        analyzer_wallet = record.wallets.get(analyzer.id) if analyzer else None
        connected_tools = self._connected_tool_nodes(record.definition, analyzer.id if analyzer else None)
        allowed_tools = analyzer.data.enabledTools if analyzer and analyzer.data.enabledTools else []
        analyzer_api_key = self._node_api_key(analyzer)

        selected_tools: List[str] = []
        analyzer_analysis = ""
        handoff_text = ""
        llm_plan_completed = False

        if analyzer:
            self._append_log(
                logs,
                level="start",
                message="{label} received the workflow task.".format(label=analyzer.data.label),
                node_id=analyzer.id,
                output=query,
            )

        if analyzer and analyzer_api_key:
            try:
                plan = self.gemini.choose_tools(
                    query=query,
                    agent_prompt=analyzer.data.systemPrompt or "",
                    available_tools=[
                        {
                            "id": node.id,
                            "label": node.data.label,
                            "kind": node.data.serviceKind or "custom",
                            "url": node.data.serviceUrl or "",
                        }
                        for node in connected_tools
                    ],
                    allowed_tools=allowed_tools,
                    api_key=analyzer_api_key,
                    allow_env_fallback=False,
                )
                llm_plan_completed = True
                selected_tools = plan["selected_tools"]
                analyzer_analysis = plan["analysis"] or (
                    "Gemini planned the best tool path for the request."
                    if selected_tools
                    else "Gemini determined that no connected tool is needed for this request."
                )
                handoff_text = plan["handoff"] or (
                    "Analyzer prepared a concise handoff for the next node."
                    if selected_tools
                    else "Analyzer can answer directly without calling any connected tool."
                )
                self._append_log(
                    logs,
                    level="output",
                    message="{label} planned the workflow path.".format(label=analyzer.data.label),
                    node_id=analyzer.id,
                    output=analyzer_analysis,
                )
            except Exception as error:
                self._append_log(
                    logs,
                    level="warning",
                    message="Gemini planning failed, falling back to heuristic routing.",
                    output=str(error),
                )

        if not selected_tools and not llm_plan_completed:
            selected_tools = self.tools.choose_tools(
                query,
                [
                    {
                        "id": node.id,
                        "label": node.data.label,
                        "kind": node.data.serviceKind or "custom",
                        "url": node.data.serviceUrl or "",
                    }
                    for node in connected_tools
                ],
                allowed_tools,
            )
            if analyzer:
                analyzer_analysis = (
                    "Fallback router selected: {tools}.".format(
                        tools=", ".join(
                            [
                                self._node_by_id(record.definition, tool_id).data.label
                                for tool_id in selected_tools
                                if self._node_by_id(record.definition, tool_id)
                            ]
                        )
                    )
                    if selected_tools
                    else "Fallback router could not identify a usable tool."
                )
                handoff_text = "Analyzer gathered tool results and prepared context for the next node."
                self._append_log(
                    logs,
                    level="output",
                    message="{label} planned the workflow path.".format(label=analyzer.data.label),
                    node_id=analyzer.id,
                    output=analyzer_analysis,
                )

        selected_tools = self._sort_tools_for_execution(record.definition, selected_tools)

        for node in ordered_nodes:
            if node.type == "trigger":
                self._append_log(
                    logs,
                    level="done",
                    message="Trigger node activated from incoming API request.",
                    node_id=node.id,
                    details={
                        "request_query": query,
                    },
                )

        tool_results: List[ToolResult] = []
        for tool_id in selected_tools:
            service_node = self._node_by_id(record.definition, tool_id)
            if service_node is None or service_node.type not in {"service", "api"}:
                continue

            tool_query = query
            if service_node.data.serviceKind == "gmail" and tool_results:
                prior_context = " | ".join(
                    [f"{result.tool}: {result.summary}" for result in tool_results[-3:]]
                )
                tool_query = (
                    "Agent instructions: {prompt}\n"
                    "Original request: {query}\n"
                    "Relevant tool outputs: {context}\n"
                    "Generate the email message using this context."
                ).format(
                    prompt=(analyzer.data.systemPrompt if analyzer else "") or "",
                    query=query,
                    context=prior_context,
                )

            uses_upstream_x402 = bool(
                service_node.data.upstreamX402
                or ((service_node.data.priceAlgo or 0) > 0 and self.tools.payment_mode == "x402")
            )
            uses_algo_payment = bool((service_node.data.priceAlgo or 0) > 0 and not uses_upstream_x402)

            if service_node.data.upstreamX402:
                call_phrase = "Calling {label} as an upstream x402 API.".format(
                    label=service_node.data.label
                )
            elif uses_algo_payment:
                call_phrase = "Calling {label} with native ALGO payment of {price:.3f} ALGO.".format(
                    label=service_node.data.label,
                    price=service_node.data.priceAlgo or 0,
                )
            else:
                call_phrase = "Calling {label} as a free API.".format(label=service_node.data.label)
            self._append_log(logs, level="start", message=call_phrase, node_id=service_node.id)

            try:
                if uses_upstream_x402:
                    if analyzer_wallet is None:
                        raise RuntimeError("Analyzer agent has no wallet available to sign x402 payments.")
                    result = self.tools.call_api_node_paid(
                        record=record,
                        payer_wallet=analyzer_wallet,
                        node=service_node,
                        query=tool_query,
                    )
                    if result.payment_requirement:
                        self._append_log(
                            logs,
                            level="progress",
                            message="{label} returned x402 payment requirements.".format(
                                label=service_node.data.label
                            ),
                            node_id=service_node.id,
                            details=result.payment_requirement,
                        )
                elif uses_algo_payment:
                    if analyzer_wallet is None:
                        raise RuntimeError("Analyzer agent has no wallet available to pay for tool execution.")
                    result = self.tools.call_api_node_algo_paid(
                        record=record,
                        payer_wallet=analyzer_wallet,
                        node=service_node,
                        query=tool_query,
                    )
                    self._append_log(
                        logs,
                        level="progress",
                        message="{label} requested native ALGO settlement before execution.".format(
                            label=service_node.data.label
                        ),
                        node_id=service_node.id,
                        details={
                            "scheme": "native_algo",
                            "network": "algorand-testnet",
                            "payer": result.payment_payer,
                            "pay_to": result.payment_payee,
                            "amount_algo": "{:.6f}".format(result.payment_amount_algo or 0),
                        },
                    )
                else:
                    result = self.tools.call_api_node_direct(service_node, tool_query)
                tool_results.append(result)
                self._append_log(
                    logs,
                    level="output",
                    message="{label} returned output.".format(label=service_node.data.label),
                    node_id=service_node.id,
                    output=result.summary,
                )
                self._append_log(
                    logs,
                    level="done",
                    message="{label} completed successfully.".format(label=service_node.data.label),
                    node_id=service_node.id,
                    tx_id=result.payment_tx_id,
                    output=(
                        "Payment settled on {network} with transaction {txid}."
                        if result.payment_tx_id
                        else None
                    ).format(
                        network=result.payment_network or "Algorand",
                        txid=result.payment_tx_id or "",
                    )
                    if result.payment_tx_id
                    else None,
                    details={
                        key: value
                        for key, value in {
                            "scheme": "x402_exact" if result.paid_via_x402 else "native_algo"
                            if result.payment_tx_id
                            else "free",
                            "network": result.payment_network,
                            "payer": result.payment_payer,
                            "pay_to": result.payment_payee,
                            "amount_algo": "{:.6f}".format(result.payment_amount_algo)
                            if result.payment_amount_algo is not None
                            else None,
                            "amount_asset": result.payment_amount_asset,
                            "asset": result.payment_asset,
                            "tx_id": result.payment_tx_id,
                        }.items()
                        if value is not None
                    }
                    if (result.payment_tx_id or result.paid_via_x402)
                    else {},
                )
            except Exception as error:
                self._append_log(
                    logs,
                    level="error",
                    message="{label} failed during execution.".format(label=service_node.data.label),
                    node_id=service_node.id,
                    output=str(error),
                )

        if analyzer:
            analyzer_output = handoff_text or "Analyzer is handing the tool context to the next node."
            if tool_results:
                analyzer_output = "{analysis}\n\n{handoff}".format(
                    analysis=analyzer_analysis or "Analyzer reviewed the external tool results.",
                    handoff=handoff_text or "Prepared handoff for the next agent.",
                )
            self._append_log(
                logs,
                level="done",
                message="{label} finished analysis.".format(label=analyzer.data.label),
                node_id=analyzer.id,
                output=analyzer_output,
            )

        final_result = self._compose_result(query, tool_results, responder, analyzer)

        if responder:
            self._append_log(
                logs,
                level="start",
                message="{label} is preparing the final response.".format(label=responder.data.label),
                node_id=responder.id,
            )
            self._append_log(
                logs,
                level="output",
                message="{label} produced the final response.".format(label=responder.data.label),
                node_id=responder.id,
                output=final_result,
            )
            self._append_log(
                logs,
                level="done",
                message="{label} delivered the response back to the caller.".format(
                    label=responder.data.label
                ),
                node_id=responder.id,
            )

        end_node = self._end_node(record.definition)
        if end_node:
            self._append_log(
                logs,
                level="done",
                message="Pipeline reached the End node and returned an HTTP response.",
                node_id=end_node.id,
                output=final_result,
            )

        return RunPipelineResponse(
            runId="run_{token}".format(token=uuid4().hex[:10]),
            pipelineId=record.pipeline_id,
            result=final_result,
            settlementMode="demo" if settlement_mode == "demo" else "payment_response",
            logs=logs,
        )

    def _append_log(
        self,
        logs: List[RuntimeLog],
        level: str,
        message: str,
        node_id: Optional[str] = None,
        output: Optional[str] = None,
        tx_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        event_type_map = {
            "start": "start",
            "progress": "progress",
            "output": "output",
            "done": "done",
            "error": "error",
            "warning": "progress",
            "success": "done",
            "info": "progress",
        }
        level_map = {
            "start": "info",
            "progress": "info",
            "output": "info",
            "done": "success",
            "error": "error",
            "warning": "warning",
            "success": "success",
            "info": "info",
        }
        logs.append(
            RuntimeLog(
                level=level_map[level],
                message=message,
                nodeId=node_id,
                eventType=event_type_map[level],
                output=output,
                txId=tx_id,
                details=details or {},
            )
        )

    def invoke_tool(self, record: PipelineRecord, node_id: str, query: str) -> ToolResult:
        node = self._node_by_id(record.definition, node_id)
        if node is None or node.type not in {"service", "api"}:
            raise KeyError("Node {node_id} is not an API or service node".format(node_id=node_id))
        return self.tools.call_api_node_direct(node, query)

    def _topological_nodes(self, definition: DeployPipelineRequest) -> List[PipelineNode]:
        node_map: Dict[str, PipelineNode] = {node.id: node for node in definition.nodes}
        outgoing: Dict[str, List[str]] = defaultdict(list)
        indegree: Dict[str, int] = {node.id: 0 for node in definition.nodes}

        for edge in definition.edges:
            outgoing[edge.source].append(edge.target)
            indegree[edge.target] = indegree.get(edge.target, 0) + 1

        queue = deque(sorted([node_id for node_id, degree in indegree.items() if degree == 0]))
        ordered: List[PipelineNode] = []
        visited = set()

        while queue:
            node_id = queue.popleft()
            if node_id in visited:
                continue

            visited.add(node_id)
            ordered.append(node_map[node_id])

            for target in outgoing.get(node_id, []):
                indegree[target] -= 1
                if indegree[target] <= 0:
                    queue.append(target)

        if len(ordered) != len(definition.nodes):
            remaining = [node for node in definition.nodes if node.id not in visited]
            ordered.extend(remaining)

        return ordered

    def _agent_by_role(self, definition: DeployPipelineRequest, role: str):
        for node in definition.nodes:
            if node.type == "agent" and node.data.role == role:
                return node
        return None

    def _first_agent(self, definition: DeployPipelineRequest) -> Optional[PipelineNode]:
        for node in definition.nodes:
            if node.type == "agent":
                return node
        return None

    def _connected_tool_nodes(
        self,
        definition: DeployPipelineRequest,
        source_node_id: Optional[str],
    ) -> List[PipelineNode]:
        if not source_node_id:
            return self._tool_nodes(definition)

        node_map = {node.id: node for node in definition.nodes}
        connected: List[PipelineNode] = []
        for edge in definition.edges:
            if edge.wireType not in {"x402", "connection"}:
                continue

            is_incoming_tool_link = edge.target == source_node_id and edge.targetHandle == "tools"
            is_legacy_outgoing_tool_link = edge.source == source_node_id

            if not is_incoming_tool_link and not is_legacy_outgoing_tool_link:
                continue

            tool_node_id = edge.source if is_incoming_tool_link else edge.target
            target = node_map.get(tool_node_id)
            if (
                target
                and target.type in {"service", "api"}
                and (target.data.serviceKind or "custom") not in {"gemini", "openai", "claude", "mistral"}
            ):
                connected.append(target)

        return connected

    def _tool_nodes(self, definition: DeployPipelineRequest) -> List[PipelineNode]:
        return [
            node
            for node in definition.nodes
            if node.type in {"service", "api"}
            and (node.data.serviceKind or "custom") not in {"gemini", "openai", "claude", "mistral"}
        ]

    def _sort_tools_for_execution(
        self,
        definition: DeployPipelineRequest,
        selected_tools: List[str],
    ) -> List[str]:
        node_map = {node.id: node for node in definition.nodes}

        return sorted(
            selected_tools,
            key=lambda tool_id: 1
            if node_map.get(tool_id) and node_map[tool_id].data.serviceKind == "gmail"
            else 0,
        )

    def _node_by_id(self, definition: DeployPipelineRequest, node_id: str) -> Optional[PipelineNode]:
        for node in definition.nodes:
            if node.id == node_id:
                return node
        return None

    def _end_node(self, definition: DeployPipelineRequest) -> Optional[PipelineNode]:
        for node in definition.nodes:
            if node.type == "end":
                return node
        return None

    def _compose_result(
        self,
        query: str,
        tool_results: List[ToolResult],
        responder: Optional[PipelineNode],
        analyzer: Optional[PipelineNode],
    ) -> str:
        response_api_key = self._node_api_key(responder) or self._node_api_key(analyzer)

        if response_api_key:
            try:
                return self.gemini.summarize_final(
                    query=query,
                    analyzer_prompt=analyzer.data.systemPrompt if analyzer else "",
                    responder_prompt=responder.data.systemPrompt if responder else "",
                    tool_results=tool_results,
                    api_key=response_api_key,
                    allow_env_fallback=False,
                )
            except Exception:
                pass

        if not tool_results:
            return (
                "AgentMesh ran the workflow for '{query}', but none of the configured tools returned "
                "usable data."
            ).format(query=query)

        tool_lines = [f"{result.tool}: {result.summary}" for result in tool_results]
        agent_prefix = responder.data.label if responder else analyzer.data.label if analyzer else "Agent"
        return "{agent} response for '{query}': {body}".format(
            agent=agent_prefix,
            query=query,
            body=" ".join(tool_lines),
        )

    def _node_api_key(self, node: Optional[PipelineNode]) -> Optional[str]:
        if node is None:
            return None

        api_key = getattr(node.data, "apiKey", None)
        if not isinstance(api_key, str):
            return None

        normalized = api_key.strip()
        return normalized or None
