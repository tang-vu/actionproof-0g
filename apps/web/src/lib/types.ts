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

export interface PreflightPreview {
  schemaVersion: "1.0";
  previewOnly: true;
  mode: "live" | "sandbox";
  actionHash: `0x${string}`;
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
  writesEnabled: boolean;
  capabilities: {
    instantPreflight: boolean;
    fullAttestation: boolean;
    publicVerification: boolean;
    durableQueue: boolean;
    postgresPersistence: boolean;
  };
  operatorAuthorization: { required: boolean; configured: boolean };
  tenancy: {
    configuredTenants: number;
    authentication: "sha256-api-key" | "legacy-operator";
    durableWebhooks: boolean;
  };
  network: { name: string; chainId: number };
  services: Array<{
    id: "chain" | "compute" | "storage" | "identity" | "signer";
    name: string;
    status: "available" | "unavailable" | "sandbox";
    detail: string;
    endpoint?: string;
    explorerUrl?: string;
    latencyMs?: number;
    checkedAt?: string;
  }>;
}
