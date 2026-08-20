"use client";

import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { IntegrationStatus as Status } from "../lib/types";

const labels = { available: "Connected", unavailable: "Unavailable", sandbox: "Sandbox" };

export function IntegrationStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api
      .getIntegrations()
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);

  return (
    <aside className="integration-card" aria-labelledby="integration-heading">
      <div className="section-heading compact">
        <span className="eyebrow">Runtime</span>
        <h2 id="integration-heading">Integration status</h2>
      </div>
      {failed ? (
        <div className="inline-error">
          <span /> API unreachable. Start <code>pnpm dev</code>.
        </div>
      ) : !status ? (
        <div className="skeleton-stack" aria-label="Loading integration status">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <div className="network-line">
            <span>Network</span>
            <strong>
              {status.network.name} · {status.network.chainId}
            </strong>
          </div>
          <div className="network-line">
            <span>Paid/write path</span>
            <strong>{status.writesEnabled ? "Explicitly enabled" : "Disabled"}</strong>
          </div>
          <div className="network-line">
            <span>Instant preflight</span>
            <strong>
              {status.capabilities.instantPreflight ? "Available · no spend" : "Unavailable"}
            </strong>
          </div>
          <ul className="service-list">
            {status.services.map((service) => (
              <li key={service.id}>
                <span className={`service-icon ${service.status}`} aria-hidden="true" />
                <div>
                  <div className="service-title">
                    <strong>{service.name}</strong>
                    <span>
                      {labels[service.status]}
                      {service.latencyMs === undefined ? "" : ` · ${service.latencyMs}ms`}
                    </span>
                  </div>
                  <p>{service.detail}</p>
                  {service.explorerUrl && (
                    <a href={service.explorerUrl} target="_blank" rel="noreferrer">
                      Open official explorer ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {status.mode === "sandbox" && (
            <p className="sandbox-note">
              Local sandbox evidence is isolated and never represented as 0G activity.
            </p>
          )}
          {status.mode === "live" && !status.writesEnabled && (
            <p className="sandbox-note">
              Public read-only mode: live Galileo evidence remains verifiable while anonymous paid
              writes are blocked.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
