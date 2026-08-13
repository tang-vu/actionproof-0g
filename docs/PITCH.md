# ActionProof — pitch deck source

## 1. Proof before action

**ActionProof** is a verifiable runtime firewall for autonomous agent transactions on 0G.

Agents move at machine speed. Their security boundary should too.

## 2. Intent is not execution

An agent says: “approve the demo operator.”

The calldata says: `approve(spender, uint256.max)`.

A dashboard can explain that mismatch. Only an exact, replay-resistant execution gate can enforce it.

## 3. AI must not grade its own homework

ActionProof separates four claims:

1. **Facts:** deterministic policy and RPC simulation.
2. **Judgment:** schema-validated 0G Compute risk assessment.
3. **Integrity:** canonical report on 0G Storage.
4. **Enforcement:** EIP-712 anchor and guarded execution on 0G Chain.

A model can make the result stricter. It cannot clear a hard block.

## 4. The evidence seal

One attestation binds:

- exact target, value, and calldata hash;
- agent, requester, and human intent hash;
- canonical report hash and 0G Storage root;
- verdict, destination chain, guard contract;
- authorized verifier, sequential nonce, issuance, expiration.

Change one byte and the seal fails.

## 5. Three-minute proof

**Allow:** a valueless counter action is simulated, assessed, stored, anchored, and executed once.

**Block:** an unlimited token approval triggers a deterministic critical rule and never executes.

**Break:** mutate calldata/root/target/nonce; verification and onchain use fail.

Every claim is visible on a public trace with receipts and independent checks.

## 6. Why 0G

- **0G Compute** supplies decentralized, traceable model inference behind a strict application
  schema.
- **0G Storage** makes the complete evidence retrievable by content commitment.
- **0G Chain** turns the report into an enforceable precondition and durable event history.

This is one coherent security lifecycle, not three disconnected integration badges.

## 7. What exists now

- strict TypeScript monorepo and asynchronous orchestration;
- production 0G adapters with no live-to-mock fallback;
- minimal Foundry guard and extensive unit/fuzz security cases;
- safe/block/tamper CLI and critical browser journey;
- polished public verification console;
- deployment, threat model, research, CI, and submission package.

External funded credentials and explicit broadcast approval are the remaining live-deployment gates.

## 8. Defensible roadmap

1. Galileo deployment and retained live receipts.
2. Independent contract/application audit and KMS-backed threshold verifier.
3. Richer state-diff tracing and protocol-specific policies.
4. Durable queue/database and event indexer.
5. Extend the implemented read-only ERC-8004 identity binding with separately approved registration
   and reputation evidence; keep ERC-7857 out until its production oracle path is proven.

No token. No custody. No claim that AI guarantees safety.

## 9. Close

Autonomous finance needs an answer to a simple question:

> Can anyone prove this exact action was the one assessed—and the only one allowed to execute?

ActionProof makes that answer verifiable.
