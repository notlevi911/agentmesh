# AgentMesh

AgentMesh is a visual canvas for building, funding, and running autonomous AI agent pipelines on Algorand.

This starter repo ships the first vertical slice:

- React canvas with Agent, Service, Trigger, and End nodes
- Purple, green, and blue wire types
- Deploy flow that provisions Algorand wallets for agent and paid API nodes
- Funding modal with QR code, faucet link, and live balance polling
- FastAPI backend with pipeline deploy/run endpoints and real internal Algorand x402 middleware for paid tool calls

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
- `AGENTMESH_INTERNAL_API_BASE_URL`: internal URL the runtime uses when an agent pays a protected tool route.
- `AGENTMESH_X402_ASSET_ID`: Algorand ASA used for x402 exact payments. Testnet USDC is `10458941`.
- `AGENTMESH_X402_SERVICE_BOOTSTRAP_ALGO`: small ALGO transfer used to prep service wallets for USDC opt-in.
- `AGENTMESH_PAYMENT_MODE`: `algo` to settle priced internal tool calls with native ALGO, `x402` to use the AVM exact USDC path.
- `AGENTMESH_REPOSITORY_PATH`: local JSON file used to persist deployed pipelines, wallet keys, and run history across restarts.
- `AGENTMESH_LLM_PROVIDER`: default reasoning provider when agent execution is wired to a real LLM.
- `AGENTMESH_LLM_MODEL`: default model name for agent execution.
- `GEMINI_API_KEY`: server-side Gemini key for live agent planning/summarization.

## Draft Persistence

Workflow drafts are currently saved in browser `localStorage`, so there is no sign-in requirement yet. This stores the canvas graph locally on the builder's machine only.

The backend now persists deployed pipelines, wallet keys, and run history to a local JSON file, so restarting the API does not rotate deployed wallet addresses.

## Current Scope

This pass focuses on the builder, deployment contract, wallet creation, funding UX, and a demo runtime. Priced internal tool calls now default to native ALGO settlement between the agent wallet and the service wallet, while the AVM x402 USDC path is still available behind `AGENTMESH_PAYMENT_MODE=x402` or explicit upstream x402 use cases. Deployed pipelines and wallet keys are persisted locally so restarts do not rotate addresses. The public `/{pipeline_id}/run` endpoint still uses the existing demo paywall shim, and AVM box storage is not wired yet.
