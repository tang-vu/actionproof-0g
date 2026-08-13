import {
  agentIdentityEvidenceSchema,
  uintStringSchema,
  type AgentIdentityEvidence,
} from "@actionproof/core";
import { getAddress, type Address, type Chain, type PublicClient, type Transport } from "viem";

import type { Clock } from "./interfaces.js";
import { systemClock } from "./interfaces.js";

export const ERC8004_IDENTITY_REGISTRIES = {
  16602: getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
  16661: getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
} as const;

export const erc8004IdentityAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export interface Erc8004ResolverConfig {
  publicClient: PublicClient<Transport, Chain>;
  chainId: 16602 | 16661;
  explorerBaseUrl: string;
  clock?: Clock;
}

/** Optional, read-only ERC-8004 identity evidence. It never registers or mutates an identity. */
export class Erc8004IdentityResolver {
  readonly #client: PublicClient<Transport, Chain>;
  readonly #chainId: 16602 | 16661;
  readonly #registry: Address;
  readonly #explorerBaseUrl: string;
  readonly #clock: Clock;

  constructor(config: Erc8004ResolverConfig) {
    this.#client = config.publicClient;
    this.#chainId = config.chainId;
    this.#registry = ERC8004_IDENTITY_REGISTRIES[config.chainId];
    this.#explorerBaseUrl = config.explorerBaseUrl.replace(/\/$/u, "");
    this.#clock = config.clock ?? systemClock;
  }

  async resolve(agentIdInput: string, expectedAgent: Address): Promise<AgentIdentityEvidence> {
    const agentId = uintStringSchema.parse(agentIdInput);
    const tokenId = BigInt(agentId);
    const [owner, agentWallet, tokenUri] = await Promise.all([
      this.#client.readContract({
        address: this.#registry,
        abi: erc8004IdentityAbi,
        functionName: "ownerOf",
        args: [tokenId],
      }),
      this.#client.readContract({
        address: this.#registry,
        abi: erc8004IdentityAbi,
        functionName: "getAgentWallet",
        args: [tokenId],
      }),
      this.#client.readContract({
        address: this.#registry,
        abi: erc8004IdentityAbi,
        functionName: "tokenURI",
        args: [tokenId],
      }),
    ]);

    return agentIdentityEvidenceSchema.parse({
      standard: "ERC-8004",
      chainId: this.#chainId,
      registry: this.#registry,
      agentId,
      owner,
      agentWallet,
      tokenUri,
      matchesActionAgent: agentWallet.toLowerCase() === expectedAgent.toLowerCase(),
      checkedAt: this.#clock().toISOString(),
      explorerUrl: `${this.#explorerBaseUrl}/address/${this.#registry}`,
    });
  }
}
