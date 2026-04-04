# Env And LLM Strategy

## What Each Env Does

- `VITE_API_URL`
  Frontend-only env used by the React app to know where the FastAPI backend lives.

- `AGENTMESH_PUBLIC_BASE_URL`
  Backend env used when generating public pipeline URLs such as `/{pipeline_id}/run`.

- `ALGOD_ADDRESS`
  Backend env for the Algorand node or provider used to fetch balances and later submit transactions.

- `ALGOD_TOKEN`
  Backend token for algod providers that require authentication.

- `GOPLAUSIBLE_FACILITATOR_URL`
  Backend base URL for the GoPlausible x402 facilitator integration.
  Use `https://facilitator.goplausible.xyz`, not the docs portal host.

- `AGENTMESH_INTERNAL_API_BASE_URL`
  Internal backend URL used when an agent pays a protected tool/API route over x402.

- `AGENTMESH_X402_ASSET_ID`
  Algorand ASA used by the AVM exact payment mechanism.
  Right now that is testnet USDC `10458941`.

- `AGENTMESH_X402_SERVICE_BOOTSTRAP_ALGO`
  Small ALGO top-up used to prepare paid service/API wallets for their first USDC opt-in.

- `AGENTMESH_PAYMENT_MODE`
  Controls how priced internal tool nodes settle.
  Use `algo` for native testnet ALGO transfers or `x402` for the AVM exact USDC path.

- `AGENTMESH_REPOSITORY_PATH`
  Local backend JSON file for persisting deployed pipelines, wallet keys, and run history across restarts.

- `AGENTMESH_LLM_PROVIDER`
  Default AI provider selection for agent reasoning.

- `AGENTMESH_LLM_MODEL`
  Default model used for reasoning if the caller or node config does not override it.

- `GEMINI_API_KEY`
  Shared backend API key for Gemini-powered agents.

## Should AI Keys Be In Env Or Entered At Runtime?

For this project, the best path is a hybrid:

- Use backend env vars for the hackathon demo.
  This is the fastest way to get autonomous agents working with one shared key and no auth system.

- Add optional runtime-provided keys later, stored locally per browser session or per workflow draft.
  This feels more like n8n and is better for a no-sign-in builder because users can bring their own key.

## Recommendation For AgentMesh Right Now

Use a server-side env key first, then support an optional per-workflow override in local storage.

Why:

- It keeps the deploy and run path simple while the x402 and Algorand pieces are still the main risk.
- It avoids blocking the demo on credential UX.
- It still leaves room for a n8n-style "bring your own API key" panel once the runtime is stable.

## Current Persistence

- Workflow graph: browser `localStorage`
- Deployment/runtime registry: local backend JSON file
- Auth: none
- User accounts: none

That is the right tradeoff for the current demo stage.
