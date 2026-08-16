import { apiBaseUrl } from "./config";
import type { ActionTrace, AnalysisJob, IntegrationStatus } from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      body?.message ?? `ActionProof API returned ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  createJob(body: unknown, operatorToken?: string): Promise<AnalysisJob> {
    return request("/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
      ...(operatorToken ? { headers: { Authorization: `Bearer ${operatorToken}` } } : {}),
    });
  },
  getJob(id: string): Promise<AnalysisJob> {
    return request(`/v1/jobs/${encodeURIComponent(id)}`);
  },
  getTrace(id: string): Promise<ActionTrace> {
    return request(`/v1/traces/${encodeURIComponent(id)}`);
  },
  listTraces(): Promise<{ traces: ActionTrace[] }> {
    return request("/v1/traces");
  },
  getIntegrations(): Promise<IntegrationStatus> {
    return request("/v1/integrations");
  },
  getNonce(
    requester: string,
    agent: string,
  ): Promise<{ agent: string; requester: string; nonce: string }> {
    return request(
      `/v1/nonces/${encodeURIComponent(requester)}?agent=${encodeURIComponent(agent)}`,
    );
  },
  verifyTrace(id: string): Promise<ActionTrace["verification"]> {
    return request(`/v1/traces/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  verifyTamper(
    id: string,
    mutation: "calldata" | "reportRoot" | "nonce",
  ): Promise<ActionTrace["verification"]> {
    return request(`/v1/traces/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      body: JSON.stringify({ mutation }),
    });
  },
};
