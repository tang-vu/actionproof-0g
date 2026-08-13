import { probePublicNetwork } from "../packages/0g/dist/index.js";

const networks = [
  {
    name: "Galileo",
    chainId: 16602,
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    computeBaseUrl: "https://router-api-testnet.integratenetwork.work/v1",
    storageIndexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  },
  {
    name: "Mainnet",
    chainId: 16661,
    rpcUrl: "https://evmrpc.0g.ai",
    computeBaseUrl: "https://router-api.0g.ai/v1",
    storageIndexerUrl: "https://indexer-storage-turbo.0g.ai",
  },
] as const;

async function main(): Promise<void> {
  let failed = false;
  console.log("ActionProof public 0G readiness probe — READ ONLY, NO KEYS, NO SPEND\n");
  for (const network of networks) {
    console.log(`=== ${network.name} (${network.chainId}) ===`);
    const results = await probePublicNetwork(network);
    for (const result of results) {
      if (result.status === "unavailable") failed = true;
      console.log(
        `${result.status === "available" ? "PASS" : "FAIL"} ${result.name} (${result.latencyMs}ms): ${result.detail}`,
      );
    }
    console.log();
  }
  if (failed) process.exitCode = 1;
}

void main();
