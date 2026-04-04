from collections import defaultdict, deque
from typing import Dict, List, Optional
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
                    message="Demo payment accepted locally. Replace with GoPlausible facilitator verification before production.",
                    eventType="progress",
                )
            )
        else:
            logs.append(
                RuntimeLog(
                    level="success",
                    message="Payment response header received. Pipeline execution has started.",
                    eventType="progress",
                )
            )

        responder = self._agent_by_role(record.definition, "responder")
        analyzer = self._agent_by_role(record.definition, "analyzer") or self._first_agent(record.definition)
        analyzer_wallet = record.wallets.get(analyzer.id) if analyzer else None
        connected_tools = self._connected_tool_nodes(record.definition, analyzer.id if analyzer else None)
        allowed_tools = analyzer.data.enabledTools if analyzer and analyzer.data.enabledTools else []

        selected_tools: List[str] = []
        analyzer_analysis = ""
        handoff_text = ""

        if analyzer:
            self._append_log(
                logs,
                level="start",
                message="{label} received the workflow task.".format(label=analyzer.data.label),
                node_id=analyzer.id,
                output=query,
            )

        if analyzer and self.gemini.enabled:
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
                )
                selected_tools = plan["selected_tools"]
                analyzer_analysis = plan["analysis"] or "Gemini planned the best tool path for the request."
                handoff_text = plan["handoff"] or "Analyzer prepared a concise handoff for the next node."
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

        if not selected_tools:
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

        for node in ordered_nodes:
            if node.type == "trigger":
                self._append_log(
                    logs,
                    level="done",
                    message="Trigger node activated from incoming API request.",
                    node_id=node.id,
                )
            elif node.type in {"service", "api"}:
                self._append_log(
                    logs,
                    level="progress",
                    message="{kind_label} {label} is wired as the {kind} tool.".format(
                        kind_label="API" if node.type == "api" else "Service",
                        label=node.data.label,
                        kind=node.data.serviceKind or "custom",
                    ),
                    node_id=node.id,
                )

        tool_results: List[ToolResult] = []
        for tool_id in selected_tools:
            service_node = self._node_by_id(record.definition, tool_id)
            if service_node is None or service_node.type not in {"service", "api"}:
                continue

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
                        query=query,
                    )
                elif uses_algo_payment:
                    if analyzer_wallet is None:
                        raise RuntimeError("Analyzer agent has no wallet available to pay for tool execution.")
                    result = self.tools.call_api_node_algo_paid(
                        record=record,
                        payer_wallet=analyzer_wallet,
                        node=service_node,
                        query=query,
                    )
                else:
                    result = self.tools.call_api_node_direct(service_node, query)
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
            if edge.source != source_node_id:
                continue
            target = node_map.get(edge.target)
            if target and target.type in {"service", "api"}:
                connected.append(target)

        return connected or self._tool_nodes(definition)

    def _tool_nodes(self, definition: DeployPipelineRequest) -> List[PipelineNode]:
        return [node for node in definition.nodes if node.type in {"service", "api"}]

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
        if not tool_results:
            return (
                "AgentMesh ran the workflow for '{query}', but none of the configured tools returned "
                "usable data."
            ).format(query=query)

        if self.gemini.enabled:
            try:
                return self.gemini.summarize_final(
                    query=query,
                    analyzer_prompt=analyzer.data.systemPrompt if analyzer else "",
                    responder_prompt=responder.data.systemPrompt if responder else "",
                    tool_results=tool_results,
                )
            except Exception:
                pass

        tool_lines = [f"{result.tool}: {result.summary}" for result in tool_results]
        agent_prefix = responder.data.label if responder else analyzer.data.label if analyzer else "Agent"
        return "{agent} response for '{query}': {body}".format(
            agent=agent_prefix,
            query=query,
            body=" ".join(tool_lines),
        )
