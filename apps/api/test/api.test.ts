import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ActionRequest, AgentIdentityEvidence } from "@actionproof/core";
import type { FastifyInstance } from "fastify";
import { encodeFunctionData, getAddress, maxUint256 } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { parseEnv, type AppConfig } from "../src/config.js";
import { createSandboxRuntime, type Runtime } from "../src/runtime.js";
import { JsonFileStateStore, MemoryStateStore } from "../src/store.js";
import type { ActionTrace, AnalysisJob } from "../src/types.js";

const AGENT = getAddress("0xa17e000000000000000000000000000000000001");
const REQUESTER = getAddress("0xa17e000000000000000000000000000000000002");
const COUNTER = getAddress("0xc001000000000000000000000000000000000001");
const TOKEN = getAddress("0x700e000000000000000000000000000000000001");
const SPENDER = getAddress("0xbad0000000000000000000000000000000000001");
const counterAbi = [
  {
    type: "function",
    name: "increment",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const tokenAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const openApps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function config() {
  return parseEnv({
    ACTIONPROOF_MODE: "sandbox",
    NODE_ENV: "test",
    OG_NETWORK: "galileo",
    OG_CHAIN_ID: "16602",
    DENIED_SPENDERS: SPENDER,
  });
}

async function createApp(
  runtime?: Runtime,
  parsed: AppConfig = config(),
): Promise<FastifyInstance> {
  const app = await buildApp({
    config: parsed,
    runtime: runtime ?? createSandboxRuntime(parsed),
    store: new MemoryStateStore(),
    logger: false,
  });
  openApps.push(app);
  return app;
}

function action(args: { nonce: string; dangerous?: boolean }): ActionRequest {
  const now = Math.floor(Date.now() / 1_000);
  const dangerous = args.dangerous ?? false;
  return {
    version: "1",
    agent: AGENT,
    requester: REQUESTER,
    target: dangerous ? TOKEN : COUNTER,
    value: "0",
    calldata: dangerous
      ? encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [SPENDER, maxUint256],
        })
      : encodeFunctionData({ abi: counterAbi, functionName: "increment" }),
    intent: dangerous ? "Approve the sandbox spender" : "Increment the sandbox demo counter",
    destinationChainId: 16602,
    nonce: args.nonce,
    issuedAt: now,
    expiresAt: now + 600,
  };
}

async function nextNonce(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/nonces/${REQUESTER}?agent=${AGENT}`,
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { nonce: string }).nonce;
}

async function submit(app: FastifyInstance, input: ActionRequest): Promise<AnalysisJob> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: { action: input, execute: true },
  });
  expect(response.statusCode).toBe(202);
  return response.json() as AnalysisJob;
}

async function terminalJob(app: FastifyInstance, id: string): Promise<AnalysisJob> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/jobs/${id}` });
    const job = response.json() as AnalysisJob;
    if (job.status === "completed" || job.status === "failed") return job;
    await delay(5);
  }
  throw new Error(`Job ${id} did not reach a terminal state`);
}

async function getTrace(app: FastifyInstance, job: AnalysisJob): Promise<ActionTrace> {
  expect(job.traceId).toBeDefined();
  const response = await app.inject({ method: "GET", url: `/v1/traces/${job.traceId}` });
  expect(response.statusCode).toBe(200);
  return response.json() as ActionTrace;
}

describe("ActionProof API sandbox pipeline", () => {
  it("executes an allowed action, anchors a blocked action, and detects tampering", async () => {
    const app = await createApp();
    const safeNonce = await nextNonce(app);
    expect(safeNonce).toBe("0");
    const safeJob = await terminalJob(app, (await submit(app, action({ nonce: safeNonce }))).id);
    expect(safeJob.status).toBe("completed");
    const safeTrace = await getTrace(app, safeJob);
    expect(safeTrace.mode).toBe("sandbox");
    expect(safeTrace.report.verdict).toBe("allow");
    expect(safeTrace.execution.status).toBe("executed");
    expect(safeTrace.verification.valid).toBe(true);
    expect(safeJob.steps.map((step) => step.status)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
    ]);

    const reportResponse = await app.inject({
      method: "GET",
      url: `/v1/reports/${safeTrace.storage.rootHash}`,
    });
    expect(reportResponse.statusCode).toBe(200);
    expect((reportResponse.json() as { integrity: { valid: boolean } }).integrity.valid).toBe(true);

    const originalVerification = await app.inject({
      method: "POST",
      url: `/v1/traces/${safeTrace.id}/verify`,
      payload: {},
    });
    expect(originalVerification.statusCode).toBe(200);
    expect((originalVerification.json() as ActionTrace["verification"]).valid).toBe(true);

    const blockedNonce = await nextNonce(app);
    expect(blockedNonce).toBe("1");
    const blockedJob = await terminalJob(
      app,
      (await submit(app, action({ nonce: blockedNonce, dangerous: true }))).id,
    );
    expect(blockedJob.status).toBe("completed");
    const blockedTrace = await getTrace(app, blockedJob);
    expect(blockedTrace.report.verdict).toBe("block");
    expect(blockedTrace.report.finalPolicy.blockingRuleIds).toContain("UNLIMITED_ERC20_APPROVAL");
    expect(blockedTrace.execution.status).toBe("blocked");
    expect(blockedJob.steps.find((step) => step.id === "anchoring")?.status).toBe("complete");
    expect(blockedJob.steps.find((step) => step.id === "execution")?.status).toBe("skipped");
    expect(blockedTrace.chain.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/u);

    const tamperResponse = await app.inject({
      method: "POST",
      url: `/v1/traces/${safeTrace.id}/verify`,
      payload: { mutation: "reportRoot" },
    });
    expect(tamperResponse.statusCode).toBe(200);
    const tampered = tamperResponse.json() as ActionTrace["verification"];
    expect(tampered.valid).toBe(false);
    expect(tampered.checks.some((entry) => entry.id === "chain-anchor" && !entry.valid)).toBe(true);
  });

  it("does not rewrite a stale submitted nonce", async () => {
    const app = await createApp();
    const submitted = action({ nonce: "99" });
    const terminal = await terminalJob(app, (await submit(app, submitted)).id);
    expect(terminal.status).toBe("failed");
    expect(terminal.error?.code).toBe("NONCE_MISMATCH");
    expect(terminal.error?.message).toContain("Submitted nonce 99");
    expect(await nextNonce(app)).toBe("0");
  });

  it("turns malformed Compute output into an anchored block", async () => {
    const parsed = config();
    const base = createSandboxRuntime(parsed);
    const runtime: Runtime = {
      ...base,
      compute: {
        mode: "sandbox",
        async assess(input) {
          const validEnvelope = await base.compute.assess(input);
          return { ...validEnvelope, rawContent: '{"verdict":"allow"}' };
        },
      },
    };
    const app = await createApp(runtime);
    const job = await terminalJob(app, (await submit(app, action({ nonce: "0" }))).id);
    expect(job.status).toBe("completed");
    const trace = await getTrace(app, job);
    expect(trace.report.verdict).toBe("block");
    expect(trace.report.finalPolicy.blockingRuleIds).toContain("COMPUTE_RESPONSE_INVALID");
    expect(trace.execution.status).toBe("blocked");
    expect(trace.verification.valid).toBe(true);
  });

  it("returns bounded validation envelopes and readiness labels", async () => {
    const app = await createApp();
    const invalid = await app.inject({ method: "GET", url: "/v1/nonces/not-an-address" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED", retryable: false },
    });
    const unknownActionField = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { action: { ...action({ nonce: "0" }), unexpected: true }, execute: true },
    });
    expect(unknownActionField.statusCode).toBe(400);
    expect(unknownActionField.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toMatchObject({ ok: true, mode: "sandbox" });
    expect((health.json() as { label: string }).label).toContain("SANDBOX ONLY");
    const integrations = await app.inject({ method: "GET", url: "/v1/integrations" });
    const statuses = integrations.json() as {
      writesEnabled: boolean;
      services: Array<{ id: string; status: string; detail: string }>;
    };
    expect(statuses.writesEnabled).toBe(false);
    expect(
      statuses.services
        .filter((service) => service.id !== "identity")
        .every(
          (service) => service.status === "sandbox" && service.detail.includes("SANDBOX ONLY"),
        ),
    ).toBe(true);
    expect(statuses.services.find((service) => service.id === "identity")?.status).toBe(
      "unavailable",
    );
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ready: true, mode: "sandbox" });
  });

  it("binds a configured ERC-8004 identity and blocks wallet mismatches", async () => {
    const identityConfig = parseEnv({
      ACTIONPROOF_MODE: "sandbox",
      NODE_ENV: "test",
      OG_NETWORK: "galileo",
      OG_CHAIN_ID: "16602",
      OG_AGENTIC_ID: "7",
    });
    const identity = (matchesActionAgent: boolean): AgentIdentityEvidence => ({
      standard: "ERC-8004",
      chainId: 16602,
      registry: getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
      agentId: "7",
      owner: REQUESTER,
      agentWallet: matchesActionAgent ? AGENT : SPENDER,
      tokenUri: "ipfs://actionproof-agent-7",
      matchesActionAgent,
      checkedAt: new Date().toISOString(),
      explorerUrl:
        "https://chainscan-galileo.0g.ai/address/0x8004A818BFB912233c491871b3d84c89A494BD9e",
    });

    const matchingBase = createSandboxRuntime(identityConfig);
    const matchingRuntime: Runtime = {
      ...matchingBase,
      resolveAgentIdentity: async () => identity(true),
    };
    const matchingApp = await createApp(matchingRuntime, identityConfig);
    const matchingJob = await terminalJob(
      matchingApp,
      (await submit(matchingApp, action({ nonce: "0" }))).id,
    );
    const matchingTrace = await getTrace(matchingApp, matchingJob);
    expect(matchingTrace.report.verdict).toBe("allow");
    expect(matchingTrace.report.agentIdentity).toMatchObject({
      agentId: "7",
      matchesActionAgent: true,
    });

    const mismatchBase = createSandboxRuntime(identityConfig);
    const mismatchRuntime: Runtime = {
      ...mismatchBase,
      resolveAgentIdentity: async () => identity(false),
    };
    const mismatchApp = await createApp(mismatchRuntime, identityConfig);
    const mismatchJob = await terminalJob(
      mismatchApp,
      (await submit(mismatchApp, action({ nonce: "0" }))).id,
    );
    const mismatchTrace = await getTrace(mismatchApp, mismatchJob);
    expect(mismatchTrace.report.verdict).toBe("block");
    expect(mismatchTrace.report.finalPolicy.blockingRuleIds).toContain(
      "AGENTIC_ID_WALLET_MISMATCH",
    );
    expect(mismatchTrace.execution.status).toBe("blocked");
  });

  it("requires the explicit mainnet broadcast gate", () => {
    const liveMainnet = {
      ACTIONPROOF_MODE: "live",
      OG_NETWORK: "mainnet",
      OG_CHAIN_ID: "16661",
      OG_RPC_URL: "https://rpc.example.test",
      OG_EXPLORER_URL: "https://chainscan.example.test",
      OG_STORAGE_INDEXER_URL: "https://indexer.example.test",
      OG_STORAGE_EXPLORER_URL: "https://storage.example.test",
      OG_STORAGE_PRIVATE_KEY: `0x${"11".repeat(32)}`,
      OG_COMPUTE_BASE_URL: "https://compute.example.test",
      OG_COMPUTE_API_KEY: "test-only-key",
      OG_COMPUTE_MODEL: "test-only-model",
      VERIFIER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      RELAYER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
      ACTIONPROOF_GUARD_ADDRESS: COUNTER,
      ENABLE_LIVE_WRITES: "true",
    };
    expect(() =>
      parseEnv({
        ...liveMainnet,
      }),
    ).toThrow(/ALLOW_MAINNET_BROADCAST/u);

    const explicitlyAllowed = parseEnv({
      ...liveMainnet,
      ALLOW_MAINNET_BROADCAST: "true",
    });
    expect(explicitlyAllowed.liveWriteEnabled).toBe(true);
  });

  it("rejects public live submissions synchronously when writes are disabled", async () => {
    const parsed = parseEnv({
      ACTIONPROOF_MODE: "live",
      NODE_ENV: "test",
      OG_NETWORK: "galileo",
      OG_CHAIN_ID: "16602",
      OG_RPC_URL: "https://rpc.example.test",
      OG_EXPLORER_URL: "https://chainscan.example.test",
      OG_STORAGE_INDEXER_URL: "https://indexer.example.test",
      OG_STORAGE_EXPLORER_URL: "https://storage.example.test",
      OG_STORAGE_PRIVATE_KEY: `0x${"11".repeat(32)}`,
      OG_COMPUTE_BASE_URL: "https://compute.example.test",
      OG_COMPUTE_API_KEY: "test-only-key",
      OG_COMPUTE_MODEL: "test-only-model",
      VERIFIER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      RELAYER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
      ACTIONPROOF_GUARD_ADDRESS: COUNTER,
      ENABLE_LIVE_WRITES: "false",
    });
    const sandbox = createSandboxRuntime(parsed);
    const app = await createApp({ ...sandbox, mode: "live" }, parsed);
    const response = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      payload: { action: action({ nonce: "0" }), execute: true },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "LIVE_WRITES_DISABLED" } });
  });

  it("persists completed jobs and traces across store instances", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "actionproof-api-test-"));
    temporaryDirectories.push(directory);
    const parsed = config();
    const store = new JsonFileStateStore(directory);
    const app = await buildApp({
      config: parsed,
      runtime: createSandboxRuntime(parsed),
      store,
      logger: false,
    });
    openApps.push(app);

    const completed = await terminalJob(app, (await submit(app, action({ nonce: "0" }))).id);
    expect(completed.status).toBe("completed");
    expect(completed.traceId).toBeDefined();

    const reloaded = new JsonFileStateStore(directory);
    await reloaded.initialize();
    expect(await reloaded.getJob(completed.id)).toMatchObject({
      id: completed.id,
      status: "completed",
      traceId: completed.traceId,
    });
    expect(await reloaded.getTrace(completed.traceId!)).toMatchObject({
      id: completed.traceId,
      action: { nonce: "0", requester: REQUESTER },
      verification: { valid: true },
    });
  });
});
