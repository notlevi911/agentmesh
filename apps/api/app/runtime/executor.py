from collections import defaultdict, deque
from typing import Dict, List, Optional
from uuid import uuid4

from app.models.pipeline import DeployPipelineRequest, PipelineNode, RunPipelineResponse, RuntimeLog
from app.runtime.tools import ToolRuntime
from app.storage.repository import PipelineRecord


class RuntimeExecutor:
    def __init__(self) -> None:
        self.tools = ToolRuntime()

    def execute(self, record: PipelineRecord, query: str, settlement_mode: str) -> RunPipelineResponse:
        ordered_nodes = self._topological_nodes(record.definition)
        logs: List[RuntimeLog] = []

        if settlement_mode == "demo":
            logs.append(
                RuntimeLog(
                    level="warning",
                    message="Demo payment accepted locally. Replace with GoPlausible facilitator verification before production.",
                )
            )
        else:
            logs.append(
                RuntimeLog(
                    level="success",
                    message="Payment response header received. Pipeline execution has started.",
                )
            )

        responder = self._agent_by_role(record.definition, "responder")
        analyzer = self._agent_by_role(record.definition, "analyzer") or self._first_agent(record.definition)
        services = self._service_nodes(record.definition)
        available_service_kinds = [node.data.serviceKind for node in services if node.data.serviceKind]
        allowed_tools = analyzer.data.enabledTools if analyzer and analyzer.data.enabledTools else []
        selected_tools = self.tools.choose_tools(query, available_service_kinds, allowed_tools)
        tool_results = []

        for node in ordered_nodes:
            if node.type == "trigger":
                logs.append(
                    RuntimeLog(
                        level="info",
                        message="Trigger node activated from incoming API request.",
                        nodeId=node.id,
                    )
                )
            elif node.type == "agent":
                message = "{label} is reasoning over the task.".format(label=node.data.label)
                if node.data.role == "analyzer":
                    message = "{label} received '{query}' and is preparing external lookups.".format(
                        label=node.data.label,
                        query=query,
                    )
                if node.data.role == "responder":
                    message = "{label} is formatting the final response payload.".format(
                        label=node.data.label
                    )

                logs.append(RuntimeLog(level="info", message=message, nodeId=node.id))
            elif node.type == "service":
                logs.append(
                    RuntimeLog(
                        level="info",
                        message="Service {label} is available as a {kind} tool.".format(
                            label=node.data.label,
                            kind=node.data.serviceKind or "custom",
                        ),
                        nodeId=node.id,
                    )
                )
            elif node.type == "end":
                logs.append(
                    RuntimeLog(
                        level="success",
                        message="Pipeline reached the End node and returned an HTTP response.",
                        nodeId=node.id,
                    )
                )

        if analyzer:
            logs.append(
                RuntimeLog(
                    level="info",
                    message="{label} selected tool path: {tools}.".format(
                        label=analyzer.data.label,
                        tools=", ".join(selected_tools) if selected_tools else "none",
                    ),
                    nodeId=analyzer.id,
                )
            )

        for tool_name in selected_tools:
            service_node = self._service_by_kind(record.definition, tool_name)
            if service_node is None:
                continue

            call_phrase = (
                "Calling {label} over x402 for {price:.3f} ALGO."
                if (service_node.data.priceAlgo or 0) > 0
                else "Calling {label} as a free tool."
            ).format(label=service_node.data.label, price=service_node.data.priceAlgo or 0)
            logs.append(RuntimeLog(level="info", message=call_phrase, nodeId=service_node.id))

            try:
                result = (
                    self.tools.weather_openmeteo(query)
                    if tool_name == "weather"
                    else self.tools.search_duckduckgo(query)
                )
                tool_results.append(result)
                logs.append(
                    RuntimeLog(
                        level="success",
                        message="{label} returned: {summary}".format(
                            label=service_node.data.label,
                            summary=result.summary,
                        ),
                        nodeId=service_node.id,
                    )
                )
            except Exception as error:
                logs.append(
                    RuntimeLog(
                        level="error",
                        message="{label} failed: {error}".format(
                            label=service_node.data.label,
                            error=str(error),
                        ),
                        nodeId=service_node.id,
                    )
                )

        if analyzer and tool_results:
            logs.append(
                RuntimeLog(
                    level="success",
                    message="{analyzer} used {count} tool result(s) and prepared handoff context.".format(
                        analyzer=analyzer.data.label,
                        count=len(tool_results),
                    ),
                    nodeId=analyzer.id,
                )
            )

        if responder:
            logs.append(
                RuntimeLog(
                    level="success",
                    message="{label} delivered the final response back to the caller.".format(
                        label=responder.data.label
                    ),
                    nodeId=responder.id,
                )
            )

        result = self._compose_result(query, tool_results, responder, analyzer)

        return RunPipelineResponse(
            runId="run_{token}".format(token=uuid4().hex[:10]),
            pipelineId=record.pipeline_id,
            result=result,
            settlementMode="demo" if settlement_mode == "demo" else "payment_response",
            logs=logs,
        )

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

    def _service_nodes(self, definition: DeployPipelineRequest) -> List[PipelineNode]:
        return [node for node in definition.nodes if node.type == "service"]

    def _service_by_kind(self, definition: DeployPipelineRequest, kind: str) -> Optional[PipelineNode]:
        for node in definition.nodes:
            if node.type == "service" and node.data.serviceKind == kind:
                return node
        return None

    def _compose_result(
        self,
        query: str,
        tool_results,
        responder: Optional[PipelineNode],
        analyzer: Optional[PipelineNode],
    ) -> str:
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
