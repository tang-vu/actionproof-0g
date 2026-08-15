import "./load-local-env.js";

import { ZgComputeRouterAdapter } from "@actionproof/0g";
import type { ActionRequest, SimulationResult } from "@actionproof/core";

import { parseEnv, requireLiveValue } from "./config.js";

const config = parseEnv();
if (config.ACTIONPROOF_MODE !== "live") throw new Error("Compute smoke requires live mode");
const expectedConfirmation =
  config.OG_NETWORK === "mainnet" ? "SPEND_MAINNET_0G" : "SPEND_GALILEO_0G";
if (config.LIVE_SMOKE_CONFIRM !== expectedConfirmation) {
  throw new Error(
    `Compute smoke refused: set LIVE_SMOKE_CONFIRM=${expectedConfirmation} to acknowledge paid inference`,
  );
}

const adapter = new ZgComputeRouterAdapter({
  apiKey: requireLiveValue(config.OG_COMPUTE_API_KEY, "OG_COMPUTE_API_KEY"),
  baseURL: requireLiveValue(config.OG_COMPUTE_BASE_URL, "OG_COMPUTE_BASE_URL"),
  model: requireLiveValue(config.OG_COMPUTE_MODEL, "OG_COMPUTE_MODEL"),
  timeoutMs: config.OG_COMPUTE_TIMEOUT_MS,
});
const now = Math.floor(Date.now() / 1_000);
const action: ActionRequest = {
  version: "1",
  agent: config.defaultAgentAddress,
  requester: config.defaultAgentAddress,
  target: requireLiveValue(config.DEMO_COUNTER_ADDRESS, "DEMO_COUNTER_ADDRESS"),
  value: "0",
  calldata: "0xd09de08a",
  intent: "Compute-only smoke: assess a valueless demo counter increment",
  destinationChainId: config.OG_CHAIN_ID,
  nonce: "0",
  issuedAt: now,
  expiresAt: now + 600,
};
const simulation: SimulationResult = {
  success: true,
  networkChainId: config.OG_CHAIN_ID,
  gasEstimate: "50000",
  returnData: "0x",
  targetHasCode: true,
  targetVerification: "verified",
  effects: [
    {
      kind: "state-change",
      summary: "Demo counter increments by one.",
      unexpected: false,
    },
  ],
  observedAt: new Date().toISOString(),
};
const result = await adapter.assess({
  action,
  simulation,
  deterministicFindings: [],
  policyVersion: "actionproof-policy/1",
});
console.log(
  JSON.stringify(
    {
      assessment: result.assessment,
      compute: result.compute,
    },
    null,
    2,
  ),
);
