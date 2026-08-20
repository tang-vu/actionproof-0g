import {
  Erc8004IdentityResolver,
  LocalAttestationSigner,
  RemoteAttestationSigner,
  SandboxChainAdapter,
  SandboxComputeAdapter,
  SandboxStorageAdapter,
  ZgChainAdapter,
  ZgComputeRouterAdapter,
  ZgStorageAdapter,
  actionProofGuardAbi,
  probePublicNetwork,
  type ChainAdapter,
  type ComputeAdapter,
  type PublicProbeResult,
  type StorageAdapter,
} from "@actionproof/0g";
import type { AgentIdentityEvidence, ModelRiskAssessment } from "@actionproof/core";
import { JsonRpcProvider, Wallet } from "ethers";
import { createPublicClient, createWalletClient, defineChain, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { asPrivateKey, requireLiveValue, type AppConfig } from "./config.js";

export interface RuntimeServiceStatus {
  id: "chain" | "compute" | "storage" | "identity" | "signer";
  name: string;
  status: "available" | "unavailable" | "sandbox";
  detail: string;
  endpoint?: string;
  explorerUrl?: string;
  latencyMs?: number;
  checkedAt?: string;
}

/** Narrow boundary consumed by the API. Keep adapters behind this interface. */
export interface Runtime {
  readonly mode: "live" | "sandbox";
  readonly chain: ChainAdapter;
  readonly compute: ComputeAdapter;
  readonly storage: StorageAdapter;
  readonly requesterAddress?: Address;
  integrationStatus(): Promise<RuntimeServiceStatus[]>;
  resolveAgentIdentity(agent: Address): Promise<AgentIdentityEvidence | undefined>;
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
    integrationStatus: async () => [
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
      {
        id: "identity",
        name: "ERC-8004 Agentic ID",
        status: "unavailable",
        detail: "Optional identity evidence is disabled in sandbox mode.",
      },
      {
        id: "signer",
        name: "Verifier signer",
        status: "sandbox",
        detail: "SANDBOX ONLY â€” ephemeral local verifier; no production KMS/HSM is claimed.",
      },
    ],
    resolveAgentIdentity: async () => undefined,
  };
}

function decorateProbe(
  result: PublicProbeResult,
  extra: Partial<RuntimeServiceStatus>,
): RuntimeServiceStatus {
  return { ...result, ...extra };
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
  const verifierSigner = config.VERIFIER_SIGNER_URL
    ? new RemoteAttestationSigner({
        address: requireLiveValue(config.AUTHORIZED_VERIFIER, "AUTHORIZED_VERIFIER") as Address,
        endpoint: config.VERIFIER_SIGNER_URL,
        token: requireLiveValue(config.VERIFIER_SIGNER_TOKEN, "VERIFIER_SIGNER_TOKEN"),
        timeoutMs: config.READINESS_TIMEOUT_MS,
      })
    : new LocalAttestationSigner(
        privateKeyToAccount(asPrivateKey(config.VERIFIER_PRIVATE_KEY, "VERIFIER_PRIVATE_KEY")),
      );
  const guardAddress = requireLiveValue(
    config.ACTIONPROOF_GUARD_ADDRESS,
    "ACTIONPROOF_GUARD_ADDRESS",
  ) as Address;
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
    verifierSigner,
    guardAddress,
    explorerBaseUrl: explorerUrl,
    explorerApiUrl: `${explorerUrl.replace(/\/$/u, "")}/open/api`,
    sourceVerificationTimeoutMs: config.READINESS_TIMEOUT_MS,
    enableStateDiff: config.ENABLE_STATE_DIFF,
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
  const identityResolver =
    config.OG_AGENTIC_ID === undefined
      ? undefined
      : new Erc8004IdentityResolver({
          publicClient,
          chainId: config.OG_CHAIN_ID as 16602 | 16661,
          explorerBaseUrl: explorerUrl,
        });
  let cachedProbe: { expiresAt: number; services: RuntimeServiceStatus[] } | undefined;

  const integrationStatus = async (): Promise<RuntimeServiceStatus[]> => {
    if (cachedProbe && cachedProbe.expiresAt > Date.now()) return cachedProbe.services;
    const publicResults = await probePublicNetwork({
      chainId: config.OG_CHAIN_ID,
      rpcUrl,
      computeBaseUrl: computeUrl,
      storageIndexerUrl: storageIndexer,
      ...(config.OG_COMPUTE_MODEL ? { selectedModel: config.OG_COMPUTE_MODEL } : {}),
      timeoutMs: config.READINESS_TIMEOUT_MS,
    });
    const chainProbe = publicResults.find((service) => service.id === "chain");
    if (chainProbe?.status === "available") {
      try {
        const [bytecode, onchainVerifier] = await Promise.all([
          publicClient.getBytecode({ address: guardAddress }),
          publicClient.readContract({
            address: guardAddress,
            abi: actionProofGuardAbi,
            functionName: "authorizedVerifier",
          }),
        ]);
        if (!bytecode || bytecode === "0x") throw new Error("configured guard has no bytecode");
        if (onchainVerifier.toLowerCase() !== verifierSigner.address.toLowerCase()) {
          throw new Error(
            `guard verifier mismatch: onchain=${onchainVerifier}, configured=${verifierSigner.address}`,
          );
        }
        chainProbe.detail += ` Guard bytecode and verifier ${verifierSigner.address} match.`;
      } catch (error) {
        chainProbe.status = "unavailable";
        chainProbe.detail = `RPC passed, but ActionProofGuard readiness failed: ${error instanceof Error ? error.message : "unknown guard error"}`;
      }
    }

    const services: RuntimeServiceStatus[] = publicResults.map((result) =>
      result.id === "chain"
        ? decorateProbe(result, { endpoint: rpcUrl, explorerUrl })
        : result.id === "compute"
          ? decorateProbe(result, { endpoint: computeUrl })
          : decorateProbe(result, { endpoint: storageIndexer, explorerUrl: storageExplorer }),
    );
    if (identityResolver && config.OG_AGENTIC_ID !== undefined) {
      const started = Date.now();
      try {
        const identity = await identityResolver.resolve(
          config.OG_AGENTIC_ID,
          config.defaultAgentAddress,
        );
        services.push({
          id: "identity",
          name: "ERC-8004 Agentic ID",
          status: identity.matchesActionAgent ? "available" : "unavailable",
          detail: identity.matchesActionAgent
            ? `Agent ${identity.agentId} is registered and binds the configured action-agent wallet.`
            : `Agent ${identity.agentId} wallet ${identity.agentWallet} does not match ${config.defaultAgentAddress}.`,
          explorerUrl: identity.explorerUrl,
          latencyMs: Date.now() - started,
          checkedAt: identity.checkedAt,
        });
      } catch (error) {
        services.push({
          id: "identity",
          name: "ERC-8004 Agentic ID",
          status: "unavailable",
          detail: `Configured identity could not be resolved: ${error instanceof Error ? error.message : "unknown identity error"}`,
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
        });
      }
    } else {
      services.push({
        id: "identity",
        name: "ERC-8004 Agentic ID",
        status: "unavailable",
        detail: "Optional read-only evidence is not configured; set OG_AGENTIC_ID to enable it.",
      });
    }
    if (verifierSigner instanceof RemoteAttestationSigner) {
      const started = Date.now();
      try {
        await verifierSigner.health();
        services.push({
          id: "signer",
          name: "Remote verifier signer",
          status: "available",
          detail: `Authenticated signer health matches ${verifierSigner.address}; signing still verifies every returned EIP-712 signature.`,
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        services.push({
          id: "signer",
          name: "Remote verifier signer",
          status: "unavailable",
          detail: `Remote signer health failed: ${error instanceof Error ? error.message : "unknown signer error"}`,
          latencyMs: Date.now() - started,
          checkedAt: new Date().toISOString(),
        });
      }
    } else {
      services.push({
        id: "signer",
        name: "Local verifier signer",
        status: "available",
        detail: `Server-local verifier ${verifierSigner.address} matches the guard; use the remote signer boundary for production isolation.`,
        checkedAt: new Date().toISOString(),
      });
    }
    cachedProbe = { expiresAt: Date.now() + 30_000, services };
    return services;
  };

  return {
    mode: "live",
    chain,
    compute,
    storage,
    requesterAddress: relayer.address,
    integrationStatus,
    resolveAgentIdentity: async (agent) => {
      if (!identityResolver || config.OG_AGENTIC_ID === undefined) return undefined;
      return identityResolver.resolve(config.OG_AGENTIC_ID, agent);
    },
  };
}

export function createRuntime(config: AppConfig): Runtime {
  return config.ACTIONPROOF_MODE === "live"
    ? createLiveRuntime(config)
    : createSandboxRuntime(config);
}
