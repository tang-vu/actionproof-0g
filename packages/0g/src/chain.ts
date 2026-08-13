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
import {
  getAddress,
  hashTypedData,
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

import { actionProofGuardAbi, type GuardAttestation } from "./guard-abi.js";
import type { AnchorVerification, ChainAdapter, ChainSubmission, Clock } from "./interfaces.js";
import { systemClock } from "./interfaces.js";

export interface ZgChainConfig {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
  relayerAccount: Account;
  verifierAccount: LocalAccount;
  guardAddress: Address;
  explorerBaseUrl?: string;
  clock?: Clock;
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

/** Production 0G Chain adapter. Signers are supplied by the caller; raw keys are never accepted. */
export class ZgChainAdapter implements ChainAdapter {
  readonly mode = "0g" as const;
  readonly #config: ZgChainConfig;
  readonly #clock: Clock;

  constructor(config: ZgChainConfig) {
    this.#config = {
      ...config,
      guardAddress: getAddress(config.guardAddress),
    };
    this.#clock = config.clock ?? systemClock;
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
    try {
      const bytecode = await this.#config.publicClient.getBytecode({ address: action.target });
      targetHasCode = bytecode !== undefined && bytecode !== "0x";
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
      return simulationResultSchema.parse({
        success: true,
        networkChainId: chainId,
        targetHasCode,
        targetVerification: "unknown",
        gasEstimate: BigInt(gas).toString(),
        returnData,
        effects: [],
        observedAt: this.#clock().toISOString(),
      });
    } catch (error) {
      return simulationResultSchema.parse({
        success: false,
        networkChainId: chainId,
        targetHasCode,
        targetVerification: "unknown",
        error: errorMessage(error).slice(0, 1_000),
        effects: [],
        observedAt: this.#clock().toISOString(),
      });
    }
  }

  async signAttestation(input: Attestation): Promise<Hex> {
    const attestation = attestationSchema.parse(input);
    const chainId = await this.#assertChain(attestation);
    return this.#config.verifierAccount.signTypedData({
      domain: actionProofDomain(chainId, this.#config.guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: guardAttestation(attestation),
    });
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
    const receipt = await this.#config.publicClient.waitForTransactionReceipt({
      hash: transactionHash,
    });
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
