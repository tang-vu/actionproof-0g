"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { ActionTrace } from "../lib/types";

function short(value: string, head = 10, tail = 8) {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

function HashRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | undefined;
}) {
  return (
    <div className="hash-row">
      <span>{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value}>
          <code>{short(value)}</code> ↗
        </a>
      ) : (
        <code title={value}>{short(value)}</code>
      )}
    </div>
  );
}

export function TraceView({ id }: { id: string }) {
  const [trace, setTrace] = useState<ActionTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState<ActionTrace["verification"] | null>(null);
  const [tampering, setTampering] = useState(false);

  useEffect(() => {
    void api
      .getTrace(id)
      .then(setTrace)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Trace not found"),
      );
  }, [id]);

  async function runTamper() {
    setTampering(true);
    try {
      setTamper(await api.verifyTamper(id, "calldata"));
    } finally {
      setTampering(false);
    }
  }

  if (error) {
    return (
      <div className="state-page">
        <span className="state-code">404 / unavailable</span>
        <h1>This evidence trace could not be retrieved.</h1>
        <p>{error}</p>
        <Link className="primary-link" href="/analyze">
          Analyze a demo action
        </Link>
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="trace-loading" aria-label="Loading trace">
        <div className="skeleton hero" />
        <div className="skeleton-grid">
          <span />
          <span />
        </div>
      </div>
    );
  }

  const allowed = trace.report.verdict === "allow";
  return (
    <div className="trace-page content-width">
      <div className="trace-hero">
        <div>
          <span className="eyebrow">Public verification trace</span>
          <h1>Evidence, not a promise.</h1>
          <p>
            Independently inspect the exact action, canonical report, storage commitment, signature,
            and onchain anchor.
          </p>
        </div>
        <div className={`trace-verdict ${allowed ? "allow" : "block"}`}>
          <span>{allowed ? "ALLOW" : "BLOCK"}</span>
          <strong>{trace.report.riskScore}</strong>
          <small>risk / 100</small>
        </div>
      </div>

      <div className={`evidence-banner ${trace.verification.valid ? "valid" : "invalid"}`}>
        <span className="seal-icon">{trace.verification.valid ? "✓" : "!"}</span>
        <div>
          <strong>
            {trace.verification.valid
              ? "All evidence bindings verify"
              : "Evidence verification failed"}
          </strong>
          <p>
            Checked {new Date(trace.verification.checkedAt).toLocaleString()} · {trace.mode} mode
          </p>
        </div>
        <span className={`mode-pill ${trace.mode === "live" ? "live" : "sandbox"}`}>
          {trace.mode === "live" ? "0G live" : "Sandbox"}
        </span>
      </div>

      <div className="trace-grid">
        <section className="panel evidence-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Cryptographic bindings</span>
              <h2>Evidence seal</h2>
            </div>
          </div>
          <HashRow label="Action hash" value={trace.actionHash} />
          <HashRow label="Canonical report" value={trace.reportHash} />
          <HashRow
            label="0G Storage root"
            value={trace.storage.rootHash}
            href={trace.storage.explorerUrl}
          />
          <HashRow label="EIP-712 signature" value={trace.signature} />
          <HashRow
            label="Anchor transaction"
            value={trace.chain.transactionHash}
            href={trace.chain.explorerUrl}
          />
          {trace.execution?.transactionHash && (
            <HashRow
              label="Execution transaction"
              value={trace.execution.transactionHash}
              href={trace.execution.explorerUrl}
            />
          )}
        </section>

        <section className="panel checks-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Independent verification</span>
              <h2>{trace.verification.checks.length} checks</h2>
            </div>
          </div>
          <ul>
            {trace.verification.checks.map((check) => (
              <li key={check.id}>
                <span className={check.valid ? "check-pass" : "check-fail"}>
                  {check.valid ? "✓" : "×"}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="trace-grid lower">
        <section className="panel report-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Layered decision</span>
              <h2>Why {trace.report.verdict}?</h2>
            </div>
            <span className="confidence">
              {Math.round(trace.report.confidence * 100)}% model confidence
            </span>
          </div>
          <div className="layer-block">
            <span>Deterministic facts</span>
            {trace.report.deterministicFindings.length === 0 ? (
              <p>No blocking deterministic rule matched.</p>
            ) : (
              trace.report.deterministicFindings.map((finding) => (
                <article className={`finding ${finding.severity}`} key={finding.id}>
                  <div>
                    <strong>{finding.title}</strong>
                    <code>{finding.id}</code>
                  </div>
                  <p>{finding.description}</p>
                </article>
              ))
            )}
          </div>
          <div className="layer-block">
            <span>Simulation</span>
            <p>
              {trace.report.simulation.success ? "Call succeeded" : "Call reverted"} · gas estimate{" "}
              {trace.report.simulation.gasEstimate ?? "unavailable"} · target code{" "}
              {trace.report.simulation.targetHasCode ? "present" : "absent"}
            </p>
          </div>
          <div className="layer-block ai">
            <span>0G Compute assessment</span>
            <p>{trace.report.modelAssessment.reasons.join(" ")}</p>
            <small>
              {trace.report.compute.model} · {trace.report.compute.mode}
            </small>
          </div>
        </section>

        <section className="panel tamper-panel">
          <div>
            <span className="eyebrow">Adversarial check</span>
            <h2>Break the seal</h2>
            <p>
              Mutate one byte of calldata after attestation. The original signature and anchored
              hash must no longer validate.
            </p>
          </div>
          <div className="tamper-visual" aria-hidden="true">
            <code>{trace.action.calldata.slice(0, 18)}</code>
            <span>→</span>
            <code className="mutated">{trace.action.calldata.slice(0, 16)}ff</code>
          </div>
          <button
            className="secondary-action"
            type="button"
            disabled={tampering}
            onClick={runTamper}
          >
            {tampering ? "Verifying mutation…" : "Run tamper test"}
          </button>
          {tamper && (
            <div className={`tamper-result ${tamper.valid ? "unexpected" : "expected"}`}>
              <strong>{tamper.valid ? "Unexpected pass" : "Verification rejected"}</strong>
              <p>
                {tamper.valid
                  ? "The mutation incorrectly verified; do not trust this deployment."
                  : "Changed calldata invalidated the action hash and attestation as designed."}
              </p>
            </div>
          )}
        </section>
      </div>

      <details className="canonical-report panel">
        <summary>Inspect canonical risk report</summary>
        <pre>{trace.reportCanonical}</pre>
      </details>
    </div>
  );
}
