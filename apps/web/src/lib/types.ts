import type {
  ActionRequest,
  Attestation,
  ChainReceipt,
  RiskReport,
  StorageReceipt,
} from "@actionproof/core";

export type JobStage =
  | "queued"
  | "preflight"
  | "simulation"
  | "inference"
  | "storage"
  | "anchoring"
  | "execution"
  | "completed"
  | "failed";

export interface JobStep {
  id: Exclude<JobStage, "queued" | "completed" | "failed">;
  label: string;
  status: "pending" | "active" | "complete" | "failed" | "skipped";
  detail?: string;
}

export interface AnalysisJob {
  id: string;
  status: JobStage;
  steps: JobStep[];
  traceId?: string;
  error?: { code: string; message: string; retryable: boolean };
}

export interface VerificationCheck {
  id: string;
  label: string;
  valid: boolean;
  detail: string;
}

export interface ActionTrace {
  id: string;
  mode: "live" | "sandbox";
  createdAt: string;
  action: ActionRequest;
  actionHash: `0x${string}`;
  report: RiskReport;
  reportCanonical: string;
  reportHash: `0x${string}`;
  storage: StorageReceipt;
  attestation: Attestation;
  signature: `0x${string}`;
  chain: ChainReceipt;
  execution?: {
    status: "executed" | "blocked" | "not-requested";
    transactionHash?: `0x${string}`;
    error?: string;
    explorerUrl?: string;
  };
  verification: {
    valid: boolean;
    checkedAt: string;
    checks: VerificationCheck[];
  };
}

export interface IntegrationStatus {
  mode: "live" | "sandbox";
  network: { name: string; chainId: number };
  services: Array<{
    id: "chain" | "compute" | "storage";
    name: string;
    status: "available" | "unavailable" | "sandbox";
    detail: string;
    endpoint?: string;
  }>;
}
