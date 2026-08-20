import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Developer integration" };

const integrationSteps = [
  [
    "01",
    "Build the exact envelope",
    "Bind agent, requester, target, value, calldata, intent, chain, nonce, and a short deadline.",
  ],
  [
    "02",
    "Preview without spending",
    "POST /v1/preflight decodes the selector, simulates the call, and evaluates deterministic policy.",
  ],
  [
    "03",
    "Request full evidence",
    "An authorized deployment can add 0G Compute, Storage, EIP-712 anchoring, and guarded execution.",
  ],
  [
    "04",
    "Verify independently",
    "Fetch the public trace and rerun every action, report, Storage, signature, and chain binding.",
  ],
] as const;

const previewExample = `// Call server-side. Browser origins must be explicitly allowlisted.
const result = await fetch("https://actionproof.tangvu.dev/v1/preflight", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: {
      version: "1",
      agent,
      requester,
      target,
      value: "0",
      calldata,
      intent: "Swap no more than the declared amount",
      destinationChainId: 16602,
      nonce,
      issuedAt,
      expiresAt: issuedAt + 600
    }
  })
});

const preview = await result.json();
if (preview.disposition !== "pass") {
  throw new Error(preview.reasons.join("; "));
}`;

const responseExample = `{
  "previewOnly": true,
  "mode": "live",
  "disposition": "block",
  "riskFloor": 100,
  "inspection": {
    "signature": "approve(address,uint256)",
    "category": "token-approval"
  },
  "blockingRuleIds": ["UNLIMITED_ERC20_APPROVAL"],
  "eligibleForFullAssessment": false,
  "notice": "Read-only preview: no inference, signature, write, or execution occurred."
}`;

export default function DevelopersPage() {
  return (
    <div className="workspace-page content-width developers-page">
      <section className="developer-hero">
        <div>
          <span className="eyebrow">Integration surface</span>
          <h1>Put a policy boundary in front of every agent transaction.</h1>
          <p>
            Start with a no-spend preview. Promote only an exact, current envelope into the full 0G
            evidence pipeline. Every response states what ran—and what did not.
          </p>
          <div className="hero-actions">
            <Link className="primary-link large" href="/analyze">
              Open transaction lab <span>→</span>
            </Link>
            <a
              className="text-link"
              href="https://github.com/tang-vu/actionproof-0g/blob/main/docs/INTEGRATION.md"
              target="_blank"
              rel="noreferrer"
            >
              Read integration guide ↗
            </a>
          </div>
        </div>
        <div className="api-contract panel">
          <span className="eyebrow">Public capability</span>
          <strong>POST /v1/preflight</strong>
          <p>Selector inspection · chain simulation · deterministic policy</p>
          <dl>
            <div>
              <dt>Authentication</dt>
              <dd>None · rate limited</dd>
            </div>
            <div>
              <dt>Chain writes</dt>
              <dd>Never</dd>
            </div>
            <div>
              <dt>Paid services</dt>
              <dd>Never</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>Pass / review / block</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="integration-steps">
        {integrationSteps.map(([number, title, detail]) => (
          <article key={number}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{detail}</p>
          </article>
        ))}
      </section>

      <section className="developer-code-grid">
        <article className="panel code-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">TypeScript</span>
              <h2>Preview an exact action</h2>
            </div>
            <span className="agent-chip">No API key</span>
          </div>
          <pre>{previewExample}</pre>
        </article>
        <article className="panel code-panel response-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Response contract</span>
              <h2>Machine-readable boundary</h2>
            </div>
          </div>
          <pre>{responseExample}</pre>
          <div className="callout neutral">
            <span className="callout-icon">i</span>A preview is not an attestation. Only the full
            pipeline creates 0G Compute, Storage, and Chain evidence.
          </div>
        </article>
      </section>

      <section className="integration-principles panel">
        <div>
          <span className="eyebrow">Fail closed</span>
          <h2>Integration rules that survive production pressure</h2>
        </div>
        <ul>
          <li>Never rewrite a submitted nonce, target, calldata, value, or deadline.</li>
          <li>Treat unknown selectors as review—not proof of safety.</li>
          <li>Do not confuse a successful simulation with future-state correctness.</li>
          <li>Require the full attestation before guarded execution.</li>
          <li>Retain block decisions as auditable evidence without making them executable.</li>
        </ul>
      </section>
    </div>
  );
}
