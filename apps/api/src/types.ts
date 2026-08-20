import type {
  ActionInspection,
  ActionRequest,
  AgentIdentityEvidence,
  Attestation,
  ChainReceipt,
  Finding,
  RiskReport,
  SimulationResult,
  StorageReceipt,
} from "@actionproof/core";
import type { Hex } from "viem";

export const stageIds = [
  "preflight",
  "simulation",
  "inference",
  "storage",
  "anchoring",
  "execution",
] as const;

export type StageId = (typeof stageIds)[number];
export type JobStatus = "queued" | StageId | "completed" | "failed";
export type StepStatus = "pending" | "active" | "complete" | "failed" | "skipped";

export interface JobStep {
  id: StageId;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface AnalysisJob {
  id: string;
  status: JobStatus;
  steps: JobStep[];
  traceId?: string;
  error?: JobError;
  createdAt: string;
  updatedAt: string;
}

export interface PreflightPreview {
  schemaVersion: "1.0";
  previewOnly: true;
  mode: "live" | "sandbox";
  actionHash: Hex;
  policyVersion: "actionproof-policy/1";
  inspection: ActionInspection;
  simulation: SimulationResult;
  agentIdentity?: AgentIdentityEvidence;
  findings: Finding[];
  disposition: "pass" | "review" | "block";
  riskFloor: number;
  blockingRuleIds: string[];
  reasons: string[];
  expectedNonce: string;
  nonceMatches: boolean;
  eligibleForFullAssessment: boolean;
  policy: {
    maxNativeValueWei: string;
    maxRequestTtlMs: number;
    targetAllowlistEnforced: boolean;
    deniedSpenderCount: number;
    packs: string[];
  };
  analysisPerformed: ["calldata-inspection", "chain-simulation", "deterministic-policy"];
  checkedAt: string;
  notice: string;
}

export interface StoredJob extends AnalysisJob {
  action: ActionRequest;
  execute: boolean;
  tenantId?: string;
}

export interface QueueStats {
  pending: number;
  leased: number;
  exhausted: number;
}

export interface WebhookOutboxItem {
  id: string;
  tenantId: string;
  jobId: string;
  event: "job.completed" | "job.failed";
  createdAt: string;
  attempts: number;
}

export interface VerificationCheck {
  id: string;
  label: string;
  valid: boolean;
  detail: string;
}

export interface TraceVerification {
  valid: boolean;
  checkedAt: string;
  checks: VerificationCheck[];
}

export interface ActionTrace {
  id: string;
  mode: "live" | "sandbox";
  createdAt: string;
  action: ActionRequest;
  actionHash: Hex;
  report: RiskReport;
  reportCanonical: string;
  reportHash: Hex;
  storage: StorageReceipt;
  attestation: Attestation;
  signature: Hex;
  chain: ChainReceipt;
  execution: {
    status: "executed" | "blocked" | "not-requested";
    transactionHash?: Hex;
    error?: string;
    explorerUrl?: string;
  };
  verification: TraceVerification;
}

export interface PersistedState {
  version: 1;
  jobs: StoredJob[];
  traces: ActionTrace[];
}

export function publicJob(job: StoredJob): AnalysisJob {
  const { action: _action, execute: _execute, tenantId: _tenantId, ...result } = job;
  return result;
}
