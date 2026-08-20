# ActionProof submission package

## Ready-to-paste project fields

**Project name:** ActionProof

**Tagline:** Proof before action.

**One-line description (19 words):**

> ActionProof creates verifiable pre-execution evidence and enforces risk policy for autonomous
> agent transactions on 0G.

**Repository:** `https://github.com/tang-vu/actionproof-0g`

**Live demo:** `https://actionproof.tangvu.dev`

**Demo video:** `[DEMO_VIDEO_URL]`

**0G Chain deployment:** `0xAE7bB700296d25FC4fB2EC3dBCCda8348f3b7d5e` —
`https://chainscan-galileo.0g.ai/address/0xae7bb700296d25fc4fb2ec3dbccda8348f3b7d5e`

**Demo Counter:** `0xdDEFa8AACE574f30B4f6db972Df4df11EC524961` —
`https://chainscan-galileo.0g.ai/address/0xddefa8aace574f30b4f6db972df4df11ec524961`

**Demo Token:** `0x5f54D66a5dD8DcEb1a5eDcC638B31839810589bf` —
`https://chainscan-galileo.0g.ai/address/0x5f54d66a5dd8dceb1a5edcc638b31839810589bf`

All three addresses above were independently checked for deployed bytecode and source verification.
The live demo provides a no-spend preflight for arbitrary exact action envelopes plus guided access
to preserved Galileo Allow, Block, and Break evidence. Public traffic can inspect, simulate, and run
deterministic policy, but cannot trigger Compute, Storage, signing, or chain writes. The video
placeholder remains blank until that separate publishing action is authorized.

## Short summary

Autonomous agents can submit exact onchain calls faster than a human can review them, while a
natural-language intent or a model's confidence cannot enforce what actually executes. ActionProof
is a verifiable runtime firewall for that gap.

Developers can first call the public Instant Preflight API with an arbitrary exact action. It decodes
supported calldata, simulates from the guard, checks nonce/identity/policy, and returns a typed
pass/review/block disposition without paid services or writes. An unchanged eligible envelope can
then enter an authorized full assessment.

For operated deployments, the same contract now has a typed SDK, PostgreSQL lease queue,
transactional signed webhook outbox, hashed tenant credentials and quota, modular policy packs,
proxy/state-footprint analysis, Prometheus metrics, and a remote KMS/HSM signer boundary. These are
production-readiness capabilities, not claims that the public read-only host is HA or audited.

For every proposed action it runs reproducible policy checks, simulates the downstream call, obtains
a strict structured assessment through 0G Compute, uploads the canonical evidence to 0G Storage, and
signs an EIP-712 attestation binding the exact action and report. An ActionProofGuard contract on 0G
Chain anchors every verdict but executes only a fresh, untampered allow verdict once. A public trace
lets anyone retrieve the evidence and rerun the bindings.

The model is deliberately advisory: malformed inference fails closed and deterministic blocks always
win. The MVP uses only valueless demo contracts and is experimental, unaudited infrastructure.

## 0G components used

- **0G Chain:** EVM guard deployment; action/report anchors; chain/contract-bound EIP-712;
  authorized verifier; sequential nonces; deadlines; replay/tamper checks; event audit history;
  safe-only target execution.
- **0G Compute:** recommended server-side Router with OpenAI-compatible chat completion, JSON-object
  mode, model/provider/request/billing evidence, strict runtime schema validation, and no live
  fallback.
- **0G Storage:** official TypeScript SDK and Turbo indexer; canonical report upload/retrieval;
  returned-root check; independent byte comparison and Merkle-root recomputation.
- **Agentic ID:** registered Galileo ERC-8004 agent `278`; official Identity Registry reads bind its
  owner, agent wallet, and public URI into every live report. Wallet mismatch or resolution failure
  blocks. Registration is separately gated; ERC-7857 remains outside the critical path.

## Architecture summary

ActionProof has five boundaries: a pure TypeScript policy/hash package; a Fastify job orchestrator;
typed 0G adapters; a Next.js public security console; and a minimal non-upgradeable Solidity guard.
The action hash commits the proposed execution. A separate canonical report hash and Storage Merkle
root commit the evidence. EIP-712 joins them with signer, chain, contract, nonce, and validity window.
Anchoring consumes the nonce; execution has its own one-time state transition.

## Reproducibility

```bash
git clone https://github.com/tang-vu/actionproof-0g.git
cd actionproof-0g
corepack enable
pnpm install
pnpm --filter @actionproof/web exec playwright install chromium
pnpm verify
pnpm demo
pnpm smoke:public
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:3000`. The default is a clearly labeled sandbox. Follow
`docs/DEPLOYMENT.md` for real Galileo configuration; no live service is silently mocked.

## Three-minute narration

> Autonomous agents need an enforceable boundary between intent and transaction. ActionProof creates
> proof before action.
>
> First, this harmless counter call is an exact envelope: agent, requester, target, calldata, zero
> value, intent, chain, nonce, and deadline. ActionProof runs deterministic policy, simulates the call,
> gets a schema-validated 0G Compute assessment, uploads the canonical report to 0G Storage, and signs
> an EIP-712 attestation. The 0G Chain guard anchors it, then executes it once. This public trace shows
> the action hash, report hash, Storage root, signature, receipts, reasons, and independent checks.
>
> Second, the declared intent still sounds normal, but calldata requests an unlimited ERC-20
> approval. The deterministic engine decodes `uint256.max` and forces block. The model cannot clear
> it. We retain the blocked proof for audit, while execution is refused.
>
> Finally, we mutate one calldata byte after attestation. Verification rejects it because the action
> hash and EIP-712 digest change. The same guard rejects wrong roots, targets, values, chains,
> deadlines, nonces, signatures, replays, and duplicate execution.
>
> ActionProof is experimental and unaudited, so the demo is valueless. Its key contribution is not
> claiming AI guarantees safety; it makes facts, model judgment, immutable evidence, and onchain
> enforcement separate and independently visible.

## Mandatory X post

> Introducing ActionProof — proof before action. 🛡️
>
> A verifiable runtime firewall for autonomous agent transactions: deterministic policy + simulation,
> structured risk analysis on 0G Compute, immutable reports on 0G Storage, and EIP-712 guarded
> execution on 0G Chain.
>
> Demo: allow a safe action, block an unlimited approval, then prove one changed byte breaks the
> attestation.
>
> Built for 0G Bridge by AKINDO — Wave 3. Experimental, open source, and using valueless demo assets.
>
> https://github.com/tang-vu/actionproof-0g [DEMO_URL]
>
> @0G_labs @0G_Builders @AKINDO_io #0GBridge #BuildOn0G

Publishing this post is an external action and requires owner approval.

## Honest known limitations

- Not audited and not a safety guarantee; valuable-asset use is unsupported.
- Policy heuristics and `eth_call` are not full semantic analysis or future-state proof.
- A compromised verifier/owner/application host remains a trust-root failure.
- Simulation and execution can observe different state; immutable demo targets reduce but do not
  eliminate that class of risk.
- JSON persistence and a single process are demo architecture, not horizontal production HA.
- Reports are public; private evidence/encryption is not implemented.
- The public host disables anonymous paid writes; it exposes live integration readiness and the real
  safe/block traces. A supervised operator must enable the write gate and supply a separate
  server-validated bearer token for paid Galileo API writes.
- Galileo Compute, Storage, deployment, safe execution, block anchor, and tamper evidence are live
  and recorded in `docs/evidence/galileo-live.json`. Mainnet remains undeployed and unauthorized.
- ERC-8004 agent `278` is registered on Galileo with public receipt/URI evidence. Its identity and
  wallet binding do not imply trust, audit, or safety. ERC-7857 is deferred for the
  production-readiness reasons recorded in research.

## Final submission checklist

- [x] Public repository URL is populated.
- [x] `pnpm verify` passes locally on the exact submission working tree.
- [x] README screenshots were regenerated from this tree and visibly label sandbox mode.
- [x] Galileo live Compute request receipt is captured without secrets.
- [x] Unique Storage report upload/download/root evidence is captured.
- [x] Contracts are deployed, source-verified, and deployment JSON is committed.
- [x] Safe action ChainScan link and final counter state are checked.
- [x] Dangerous action is anchored and execution refusal is demonstrated.
- [x] Tamper and replay failures are recorded.
- [x] Live demo URL works in a fresh browser over HTTPS.
- [x] Public no-spend preflight accepts arbitrary exact actions and is covered by live smoke tests.
- [x] A captioned demo video can be reproduced locally with `pnpm demo:record`.
- [ ] Demo video URL is owner-approved and published.
- [x] Repository secret scan finds no private key or API key; no fabricated metrics/claims exist.
- [x] Security disclaimer and known limitations remain visible.
- [x] Project fields meet the documented platform length requirements.
- [x] X post contains `#0GBridge #BuildOn0G` and tags all three required accounts.
- [ ] Owner explicitly approves video publication, submission, and social post.
