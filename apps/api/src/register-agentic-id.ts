import "./load-local-env.js";

import { ERC8004_IDENTITY_REGISTRIES } from "@actionproof/0g";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { asPrivateKey, parseEnv, requireLiveValue } from "./config.js";

const registrationUri = "https://actionproof.tangvu.dev/.well-known/agent-registration.json";
const broadcastConfirmation = "REGISTER_AGENTIC_ID_GALILEO";

const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
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
  {
    type: "event",
    name: "Registered",
    anonymous: false,
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

function readArgument(name: string): string | undefined {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseAgentId(): bigint | undefined {
  const value = readArgument("--agent-id");
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError("--agent-id must be an unsigned decimal integer");
  }
  return BigInt(value);
}

async function transactionEvidence(
  publicClient: ReturnType<typeof createPublicClient>,
  transactionHash: Hash,
) {
  const receipt = await publicClient
    .waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    })
    .catch(async (initialError: unknown) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          return await publicClient.getTransactionReceipt({ hash: transactionHash });
        } catch {
          await delay(2_000);
        }
      }
      throw initialError;
    });
  if (receipt.status !== "success") throw new Error("Agentic ID transaction reverted");
  return receipt;
}

async function main(): Promise<void> {
  const config = parseEnv();
  if (config.ACTIONPROOF_MODE !== "live" || config.OG_NETWORK !== "galileo") {
    throw new TypeError("Agentic ID registration is restricted to live Galileo configuration");
  }
  if (config.OG_CHAIN_ID !== 16602 || config.ALLOW_MAINNET_BROADCAST) {
    throw new TypeError(
      "Agentic ID registration refuses non-Galileo or mainnet-enabled configuration",
    );
  }

  const rpcUrl = requireLiveValue(config.OG_RPC_URL, "OG_RPC_URL");
  const explorerUrl = requireLiveValue(config.OG_EXPLORER_URL, "OG_EXPLORER_URL").replace(
    /\/$/u,
    "",
  );
  const account = privateKeyToAccount(
    asPrivateKey(config.RELAYER_PRIVATE_KEY, "RELAYER_PRIVATE_KEY"),
  );
  if (getAddress(account.address) !== getAddress(config.defaultAgentAddress)) {
    throw new TypeError("RELAYER_PRIVATE_KEY must control the exact ACTIONPROOF_AGENT_ADDRESS");
  }

  const chain = defineChain({
    id: 16602,
    name: "0G Galileo Testnet",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "0G ChainScan", url: explorerUrl } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const registry = ERC8004_IDENTITY_REGISTRIES[16602];
  const [chainId, code, balance] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getCode({ address: registry }),
    publicClient.getBalance({ address: account.address }),
  ]);
  if (chainId !== 16602 || !code || code === "0x") {
    throw new Error("Official Galileo ERC-8004 Identity Registry readiness check failed");
  }
  if (balance === 0n) throw new Error("Action-agent wallet has no Galileo gas balance");

  const agentId = parseAgentId();
  const broadcast = process.env.AGENTIC_ID_BROADCAST_CONFIRM === broadcastConfirmation;
  if (agentId === undefined) {
    const simulation = await publicClient.simulateContract({
      account,
      address: registry,
      abi: registryAbi,
      functionName: "register",
    });
    const gas = await publicClient.estimateContractGas({
      account,
      address: registry,
      abi: registryAbi,
      functionName: "register",
    });
    if (!broadcast) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            broadcast: false,
            network: "0G Galileo Testnet",
            chainId,
            registry,
            actionAgent: account.address,
            balanceWei: balance.toString(),
            estimatedGas: gas.toString(),
            simulatedAgentId: simulation.result.toString(),
            next: `Set AGENTIC_ID_BROADCAST_CONFIRM=${broadcastConfirmation} to broadcast register().`,
          },
          null,
          2,
        ),
      );
      return;
    }

    const transactionHash = await walletClient.writeContract({
      address: registry,
      abi: registryAbi,
      functionName: "register",
    });
    const receipt = await transactionEvidence(publicClient, transactionHash);
    const registeredLog = receipt.logs
      .filter((log) => log.address.toLowerCase() === registry.toLowerCase())
      .map((log) => {
        try {
          return decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .find((entry) => entry?.eventName === "Registered");
    if (!registeredLog || registeredLog.eventName !== "Registered") {
      throw new Error("Registered event was not found in the successful receipt");
    }
    const registeredAgentId = registeredLog.args.agentId;
    const [owner, agentWallet] = await Promise.all([
      publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "ownerOf",
        args: [registeredAgentId],
      }),
      publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getAgentWallet",
        args: [registeredAgentId],
      }),
    ]);
    if (
      getAddress(owner) !== getAddress(account.address) ||
      getAddress(agentWallet) !== getAddress(account.address)
    ) {
      throw new Error(
        "Registered identity does not bind the exact ActionProof action-agent wallet",
      );
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          broadcast: true,
          operation: "register",
          chainId,
          registry,
          agentId: registeredAgentId.toString(),
          owner,
          agentWallet,
          transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          explorerUrl: `${explorerUrl}/tx/${transactionHash}`,
          next: `Publish the registration file, then rerun with --agent-id ${registeredAgentId}.`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const owner = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "ownerOf",
    args: [agentId],
  });
  if (getAddress(owner) !== getAddress(account.address)) {
    throw new Error(`Action-agent wallet does not own ERC-8004 agent ${agentId}`);
  }
  await publicClient.simulateContract({
    account,
    address: registry,
    abi: registryAbi,
    functionName: "setAgentURI",
    args: [agentId, registrationUri],
  });
  const gas = await publicClient.estimateContractGas({
    account,
    address: registry,
    abi: registryAbi,
    functionName: "setAgentURI",
    args: [agentId, registrationUri],
  });
  if (!broadcast) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          broadcast: false,
          operation: "setAgentURI",
          chainId,
          registry,
          agentId: agentId.toString(),
          registrationUri,
          estimatedGas: gas.toString(),
          next: `Set AGENTIC_ID_BROADCAST_CONFIRM=${broadcastConfirmation} to broadcast setAgentURI().`,
        },
        null,
        2,
      ),
    );
    return;
  }

  const transactionHash = await walletClient.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "setAgentURI",
    args: [agentId, registrationUri],
  });
  const receipt = await transactionEvidence(publicClient, transactionHash);
  const [storedUri, agentWallet] = await Promise.all([
    publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "tokenURI",
      args: [agentId],
    }),
    publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getAgentWallet",
      args: [agentId],
    }),
  ]);
  if (
    storedUri !== registrationUri ||
    getAddress(agentWallet as Address) !== getAddress(account.address)
  ) {
    throw new Error("Post-write ERC-8004 URI or action-agent wallet verification failed");
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        broadcast: true,
        operation: "setAgentURI",
        chainId,
        registry,
        agentId: agentId.toString(),
        owner,
        agentWallet,
        registrationUri: storedUri,
        transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        explorerUrl: `${explorerUrl}/tx/${transactionHash}`,
      },
      null,
      2,
    ),
  );
}

void main();
