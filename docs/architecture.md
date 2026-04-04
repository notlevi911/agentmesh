# AgentMesh Architecture

## Core Split

- `apps/web`: visual builder, funding UX, deployment panel, and runtime logs
- `apps/api`: wallet creation, pipeline deployment, x402-style run endpoint, and orchestration
- `packages/specs`: shared JSON contracts for pipeline graphs and runtime events

## Runtime Flow

1. Builder shapes a graph on the ReactFlow canvas.
2. `Deploy` posts the graph to FastAPI.
3. FastAPI generates Algorand accounts for agent nodes with `py-algorand-sdk`.
4. AgentMesh returns a live pipeline endpoint and payment wallet.
5. Incoming calls to `/{pipeline_id}/run` respond with `402 Payment Required` until a payment proof or demo bypass header is supplied.
6. The runtime executes the graph in topological order and emits structured logs.

## Next Integrations

- Replace the demo payment bypass with live GoPlausible facilitator verification.
- Persist pipeline metadata and runtime checkpoints into AVM box storage.
- Add signed wallet custody and encrypted secret storage.
- Stream runtime events over SSE or WebSocket instead of one-shot run responses.

