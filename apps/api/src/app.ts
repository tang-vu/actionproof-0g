import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { actionRequestSchema, bytes32Schema } from "@actionproof/core";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { isAddress } from "viem";
import { z, ZodError } from "zod";

import { parseEnv, type AppConfig, type RawEnv } from "./config.js";
import { ApiError } from "./errors.js";
import { Orchestrator, tamperedTrace } from "./orchestrator.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { JsonFileStateStore, MemoryStateStore, type StateStore } from "./store.js";

const idParamsSchema = z.object({ id: z.uuid() }).strict();
const rootParamsSchema = z.object({ rootHash: bytes32Schema }).strict();
const requesterParamsSchema = z
  .object({
    requester: z.string().refine((value) => isAddress(value, { strict: false }), "Invalid address"),
  })
  .strict();
const nonceQuerySchema = z
  .object({
    agent: z
      .string()
      .refine((value) => isAddress(value, { strict: false }), "Invalid address")
      .optional(),
  })
  .strict();
const createJobSchema = z
  .object({
    action: actionRequestSchema.strict(),
    execute: z.boolean().default(false),
  })
  .strict();
const verificationSchema = z
  .object({ mutation: z.enum(["calldata", "reportRoot", "nonce"]).optional() })
  .strict();

export interface BuildAppOptions {
  env?: RawEnv;
  config?: AppConfig;
  runtime?: Runtime;
  store?: StateStore;
  logger?: FastifyServerOptions["logger"];
}

function notFound(resource: string): never {
  throw new ApiError(404, "NOT_FOUND", `${resource} was not found`);
}

function errorEnvelope(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: {
        message: error.message,
        error: {
          code: error.code,
          message: error.message,
          requestId,
          retryable: error.retryable,
        },
      },
    };
  }
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        message: "Request validation failed",
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          requestId,
          retryable: false,
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }
  return {
    statusCode: 500,
    body: {
      message: "Internal service error",
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal service error",
        requestId,
        retryable: false,
      },
    },
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? parseEnv(options.env);
  const runtime = options.runtime ?? createRuntime(config);
  const store =
    options.store ??
    (config.NODE_ENV === "test"
      ? new MemoryStateStore()
      : new JsonFileStateStore(config.API_DATA_DIR));
  await store.initialize();
  const orchestrator = new Orchestrator({ config, runtime, store });
  const app = Fastify({
    logger:
      options.logger ??
      (config.NODE_ENV === "test"
        ? false
        : {
            level: config.NODE_ENV === "production" ? "info" : "debug",
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "*.OG_COMPUTE_API_KEY",
              "*.privateKey",
              "*.signature",
            ],
          }),
    bodyLimit: config.API_BODY_LIMIT,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    origin(origin, callback) {
      if (!origin || config.corsOrigins.has("*") || config.corsOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new ApiError(403, "CORS_ORIGIN_DENIED", "Origin is not allowed"), false);
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: config.API_RATE_LIMIT_MAX,
    timeWindow: config.API_RATE_LIMIT_WINDOW,
    errorResponseBuilder: (request, context) => ({
      message: "Rate limit exceeded",
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded; retry after ${context.after}`,
        requestId: request.id,
        retryable: true,
      },
    }),
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn(
      { err: error, requestId: request.id },
      error instanceof ApiError || error instanceof ZodError
        ? "request rejected"
        : "request failed",
    );
    const envelope = errorEnvelope(error, request.id);
    void reply.code(envelope.statusCode).send(envelope.body);
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      message: "Route not found",
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
        retryable: false,
      },
    });
  });

  const health = () => ({
    ok: true,
    service: "actionproof-api",
    mode: config.ACTIONPROOF_MODE,
    label:
      config.ACTIONPROOF_MODE === "sandbox"
        ? "SANDBOX ONLY — no production services"
        : "LIVE CONFIGURED — paid success is not implied",
  });
  const readiness = async (_request: unknown, reply: { code(status: number): unknown }) => {
    const services = await runtime.integrationStatus();
    const coreAvailable = services
      .filter((service) => service.id !== "identity")
      .every((service) => service.status === "available" || service.status === "sandbox");
    const identityAvailable =
      config.OG_AGENTIC_ID === undefined ||
      services.some((service) => service.id === "identity" && service.status === "available");
    const ready =
      (runtime.mode === "sandbox" || config.liveWriteEnabled) && coreAvailable && identityAvailable;
    if (!ready) reply.code(503);
    return {
      ready,
      mode: runtime.mode,
      reason: ready
        ? "runtime and required integration probes passed"
        : "a safety gate or required integration probe failed",
      services,
    };
  };
  app.get("/health", health);
  app.get("/healthz", health);
  app.get("/ready", readiness);
  app.get("/readyz", readiness);

  app.get("/v1/integrations", async () => ({
    mode: runtime.mode,
    writesEnabled: runtime.mode === "live" && config.liveWriteEnabled,
    network: {
      name: config.OG_NETWORK === "galileo" ? "0G Galileo Testnet" : "0G Mainnet",
      chainId: config.OG_CHAIN_ID,
    },
    services: await runtime.integrationStatus(),
  }));

  app.get("/v1/nonces/:requester", async (request) => {
    const params = requesterParamsSchema.parse(request.params);
    const query = nonceQuerySchema.parse(request.query);
    const agent = (query.agent ?? config.defaultAgentAddress) as `0x${string}`;
    const requester = params.requester as `0x${string}`;
    const nonce = await orchestrator.nextNonce(agent, requester);
    return {
      agent,
      requester,
      nonce: nonce.toString(),
      chainId: config.OG_CHAIN_ID,
      note: "Submit this exact nonce; POST /v1/jobs never rewrites it.",
    };
  });

  app.post("/v1/jobs", async (request, reply) => {
    if (runtime.mode === "live" && !config.liveWriteEnabled) {
      throw new ApiError(
        503,
        "LIVE_WRITES_DISABLED",
        "This public deployment is read-only; live analysis requires an operator to enable the network safety gate",
      );
    }
    const body = createJobSchema.parse(request.body);
    const job = await orchestrator.createJob(body);
    return reply.code(202).send(job);
  });
  app.get("/v1/jobs/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return orchestrator.getJob(id) ?? notFound("Job");
  });

  app.get("/v1/traces", async () => ({ traces: store.listTraces() }));
  app.get("/v1/traces/:id", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return store.getTrace(id) ?? notFound("Trace");
  });
  app.post("/v1/traces/:id/verify", async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = verificationSchema.parse(request.body ?? {});
    const trace = store.getTrace(id) ?? notFound("Trace");
    return orchestrator.verify(body.mutation ? tamperedTrace(trace, body.mutation) : trace);
  });

  app.get("/v1/reports/:rootHash", async (request) => {
    const { rootHash } = rootParamsSchema.parse(request.params);
    const trace = store.findTraceByRoot(rootHash) ?? notFound("Report");
    const integrity = await orchestrator.verify(trace);
    if (!integrity.valid) {
      throw new ApiError(409, "INTEGRITY_FAILED", "Stored report failed integrity verification");
    }
    return {
      rootHash,
      report: trace.report,
      canonical: trace.reportCanonical,
      integrity,
    };
  });

  return app;
}
