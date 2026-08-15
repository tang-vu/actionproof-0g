import { setTimeout as delay } from "node:timers/promises";

import "./load-local-env.js";

import type { ActionRequest } from "@actionproof/core";
import { encodeFunctionData, maxUint256, type Address } from "viem";

import { buildApp } from "./app.js";
import { parseEnv, requireLiveValue } from "./config.js";
import { createLiveRuntime } from "./runtime.js";
import { JsonFileStateStore } from "./store.js";
import type { ActionTrace, AnalysisJob } from "./types.js";

type LiveScenario = "safe" | "block";

const checkOnly = process.argv.includes("--check-only");
const requested = process.argv.find((argument) => ["safe", "block", "all"].includes(argument));
const selection = (requested ?? "all") as LiveScenario | "all";
const config = parseEnv();

if (config.ACTIONPROOF_MODE !== "live") {
  console.log("Live demo skipped: ACTIONPROOF_MODE is not live. No funds were spent.");
  process.exit(0);
}
if (!config.liveWriteEnabled) {
  throw new Error("Live demo refused: ENABLE_LIVE_WRITES/network gates are not enabled");
}
if (checkOnly) {
  console.log("Live configuration and safety gates parsed. Check-only mode made no network call.");
  process.exit(0);
}

const expectedConfirmation =
  config.OG_NETWORK === "mainnet" ? "SPEND_MAINNET_0G" : "SPEND_GALILEO_0G";
if (config.LIVE_SMOKE_CONFIRM !== expectedConfirmation) {
  throw new Error(
    `Live demo refused: set LIVE_SMOKE_CONFIRM=${expectedConfirmation} to acknowledge paid writes`,
  );
}

const runtime = createLiveRuntime(config);
const requester = requireLiveValue(runtime.requesterAddress, "live requester account");
const counter = requireLiveValue(config.DEMO_COUNTER_ADDRESS, "DEMO_COUNTER_ADDRESS") as Address;
const token = requireLiveValue(config.DEMO_TOKEN_ADDRESS, "DEMO_TOKEN_ADDRESS") as Address;
const app = await buildApp({
  config,
  runtime,
  store: new JsonFileStateStore(config.API_DATA_DIR),
  logger: false,
});
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

function actionFor(scenario: LiveScenario, nonce: string): ActionRequest {
  const now = Math.floor(Date.now() / 1_000);
  return {
    version: "1",
    agent: config.defaultAgentAddress,
    requester,
    target: scenario === "safe" ? counter : token,
    value: "0",
    calldata:
      scenario === "safe"
        ? encodeFunctionData({ abi: counterAbi, functionName: "increment" })
        : encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [requester, maxUint256],
          }),
    intent:
      scenario === "safe"
        ? "LIVE GALILEO DEMO: increment the deployed valueless demo counter once"
        : "LIVE GALILEO DEMO: prove that an unlimited token approval is blocked",
    destinationChainId: config.OG_CHAIN_ID,
    nonce,
    issuedAt: now,
    expiresAt: now + 600,
  };
}

async function nextNonce(): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/nonces/${requester}?agent=${config.defaultAgentAddress}`,
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  return (response.json() as { nonce: string }).nonce;
}

async function waitForJob(id: string): Promise<AnalysisJob> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/jobs/${id}` });
    const job = response.json() as AnalysisJob;
    if (job.status === "completed" || job.status === "failed") return job;
    await delay(500);
  }
  throw new Error(`Live ${id} timed out after five minutes`);
}

async function runScenario(scenario: LiveScenario): Promise<ActionTrace> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: { action: actionFor(scenario, await nextNonce()), execute: true },
  });
  if (created.statusCode !== 202) throw new Error(created.body);
  const job = await waitForJob((created.json() as AnalysisJob).id);
  if (job.status !== "completed" || !job.traceId) {
    throw new Error(`Live ${scenario} failed closed: ${job.error?.message ?? "unknown error"}`);
  }
  const response = await app.inject({ method: "GET", url: `/v1/traces/${job.traceId}` });
  if (response.statusCode !== 200) throw new Error(response.body);
  const trace = response.json() as ActionTrace;
  const commonValid =
    trace.mode === "live" &&
    trace.report.compute.mode === "router" &&
    trace.storage.mode === "0g" &&
    trace.chain.mode === "0g" &&
    trace.verification.valid;
  const scenarioValid =
    scenario === "safe"
      ? trace.report.verdict === "allow" && trace.execution.status === "executed"
      : trace.report.verdict === "block" &&
        trace.execution.status === "blocked" &&
        trace.report.finalPolicy.blockingRuleIds.includes("UNLIMITED_ERC20_APPROVAL");
  if (!commonValid || !scenarioValid) {
    throw new Error(
      `Live ${scenario} invariant failed: verdict=${trace.report.verdict}, execution=${trace.execution.status}, verification=${trace.verification.valid}`,
    );
  }
  return trace;
}

function summary(trace: ActionTrace) {
  return {
    traceId: trace.id,
    actionHash: trace.actionHash,
    reportHash: trace.reportHash,
    verdict: trace.report.verdict,
    riskScore: trace.report.riskScore,
    blockingRuleIds: trace.report.finalPolicy.blockingRuleIds,
    model: trace.report.compute.model,
    provider: trace.report.compute.provider,
    requestId: trace.report.compute.requestId,
    storage: trace.storage,
    anchor: trace.chain,
    execution: trace.execution,
    verification: trace.verification,
  };
}

try {
  const evidence: Record<string, unknown> = {
    network: config.OG_NETWORK,
    chainId: config.OG_CHAIN_ID,
  };
  let tamperTarget: ActionTrace | undefined;
  if (selection === "safe" || selection === "all") {
    const trace = await runScenario("safe");
    evidence["safe"] = summary(trace);
    tamperTarget = trace;
  }
  if (selection === "block" || selection === "all") {
    const trace = await runScenario("block");
    evidence["dangerous"] = summary(trace);
    tamperTarget ??= trace;
  }
  if (!tamperTarget) throw new Error("Live demo did not produce a trace for tamper verification");
  const tamperResponse = await app.inject({
    method: "POST",
    url: `/v1/traces/${tamperTarget.id}/verify`,
    payload: { mutation: "calldata" },
  });
  if (tamperResponse.statusCode !== 200) throw new Error(tamperResponse.body);
  const tamper = tamperResponse.json() as ActionTrace["verification"];
  if (tamper.valid) throw new Error("Live tamper mutation unexpectedly verified");
  evidence["tamper"] = {
    sourceTraceId: tamperTarget.id,
    mutation: "calldata",
    valid: tamper.valid,
    failedChecks: tamper.checks.filter((check) => !check.valid),
    checkedAt: tamper.checkedAt,
  };
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await app.close();
}
