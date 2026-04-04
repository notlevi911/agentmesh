import type {
  BalanceResponse,
  DeployRequest,
  DeployResponse,
  FundIntentResponse,
  RunResponse,
} from "../types/pipeline";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function deployPipeline(payload: DeployRequest): Promise<DeployResponse> {
  const response = await fetch(`${API_BASE_URL}/api/pipelines/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<DeployResponse>(response);
}

export async function getBalances(pipelineId: string): Promise<BalanceResponse> {
  const response = await fetch(`${API_BASE_URL}/api/pipelines/${pipelineId}/balances`);
  return parseJson<BalanceResponse>(response);
}

export async function getFundIntent(
  pipelineId: string,
  nodeId: string,
): Promise<FundIntentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/pipelines/${pipelineId}/nodes/${nodeId}/fund`);
  return parseJson<FundIntentResponse>(response);
}

export async function runPipeline(
  pipelineId: string,
  payload: Record<string, unknown>,
): Promise<RunResponse> {
  const response = await fetch(`${API_BASE_URL}/${pipelineId}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AgentMesh-Demo-Paid": "true",
    },
    body: JSON.stringify(payload),
  });

  return parseJson<RunResponse>(response);
}

