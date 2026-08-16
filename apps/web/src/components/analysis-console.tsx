"use client";

import { encodeFunctionData, getAddress, maxUint256 } from "viem";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import type { ActionRequest } from "@actionproof/core";

import { api } from "../lib/api";
import type { ActionTrace, AnalysisJob, JobStep } from "../lib/types";

const DEMO_AGENT = getAddress(
  process.env.NEXT_PUBLIC_ACTIONPROOF_AGENT_ADDRESS ?? "0xa17e000000000000000000000000000000000001",
);
const DEMO_COUNTER = getAddress(
  process.env.NEXT_PUBLIC_DEMO_COUNTER_ADDRESS ?? "0xc001000000000000000000000000000000000001",
);
const DEMO_TOKEN = getAddress(
  process.env.NEXT_PUBLIC_DEMO_TOKEN_ADDRESS ?? "0x700e000000000000000000000000000000000001",
);
const DEMO_SPENDER = getAddress("0xbad0000000000000000000000000000000000001");
const DESTINATION_CHAIN_ID = Number(process.env.NEXT_PUBLIC_OG_CHAIN_ID ?? "16602");

const demoCounterAbi = [
  {
    type: "function",
    name: "increment",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type Scenario = "safe" | "dangerous";

const initialSteps: JobStep[] = [
  { id: "preflight", label: "Deterministic policy", status: "pending" },
  { id: "simulation", label: "Transaction simulation", status: "pending" },
  { id: "inference", label: "0G Compute assessment", status: "pending" },
  { id: "storage", label: "0G Storage commitment", status: "pending" },
  { id: "anchoring", label: "0G Chain attestation", status: "pending" },
  { id: "execution", label: "Guarded execution", status: "pending" },
];

function scenarioAction(
  scenario: Scenario,
  requester: `0x${string}`,
  issuedAt = Math.floor(Date.now() / 1000),
): ActionRequest {
  return {
    version: "1",
    agent: DEMO_AGENT,
    requester,
    target: scenario === "safe" ? DEMO_COUNTER : DEMO_TOKEN,
    value: "0",
    calldata:
      scenario === "safe"
        ? encodeFunctionData({ abi: demoCounterAbi, functionName: "increment" })
        : encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [DEMO_SPENDER, maxUint256],
          }),
    intent:
      scenario === "safe"
        ? "Increment the valueless ActionProof demo counter once"
        : "Approve the demo operator to manage test tokens",
    destinationChainId: DESTINATION_CHAIN_ID,
    nonce: String(issuedAt),
    issuedAt,
    expiresAt: issuedAt + 600,
  };
}

export function AnalysisConsole({ initialIssuedAt }: { initialIssuedAt: number }) {
  const account = useAccount();
  const [scenario, setScenario] = useState<Scenario>("safe");
  const [action, setAction] = useState(() => scenarioAction("safe", DEMO_AGENT, initialIssuedAt));
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [trace, setTrace] = useState<ActionTrace | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nonceLoading, setNonceLoading] = useState(false);
  const [readOnly, setReadOnly] = useState(false);

  const requester = account.address ?? DEMO_AGENT;

  useEffect(() => {
    void api
      .getIntegrations()
      .then((status) => setReadOnly(status.mode === "live" && !status.writesEnabled))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const next = scenarioAction(scenario, requester);
    setAction(next);
    setJob(null);
    setTrace(null);
    setSubmitError(null);
    setNonceLoading(true);
    void api
      .getNonce(requester, DEMO_AGENT)
      .then(({ nonce }) => setAction((current) => ({ ...current, nonce })))
      .catch(() => {
        // Keep the visible placeholder nonce; submission will fail closed if it is stale.
      })
      .finally(() => setNonceLoading(false));
  }, [requester, scenario]);

  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    const timer = window.setInterval(() => {
      void api
        .getJob(job.id)
        .then((next) => {
          setJob(next);
          if (next.status === "completed" && next.traceId) {
            void api
              .getTrace(next.traceId)
              .then(setTrace)
              .catch(() => undefined);
          }
        })
        .catch((error: unknown) => {
          setSubmitError(error instanceof Error ? error.message : "Job polling failed");
          window.clearInterval(timer);
        });
    }, 450);
    return () => window.clearInterval(timer);
  }, [job]);

  const steps = job?.steps ?? initialSteps;
  const busy = job && !["completed", "failed"].includes(job.status);
  const actionPreview = useMemo(
    () => [
      ["Agent", action.agent],
      ["Target", action.target],
      ["Value", `${action.value} 0G`],
      ["Nonce", action.nonce],
      ["Deadline", new Date(action.expiresAt * 1000).toLocaleTimeString()],
    ],
    [action],
  );

  const submit = useCallback(async () => {
    setSubmitError(null);
    setTrace(null);
    try {
      setJob(await api.createJob({ action, execute: true }));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not create analysis job");
    }
  }, [action]);

  return (
    <div className="console-grid">
      <section className="action-builder panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">01 · Proposed action</span>
            <h2>Exact execution envelope</h2>
          </div>
          <span className="agent-chip">
            {account.isConnected ? "Connected wallet" : "Demo agent"}
          </span>
        </div>

        <div className="scenario-switch" role="tablist" aria-label="Demo scenario">
          <button
            className={scenario === "safe" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={scenario === "safe"}
            onClick={() => setScenario("safe")}
          >
            <span className="scenario-signal safe" /> Safe counter
          </button>
          <button
            className={scenario === "dangerous" ? "active danger" : ""}
            type="button"
            role="tab"
            aria-selected={scenario === "dangerous"}
            onClick={() => setScenario("dangerous")}
          >
            <span className="scenario-signal danger" /> Unlimited approval
          </button>
        </div>

        <label className="field intent-field">
          <span>Human-readable intent</span>
          <textarea
            value={action.intent}
            maxLength={500}
            onChange={(event) => setAction({ ...action, intent: event.target.value })}
          />
        </label>

        <dl className="envelope-list">
          {actionPreview.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>

        <details className="calldata-box">
          <summary>Calldata · {action.calldata.slice(0, 10)}</summary>
          <code>{action.calldata}</code>
        </details>

        <div className="callout neutral">
          <span className="callout-icon">i</span>
          Demo contracts and valueless assets only. An allow verdict is experimental evidence—not a
          safety guarantee.
        </div>

        <button
          className="primary-action"
          type="button"
          disabled={Boolean(busy) || nonceLoading || readOnly}
          onClick={submit}
        >
          {readOnly
            ? "Read-only hosted demo"
            : nonceLoading
              ? "Reading guard nonce…"
              : busy
                ? "Analyzing exact action…"
                : "Analyze & attest"}
          <span aria-hidden="true">→</span>
        </button>
        {readOnly && (
          <div className="callout neutral">
            <span className="callout-icon">i</span>
            <div>
              <strong>Public evidence mode</strong>
              <p>
                Paid writes are disabled to protect server-held testnet balances.{" "}
                <Link href="/history">Inspect the real Galileo safe and blocked traces</Link>.
              </p>
            </div>
          </div>
        )}
        {submitError && <div className="inline-error prominent">{submitError}</div>}
      </section>

      <section className="proof-pipeline panel" aria-live="polite">
        <div className="panel-header">
          <div>
            <span className="eyebrow">02 · Evidence pipeline</span>
            <h2>Fail-closed pre-execution proof</h2>
          </div>
          {job && <code className="job-id">{job.id.slice(0, 12)}</code>}
        </div>
        <ol className="pipeline-list">
          {steps.map((step, index) => (
            <li className={step.status} key={step.id}>
              <span className="step-index">
                {step.status === "complete" ? "✓" : step.status === "failed" ? "!" : index + 1}
              </span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail ?? defaultStepDetail(step.id)}</p>
              </div>
              <span className="step-status">{step.status}</span>
            </li>
          ))}
        </ol>

        {!job && (
          <div className="empty-proof">
            <div className="proof-glyph" aria-hidden="true">
              <span />
            </div>
            <h3>No proof yet</h3>
            <p>
              Select a scenario and submit the exact envelope. No stage is implied until it runs.
            </p>
          </div>
        )}

        {job?.status === "failed" && (
          <div className="callout danger">
            <span className="callout-icon">!</span>
            <div>
              <strong>{job.error?.code ?? "ANALYSIS_FAILED"}</strong>
              <p>{job.error?.message ?? "The pipeline failed closed."}</p>
            </div>
          </div>
        )}

        {trace && <VerdictSummary trace={trace} />}
      </section>
    </div>
  );
}

function defaultStepDetail(id: JobStep["id"]) {
  return {
    preflight: "Selectors, limits, chain, deadline, nonce",
    simulation: "eth_call, bytecode, effects, revert status",
    inference: "Structured assessment validated at runtime",
    storage: "Canonical report and Merkle root",
    anchoring: "EIP-712 signature and report-root event",
    execution: "Safe verdict only; replay protected",
  }[id];
}

function VerdictSummary({ trace }: { trace: ActionTrace }) {
  const allowed = trace.report.verdict === "allow";
  return (
    <article className={`verdict-card ${allowed ? "allow" : "block"}`}>
      <div className="verdict-topline">
        <span className="verdict-word">{allowed ? "Allowed" : "Blocked"}</span>
        <span className="risk-score">Risk {trace.report.riskScore}/100</span>
      </div>
      <h3>{allowed ? "Exact action passed every enforced layer." : "Policy stopped execution."}</h3>
      <p>{trace.report.finalPolicy.reasons[0]}</p>
      <div className="verdict-meta">
        <span>{trace.mode === "live" ? "0G live evidence" : "Labeled sandbox evidence"}</span>
        <span>·</span>
        <span>
          {trace.verification.checks.filter((check) => check.valid).length} integrity checks
        </span>
      </div>
      <Link className="trace-link" href={`/trace/${trace.id}`}>
        Open public trace <span aria-hidden="true">↗</span>
      </Link>
    </article>
  );
}
