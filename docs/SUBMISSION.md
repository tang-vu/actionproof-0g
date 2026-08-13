# ActionProof submission package

## Ready-to-paste project fields

**Project name:** ActionProof

**Tagline:** Proof before action.

**One-line description (19 words):**

> ActionProof creates verifiable pre-execution evidence and enforces risk policy for autonomous
> agent transactions on 0G.

**Repository:** `[REPOSITORY_URL]`

**Live demo:** `[LIVE_DEMO_URL]`

**Demo video:** `[DEMO_VIDEO_URL]`

**0G Chain deployment:** `[ACTIONPROOF_GUARD_ADDRESS]` — `[CHAINSCAN_URL]`

**Demo Counter:** `[DEMO_COUNTER_ADDRESS]` — `[CHAINSCAN_URL]`

**Demo Token:** `[DEMO_TOKEN_ADDRESS]` — `[CHAINSCAN_URL]`

Do not replace placeholders until links and bytecode are independently checked.

## Short summary

Autonomous agents can submit exact onchain calls faster than a human can review them, while a
natural-language intent or a model's confidence cannot enforce what actually executes. ActionProof
is a verifiable runtime firewall for that gap.

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
- **Agentic ID:** researched and deliberately deferred. Current ERC-7857 production oracle/TEE path
  is not packaged clearly enough to put on this firewall's critical path. ERC-8004 is documented as
  a future optional identity enhancement.

## Architecture summary

ActionProof has five boundaries: a pure TypeScript policy/hash package; a Fastify job orchestrator;
typed 0G adapters; a Next.js public security console; and a minimal non-upgradeable Solidity guard.
The action hash commits the proposed execution. A separate canonical report hash and Storage Merkle
root commit the evidence. EIP-712 joins them with signer, chain, contract, nonce, and validity window.
Anchoring consumes the nonce; execution has its own one-time state transition.

## Reproducibility

```bash
git clone [REPOSITORY_URL]
cd actionproof-0g
corepack enable
pnpm install
pnpm --filter @actionproof/web exec playwright install chromium
pnpm verify
pnpm demo
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
> [REPOSITORY_URL] [DEMO_URL]
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
- Paid Compute, Storage, testnet deployment, and mainnet proof require user-provided funded accounts,
  credentials, and explicit broadcast authorization.
- ERC-7857 Agentic ID is deferred for the production-readiness reasons recorded in research.

## Final submission checklist

- [ ] Public repository URL replaces placeholder.
- [ ] `pnpm verify` passes on public commit and CI is green.
- [ ] README screenshot is from the same commit and mode is visible.
- [ ] Galileo live Compute request receipt is captured without secrets.
- [ ] Unique Storage report upload/download/root evidence is captured.
- [ ] Contracts are deployed, source-verified, and deployment JSON is committed.
- [ ] Safe action ChainScan link and final counter state are checked.
- [ ] Dangerous action is anchored and execution refusal is demonstrated.
- [ ] Tamper and replay failures are recorded.
- [ ] Live demo and demo video URLs work in a fresh browser.
- [ ] No private key, API key, fabricated metric, or fake partner/audit claim exists.
- [ ] Security disclaimer and known limitations remain visible.
- [ ] Project fields meet platform length requirements.
- [ ] X post contains `#0GBridge #BuildOn0G` and tags all three required accounts.
- [ ] Owner explicitly approves repository push, deployment, submission, and social post.
