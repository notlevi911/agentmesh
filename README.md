# AgentMesh

AgentMesh is a visual workflow studio for wallet-backed AI agents on Algorand.

It combines the usability of a drag-and-drop automation builder with the execution model of agentic commerce: agents can be connected to models, selectively granted access to tools, funded with real onchain wallets, and routed through paid API steps using native ALGO or x402-aware settlement.

## Why AgentMesh

Most workflow builders can orchestrate APIs. Very few can express:

- which tools an AI agent is allowed to call
- which steps should run deterministically as part of the workflow
- how a software agent pays for a service it decides to use
- how those decisions map to a visual canvas that non-engineers can understand

AgentMesh is built around that exact problem.

It gives every agent a real Algorand wallet, lets you wire tools and workflow steps differently, and turns agent execution into something you can inspect, fund, and run end to end from a visual interface.

## What Makes It Stand Out

- Visual agent orchestration, not just API chaining
- Explicit separation between agent-callable tools and normal workflow steps
- Real Algorand testnet wallets created for deployed agents
- Support for priced service execution with native ALGO or x402-compatible flows
- Local-first deployment flow with persistent pipeline state and runtime history
- FastAPI control plane plus React canvas UI for a complete demoable product

## Core Experience

With AgentMesh, you can:

- design an agent workflow on a visual canvas
- connect an AI model directly to an agent node
- expose only selected tools to that agent
- chain post-agent workflow steps like Gmail or response formatting
- deploy the workflow to a local runtime
- fund agent wallets and inspect balances
- run the pipeline through a generated HTTP endpoint
- watch execution logs step by step inside the studio

## How The Wiring Model Works

AgentMesh uses two different connection semantics on purpose.

### 1. Agent Tool Access

Use:

- `Tool top dot -> Agent bottom-right Tools dot`

Meaning:

- the tool is available for the agent to choose at runtime
- the agent may use it, or may decide no tool is needed
- only tools wired this way are considered agent-callable

### 2. AI Model Binding

Use:

- `Model top dot -> Agent bottom-left AI Model dot`

Meaning:

- the connected model powers that agent's planning and final response generation
- the model node's API key is used for that agent at runtime

### 3. Workflow Sequencing

Use:

- `Side dot -> side dot`

Meaning:

- the next node runs as a normal workflow step
- this is deterministic orchestration, not optional tool access

Example:

- `Search top -> Agent Tools` means the agent may choose Search
- `Agent side -> Gmail side -> End` means Gmail runs after the agent step in the workflow

This distinction is one of the most important ideas in the product.

## Runtime Behavior

The current runtime is designed to match the canvas closely:

- the connected model node API key is used during agent planning and response synthesis
- if the model decides no tool is needed, AgentMesh does not force an unrelated fallback tool
- only tools explicitly connected to the agent tool port are considered callable by the agent
- services connected through side workflow ports execute as normal downstream workflow steps
- draft canvas state is stored in browser `localStorage`
- deployed workflows, wallets, and run history persist locally across backend restarts

## Demo Flow

The strongest way to demo AgentMesh is:

1. Build or load a workflow in the studio.
2. Connect a model to the agent's AI Model port.
3. Connect one or more tools to the agent's Tools port.
4. Deploy the workflow to mint agent wallets and generate the live endpoint.
5. Fund the agent wallet.
6. Run a prompt through the endpoint and inspect the runtime log stream.
7. Show the difference between an agent-selected tool and a side-wired workflow step.

This makes the product value immediately visible to judges because the canvas, wallet model, and runtime logs all line up.

## Architecture

AgentMesh is split into three main parts:

```text
apps/
  api/   FastAPI control plane, orchestration runtime, wallet management, and payments
  web/   React + XYFlow visual builder, deployment UX, and live runtime panels
packages/
  specs/ Shared pipeline and runtime event schemas
docs/    Supporting architecture and environment notes
```

### Execution Flow

1. The frontend builds a pipeline graph on the canvas.
2. The graph is deployed to the FastAPI backend.
3. The backend creates Algorand wallets for agent nodes and stores deployment metadata.
4. A live pipeline endpoint is generated.
5. On execution, the runtime resolves the connected model, available tools, and downstream workflow path.
6. Paid service calls can settle with native ALGO or x402-compatible payment mechanics.
7. Structured logs are emitted back to the studio for inspection.

## Technology Stack

- Frontend: React, TypeScript, Vite, XYFlow
- Backend: FastAPI, Python
- AI: Gemini-connected model nodes
- Payments: Algorand testnet, native ALGO, x402 AVM integration path
- Persistence: local JSON repository plus browser local storage

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.11 recommended
- npm

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Create The Backend Virtual Environment

```bash
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -r apps/api/requirements.txt
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

### 4. Start The Backend

```bash
npm run dev:api
```

Backend URLs:

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/docs`

### 5. Start The Frontend

```bash
npm run dev:web
```

Frontend URL:

- usually `http://127.0.0.1:5173`

## Available Scripts

From the repo root:

```bash
npm run dev:web
npm run build:web
npm run lint:web
npm run dev:api
npm run check
```

## Environment Variables

Key variables from `.env.example`:

- `VITE_API_URL`: frontend target for the FastAPI backend
- `AGENTMESH_PUBLIC_BASE_URL`: base URL used to generate public pipeline run endpoints
- `ALGOD_ADDRESS`: Algorand node/provider URL
- `ALGOD_TOKEN`: optional algod token
- `GOPLAUSIBLE_FACILITATOR_URL`: x402 facilitator URL
- `AGENTMESH_INTERNAL_API_BASE_URL`: internal backend URL for protected tool invocation
- `AGENTMESH_X402_ASSET_ID`: Algorand ASA used for x402 exact settlement
- `AGENTMESH_X402_SERVICE_BOOTSTRAP_ALGO`: bootstrap ALGO for service wallet prep
- `AGENTMESH_PAYMENT_MODE`: `algo` or `x402`
- `AGENTMESH_TOOL_PAYOUT_ADDRESS`: optional payout address for priced tool nodes
- `AGENTMESH_REPOSITORY_PATH`: local file for deployed pipelines and runtime history
- `AGENTMESH_LLM_PROVIDER`: default LLM provider label
- `AGENTMESH_LLM_MODEL`: default model name
- `GEMINI_API_KEY`: optional shared backend Gemini key

Optional Gmail SMTP variables:

- `GMAIL_SMTP_USER`
- `GMAIL_SMTP_APP_PASSWORD`

## Gmail Behavior

- If Gmail is connected through the agent Tools port, the agent may choose it as a tool.
- If Gmail is connected through side workflow ports, it runs as a deterministic downstream step.
- Without SMTP credentials, Gmail returns a draft-style result instead of sending a real email.

## API Surface

Important endpoints:

- `POST /api/pipelines/deploy`
- `GET /api/pipelines`
- `GET /api/pipelines/{pipeline_id}`
- `GET /api/pipelines/{pipeline_id}/balances`
- `GET /api/pipelines/{pipeline_id}/nodes/{node_id}/fund`
- `POST /{pipeline_id}/run`
- `GET /docs`

## Current Scope

AgentMesh is already strong as a hackathon demo and product prototype. It is especially good at showing:

- visual agent-to-tool control
- wallet-backed execution
- paid tool invocation
- inspectable runtime behavior

It is not yet a fully hosted multi-tenant platform. Current rough edges remain around:

- production auth
- hardened secret management
- multi-user collaboration
- broader provider abstraction
- deeper service integrations and delivery guarantees

## Why This Is Compelling For A Hackathon

AgentMesh is not just another chat wrapper or no-code flow builder.

It demonstrates a concrete product thesis:

- AI agents need controllable tool access
- agent actions need economic rails
- those rails should be visible in the UI
- workflows should be understandable by both builders and judges in under a minute

That makes it a strong demo because the product story, technical architecture, and live user interaction all reinforce each other.

## Troubleshooting

- If the frontend loads but runs fail, confirm the backend is running on `127.0.0.1:8000`.
- If an agent ignores a tool, confirm the tool is connected from its top dot into the agent's bottom-right `Tools` dot.
- If a service should run after an agent, connect it with side workflow dots instead of the tool port.
- If Gmail does not send, check `GMAIL_SMTP_USER` and `GMAIL_SMTP_APP_PASSWORD`.
- If model-based execution fails, confirm the agent has a connected model node with a valid API key.
