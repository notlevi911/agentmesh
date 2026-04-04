# AgentMesh Architecture

## Core Split

- `apps/web`: visual builder, funding UX, deployment panel, and runtime logs
- `apps/api`: wallet creation, pipeline deployment, x402-gated internal tool routes, and orchestration
- `packages/specs`: shared JSON contracts for pipeline graphs and runtime events

The API now persists deployed pipelines and wallet custody metadata to a local JSON store so a backend restart does not rotate wallet addresses for already-deployed pipelines.

## Runtime Flow

1. Builder shapes a graph on the ReactFlow canvas.
2. `Deploy` posts the graph to FastAPI.
3. FastAPI generates Algorand accounts for agent nodes with `py-algorand-sdk`.
4. AgentMesh returns a live pipeline endpoint and payment wallet.
5. Incoming calls to `/{pipeline_id}/run` still use the current demo paywall shim for the outer pipeline trigger.
6. When a priced API/service node is selected, the runtime now defaults to a native ALGO transfer from the agent wallet to the service wallet before the upstream API call proceeds.
7. If the workflow or environment explicitly uses x402, the runtime can still call an internal FastAPI route protected by official `x402-avm` middleware and settle in testnet USDC.
8. The runtime executes the graph in topological order and emits structured logs.

## Next Integrations

- Replace the outer `/{pipeline_id}/run` demo payment shim with either the same official x402 middleware path or a native-ALGO paywall path.
- Persist pipeline metadata and runtime checkpoints into AVM box storage.
- Add signed wallet custody and encrypted secret storage.
- Stream runtime events over SSE or WebSocket instead of one-shot run responses.
