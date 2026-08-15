import "./load-local-env.js";

import { parseEnv } from "./config.js";
import { createLiveRuntime } from "./runtime.js";

const config = parseEnv();
if (config.ACTIONPROOF_MODE !== "live") {
  throw new Error("Live readiness requires ACTIONPROOF_MODE=live");
}

const services = await createLiveRuntime(config).integrationStatus();
console.log(
  JSON.stringify(
    {
      mode: config.ACTIONPROOF_MODE,
      writesEnabled: config.liveWriteEnabled,
      mainnetBroadcastAllowed: config.ALLOW_MAINNET_BROADCAST,
      services,
    },
    null,
    2,
  ),
);

const failedCore = services.filter(
  (service) => service.id !== "identity" && service.status !== "available",
);
const identityFailed =
  config.OG_AGENTIC_ID !== undefined &&
  services.some((service) => service.id === "identity" && service.status !== "available");
if (failedCore.length > 0 || identityFailed) process.exitCode = 1;
