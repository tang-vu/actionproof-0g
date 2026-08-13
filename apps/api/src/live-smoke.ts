import { setTimeout as delay } from "node:timers/promises";

import type { ActionRequest } from "@actionproof/core";
import { encodeFunctionData } from "viem";

import { buildApp } from "./app.js";
import { parseEnv, requireLiveValue } from "./config.js";
import { createLiveRuntime } from "./runtime.js";
import { MemoryStateStore } from "./store.js";
import type { AnalysisJob } from "./types.js";

const checkOnly = process.argv.includes("--check-only");
const config = parseEnv();

if (config.ACTIONPROOF_MODE !== "live") {
  console.log("Live smoke skipped: ACTIONPROOF_MODE is not live. No funds were spent.");
  process.exit(0);
}
if (!config.liveWriteEnabled) {
  throw new Error("Live smoke refused: ENABLE_LIVE_WRITES/network gates are not enabled");
}
if (checkOnly) {
  console.log("Live configuration and safety gates parsed. Check-only mode made no network call.");
  process.exit(0);
}

const expectedConfirmation =
  config.OG_NETWORK === "mainnet" ? "SPEND_MAINNET_0G" : "SPEND_GALILEO_0G";
if (config.LIVE_SMOKE_CONFIRM !== expectedConfirmation) {
  throw new Error(
    `Live smoke refused: set LIVE_SMOKE_CONFIRM=${expectedConfirmation} to acknowledge paid writes`,
  );
}

const runtime = createLiveRuntime(config);
const requester = requireLiveValue(runtime.requesterAddress, "live requester account");
const target = requireLiveValue(config.DEMO_COUNTER_ADDRESS, "DEMO_COUNTER_ADDRESS");
const app = await buildApp({ config, runtime, store: new MemoryStateStore() });
const counterAbi = [
  {
    type: "function",
    name: "increment",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

try {
  const nonceResponse = await app.inject({
    method: "GET",
    url: `/v1/nonces/${requester}?agent=${config.defaultAgentAddress}`,
  });
  if (nonceResponse.statusCode !== 200) throw new Error(nonceResponse.body);
  const nonce = (nonceResponse.json() as { nonce: string }).nonce;
  const now = Math.floor(Date.now() / 1_000);
  const action: ActionRequest = {
    version: "1",
    agent: config.defaultAgentAddress,
    requester,
    target,
    value: "0",
    calldata: encodeFunctionData({ abi: counterAbi, functionName: "increment" }),
    intent: "Opt-in live smoke: increment the deployed valueless demo counter once",
    destinationChainId: config.OG_CHAIN_ID,
    nonce,
    issuedAt: now,
    expiresAt: now + 600,
  };
  const created = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    payload: { action, execute: true },
  });
  if (created.statusCode !== 202) throw new Error(created.body);
  const id = (created.json() as AnalysisJob).id;
  let terminal: AnalysisJob | undefined;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/jobs/${id}` });
    const job = response.json() as AnalysisJob;
    if (job.status === "completed" || job.status === "failed") {
      terminal = job;
      break;
    }
    await delay(500);
  }
  if (!terminal) throw new Error("Live smoke timed out after five minutes");
  if (terminal.status !== "completed") {
    throw new Error(`Live smoke failed closed: ${terminal.error?.message ?? "unknown error"}`);
  }
  console.log(`Live smoke completed on ${config.OG_NETWORK}; trace=${terminal.traceId}`);
} finally {
  await app.close();
}
