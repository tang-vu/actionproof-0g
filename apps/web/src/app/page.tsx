import Link from "next/link";

import { IntegrationStatus } from "../components/integration-status";

const layers: Array<readonly [string, string, string]> = [
  [
    "01",
    "Deterministic policy",
    "Hard rules catch approvals, admin calls, limits, expiry, and replay.",
  ],
  [
    "02",
    "Preflight simulation",
    "RPC evidence records code, call success, gas, and observed effects.",
  ],
  [
    "03",
    "0G Compute",
    "A structured model assessment adds context but can never override a hard block.",
  ],
  ["04", "0G Storage", "The exact canonical report becomes a retrievable Merkle commitment."],
  ["05", "0G Chain", "EIP-712 binds action, report, chain, nonce, deadline, signer, and guard."],
];

export default function HomePage() {
  return (
    <div>
      <section className="landing-hero content-width">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="pulse-dot" /> Runtime security for autonomous agents
          </div>
          <h1>
            Proof before <span>action.</span>
          </h1>
          <p className="hero-lede">
            ActionProof analyzes, simulates, attests, and audits an agent transaction before the
            guarded executor can touch the chain.
          </p>
          <div className="hero-actions">
            <Link className="primary-link large" href="/analyze">
              Open demo console <span>→</span>
            </Link>
            <Link className="text-link" href="/architecture">
              Inspect the security model
            </Link>
          </div>
          <div className="honesty-line">
            <span>Experimental</span>
            <span>·</span>
            <span>Non-custodial demo</span>
            <span>·</span>
            <span>No safety guarantees</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="ActionProof evidence flow visualization">
          <div className="scan-line" />
          <div className="action-packet">
            <span className="packet-label">PROPOSED_ACTION</span>
            <strong>increment()</strong>
            <code>0xd09de08a</code>
            <div className="packet-meta">
              <span>chain</span>
              <b>16602</b>
              <span>value</span>
              <b>0 0G</b>
            </div>
          </div>
          <div className="proof-node policy">
            <span>POLICY</span>
            <b>PASS</b>
          </div>
          <div className="proof-node simulation">
            <span>SIMULATION</span>
            <b>45,312 gas</b>
          </div>
          <div className="proof-node compute">
            <span>0G COMPUTE</span>
            <b>LOW RISK</b>
          </div>
          <div className="proof-seal">
            <span>✓</span>
            <div>
              <small>ATTESTED</small>
              <strong>ALLOW</strong>
            </div>
          </div>
          <div className="grid-noise" />
        </div>
      </section>

      <section className="truth-strip">
        <div className="content-width">
          <div>
            <span>Exact-action binding</span>
            <strong>EIP-712</strong>
          </div>
          <div>
            <span>Immutable evidence</span>
            <strong>0G Storage</strong>
          </div>
          <div>
            <span>Audit anchor</span>
            <strong>0G Chain</strong>
          </div>
          <div>
            <span>Advisory intelligence</span>
            <strong>0G Compute</strong>
          </div>
        </div>
      </section>

      <section className="proof-section content-width">
        <div className="section-heading">
          <span className="eyebrow">Layered by design</span>
          <h2>The model is one witness. Never the judge.</h2>
          <p>
            Deterministic facts establish hard boundaries. Inference adds context. Cryptography
            makes the exact decision independently checkable.
          </p>
        </div>
        <div className="layer-grid">
          {layers.map(([number, title, detail]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="demo-story content-width">
        <div className="section-heading">
          <span className="eyebrow">Three-minute proof</span>
          <h2>Allow. Block. Break.</h2>
        </div>
        <div className="story-grid">
          <article className="allow-story">
            <span>01 / ALLOW</span>
            <h3>A harmless counter action</h3>
            <p>
              Simulated, assessed, stored, anchored, and executed against a valueless demo contract.
            </p>
          </article>
          <article className="block-story">
            <span>02 / BLOCK</span>
            <h3>An unlimited token approval</h3>
            <p>
              A deterministic critical finding overrides optimism and the executor refuses the call.
            </p>
          </article>
          <article className="tamper-story">
            <span>03 / BREAK</span>
            <h3>One mutated byte</h3>
            <p>
              Change calldata, root, target, or nonce and the signature no longer seals the
              evidence.
            </p>
          </article>
        </div>
      </section>

      <section className="status-section content-width">
        <div className="status-copy">
          <span className="eyebrow">No invented integrations</span>
          <h2>Runtime truth is visible.</h2>
          <p>
            Unavailable services fail closed. Sandbox evidence is unmistakably labeled and never
            shown as a real 0G transaction.
          </p>
          <Link className="text-link" href="/analyze">
            Start a trace →
          </Link>
        </div>
        <IntegrationStatus />
      </section>
    </div>
  );
}
