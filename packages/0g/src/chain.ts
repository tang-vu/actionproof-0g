import {
  actionAttestationTypes,
  actionProofDomain,
  actionRequestSchema,
  attestationSchema,
  chainReceiptSchema,
  hashCalldata,
  simulationResultSchema,
  toTypedAttestation,
  type ActionRequest,
  type Attestation,
  type ChainReceipt,
  type SimulationResult,
} from "@actionproof/core";
import { setTimeout as delay } from "node:timers/promises";
import {
  getAddress,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { z } from "zod";

import { actionProofGuardAbi, type GuardAttestation } from "./guard-abi.js";
import type { AnchorVerification, ChainAdapter, ChainSubmission, Clock } from "./interfaces.js";
import { systemClock } from "./interfaces.js";
import { LocalAttestationSigner, type AttestationSigner } from "./signers.js";

export interface ZgChainConfig {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
  relayerAccount: Account;
  verifierAccount?: LocalAccount;
  verifierSigner?: AttestationSigner;
  guardAddress: Address;
  explorerBaseUrl?: string;
  explorerApiUrl?: string;
  fetchFn?: typeof fetch;
  sourceVerificationTimeoutMs?: number;
  enableStateDiff?: boolean;
  clock?: Clock;
}

const explorerSourceResponseSchema = z
  .object({
    status: z.string(),
    message: z.string().optional(),
    result: z.union([
      z.string(),
      z.array(
        z
          .object({
            SourceCode: z.string(),
            ABI: z.string().optional(),
          })
          .passthrough(),
      ),
    ]),
  })
  .passthrough();

const EIP1967_SLOTS = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e019b817850b5d6103ade098d235090d6103",
  beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
} as const satisfies Record<string, Hex>;

function slotAddress(value: Hex | undefined): Address | undefined {
  if (!value || value === "0x") return undefined;
  const candidate = `0x${value.slice(-40)}` as Address;
  return /^0x0{40}$/u.test(candidate) ? undefined : getAddress(candidate);
}

function stateDiffSummary(value: unknown): {
  accountsChanged: number;
  storageSlotsChanged: number;
} {
  if (typeof value !== "object" || value === null)
    return { accountsChanged: 0, storageSlotsChanged: 0 };
  const envelope = value as Record<string, unknown>;
  const pre =
    typeof envelope.pre === "object" && envelope.pre !== null
      ? (envelope.pre as Record<string, unknown>)
      : {};
  const post =
    typeof envelope.post === "object" && envelope.post !== null
      ? (envelope.post as Record<string, unknown>)
      : {};
  const accounts = new Set([...Object.keys(pre), ...Object.keys(post)]);
  let storageSlotsChanged = 0;
  for (const address of accounts) {
    const before = pre[address] as { storage?: Record<string, unknown> } | undefined;
    const after = post[address] as { storage?: Record<string, unknown> } | undefined;
    storageSlotsChanged += new Set([
      ...Object.keys(before?.storage ?? {}),
      ...Object.keys(after?.storage ?? {}),
    ]).size;
  }
  return { accountsChanged: accounts.size, storageSlotsChanged };
}

function guardAttestation(attestation: Attestation): GuardAttestation {
  return toTypedAttestation(attestation);
}

function explorerLink(baseUrl: string | undefined, transactionHash: Hex): string | undefined {
  if (baseUrl === undefined) return undefined;
  return `${baseUrl.replace(/\/$/u, "")}/tx/${transactionHash}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown RPC simulation error";
}

async function confirmedReceipt(
  publicClient: PublicClient<Transport, Chain>,
  transactionHash: Hex,
) {
  return publicClient.waitForTransactionReceipt({ hash: transactionHash }).catch(async (error) => {
    // Some Galileo RPC nodes briefly return "receipt not found" after observing the transaction.
    // Recover only by reading the exact already-broadcast hash; never submit a replacement here.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        return await publicClient.getTransactionReceipt({ hash: transactionHash });
      } catch {
        await delay(2_000);
      }
    }
    throw error;
  });
}

/** Production 0G Chain adapter. Signers are supplied by the caller; raw keys are never accepted. */
export class ZgChainAdapter implements ChainAdapter {
  readonly mode = "0g" as const;
  readonly #config: ZgChainConfig;
  readonly #clock: Clock;
  readonly #verifierSigner: AttestationSigner;

  constructor(config: ZgChainConfig) {
    if (!config.verifierSigner && !config.verifierAccount) {
      throw new TypeError("A verifier signer is required");
    }
    this.#config = {
      ...config,
      guardAddress: getAddress(config.guardAddress),
    };
    this.#clock = config.clock ?? systemClock;
    this.#verifierSigner =
      config.verifierSigner ?? new LocalAttestationSigner(config.verifierAccount as LocalAccount);
  }

  async simulateAction(input: ActionRequest): Promise<SimulationResult> {
    const action = actionRequestSchema.parse(input);
    const chainId = await this.#config.publicClient.getChainId();
    if (chainId !== action.destinationChainId) {
      return simulationResultSchema.parse({
        success: false,
        networkChainId: chainId,
        targetHasCode: false,
        targetVerification: "unknown",
        error: `RPC chain mismatch: expected ${action.destinationChainId}, received ${chainId}`,
        effects: [],
        observedAt: this.#clock().toISOString(),
      });
    }
    let targetHasCode = false;
    let targetVerification: SimulationResult["targetVerification"] = "unknown";
    try {
      const [bytecode, verification] = await Promise.all([
        this.#config.publicClient.getBytecode({ address: action.target }),
        this.#targetVerification(action.target),
      ]);
      targetHasCode = bytecode !== undefined && bytecode !== "0x";
      targetVerification = verification;
      const request = {
        from: this.#config.guardAddress,
        to: action.target,
        data: action.calldata as Hex,
        value: toHex(BigInt(action.value)),
      } as const;
      const [returnData, gas] = await Promise.all([
        this.#config.publicClient.request({
          method: "eth_call",
          params: [request, "latest"],
        }),
        this.#config.publicClient.request({ method: "eth_estimateGas", params: [request] }),
      ]);
      let targetAnalysis: SimulationResult["targetAnalysis"];
      try {
        const [blockNumber, implementationSlot, adminSlot, beaconSlot] = await Promise.all([
          this.#config.publicClient.getBlockNumber(),
          this.#config.publicClient.getStorageAt({
            address: action.target,
            slot: EIP1967_SLOTS.implementation,
          }),
          this.#config.publicClient.getStorageAt({
            address: action.target,
            slot: EIP1967_SLOTS.admin,
          }),
          this.#config.publicClient.getStorageAt({
            address: action.target,
            slot: EIP1967_SLOTS.beacon,
          }),
        ]);
        const implementation = slotAddress(implementationSlot);
        const admin = slotAddress(adminSlot);
        const beacon = slotAddress(beaconSlot);
        const proxy =
          implementation || admin || beacon
            ? {
                standard: "EIP-1967" as const,
                ...(implementation ? { implementation } : {}),
                ...(admin ? { admin } : {}),
                ...(beacon ? { beacon } : {}),
              }
            : undefined;
        targetAnalysis = {
          codeHash: keccak256(bytecode as Hex),
          blockNumber: blockNumber.toString(),
          ...(proxy ? { proxy } : {}),
        };
      } catch {
        // Enrichment is provenance only; an unavailable storage-slot method must not rewrite
        // the independently successful eth_call result.
      }
      let stateDiff: SimulationResult["stateDiff"] = {
        status: "disabled",
        note: "debug_traceCall state diff is disabled by deployment configuration.",
      };
      if (this.#config.enableStateDiff) {
        try {
          const debugRequest = this.#config.publicClient.request as unknown as (args: {
            method: string;
            params: unknown[];
          }) => Promise<unknown>;
          const rawDiff = await debugRequest({
            method: "debug_traceCall",
            params: [
              request,
              "latest",
              { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
            ],
          });
          const summary = stateDiffSummary(rawDiff);
          stateDiff = {
            status: "available",
            ...summary,
            note: "Summarized from debug_traceCall prestateTracer diff mode; raw state was not retained.",
          };
        } catch (error) {
          const message = errorMessage(error).toLowerCase();
          stateDiff = {
            status:
              message.includes("method") || message.includes("unsupported")
                ? "unsupported"
                : "failed",
            note: errorMessage(error).slice(0, 500),
          };
        }
      }
      return simulationResultSchema.parse({
        success: true,
        networkChainId: chainId,
        targetHasCode,
        targetVerification,
        gasEstimate: BigInt(gas).toString(),
        returnData,
        effects: [],
        ...(targetAnalysis ? { targetAnalysis } : {}),
        stateDiff,
        observedAt: this.#clock().toISOString(),
      });
    } catch (error) {
      return simulationResultSchema.parse({
        success: false,
        networkChainId: chainId,
        targetHasCode,
        targetVerification,
        error: errorMessage(error).slice(0, 1_000),
        effects: [],
        observedAt: this.#clock().toISOString(),
      });
    }
  }

  async #targetVerification(target: Address): Promise<SimulationResult["targetVerification"]> {
    if (this.#config.explorerApiUrl === undefined) return "unknown";
    const endpoint = new URL(this.#config.explorerApiUrl);
    endpoint.searchParams.set("module", "contract");
    endpoint.searchParams.set("action", "getsourcecode");
    endpoint.searchParams.set("address", target);
    try {
      const response = await (this.#config.fetchFn ?? fetch)(endpoint, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.#config.sourceVerificationTimeoutMs ?? 5_000),
      });
      if (!response.ok) return "unknown";
      const payload = explorerSourceResponseSchema.parse(await response.json());
      if (payload.status === "1" && Array.isArray(payload.result)) {
        return payload.result.some((contract) => contract.SourceCode.trim().length > 0)
          ? "verified"
          : "unverified";
      }
      if (payload.status === "0" && typeof payload.result === "string") {
        const result = payload.result.toLowerCase();
        if (result.includes("not verified") || result.includes("source code not verified")) {
          return "unverified";
        }
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  async signAttestation(input: Attestation): Promise<Hex> {
    const attestation = attestationSchema.parse(input);
    const chainId = await this.#assertChain(attestation);
    return this.#verifierSigner.sign(attestation, chainId, this.#config.guardAddress);
  }

  async anchorAttestation(input: Attestation, signature: Hex): Promise<ChainSubmission> {
    const attestation = attestationSchema.parse(input);
    await this.#assertChain(attestation);
    const args = [guardAttestation(attestation), signature] as const;
    await this.#config.publicClient.simulateContract({
      account: this.#config.relayerAccount,
      address: this.#config.guardAddress,
      abi: actionProofGuardAbi,
      functionName: "anchorAttestation",
      args,
    });
    const transactionHash = await this.#config.walletClient.writeContract({
      account: this.#config.relayerAccount,
      address: this.#config.guardAddress,
      abi: actionProofGuardAbi,
      functionName: "anchorAttestation",
      args,
    });
    return this.#submission(attestation, transactionHash);
  }

  async executeAttestedAction(
    input: Attestation,
    actionCalldata: Hex,
    signature: Hex,
  ): Promise<ChainSubmission> {
    const attestation = attestationSchema.parse(input);
    await this.#assertChain(attestation);
    if (attestation.verdict !== 1) {
      throw new Error("Only an allow attestation can be executed");
    }
    if (hashCalldata(actionCalldata).toLowerCase() !== attestation.calldataHash.toLowerCase()) {
      throw new Error("Execution calldata does not match the signed calldata hash");
    }
    const args = [guardAttestation(attestation), actionCalldata, signature] as const;
    const value = BigInt(attestation.value);
    await this.#config.publicClient.simulateContract({
      account: this.#config.relayerAccount,
      address: this.#config.guardAddress,
      abi: actionProofGuardAbi,
      functionName: "executeAttestedAction",
      args,
      value,
    });
    const transactionHash = await this.#config.walletClient.writeContract({
      account: this.#config.relayerAccount,
      address: this.#config.guardAddress,
      abi: actionProofGuardAbi,
      functionName: "executeAttestedAction",
      args,
      value,
    });
    return this.#submission(attestation, transactionHash);
  }

  async verifyAnchor(input: Attestation, signature: Hex): Promise<AnchorVerification> {
    const attestation = attestationSchema.parse(input);
    const chainId = await this.#assertChain(attestation);
    const typed = guardAttestation(attestation);
    const digest = hashTypedData({
      domain: actionProofDomain(chainId, this.#config.guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: typed,
    });
    const [onchainDigest, anchor, anchored, executed, recovered] = await Promise.all([
      this.#config.publicClient.readContract({
        address: this.#config.guardAddress,
        abi: actionProofGuardAbi,
        functionName: "hashAttestation",
        args: [typed],
      }),
      this.#config.publicClient.readContract({
        address: this.#config.guardAddress,
        abi: actionProofGuardAbi,
        functionName: "anchors",
        args: [digest],
      }),
      this.#config.publicClient.readContract({
        address: this.#config.guardAddress,
        abi: actionProofGuardAbi,
        functionName: "usedAttestations",
        args: [digest],
      }),
      this.#config.publicClient.readContract({
        address: this.#config.guardAddress,
        abi: actionProofGuardAbi,
        functionName: "executedAttestations",
        args: [digest],
      }),
      recoverTypedDataAddress({
        domain: actionProofDomain(chainId, this.#config.guardAddress),
        types: actionAttestationTypes,
        primaryType: "ActionAttestation",
        message: typed,
        signature,
      }),
    ]);
    const [agent, requester, verifier, reportRoot, reportHash, verdict, anchoredAt] = anchor;
    const matches =
      onchainDigest.toLowerCase() === digest.toLowerCase() &&
      anchored &&
      agent.toLowerCase() === attestation.agent.toLowerCase() &&
      requester.toLowerCase() === attestation.requester.toLowerCase() &&
      verifier.toLowerCase() === recovered.toLowerCase() &&
      reportRoot.toLowerCase() === attestation.reportRoot.toLowerCase() &&
      reportHash.toLowerCase() === attestation.reportHash.toLowerCase() &&
      verdict === attestation.verdict &&
      anchoredAt > 0n;
    return { digest, anchored, executed, matches, anchoredAt };
  }

  nextNonce(agent: Address, requester: Address): Promise<bigint> {
    return this.#config.publicClient.readContract({
      address: this.#config.guardAddress,
      abi: actionProofGuardAbi,
      functionName: "nextNonce",
      args: [getAddress(agent), getAddress(requester)],
    });
  }

  async #assertChain(attestation: Attestation): Promise<number> {
    const chainId = await this.#config.publicClient.getChainId();
    if (chainId !== attestation.destinationChainId) {
      throw new Error(
        `0G Chain mismatch: expected ${attestation.destinationChainId}, received ${chainId}`,
      );
    }
    return chainId;
  }

  async #submission(attestation: Attestation, transactionHash: Hex): Promise<ChainSubmission> {
    const receipt = await confirmedReceipt(this.#config.publicClient, transactionHash);
    if (receipt.status !== "success") {
      throw new Error(`0G Chain transaction ${transactionHash} reverted`);
    }
    const chainId = await this.#assertChain(attestation);
    const digest = hashTypedData({
      domain: actionProofDomain(chainId, this.#config.guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: guardAttestation(attestation),
    });
    const receiptValue: ChainReceipt = chainReceiptSchema.parse({
      mode: "0g",
      chainId,
      guardAddress: this.#config.guardAddress,
      transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: explorerLink(this.#config.explorerBaseUrl, transactionHash),
      anchoredAt: this.#clock().toISOString(),
    });
    return { digest, receipt: receiptValue };
  }
}
