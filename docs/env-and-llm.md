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

- `AGENTMESH_LLM_PROVIDER`
  Default AI provider selection for agent reasoning.

- `AGENTMESH_LLM_MODEL`
  Default model used for reasoning if the caller or node config does not override it.

- `OPENAI_API_KEY`
  Shared backend API key for OpenAI-powered agents.

- `ANTHROPIC_API_KEY`
  Shared backend API key for Claude-powered agents.

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
- Deployment/runtime registry: backend memory only
- Auth: none
- User accounts: none

That is the right tradeoff for the current demo stage.
