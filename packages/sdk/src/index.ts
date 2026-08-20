import {
  actionRequestSchema,
  type ActionRequest,
  type Finding,
  type SimulationResult,
} from "@actionproof/core";

export interface PreflightResponse {
  schemaVersion: "1.0";
  previewOnly: true;
  mode: "live" | "sandbox";
  actionHash: `0x${string}`;
  disposition: "pass" | "review" | "block";
  riskFloor: number;
  findings: Finding[];
  simulation: SimulationResult;
  blockingRuleIds: string[];
  eligibleForFullAssessment: boolean;
  notice: string;
}

export interface JobResponse {
  id: string;
  status: string;
  traceId?: string;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
}

export class ActionProofApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export class ActionProofClient {
  readonly #origin: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(args: { origin: string; apiKey?: string; fetchFn?: typeof fetch }) {
    const url = new URL(args.origin);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new TypeError("ActionProof origin must use HTTPS outside local development");
    }
    this.#origin = url.origin;
    this.#apiKey = args.apiKey;
    this.#fetch = args.fetchFn ?? fetch;
  }

  preflight(action: ActionRequest, signal?: AbortSignal): Promise<PreflightResponse> {
    return this.#request("/v1/preflight", {
      method: "POST",
      body: JSON.stringify({ action: actionRequestSchema.parse(action) }),
      ...(signal ? { signal } : {}),
    });
  }

  createJob(
    action: ActionRequest,
    options: { execute?: boolean; signal?: AbortSignal } = {},
  ): Promise<JobResponse> {
    return this.#request("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        action: actionRequestSchema.parse(action),
        execute: options.execute ?? false,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  getJob(id: string, signal?: AbortSignal): Promise<JobResponse> {
    return this.#request(`/v1/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {});
  }

  async waitForJob(
    id: string,
    options: { pollMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<JobResponse> {
    const started = Date.now();
    const pollMs = options.pollMs ?? 500;
    const timeoutMs = options.timeoutMs ?? 120_000;
    while (Date.now() - started < timeoutMs) {
      const job = await this.getJob(id, options.signal);
      if (job.status === "completed" || job.status === "failed") return job;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, pollMs);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason ?? new Error("Aborted"));
          },
          { once: true },
        );
      });
    }
    throw new Error(`ActionProof job ${id} did not finish within ${timeoutMs}ms`);
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.#fetch(`${this.#origin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.#apiKey ? { "x-api-key": this.#apiKey } : {}),
        ...init.headers,
      },
    });
    const payload = (await response.json()) as {
      message?: string;
      error?: { code?: string; message?: string; requestId?: string };
    };
    if (!response.ok) {
      throw new ActionProofApiError(
        response.status,
        payload.error?.code ?? "ACTIONPROOF_API_ERROR",
        payload.error?.message ?? payload.message ?? `HTTP ${response.status}`,
        payload.error?.requestId,
      );
    }
    return payload as T;
  }
}
