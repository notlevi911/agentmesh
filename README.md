# AgentMesh

AgentMesh is a visual canvas for building, funding, and running autonomous AI agent pipelines on Algorand.

This starter repo ships the first vertical slice:

- React canvas with Agent, Service, Trigger, and End nodes
- Purple, green, and blue wire types
- Deploy flow that provisions Algorand wallets for agent nodes
- Funding modal with QR code, faucet link, and live balance polling
- FastAPI backend with pipeline deploy/run endpoints and x402-style `402 Payment Required` flow

## Workspace Layout

```text
apps/
  api/   FastAPI control plane and runtime
  web/   ReactFlow builder UI
packages/
  specs/ Shared pipeline and event schemas
docs/    Product and architecture notes
```

## Local Development

### Web

```bash
npm install
npm run dev:web
```

### API

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
npm run dev:api
```

The web app expects the API at `http://localhost:8000` by default. Override with `VITE_API_URL`.

## Environment Variables

Copy `.env.example` to `.env` and adjust only what you need.

- `VITE_API_URL`: frontend target for FastAPI.
- `AGENTMESH_PUBLIC_BASE_URL`: the public URL embedded into generated pipeline endpoints.
- `ALGOD_ADDRESS`: algod RPC endpoint for balance checks and future transactions.
- `ALGOD_TOKEN`: API token for providers that require one.
- `GOPLAUSIBLE_FACILITATOR_URL`: x402 facilitator base URL for payment flows.
- `AGENTMESH_LLM_PROVIDER`: default reasoning provider when agent execution is wired to a real LLM.
- `AGENTMESH_LLM_MODEL`: default model name for agent execution.
- `OPENAI_API_KEY`: server-side OpenAI key, optional today but needed once live reasoning is enabled.
- `ANTHROPIC_API_KEY`: server-side Anthropic key, optional alternative to OpenAI.

## Draft Persistence

Workflow drafts are currently saved in browser `localStorage`, so there is no sign-in requirement yet. This stores the canvas graph locally on the builder's machine only.

## Current Scope

This pass focuses on the builder, deployment contract, wallet creation, funding UX, and a demo runtime. Real GoPlausible facilitator verification and AVM box storage are designed in as seams but not fully integrated yet.
