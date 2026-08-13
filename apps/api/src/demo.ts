import { setTimeout as delay } from "node:timers/promises";

import type { ActionRequest } from "@actionproof/core";
import { encodeFunctionData, getAddress, maxUint256 } from "viem";

import { buildApp } from "./app.js";
import { parseEnv } from "./config.js";
import { createSandboxRuntime } from "./runtime.js";
import { MemoryStateStore } from "./store.js";
import type { ActionTrace, AnalysisJob } from "./types.js";

const AGENT = getAddress("0xa17e000000000000000000000000000000000001");
const REQUESTER = getAddress("0xa17e000000000000000000000000000000000002");
const COUNTER = getAddress("0xc001000000000000000000000000000000000001");
const TOKEN = getAddress("0x700e000000000000000000000000000000000001");
const DENIED_SPENDER = getAddress("0xbad0000000000000000000000000000000000001");
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

type DemoScenario = "safe" | "block";

function actionFor(scenario: DemoScenario, nonce: string): ActionRequest {
  const now = Math.floor(Date.now() / 1_000);
  return {
    version: "1",
    agent: AGENT,
    requester: REQUESTER,
    target: scenario === "safe" ? COUNTER : TOKEN,
    value: "0",
    calldata:
      scenario === "safe"
        ? encodeFunctionData({ abi: counterAbi, functionName: "increment" })
        : encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [DENIED_SPENDER, maxUint256],
          }),
    intent:
      scenario === "safe"
        ? "SANDBOX: increment a valueless in-memory demo counter"
        : "SANDBOX: demonstrate that an unlimited approval is blocked",
    destinationChainId: 16602,
    nonce,
    issuedAt: now,
    expiresAt: now + 600,
  };
}

async function getNonce(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/nonces/${REQUESTER}?agent=${AGENT}`,
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  return (response.json() as { nonce: string }).nonce;
}

async function waitForJob(
  app: Awaited<ReturnType<typeof buildApp>>,
  id: string,
): Promise<AnalysisJob> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/jobs/${id}` });
    const job = response.json() as AnalysisJob;
    if (job.status === "completed" || job.status === "failed") return job;
    await delay(10);
  }
  throw new Error(`Sandbox job ${id} timed out`);
}

async function runScenario(
  app: Awaited<ReturnType<typeof buildApp>>,
  scenario: DemoScenario,
): Promise<ActionTrace> {
  const nonce = await getNonce(app);
  const created = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: { action: actionFor(scenario, nonce), execute: true },
  });
  if (created.statusCode !== 202) throw new Error(created.body);
  const job = await waitForJob(app, (created.json() as AnalysisJob).id);
  if (job.status !== "completed" || !job.traceId) {
    throw new Error(`${scenario} demo failed: ${job.error?.message ?? "unknown error"}`);
  }
  const response = await app.inject({ method: "GET", url: `/v1/traces/${job.traceId}` });
  return response.json() as ActionTrace;
}

function printTrace(label: string, trace: ActionTrace): void {
  console.log(`\n=== ${label} — SANDBOX ONLY ===`);
  console.log(`trace:       ${trace.id}`);
  console.log(`verdict:     ${trace.report.verdict}`);
  console.log(`risk score:  ${trace.report.riskScore}`);
  console.log(
    `policy:      ${trace.report.finalPolicy.blockingRuleIds.join(", ") || "no blockers"}`,
  );
  console.log(`storage:     ${trace.storage.rootHash} (in-memory sandbox)`);
  console.log(`anchor tx:   ${trace.chain.transactionHash} (ephemeral sandbox)`);
  console.log(`execution:   ${trace.execution.status}`);
  console.log(`integrity:   ${trace.verification.valid}`);
}

const requested = process.argv[2] ?? "all";
if (!["safe", "block", "tamper", "all"].includes(requested)) {
  throw new Error("Usage: pnpm demo:sandbox [safe|block|tamper|all]");
}

const config = parseEnv({
  ACTIONPROOF_MODE: "sandbox",
  NODE_ENV: "test",
  OG_NETWORK: "galileo",
  OG_CHAIN_ID: "16602",
  DENIED_SPENDERS: DENIED_SPENDER,
});
const runtime = createSandboxRuntime(config);
const app = await buildApp({ config, runtime, store: new MemoryStateStore(), logger: false });

try {
  console.log("ACTIONPROOF SANDBOX DEMO — NO 0G RPC, PAID COMPUTE, STORAGE, OR CHAIN WRITE");
  let trace: ActionTrace | undefined;
  if (requested === "safe" || requested === "all") {
    trace = await runScenario(app, "safe");
    printTrace("SAFE FLOW", trace);
  }
  if (requested === "block" || requested === "all") {
    trace = await runScenario(app, "block");
    printTrace("BLOCKED FLOW", trace);
  }
  if (requested === "tamper" || requested === "all") {
    trace ??= await runScenario(app, "safe");
    const response = await app.inject({
      method: "POST",
      url: `/v1/traces/${trace.id}/verify`,
      payload: { mutation: "reportRoot" },
    });
    const verification = response.json() as ActionTrace["verification"];
    console.log("\n=== TAMPER FLOW — SANDBOX ONLY ===");
    console.log(`original integrity: ${trace.verification.valid}`);
    console.log(`tampered integrity: ${verification.valid}`);
    for (const item of verification.checks.filter((entry) => !entry.valid)) {
      console.log(`failed check: ${item.id} — ${item.detail}`);
    }
    if (verification.valid) throw new Error("Tamper demo unexpectedly verified");
  }
} finally {
  await app.close();
}
