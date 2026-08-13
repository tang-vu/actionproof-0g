import {
  SELECTORS,
  actionAttestationTypes,
  actionProofDomain,
  actionRequestSchema,
  attestationSchema,
  bytes32Schema,
  chainReceiptSchema,
  computeMetadataSchema,
  hashCalldata,
  hashCanonical,
  modelRiskAssessmentSchema,
  riskReportSchema,
  simulationResultSchema,
  storageReceiptSchema,
  toTypedAttestation,
  type Attestation,
  type CanonicalValue,
  type ModelRiskAssessment,
  type RiskReport,
} from "@actionproof/core";
import {
  decodeAbiParameters,
  getAddress,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  slice,
  toBytes,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type {
  AnchorVerification,
  ChainAdapter,
  ChainSubmission,
  Clock,
  ComputeAdapter,
  ComputeAssessmentResult,
  RetrievedReport,
  RiskAssessmentInput,
  StorageAdapter,
  StoredReport,
} from "./interfaces.js";
import { systemClock } from "./interfaces.js";
import { calculateZgMerkleRoot, storageInternals } from "./storage.js";

function seededAccount(seed: string, role: string): LocalAccount {
  return privateKeyToAccount(keccak256(toBytes(`actionproof-sandbox:${role}:${seed}`)));
}

function randomAccount(): LocalAccount {
  return privateKeyToAccount(generatePrivateKey());
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

const DEMO_COUNTER_INCREMENT_SELECTOR = "0xd09de08a";

function sandboxEffects(calldata: Hex, guardAddress: Address) {
  const selector = calldata.slice(0, 10).toLowerCase();
  if (selector === DEMO_COUNTER_INCREMENT_SELECTOR) {
    return [
      {
        kind: "state-change" as const,
        summary: "DemoCounter increment() increases the counter by one",
        from: guardAddress,
        unexpected: false,
      },
    ];
  }
  if (selector === SELECTORS.approve && calldata.length >= 138) {
    try {
      const [spender, amount] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        slice(calldata, 4),
      );
      return [
        {
          kind: "approval" as const,
          summary: `ERC-20 allowance of ${amount} for ${spender}`,
          from: guardAddress,
          to: getAddress(spender),
          amount: amount.toString(),
          unexpected: false,
        },
      ];
    } catch {
      return [];
    }
  }
  return [];
}

export interface SandboxComputeConfig {
  assessment: ModelRiskAssessment;
  model?: string;
  clock?: Clock;
}

/** Explicit deterministic compute double. It never contacts a production endpoint. */
export class SandboxComputeAdapter implements ComputeAdapter {
  readonly mode = "sandbox" as const;
  readonly #assessment: ModelRiskAssessment;
  readonly #model: string;
  readonly #clock: Clock;

  constructor(config: SandboxComputeConfig) {
    this.#assessment = modelRiskAssessmentSchema.parse(config.assessment);
    this.#model = config.model ?? "sandbox/deterministic-risk-model";
    this.#clock = config.clock ?? systemClock;
  }

  async assess(input: RiskAssessmentInput): Promise<ComputeAssessmentResult> {
    const requestId = hashCanonical(input as unknown as CanonicalValue);
    const rawContent = JSON.stringify(this.#assessment);
    const compute = computeMetadataSchema.parse({
      service: "0G Compute",
      mode: "sandbox",
      model: this.#model,
      provider: "sandbox/in-memory",
      requestId,
      generatedAt: this.#clock().toISOString(),
    });
    return { assessment: this.#assessment, compute, rawContent };
  }
}

export interface SandboxStorageConfig {
  clock?: Clock;
}

/** Explicit in-memory storage double using the real 0G Merkle implementation. */
export class SandboxStorageAdapter implements StorageAdapter {
  readonly mode = "sandbox" as const;
  readonly #clock: Clock;
  readonly #objects = new Map<string, Uint8Array>();

  constructor(config: SandboxStorageConfig = {}) {
    this.#clock = config.clock ?? systemClock;
  }

  async uploadReport(report: RiskReport): Promise<StoredReport> {
    const parsed = riskReportSchema.parse(report);
    const canonicalBytes = storageInternals.canonicalReportBytes(parsed);
    const rootHash = await calculateZgMerkleRoot(canonicalBytes);
    this.#objects.set(rootHash.toLowerCase(), canonicalBytes.slice());
    const receipt = storageReceiptSchema.parse({
      mode: "sandbox",
      rootHash,
      transactionHash: keccak256(toBytes(`sandbox-storage:${rootHash}`)),
      uploadedAt: this.#clock().toISOString(),
      size: canonicalBytes.byteLength,
    });
    return { receipt, canonicalBytes };
  }

  async retrieveAndVerify(rootHash: string, expectedReport: RiskReport): Promise<RetrievedReport> {
    const expectedRoot = bytes32Schema.parse(rootHash) as Hex;
    const stored = this.#objects.get(expectedRoot.toLowerCase());
    if (stored === undefined) throw new Error(`Sandbox object ${expectedRoot} was not found`);
    const expectedBytes = storageInternals.canonicalReportBytes(expectedReport);
    const recomputedRoot = await calculateZgMerkleRoot(stored);
    if (recomputedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
      throw new Error("Sandbox storage failed mandatory Merkle-root verification");
    }
    if (!sameBytes(stored, expectedBytes)) {
      throw new Error("Sandbox storage bytes differ from the canonical expected report");
    }
    const report = storageInternals.decodeCanonicalReport(stored);
    return { report, rootHash: recomputedRoot, canonicalBytes: stored.slice() };
  }
}

interface SandboxAnchor {
  attestation: Attestation;
  anchoredAt: bigint;
}

export interface SandboxChainConfig {
  chainId: number;
  seed?: string;
  guardAddress?: Address;
  clock?: Clock;
}

/** Explicit in-memory chain double with an ephemeral EIP-712 verifier key. */
export class SandboxChainAdapter implements ChainAdapter {
  readonly mode = "sandbox" as const;
  readonly #chainId: number;
  readonly #guardAddress: Address;
  readonly #verifier: LocalAccount;
  readonly #clock: Clock;
  readonly #anchors = new Map<string, SandboxAnchor>();
  readonly #executed = new Set<string>();
  readonly #nonces = new Map<string, bigint>();
  #blockNumber = 0n;

  constructor(config: SandboxChainConfig) {
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
      throw new TypeError("Sandbox chainId must be a positive safe integer");
    }
    this.#chainId = config.chainId;
    this.#clock = config.clock ?? systemClock;
    this.#verifier = config.seed ? seededAccount(config.seed, "verifier") : randomAccount();
    this.#guardAddress = config.guardAddress
      ? getAddress(config.guardAddress)
      : config.seed
        ? seededAccount(config.seed, "guard").address
        : randomAccount().address;
  }

  async simulateAction(input: Parameters<ChainAdapter["simulateAction"]>[0]) {
    const action = actionRequestSchema.parse(input);
    return simulationResultSchema.parse({
      success: action.destinationChainId === this.#chainId,
      networkChainId: this.#chainId,
      targetHasCode: true,
      targetVerification: "unknown",
      gasEstimate: "0",
      returnData: "0x",
      error:
        action.destinationChainId === this.#chainId
          ? undefined
          : `Sandbox chain mismatch: ${action.destinationChainId} != ${this.#chainId}`,
      effects:
        action.destinationChainId === this.#chainId
          ? sandboxEffects(action.calldata as Hex, this.#guardAddress)
          : [],
      observedAt: this.#clock().toISOString(),
    });
  }

  async signAttestation(input: Attestation): Promise<Hex> {
    const attestation = attestationSchema.parse(input);
    this.#assertChain(attestation);
    return this.#verifier.signTypedData({
      domain: actionProofDomain(this.#chainId, this.#guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: toTypedAttestation(attestation),
    });
  }

  async anchorAttestation(input: Attestation, signature: Hex): Promise<ChainSubmission> {
    const attestation = attestationSchema.parse(input);
    const digest = await this.#validateSignature(attestation, signature);
    if (this.#anchors.has(digest.toLowerCase())) {
      throw new Error("Sandbox attestation was already anchored");
    }
    const lane = this.#lane(attestation.agent, attestation.requester);
    const expectedNonce = this.#nonces.get(lane) ?? 0n;
    if (BigInt(attestation.nonce) !== expectedNonce) {
      throw new Error(
        `Sandbox nonce mismatch: expected ${expectedNonce}, got ${attestation.nonce}`,
      );
    }
    const anchoredAt = this.#assertValidityWindow(attestation);
    this.#anchors.set(digest.toLowerCase(), { attestation, anchoredAt });
    this.#nonces.set(lane, expectedNonce + 1n);
    return this.#submission(digest, "anchor");
  }

  async executeAttestedAction(
    input: Attestation,
    actionCalldata: Hex,
    signature: Hex,
  ): Promise<ChainSubmission> {
    const attestation = attestationSchema.parse(input);
    if (attestation.verdict !== 1) throw new Error("Sandbox execution requires an allow verdict");
    if (hashCalldata(actionCalldata).toLowerCase() !== attestation.calldataHash.toLowerCase()) {
      throw new Error("Sandbox execution calldata does not match the signed calldata hash");
    }
    const digest = await this.#validateSignature(attestation, signature);
    const normalizedDigest = digest.toLowerCase();
    const anchor = this.#anchors.get(normalizedDigest);
    if (anchor === undefined) throw new Error("Sandbox attestation is not anchored");
    if (JSON.stringify(anchor.attestation) !== JSON.stringify(attestation)) {
      throw new Error("Sandbox anchored attestation does not match the execution request");
    }
    if (this.#executed.has(normalizedDigest)) {
      throw new Error("Sandbox attestation was already executed");
    }
    this.#assertValidityWindow(attestation);
    this.#executed.add(normalizedDigest);
    return this.#submission(digest, "execute");
  }

  async verifyAnchor(input: Attestation, signature: Hex): Promise<AnchorVerification> {
    const attestation = attestationSchema.parse(input);
    this.#assertChain(attestation);
    const digest = this.#digest(attestation);
    const anchor = this.#anchors.get(digest.toLowerCase());
    if (anchor === undefined) {
      return { digest, anchored: false, executed: false, matches: false };
    }
    const stored = anchor.attestation;
    const recovered = await recoverTypedDataAddress({
      domain: actionProofDomain(this.#chainId, this.#guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: toTypedAttestation(attestation),
      signature,
    });
    const matches =
      JSON.stringify(stored) === JSON.stringify(attestation) &&
      recovered.toLowerCase() === this.#verifier.address.toLowerCase();
    return {
      digest,
      anchored: true,
      executed: this.#executed.has(digest.toLowerCase()),
      matches,
      anchoredAt: anchor.anchoredAt,
    };
  }

  async nextNonce(agent: Address, requester: Address): Promise<bigint> {
    return this.#nonces.get(this.#lane(agent, requester)) ?? 0n;
  }

  async #validateSignature(attestation: Attestation, signature: Hex): Promise<Hex> {
    this.#assertChain(attestation);
    const digest = this.#digest(attestation);
    const recovered = await recoverTypedDataAddress({
      domain: actionProofDomain(this.#chainId, this.#guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: toTypedAttestation(attestation),
      signature,
    });
    if (recovered.toLowerCase() !== this.#verifier.address.toLowerCase()) {
      throw new Error("Sandbox attestation signature is not from the ephemeral verifier");
    }
    return digest;
  }

  #assertValidityWindow(attestation: Attestation): bigint {
    const now = BigInt(Math.floor(this.#clock().getTime() / 1_000));
    if (now < BigInt(attestation.issuedAt) || now >= BigInt(attestation.expiresAt)) {
      throw new Error("Sandbox attestation is outside its validity window");
    }
    return now;
  }

  #digest(attestation: Attestation): Hex {
    return hashTypedData({
      domain: actionProofDomain(this.#chainId, this.#guardAddress),
      types: actionAttestationTypes,
      primaryType: "ActionAttestation",
      message: toTypedAttestation(attestation),
    });
  }

  #assertChain(attestation: Attestation): void {
    if (attestation.destinationChainId !== this.#chainId) {
      throw new Error(
        `Sandbox attestation chain mismatch: ${attestation.destinationChainId} != ${this.#chainId}`,
      );
    }
  }

  #lane(agent: Address, requester: Address): string {
    return `${agent.toLowerCase()}:${requester.toLowerCase()}`;
  }

  #submission(digest: Hex, operation: "anchor" | "execute"): ChainSubmission {
    this.#blockNumber += 1n;
    const transactionHash = keccak256(toBytes(`sandbox-${operation}:${digest}`));
    const receipt = chainReceiptSchema.parse({
      mode: "sandbox",
      chainId: this.#chainId,
      guardAddress: this.#guardAddress,
      transactionHash,
      blockNumber: this.#blockNumber.toString(),
      anchoredAt: this.#clock().toISOString(),
    });
    return { digest, receipt };
  }
}
