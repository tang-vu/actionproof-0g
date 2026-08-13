import type {
  ActionRequest,
  Attestation,
  ChainReceipt,
  Finding,
  ModelRiskAssessment,
  RiskReport,
  SimulationResult,
  StorageReceipt,
} from "@actionproof/core";
import type { Hex } from "viem";

export type AdapterMode = "0g" | "router" | "sandbox";

export interface RiskAssessmentInput {
  action: ActionRequest;
  simulation: SimulationResult;
  deterministicFindings: Finding[];
  policyVersion: string;
}

export interface ComputeAssessmentResult {
  assessment: ModelRiskAssessment;
  compute: RiskReport["compute"];
  rawContent: string;
}

export interface ComputeAdapter {
  readonly mode: "router" | "sandbox";
  assess(input: RiskAssessmentInput): Promise<ComputeAssessmentResult>;
}

export interface StoredReport {
  receipt: StorageReceipt;
  canonicalBytes: Uint8Array;
}

export interface RetrievedReport {
  report: RiskReport;
  rootHash: Hex;
  canonicalBytes: Uint8Array;
}

export interface StorageAdapter {
  readonly mode: "0g" | "sandbox";
  uploadReport(report: RiskReport): Promise<StoredReport>;
  retrieveAndVerify(rootHash: string, expectedReport: RiskReport): Promise<RetrievedReport>;
}

export interface ChainSubmission {
  digest: Hex;
  receipt: ChainReceipt;
}

export interface AnchorVerification {
  digest: Hex;
  anchored: boolean;
  executed: boolean;
  matches: boolean;
  anchoredAt?: bigint;
}

export interface ChainAdapter {
  readonly mode: "0g" | "sandbox";
  simulateAction(action: ActionRequest): Promise<SimulationResult>;
  signAttestation(attestation: Attestation): Promise<Hex>;
  anchorAttestation(attestation: Attestation, signature: Hex): Promise<ChainSubmission>;
  executeAttestedAction(
    attestation: Attestation,
    actionCalldata: Hex,
    signature: Hex,
  ): Promise<ChainSubmission>;
  verifyAnchor(attestation: Attestation, signature: Hex): Promise<AnchorVerification>;
  nextNonce(agent: `0x${string}`, requester: `0x${string}`): Promise<bigint>;
}

export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
