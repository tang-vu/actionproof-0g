import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { createPublicClient, http } from "viem";

export type PublicProbeServiceId = "chain" | "compute" | "storage";

export interface PublicProbeResult {
  id: PublicProbeServiceId;
  name: string;
  status: "available" | "unavailable";
  detail: string;
  latencyMs: number;
  checkedAt: string;
}

export interface PublicNetworkProbeConfig {
  chainId: number;
  rpcUrl: string;
  computeBaseUrl: string;
  storageIndexerUrl: string;
  selectedModel?: string;
  timeoutMs?: number;
}

export interface PublicProbeDependencies {
  getChainState(rpcUrl: string): Promise<{ chainId: number; blockNumber: bigint }>;
  getJson(url: string, signal: AbortSignal): Promise<unknown>;
  selectStorageNodes(indexerUrl: string): Promise<number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown readiness error";
}

const defaultDependencies: PublicProbeDependencies = {
  async getChainState(rpcUrl) {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const [chainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    return { chainId, blockNumber };
  },
  async getJson(url, signal) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return response.json() as Promise<unknown>;
  },
  async selectStorageNodes(indexerUrl) {
    const [nodes, error] = await new Indexer(indexerUrl).selectNodes(1);
    if (error) throw new Error("0G Storage indexer node selection failed", { cause: error });
    return nodes.length;
  },
};

async function boundedProbe(
  id: PublicProbeServiceId,
  name: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<string>,
): Promise<PublicProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${name} readiness timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const detail = await Promise.race([operation(controller.signal), timeout]);
    return {
      id,
      name,
      status: "available",
      detail,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      name,
      status: "unavailable",
      detail: errorMessage(error).slice(0, 500),
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function modelCatalogDetail(value: unknown, selectedModel: string | undefined): string {
  if (!isRecord(value) || !Array.isArray(value["data"])) {
    throw new TypeError("0G Compute model catalog has an invalid response shape");
  }
  const models = value["data"].filter(isRecord);
  if (models.length === 0) throw new Error("0G Compute model catalog is empty");
  if (selectedModel !== undefined) {
    const selected = models.find((model) => model["id"] === selectedModel);
    if (!selected) throw new Error(`Configured model ${selectedModel} is not listed by 0G Router`);
    const providerCount = selected["provider_count"];
    if (typeof providerCount === "number" && providerCount < 1) {
      throw new Error(`Configured model ${selectedModel} has no healthy providers`);
    }
    return `Read-only catalog probe passed; ${selectedModel} is listed (${models.length} models total).`;
  }
  return `Read-only catalog probe passed; ${models.length} models are listed.`;
}

/** Read-only public probes. No API key, signer, paid request, or transaction is used. */
export function probePublicNetwork(
  config: PublicNetworkProbeConfig,
  dependencies: PublicProbeDependencies = defaultDependencies,
): Promise<PublicProbeResult[]> {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const computeModelsUrl = `${config.computeBaseUrl.replace(/\/$/u, "")}/models`;
  return Promise.all([
    boundedProbe("chain", "0G Chain", timeoutMs, async () => {
      const state = await dependencies.getChainState(config.rpcUrl);
      if (state.chainId !== config.chainId) {
        throw new Error(
          `RPC chain mismatch: expected ${config.chainId}, received ${state.chainId}`,
        );
      }
      return `Read-only RPC probe passed at block ${state.blockNumber}; chain ID ${state.chainId}.`;
    }),
    boundedProbe("compute", "0G Compute Router", timeoutMs, async (signal) =>
      modelCatalogDetail(
        await dependencies.getJson(computeModelsUrl, signal),
        config.selectedModel,
      ),
    ),
    boundedProbe("storage", "0G Storage Turbo", timeoutMs, async () => {
      const nodeCount = await dependencies.selectStorageNodes(config.storageIndexerUrl);
      if (nodeCount < 1) throw new Error("0G Storage indexer returned no selectable nodes");
      return `Read-only indexer probe passed; ${nodeCount} storage node${nodeCount === 1 ? "" : "s"} selected.`;
    }),
  ]);
}

export const readinessInternals = { modelCatalogDetail };
