import "./load-local-env.js";

import { buildApp } from "./app.js";
import { parseEnv } from "./config.js";

const config = parseEnv();
const app = await buildApp({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(
    {
      host: config.API_HOST,
      port: config.API_PORT,
      mode: config.ACTIONPROOF_MODE,
      liveWrites: config.liveWriteEnabled,
    },
    "ActionProof API listening",
  );
} catch (error) {
  app.log.fatal({ err: error }, "failed to start API");
  process.exitCode = 1;
  await app.close();
}
