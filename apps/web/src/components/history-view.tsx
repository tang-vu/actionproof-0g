"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { ActionTrace } from "../lib/types";

export function HistoryView() {
  const [traces, setTraces] = useState<ActionTrace[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void api
      .listTraces()
      .then((result) => setTraces(result.traces))
      .catch(() => setError(true));
  }, []);

  if (error) return <div className="inline-error prominent">History is unavailable.</div>;
  if (!traces) return <div className="skeleton history-skeleton" />;
  if (traces.length === 0) {
    return (
      <div className="empty-history panel">
        <div className="proof-glyph small" aria-hidden="true">
          <span />
        </div>
        <h2>No action traces yet</h2>
        <p>Completed analyses appear here with honest live or sandbox provenance.</p>
        <Link className="primary-link" href="/analyze">
          Run the first scenario
        </Link>
      </div>
    );
  }

  return (
    <div className="history-table panel">
      <div className="history-row header">
        <span>Verdict</span>
        <span>Intent</span>
        <span>Evidence</span>
        <span>Created</span>
      </div>
      {traces.map((trace) => (
        <Link className="history-row" href={`/trace/${trace.id}`} key={trace.id}>
          <span>
            <b className={`mini-verdict ${trace.report.verdict}`}>{trace.report.verdict}</b>
          </span>
          <span>
            <strong>{trace.action.intent}</strong>
            <small>{trace.action.target}</small>
          </span>
          <span>
            <code>{trace.actionHash.slice(0, 12)}…</code>
            <small>{trace.mode}</small>
          </span>
          <span>{new Date(trace.createdAt).toLocaleString()}</span>
        </Link>
      ))}
    </div>
  );
}
