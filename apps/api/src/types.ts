import type {
  ActionRequest,
  Attestation,
  ChainReceipt,
  RiskReport,
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

export interface StoredJob extends AnalysisJob {
  action: ActionRequest;
  execute: boolean;
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
  const { action: _action, execute: _execute, ...result } = job;
  return result;
}
