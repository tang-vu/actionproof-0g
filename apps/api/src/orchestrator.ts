import { randomUUID } from "node:crypto";

import {
  canonicalize,
  createAttestation,
  decideFinalVerdict,
  evaluateDeterministicPolicy,
  findingSchema,
  hashActionRequest,
  hashCanonical,
  inspectAction,
  modelRiskAssessmentSchema,
  riskReportSchema,
  type ActionRequest,
  type AgentIdentityEvidence,
  type CanonicalValue,
  type Finding,
  type ModelRiskAssessment,
  type RiskReport,
} from "@actionproof/core";
import { calculateZgMerkleRoot } from "@actionproof/0g";
import type { Hex } from "viem";

import type { AppConfig } from "./config.js";
import { ApiError, errorCode, isRetryable, safeErrorMessage } from "./errors.js";
import type { Runtime } from "./runtime.js";
import type { StateStore } from "./store.js";
import {
  publicJob,
  stageIds,
  type ActionTrace,
  type AnalysisJob,
  type PreflightPreview,
  type StageId,
  type StoredJob,
  type TraceVerification,
  type VerificationCheck,
} from "./types.js";

const STEP_LABELS: Readonly<Record<StageId, string>> = {
  preflight: "Deterministic preflight",
  simulation: "Transaction simulation",
  inference: "0G Compute assessment",
  storage: "0G Storage commitment",
  anchoring: "EIP-712 attestation and anchor",
  execution: "Guarded execution",
};

export interface CreateJobInput {
  action: ActionRequest;
  execute: boolean;
}

type Clock = () => Date;

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function computeFailure(error: unknown): {
  finding: Finding;
  assessment: ModelRiskAssessment;
} {
  const message = safeErrorMessage(error).slice(0, 500);
  const finding = findingSchema.parse({
    id: "COMPUTE_RESPONSE_INVALID",
    severity: "critical",
    category: "deterministic",
    title: "Compute assessment unavailable or malformed",
    description: "Inference failures are converted to a deterministic fail-closed policy finding.",
    evidence: [message],
    blocking: true,
  });
  const assessment = modelRiskAssessmentSchema.parse({
    verdict: "block",
    riskScore: 100,
    confidence: 1,
    modelFindings: [
      {
        id: "MODEL_OUTPUT_REJECTED",
        severity: "critical",
        category: "model",
        title: "Model output rejected",
        description:
          "No model-authored content was trusted because the response failed its boundary.",
        evidence: [message],
        blocking: true,
      },
    ],
    evidence: [message],
    reasons: ["Compute failed strict runtime validation."],
    recommendedAction: "Do not execute the proposed action.",
    limitations: ["No valid model assessment was available."],
  });
  return { finding, assessment };
}

function strictModelAssessment(rawContent: string): ModelRiskAssessment {
  if (Buffer.byteLength(rawContent, "utf8") > 131_072) {
    throw new TypeError("Compute assessment exceeded the 128 KiB response limit");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawContent);
  } catch (error) {
    throw new TypeError("Compute assessment was not exactly one JSON value", { cause: error });
  }
  const parsed = modelRiskAssessmentSchema.parse(decoded);
  const inputCanonical = canonicalize(decoded as CanonicalValue);
  const parsedCanonical = canonicalize(parsed as unknown as CanonicalValue);
  if (inputCanonical !== parsedCanonical) {
    throw new TypeError("Compute assessment contained unknown or normalized fields");
  }
  return parsed;
}

function fallbackComputeMetadata(now: Date, mode: Runtime["mode"]): RiskReport["compute"] {
  return {
    service: "0G Compute",
    mode: mode === "live" ? "router" : "sandbox",
    model: "unavailable/fail-closed",
    generatedAt: now.toISOString(),
  };
}

function policyFinding(input: {
  id: string;
  severity: Finding["severity"];
  title: string;
  description: string;
  evidence: string[];
  blocking: boolean;
}): Finding {
  return findingSchema.parse({ ...input, category: "deterministic" });
}

async function resolveAgentIdentity(
  runtime: Runtime,
  config: AppConfig,
  action: ActionRequest,
): Promise<{ agentIdentity?: AgentIdentityEvidence; findings: Finding[] }> {
  if (config.OG_AGENTIC_ID === undefined) return { findings: [] };

  try {
    const agentIdentity = await runtime.resolveAgentIdentity(action.agent);
    if (!agentIdentity) throw new Error("Agentic ID resolver returned no evidence");
    if (agentIdentity.matchesActionAgent) return { agentIdentity, findings: [] };
    return {
      agentIdentity,
      findings: [
        policyFinding({
          id: "AGENTIC_ID_WALLET_MISMATCH",
          severity: "critical",
          title: "Agentic ID wallet mismatch",
          description:
            "The ERC-8004 agent wallet does not match the exact agent address in this action.",
          evidence: [
            `agentId=${agentIdentity.agentId}`,
            `registered=${agentIdentity.agentWallet}`,
            `action=${action.agent}`,
          ],
          blocking: true,
        }),
      ],
    };
  } catch (error) {
    return {
      findings: [
        policyFinding({
          id: "AGENTIC_ID_UNAVAILABLE",
          severity: "critical",
          title: "Configured Agentic ID could not be verified",
          description:
            "Optional identity enforcement was configured, so resolution failure blocks execution.",
          evidence: [safeErrorMessage(error).slice(0, 500)],
          blocking: true,
        }),
      ],
    };
  }
}

export class Orchestrator {
  readonly #config: AppConfig;
  readonly #runtime: Runtime;
  readonly #store: StateStore;
  readonly #clock: Clock;
  #queue: Promise<void> = Promise.resolve();

  constructor(args: { config: AppConfig; runtime: Runtime; store: StateStore; clock?: Clock }) {
    this.#config = args.config;
    this.#runtime = args.runtime;
    this.#store = args.store;
    this.#clock = args.clock ?? (() => new Date());
  }

  async createJob(input: CreateJobInput): Promise<AnalysisJob> {
    const now = this.#clock().toISOString();
    const job: StoredJob = {
      id: randomUUID(),
      status: "queued",
      steps: stageIds.map((id) => ({ id, label: STEP_LABELS[id], status: "pending" })),
      action: input.action,
      execute: input.execute,
      createdAt: now,
      updatedAt: now,
    };
    await this.#store.putJob(job);
    this.#queue = this.#queue.then(
      () => this.#run(job.id),
      () => this.#run(job.id),
    );
    return publicJob(job);
  }

  getJob(id: string): AnalysisJob | undefined {
    const job = this.#store.getJob(id);
    return job ? publicJob(job) : undefined;
  }

  async nextNonce(agent: `0x${string}`, requester: `0x${string}`): Promise<bigint> {
    return this.#runtime.chain.nextNonce(agent, requester);
  }

  async preview(action: ActionRequest): Promise<PreflightPreview> {
    const checkedAt = this.#clock();
    const actionHash = hashActionRequest(action);
    const [simulation, expectedNonce, identityResult] = await Promise.all([
      this.#runtime.chain.simulateAction(action),
      this.#runtime.chain.nextNonce(action.agent, action.requester),
      resolveAgentIdentity(this.#runtime, this.#config, action),
    ]);
    const nonceMatches = BigInt(action.nonce) === expectedNonce;
    const lifetimeMs = (action.expiresAt - action.issuedAt) * 1_000;
    let findings = evaluateDeterministicPolicy(action, simulation, {
      expectedChainId: this.#config.OG_CHAIN_ID,
      now: Math.floor(checkedAt.getTime() / 1_000),
      maxNativeValueWei: this.#config.maxNativeValueWei,
      deniedSpenders: this.#config.deniedSpenders,
      ...(this.#config.allowedTargets ? { allowedTargets: this.#config.allowedTargets } : {}),
      duplicate: Boolean(this.#store.findTraceByActionHash(actionHash)),
    });

    if (!nonceMatches) {
      findings = [
        policyFinding({
          id: "NONCE_MISMATCH",
          severity: "critical",
          title: "Guard nonce mismatch",
          description: "The submitted nonce is not the guard's exact next nonce for this lane.",
          evidence: [`submitted=${action.nonce}`, `expected=${expectedNonce}`],
          blocking: true,
        }),
        ...findings,
      ];
    }
    if (lifetimeMs > this.#config.JOB_TTL_MS) {
      findings = [
        policyFinding({
          id: "REQUEST_TTL_EXCEEDED",
          severity: "critical",
          title: "Request validity window is too long",
          description: "The action exceeds the configured maximum attestation lifetime.",
          evidence: [`submittedMs=${lifetimeMs}`, `maximumMs=${this.#config.JOB_TTL_MS}`],
          blocking: true,
        }),
        ...findings,
      ];
    }
    findings = [...findings, ...identityResult.findings];

    const weights: Record<Finding["severity"], number> = {
      info: 0,
      low: 10,
      medium: 35,
      high: 70,
      critical: 100,
    };
    const riskFloor = findings.reduce(
      (score, finding) => Math.max(score, weights[finding.severity]),
      0,
    );
    const blockers = findings.filter((finding) => finding.blocking);
    const disposition = blockers.length > 0 ? "block" : riskFloor >= 35 ? "review" : "pass";

    return {
      schemaVersion: "1.0",
      previewOnly: true,
      mode: this.#runtime.mode,
      actionHash,
      policyVersion: "actionproof-policy/1",
      inspection: inspectAction(action),
      simulation,
      ...(identityResult.agentIdentity ? { agentIdentity: identityResult.agentIdentity } : {}),
      findings,
      disposition,
      riskFloor,
      blockingRuleIds: blockers.map((finding) => finding.id),
      reasons:
        findings.length > 0
          ? findings.map((finding) => finding.title)
          : ["No deterministic policy finding was raised."],
      expectedNonce: expectedNonce.toString(),
      nonceMatches,
      eligibleForFullAssessment: blockers.length === 0,
      policy: {
        maxNativeValueWei: this.#config.maxNativeValueWei.toString(),
        maxRequestTtlMs: this.#config.JOB_TTL_MS,
        targetAllowlistEnforced: Boolean(this.#config.allowedTargets),
        deniedSpenderCount: this.#config.deniedSpenders.size,
      },
      analysisPerformed: ["calldata-inspection", "chain-simulation", "deterministic-policy"],
      checkedAt: checkedAt.toISOString(),
      notice:
        "Read-only preview: no 0G Compute inference, Storage upload, signature, chain write, or execution occurred.",
    };
  }

  async verify(trace: ActionTrace): Promise<TraceVerification> {
    return verifyTrace(this.#runtime, trace, this.#clock);
  }

  async #run(id: string): Promise<void> {
    const job = this.#store.getJob(id);
    if (!job) return;
    let activeStage: StageId = "preflight";
    try {
      await this.#start(job, "preflight");
      if (this.#runtime.mode === "live" && !this.#config.liveWriteEnabled) {
        throw new ApiError(
          503,
          "LIVE_WRITES_DISABLED",
          "Live analysis is disabled until ENABLE_LIVE_WRITES and network safety gates are true",
        );
      }
      const lifetimeMs = (job.action.expiresAt - job.action.issuedAt) * 1_000;
      if (lifetimeMs > this.#config.JOB_TTL_MS) {
        throw new ApiError(
          400,
          "REQUEST_TTL_EXCEEDED",
          `Action validity exceeds the configured ${this.#config.JOB_TTL_MS}ms limit`,
        );
      }
      const expectedNonce = await this.#runtime.chain.nextNonce(
        job.action.agent,
        job.action.requester,
      );
      if (BigInt(job.action.nonce) !== expectedNonce) {
        throw new ApiError(
          409,
          "NONCE_MISMATCH",
          `Submitted nonce ${job.action.nonce} does not match guard nonce ${expectedNonce}`,
        );
      }
      const actionHash = hashActionRequest(job.action);
      if (this.#store.findTraceByActionHash(actionHash)) {
        throw new ApiError(409, "DUPLICATE_ACTION", "This exact action already has a trace");
      }
      await this.#complete(job, "preflight", `Exact submitted nonce ${job.action.nonce} accepted.`);

      activeStage = "simulation";
      await this.#start(job, activeStage);
      const simulation = await this.#runtime.chain.simulateAction(job.action);
      let deterministic = evaluateDeterministicPolicy(job.action, simulation, {
        expectedChainId: this.#config.OG_CHAIN_ID,
        now: Math.floor(this.#clock().getTime() / 1_000),
        maxNativeValueWei: this.#config.maxNativeValueWei,
        deniedSpenders: this.#config.deniedSpenders,
        ...(this.#config.allowedTargets ? { allowedTargets: this.#config.allowedTargets } : {}),
        duplicate: false,
      });
      const identityResult = await resolveAgentIdentity(this.#runtime, this.#config, job.action);
      const agentIdentity = identityResult.agentIdentity;
      deterministic = [...deterministic, ...identityResult.findings];
      await this.#complete(
        job,
        activeStage,
        simulation.success
          ? "Simulation completed."
          : "Simulation failed and will block execution.",
      );

      activeStage = "inference";
      await this.#start(job, activeStage);
      let assessment: ModelRiskAssessment;
      let compute: RiskReport["compute"];
      try {
        const computeInput = JSON.parse(
          JSON.stringify({
            action: job.action,
            simulation,
            deterministicFindings: deterministic,
            policyVersion: "actionproof-policy/1",
            ...(agentIdentity ? { agentIdentity } : {}),
          }),
        ) as Parameters<Runtime["compute"]["assess"]>[0];
        const result = await this.#runtime.compute.assess(computeInput);
        assessment = strictModelAssessment(result.rawContent);
        compute = result.compute;
        await this.#complete(job, activeStage, "Strict model assessment accepted at runtime.");
      } catch (error) {
        const failure = computeFailure(error);
        deterministic = [...deterministic, failure.finding];
        assessment = failure.assessment;
        compute = fallbackComputeMetadata(this.#clock(), this.#runtime.mode);
        await this.#complete(job, activeStage, "Invalid Compute output rejected; failed closed.");
      }

      const finalDecision = decideFinalVerdict(deterministic, assessment);
      const generatedAt = this.#clock().toISOString();
      const reportDraft = {
        schemaVersion: "1.0",
        actionHash,
        action: job.action,
        verdict: finalDecision.verdict,
        riskScore: finalDecision.riskScore,
        confidence: finalDecision.confidence,
        deterministicFindings: deterministic,
        simulation,
        modelAssessment: assessment,
        compute,
        ...(agentIdentity ? { agentIdentity } : {}),
        finalPolicy: {
          version: "actionproof-policy/1",
          blockingRuleIds: finalDecision.blockingRuleIds,
          reasons:
            finalDecision.reasons.length > 0
              ? finalDecision.reasons
              : ["No enforced policy rule blocked this exact action."],
        },
        generatedAt,
      };
      // Some upstream adapters construct optional fields with an explicit
      // `undefined`. Canonical JSON forbids that representation, so normalize
      // through JSON before the final schema parse instead of silently changing
      // any submitted action field.
      const report = riskReportSchema.parse(JSON.parse(JSON.stringify(reportDraft)));
      const reportCanonical = canonicalize(report as unknown as CanonicalValue);
      const reportHash = hashCanonical(report as unknown as CanonicalValue);

      activeStage = "storage";
      await this.#start(job, activeStage);
      const stored = await this.#runtime.storage.uploadReport(report);
      const localBytes = new TextEncoder().encode(reportCanonical);
      if (!sameBytes(localBytes, stored.canonicalBytes)) {
        throw new Error("Storage adapter returned bytes different from the canonical report");
      }
      await this.#complete(job, activeStage, `Committed root ${stored.receipt.rootHash}.`);

      activeStage = "anchoring";
      await this.#start(job, activeStage);
      const attestation = createAttestation({
        action: job.action,
        reportRoot: stored.receipt.rootHash as Hex,
        reportHash,
        verdict: report.verdict,
      });
      const signature = await this.#runtime.chain.signAttestation(attestation);
      const shouldExecute = report.verdict === "allow" && job.execute;
      const anchor = await this.#runtime.chain.anchorAttestation(attestation, signature);
      await this.#complete(
        job,
        activeStage,
        shouldExecute
          ? "Signed and anchored; exact allow action is now eligible for guarded execution."
          : "Signed and anchored without executing the action.",
      );

      activeStage = "execution";
      await this.#start(job, activeStage);
      const execution = shouldExecute
        ? await this.#runtime.chain.executeAttestedAction(
            attestation,
            job.action.calldata as Hex,
            signature,
          )
        : undefined;
      const chain = anchor.receipt;
      const executionStatus: ActionTrace["execution"] = shouldExecute
        ? {
            status: "executed",
            transactionHash: execution?.receipt.transactionHash as Hex,
            ...(execution?.receipt.explorerUrl
              ? { explorerUrl: execution.receipt.explorerUrl }
              : {}),
          }
        : report.verdict === "allow"
          ? { status: "not-requested" }
          : { status: "blocked" };
      await this.#finishExecution(
        job,
        shouldExecute
          ? "Previously anchored allow attestation completed guarded execution."
          : report.verdict === "allow"
            ? "Execution was not requested; attestation remains anchored."
            : `Execution skipped because final verdict is ${report.verdict}; decision is anchored.`,
        shouldExecute ? "complete" : "skipped",
      );

      const trace: ActionTrace = {
        id: randomUUID(),
        mode: this.#runtime.mode,
        createdAt: this.#clock().toISOString(),
        action: job.action,
        actionHash,
        report,
        reportCanonical,
        reportHash,
        storage: stored.receipt,
        attestation,
        signature,
        chain,
        execution: executionStatus,
        verification: { valid: false, checkedAt: this.#clock().toISOString(), checks: [] },
      };
      trace.verification = await verifyTrace(this.#runtime, trace, this.#clock);
      if (!trace.verification.valid) {
        const failed = trace.verification.checks
          .filter((entry) => !entry.valid)
          .map((entry) => `${entry.id}: ${entry.detail}`)
          .join("; ");
        throw new Error(`Completed trace failed its own integrity verification: ${failed}`);
      }
      await this.#store.putTrace(trace);
      job.status = "completed";
      job.traceId = trace.id;
      job.updatedAt = this.#clock().toISOString();
      await this.#store.putJob(job);
    } catch (error) {
      await this.#fail(job, activeStage, error);
    }
  }

  async #start(job: StoredJob, stage: StageId): Promise<void> {
    job.status = stage;
    const step = job.steps.find((entry) => entry.id === stage);
    if (step) step.status = "active";
    job.updatedAt = this.#clock().toISOString();
    await this.#store.putJob(job);
  }

  async #complete(job: StoredJob, stage: StageId, detail: string): Promise<void> {
    const step = job.steps.find((entry) => entry.id === stage);
    if (step) {
      step.status = "complete";
      step.detail = detail;
    }
    job.updatedAt = this.#clock().toISOString();
    await this.#store.putJob(job);
  }

  async #finishExecution(
    job: StoredJob,
    detail: string,
    status: "complete" | "skipped",
  ): Promise<void> {
    const step = job.steps.find((entry) => entry.id === "execution");
    if (step) {
      step.status = status;
      step.detail = detail;
    }
    job.updatedAt = this.#clock().toISOString();
    await this.#store.putJob(job);
  }

  async #fail(job: StoredJob, stage: StageId, error: unknown): Promise<void> {
    const activeIndex = job.steps.findIndex((entry) => entry.id === stage);
    const active = job.steps[activeIndex];
    if (active) {
      active.status = "failed";
      active.detail = safeErrorMessage(error);
    }
    for (const step of job.steps.slice(Math.max(0, activeIndex + 1))) {
      if (step.status === "pending") step.status = "skipped";
    }
    job.status = "failed";
    job.error = {
      code: errorCode(error),
      message: safeErrorMessage(error),
      retryable: isRetryable(error),
    };
    job.updatedAt = this.#clock().toISOString();
    await this.#store.putJob(job);
  }
}

function check(id: string, label: string, valid: boolean, detail: string): VerificationCheck {
  return { id, label, valid, detail };
}

export async function verifyTrace(
  runtime: Runtime,
  trace: ActionTrace,
  clock: Clock = () => new Date(),
): Promise<TraceVerification> {
  const checks: VerificationCheck[] = [];
  try {
    const actionHash = hashActionRequest(trace.action);
    checks.push(
      check(
        "action-hash",
        "Exact action hash",
        actionHash.toLowerCase() === trace.actionHash.toLowerCase() &&
          actionHash.toLowerCase() === trace.report.actionHash.toLowerCase(),
        `computed=${actionHash}`,
      ),
    );
  } catch (error) {
    checks.push(check("action-hash", "Exact action hash", false, safeErrorMessage(error)));
  }

  const canonical = canonicalize(trace.report as unknown as CanonicalValue);
  checks.push(
    check(
      "report-canonical",
      "Canonical report bytes",
      canonical === trace.reportCanonical,
      canonical === trace.reportCanonical ? "Canonical bytes match." : "Canonical bytes changed.",
    ),
  );
  const reportHash = hashCanonical(trace.report as unknown as CanonicalValue);
  checks.push(
    check(
      "report-hash",
      "Canonical report hash",
      reportHash.toLowerCase() === trace.reportHash.toLowerCase(),
      `computed=${reportHash}`,
    ),
  );

  let storageRootValid = false;
  try {
    const root = await calculateZgMerkleRoot(new TextEncoder().encode(trace.reportCanonical));
    storageRootValid = root.toLowerCase() === trace.storage.rootHash.toLowerCase();
    checks.push(
      check("storage-root", "Recomputed 0G Merkle root", storageRootValid, `computed=${root}`),
    );
  } catch (error) {
    checks.push(check("storage-root", "Recomputed 0G Merkle root", false, safeErrorMessage(error)));
  }

  if (runtime.mode === "sandbox") {
    checks.push(
      check(
        "storage-roundtrip",
        "Sandbox persisted bytes",
        storageRootValid,
        "SANDBOX ONLY: persisted canonical bytes were re-rooted; no 0G network retrieval is claimed.",
      ),
    );
  } else {
    try {
      await runtime.storage.retrieveAndVerify(trace.storage.rootHash as Hex, trace.report);
      checks.push(
        check(
          "storage-roundtrip",
          "Storage round-trip",
          true,
          "Retrieved bytes and root verified.",
        ),
      );
    } catch (error) {
      checks.push(check("storage-roundtrip", "Storage round-trip", false, safeErrorMessage(error)));
    }
  }

  try {
    const expected = createAttestation({
      action: trace.action,
      reportRoot: trace.storage.rootHash as Hex,
      reportHash: trace.reportHash,
      verdict: trace.report.verdict,
    });
    const valid = JSON.stringify(expected) === JSON.stringify(trace.attestation);
    checks.push(
      check(
        "attestation-binding",
        "Attestation binds action and report",
        valid,
        valid ? "All signed fields match." : "One or more signed fields differ.",
      ),
    );
  } catch (error) {
    checks.push(
      check(
        "attestation-binding",
        "Attestation binds action and report",
        false,
        safeErrorMessage(error),
      ),
    );
  }

  try {
    const anchor = await runtime.chain.verifyAnchor(trace.attestation, trace.signature);
    const anchored = anchor.anchored;
    checks.push(
      check(
        "chain-anchor",
        "On-chain/sandbox anchor",
        anchored && anchor.matches,
        `digest=${anchor.digest}; anchored=${anchored}; matches=${anchor.matches}`,
      ),
    );
  } catch (error) {
    checks.push(check("chain-anchor", "On-chain/sandbox anchor", false, safeErrorMessage(error)));
  }

  return {
    valid: checks.length > 0 && checks.every((entry) => entry.valid),
    checkedAt: clock().toISOString(),
    checks,
  };
}

export function tamperedTrace(
  source: ActionTrace,
  mutation: "calldata" | "reportRoot" | "nonce",
): ActionTrace {
  const trace = structuredClone(source);
  if (mutation === "calldata") {
    trace.action.calldata = trace.action.calldata === "0x" ? "0x00" : `${trace.action.calldata}00`;
  } else if (mutation === "nonce") {
    trace.action.nonce = (BigInt(trace.action.nonce) + 1n).toString();
  } else {
    const last = trace.attestation.reportRoot.at(-1) ?? "0";
    trace.attestation.reportRoot = `${trace.attestation.reportRoot.slice(0, -1)}${last === "0" ? "1" : "0"}`;
  }
  return trace;
}
