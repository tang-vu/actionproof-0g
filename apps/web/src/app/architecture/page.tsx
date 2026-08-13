import type { Metadata } from "next";

export const metadata: Metadata = { title: "Architecture" };

const trust: Array<readonly [string, string, string]> = [
  [
    "Deterministic engine",
    "Enforced",
    "Reproducible rules can force block. Selector scans are labeled heuristics.",
  ],
  ["RPC simulation", "Enforced", "A revert, chain mismatch, or absent target code fails closed."],
  [
    "0G Compute",
    "Advisory",
    "Structured output is schema validated. Malformed output stops the pipeline.",
  ],
  [
    "0G Storage",
    "Integrity",
    "Canonical bytes are retrieved and their content and Merkle commitments recomputed.",
  ],
  [
    "0G Chain guard",
    "Enforced",
    "Signer, domain, exact fields, deadline, nonce, verdict, and replay are checked onchain.",
  ],
];

export default function ArchitecturePage() {
  return (
    <div className="workspace-page content-width architecture-page">
      <div className="architecture-hero">
        <span className="eyebrow">Security architecture</span>
        <h1>Assume every layer can fail differently.</h1>
        <p>
          ActionProof separates facts, model judgment, storage integrity, and contract enforcement
          so a single optimistic model response cannot authorize a dangerous action.
        </p>
      </div>

      <section className="flow-diagram panel" aria-label="ActionProof architecture flow">
        <div className="flow-agent">
          <span>01</span>
          <strong>Agent action</strong>
          <small>exact envelope</small>
        </div>
        <i>→</i>
        <div className="flow-stack">
          <div>
            <span>02A</span>
            <strong>Policy + simulation</strong>
            <small>deterministic facts</small>
          </div>
          <div>
            <span>02B</span>
            <strong>0G Compute</strong>
            <small>advisory assessment</small>
          </div>
        </div>
        <i>→</i>
        <div className="flow-stack">
          <div>
            <span>03A</span>
            <strong>0G Storage</strong>
            <small>canonical report root</small>
          </div>
          <div>
            <span>03B</span>
            <strong>EIP-712 signer</strong>
            <small>exact evidence binding</small>
          </div>
        </div>
        <i>→</i>
        <div className="flow-guard">
          <span>04</span>
          <strong>0G Chain guard</strong>
          <small>anchor · allow / refuse</small>
        </div>
      </section>

      <section className="trust-table panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Trust boundaries</span>
            <h2>What each layer actually proves</h2>
          </div>
        </div>
        {trust.map(([layer, role, meaning]) => (
          <div className="trust-row" key={layer}>
            <strong>{layer}</strong>
            <span className={`role-chip ${role.toLowerCase()}`}>{role}</span>
            <p>{meaning}</p>
          </div>
        ))}
      </section>

      <section className="limitations-grid">
        <article>
          <span className="eyebrow">Deliberate constraint</span>
          <h2>No custody</h2>
          <p>The MVP guard holds no protocol funds, has no tokenomics, and is not upgradeable.</p>
        </article>
        <article>
          <span className="eyebrow">Honest limitation</span>
          <h2>Not a full analyzer</h2>
          <p>
            Selector and bytecode checks are useful heuristics, not complete semantic contract
            analysis.
          </p>
        </article>
        <article>
          <span className="eyebrow">Deployment posture</span>
          <h2>Experimental</h2>
          <p>No audit has occurred. Use only with the included valueless demo assets.</p>
        </article>
      </section>
    </div>
  );
}
