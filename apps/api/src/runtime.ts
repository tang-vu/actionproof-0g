import {
  SandboxChainAdapter,
  SandboxComputeAdapter,
  SandboxStorageAdapter,
  ZgChainAdapter,
  ZgComputeRouterAdapter,
  ZgStorageAdapter,
  type ChainAdapter,
  type ComputeAdapter,
  type StorageAdapter,
} from "@actionproof/0g";
import type { ModelRiskAssessment } from "@actionproof/core";
import { JsonRpcProvider, Wallet } from "ethers";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { asPrivateKey, requireLiveValue, type AppConfig } from "./config.js";

export interface RuntimeServiceStatus {
  id: "chain" | "compute" | "storage";
  name: string;
  status: "available" | "unavailable" | "sandbox";
  detail: string;
  endpoint?: string;
  explorerUrl?: string;
}

/** Narrow boundary consumed by the API. Keep adapters behind this interface. */
export interface Runtime {
  readonly mode: "live" | "sandbox";
  readonly chain: ChainAdapter;
  readonly compute: ComputeAdapter;
  readonly storage: StorageAdapter;
  readonly requesterAddress?: Address;
  integrationStatus(): RuntimeServiceStatus[];
}

const SANDBOX_ALLOW: ModelRiskAssessment = {
  verdict: "allow",
  riskScore: 12,
  confidence: 0.84,
  modelFindings: [],
  evidence: ["Deterministic sandbox assessment; no external model was called."],
  reasons: ["Sandbox model found no additional risk beyond deterministic evidence."],
  recommendedAction: "Respect the deterministic policy verdict.",
  limitations: ["SANDBOX ONLY: this is not a live 0G Compute result."],
};

export function createSandboxRuntime(config: AppConfig): Runtime {
  const chain = new SandboxChainAdapter({ chainId: config.OG_CHAIN_ID });
  const compute = new SandboxComputeAdapter({ assessment: SANDBOX_ALLOW });
  const storage = new SandboxStorageAdapter();
  return {
    mode: "sandbox",
    chain,
    compute,
    storage,
    integrationStatus: () => [
      {
        id: "chain",
        name: "0G Chain",
        status: "sandbox",
        detail: "SANDBOX ONLY — ephemeral EIP-712 signer and in-memory chain state; no RPC writes.",
      },
      {
        id: "compute",
        name: "0G Compute",
        status: "sandbox",
        detail: "SANDBOX ONLY — deterministic local assessment; no model or paid Router request.",
      },
      {
        id: "storage",
        name: "0G Storage",
        status: "sandbox",
        detail: "SANDBOX ONLY — in-memory bytes with the SDK Merkle algorithm; no paid upload.",
      },
    ],
  };
}

export function createLiveRuntime(config: AppConfig): Runtime {
  const rpcUrl = requireLiveValue(config.OG_RPC_URL, "OG_RPC_URL");
  const explorerUrl = requireLiveValue(config.OG_EXPLORER_URL, "OG_EXPLORER_URL");
  const storageIndexer = requireLiveValue(config.OG_STORAGE_INDEXER_URL, "OG_STORAGE_INDEXER_URL");
  const storageExplorer = requireLiveValue(
    config.OG_STORAGE_EXPLORER_URL,
    "OG_STORAGE_EXPLORER_URL",
  );
  const computeUrl = requireLiveValue(config.OG_COMPUTE_BASE_URL, "OG_COMPUTE_BASE_URL");
  const relayer = privateKeyToAccount(
    asPrivateKey(config.RELAYER_PRIVATE_KEY, "RELAYER_PRIVATE_KEY"),
  );
  const verifier = privateKeyToAccount(
    asPrivateKey(config.VERIFIER_PRIVATE_KEY, "VERIFIER_PRIVATE_KEY"),
  );
  const chainDefinition = defineChain({
    id: config.OG_CHAIN_ID,
    name: config.OG_NETWORK === "galileo" ? "0G Galileo Testnet" : "0G Mainnet",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "0G ChainScan", url: explorerUrl } },
  });
  const publicClient = createPublicClient({ chain: chainDefinition, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account: relayer,
    chain: chainDefinition,
    transport: http(rpcUrl),
  });
  const chain = new ZgChainAdapter({
    publicClient,
    walletClient,
    relayerAccount: relayer,
    verifierAccount: verifier,
    guardAddress: requireLiveValue(
      config.ACTIONPROOF_GUARD_ADDRESS,
      "ACTIONPROOF_GUARD_ADDRESS",
    ) as Address,
    explorerBaseUrl: explorerUrl,
  });
  const compute = new ZgComputeRouterAdapter({
    apiKey: requireLiveValue(config.OG_COMPUTE_API_KEY, "OG_COMPUTE_API_KEY"),
    baseURL: computeUrl,
    model: requireLiveValue(config.OG_COMPUTE_MODEL, "OG_COMPUTE_MODEL"),
    timeoutMs: config.OG_COMPUTE_TIMEOUT_MS,
  });
  const storageProvider = new JsonRpcProvider(rpcUrl);
  const storageSigner = new Wallet(
    asPrivateKey(config.OG_STORAGE_PRIVATE_KEY, "OG_STORAGE_PRIVATE_KEY"),
    storageProvider,
  );
  const storage = new ZgStorageAdapter({
    indexerUrl: storageIndexer,
    rpcUrl,
    signer: storageSigner,
    explorerUrl: storageExplorer,
  });
  const available = config.liveWriteEnabled ? "available" : "unavailable";
  const gateDetail = config.liveWriteEnabled
    ? "Configured for live use; readiness does not claim a paid request has succeeded."
    : "Configured but live writes are disabled by ENABLE_LIVE_WRITES.";
  return {
    mode: "live",
    chain,
    compute,
    storage,
    requesterAddress: relayer.address,
    integrationStatus: () => [
      {
        id: "chain",
        name: "0G Chain",
        status: available,
        detail: gateDetail,
        endpoint: rpcUrl,
      },
      {
        id: "compute",
        name: "0G Compute Router",
        status: available,
        detail: gateDetail,
        endpoint: computeUrl,
      },
      {
        id: "storage",
        name: "0G Storage Turbo",
        status: available,
        detail: `${gateDetail} Report receipts link to 0G StorageScan.`,
        endpoint: storageIndexer,
        explorerUrl: storageExplorer,
      },
    ],
  };
}

export function createRuntime(config: AppConfig): Runtime {
  return config.ACTIONPROOF_MODE === "live"
    ? createLiveRuntime(config)
    : createSandboxRuntime(config);
}
