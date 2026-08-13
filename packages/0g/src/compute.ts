import {
  canonicalize,
  computeMetadataSchema,
  modelRiskAssessmentSchema,
  type CanonicalValue,
} from "@actionproof/core";
import OpenAI from "openai";

import type {
  Clock,
  ComputeAdapter,
  ComputeAssessmentResult,
  RiskAssessmentInput,
} from "./interfaces.js";
import { systemClock } from "./interfaces.js";

const JSON_SYSTEM_PROMPT = `You are ActionProof's risk-assessment model. Return exactly one JSON object and no markdown. The object must contain verdict (allow, block, or review), integer riskScore from 0 to 100, confidence from 0 to 1, modelFindings, evidence, reasons, recommendedAction, and limitations. Findings must contain id, severity, category="model", title, description, evidence, and blocking. Never omit required fields.`;

export interface RouterCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_object" };
  temperature: number;
}

export interface RouterCompletionTransport {
  create(request: RouterCompletionRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ZgComputeRouterConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  clock?: Clock;
  transport?: RouterCompletionTransport;
}

class OpenAiRouterTransport implements RouterCompletionTransport {
  readonly #client: OpenAI;

  constructor(config: Pick<ZgComputeRouterConfig, "apiKey" | "baseURL">) {
    this.#client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async create(request: RouterCompletionRequest, signal: AbortSignal): Promise<unknown> {
    return this.#client.chat.completions.create(request, { signal });
  }
}

interface ParsedCompletion {
  content: string;
  requestId: string;
  provider: string;
  billing: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompletion(value: unknown): ParsedCompletion {
  if (!isRecord(value)) throw new TypeError("0G Router returned a non-object response");

  const choices = value["choices"];
  if (!Array.isArray(choices) || !isRecord(choices[0])) {
    throw new TypeError("0G Router response is missing choices[0]");
  }
  const message = choices[0]["message"];
  if (!isRecord(message) || typeof message["content"] !== "string") {
    throw new TypeError("0G Router response is missing textual message content");
  }

  const trace = value["x_0g_trace"];
  if (!isRecord(trace)) throw new TypeError("0G Router response is missing x_0g_trace");
  const requestId = trace["request_id"];
  const provider = trace["provider"];
  const billing = trace["billing"];
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new TypeError("0G Router trace is missing request_id");
  }
  if (typeof provider !== "string" || provider.length === 0) {
    throw new TypeError("0G Router trace is missing provider");
  }
  if (!isRecord(billing)) throw new TypeError("0G Router trace is missing billing metadata");

  return { content: message["content"], requestId, provider, billing };
}

async function runWithTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`0G Compute Router request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Production adapter for the OpenAI-compatible 0G Compute Router. */
export class ZgComputeRouterAdapter implements ComputeAdapter {
  readonly mode = "router" as const;
  readonly #config: Required<
    Pick<ZgComputeRouterConfig, "model" | "timeoutMs" | "maxResponseBytes">
  >;
  readonly #clock: Clock;
  readonly #transport: RouterCompletionTransport;

  constructor(config: ZgComputeRouterConfig) {
    if (config.apiKey.trim().length === 0) throw new TypeError("0G Router apiKey is required");
    if (config.baseURL.trim().length === 0) throw new TypeError("0G Router baseURL is required");
    if (config.model.trim().length === 0) throw new TypeError("0G Router model is required");
    const timeoutMs = config.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive safe integer");
    }
    const maxResponseBytes = config.maxResponseBytes ?? 32_768;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new TypeError("maxResponseBytes must be a positive safe integer");
    }

    this.#config = { model: config.model, timeoutMs, maxResponseBytes };
    this.#clock = config.clock ?? systemClock;
    this.#transport = config.transport ?? new OpenAiRouterTransport(config);
  }

  async assess(input: RiskAssessmentInput): Promise<ComputeAssessmentResult> {
    const request: RouterCompletionRequest = {
      model: this.#config.model,
      messages: [
        { role: "system", content: JSON_SYSTEM_PROMPT },
        {
          role: "user",
          content: canonicalize(input as unknown as CanonicalValue),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    };

    const rawResponse = await runWithTimeout(this.#config.timeoutMs, (signal) =>
      this.#transport.create(request, signal),
    );
    const completion = parseCompletion(rawResponse);
    if (new TextEncoder().encode(completion.content).byteLength > this.#config.maxResponseBytes) {
      throw new Error(
        `0G Router response exceeded the ${this.#config.maxResponseBytes}-byte limit`,
      );
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(completion.content);
    } catch (error) {
      throw new TypeError("0G Router returned invalid JSON-object content", { cause: error });
    }
    const assessment = modelRiskAssessmentSchema.strict().parse(decoded);
    const compute = computeMetadataSchema.parse({
      service: "0G Compute",
      mode: "router",
      model: this.#config.model,
      provider: completion.provider,
      requestId: completion.requestId,
      billing: completion.billing,
      generatedAt: this.#clock().toISOString(),
    });

    return { assessment, compute, rawContent: completion.content };
  }
}
