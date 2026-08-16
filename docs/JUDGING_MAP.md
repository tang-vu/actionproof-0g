# Judging evidence map

This document lets a reviewer verify each judging criterion without relying on marketing claims.
Galileo addresses and receipts are real and collected in `docs/evidence/galileo-live.json`; the
read-only public evidence console is live at `https://actionproof.tangvu.dev`; mainnet remains
undeployed and unauthorized.

## Progress and momentum — 40%

| Evidence                                      | Where to verify                                                        | What it demonstrates                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Working monorepo and one-command verification | `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`           | Reproducible delivery rather than disconnected snippets                              |
| Timestamped decisions and milestones          | `docs/RESEARCH.md`, `docs/BUILD_LOG.md`, Git history                   | Research-to-implementation momentum and honest blockers                              |
| Complete product journey                      | `apps/web`, `apps/api`, `docs/DEMO_SCRIPT.md`                          | Proposal through analysis, storage, anchor, execution/refusal, and public trace      |
| Safe / dangerous / tamper fixtures            | API demo CLI, core policy tests, contract tests, Playwright suite      | Three dramatic scenarios are repeatable in CLI and browser                           |
| Deployment-ready records and gates            | `packages/contracts/deployments`, `docs/DEPLOYMENT.md`, `.env.example` | Galileo/mainnet work can proceed without redesign                                    |
| Real Galileo safe/block/tamper proof          | `docs/evidence/galileo-live.json`, ChainScan and StorageScan links     | Production adapters completed the full story; identifiers are independently openable |
| Public evidence deployment                    | `https://actionproof.tangvu.dev`, `ecosystem.config.cjs`               | HTTPS judge access, live probes, real traces, and an explicit anonymous-write gate   |
| Automated public proof                        | `pnpm smoke:public`, `scripts/public-smoke.ts`                         | No-spend check of HTTPS, integrations, traces, rendering, and write rejection        |

Fast review:

```bash
pnpm install
pnpm verify
pnpm demo
pnpm probe:0g
pnpm smoke:public
pnpm dev
```

Then open `http://127.0.0.1:3000`, or inspect the read-only live evidence deployment at
`https://actionproof.tangvu.dev`.

## Depth and quality of 0G integration — 30%

### 0G Chain

- [`ActionProofGuard.sol`](../packages/contracts/src/ActionProofGuard.sol) implements EIP-712,
  authorized verifier, report-root/report-hash anchor, chain/contract binding, nonce lanes, deadlines,
  two replay barriers, events, and allow-only guarded execution.
- [`ActionProofGuard.t.sol`](../packages/contracts/test/ActionProofGuard.t.sol) exercises valid,
  malicious, malformed, replay, expiry, reentrancy, downstream revert, zero/boundary, and fuzz cases.
- [`chain.ts`](../packages/0g/src/chain.ts) uses the guard through typed viem reads, simulation,
  signing, writes, receipts, and independent anchor verification.
- Deployment is dry-run first and pinned to the current official chain IDs, Cancun settings, and
  ChainScan verification flow.

### 0G Compute

- [`compute.ts`](../packages/0g/src/compute.ts) uses the official recommended OpenAI-compatible 0G
  Router endpoint with a server-only key.
- JSON-object mode is followed by strict runtime validation; invalid content/trace metadata,
  oversize, timeout, and transport error fail closed with no mock fallback.
- Model/provider/request/billing metadata is carried into the canonical report.
- Adapter tests use only injected transports. The live proof used `qwen2.5-omni` and retains two
  real request/provider IDs without exposing the Router key.

### 0G Storage

- [`storage.ts`](../packages/0g/src/storage.ts) uses the official exact-pinned TypeScript SDK,
  computes the report root locally, validates upload roots, retrieves exact bytes, and independently
  recomputes the Merkle root.
- This extra verification addresses the current documented/published high-level proof-check gap.
- The exact root plus canonical report hash are both signed and anchored.
- Live roots `0x75dcd6…208cc` and `0x4f7721…f480c` are retrievable through Storage sequences
  [146933](https://storagescan-galileo.0g.ai/submission/146933) and
  [146934](https://storagescan-galileo.0g.ai/submission/146934).

### Agentic ID

- [`agentic-id.ts`](../packages/0g/src/agentic-id.ts) performs optional read-only lookups against the
  official ERC-8004 Identity Registry and binds owner/wallet/URI evidence into canonical reports.
- Wallet mismatch and configured-resolution failure are deterministic blocks. Registration writes
  and the mock-oracle-dependent ERC-7857 path remain deliberately deferred.
- [`readiness.ts`](../packages/0g/src/readiness.ts) exposes no-key/no-spend Chain, Compute model
  catalog, and Storage node-selection probes; `pnpm probe:0g` exercises Galileo and Mainnet.

## Technical execution, architecture, completeness, security — 20%

| Requirement              | Concrete evidence                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| AI is not an oracle      | `packages/core/src/policy.ts`; deterministic blocks win; UI architecture copy                   |
| Cryptographic binding    | Core action/report hashes, EIP-712 shared types, matching Solidity type hashes                  |
| Replay/tamper resistance | Sequential anchor nonces, executed digest map, chain/contract domain, tamper route/tests        |
| Fail-closed boundaries   | Zod schemas, API job failure states, Router strict parse, Storage root mismatch errors          |
| Minimal contract         | No custody system, proxy, tokenomics, DAO, marketplace, or arbitrary privileged execution       |
| Security transparency    | `docs/THREAT_MODEL.md`, `SECURITY.md`, visible UI disclaimers, explicit limitations             |
| Operational safety       | server-only secrets, mainnet double gate, dry-run deploy, recovery playbook                     |
| Funded API abuse control | disabled public writes plus constant-time operator bearer authorization when writes are enabled |
| Quality gates            | formatting, lint, TypeScript, unit/fuzz, build, browser journey, secret scan, dependency audit  |

Architecture details and diagrams are in `docs/ARCHITECTURE.md` and the `/architecture` product page.

## Traction, documentation, demo clarity, public communication — 10%

| Evidence                                            | Location                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| International judge README and architecture diagram | `README.md`                                                         |
| Three-minute narration and operator prompts         | `docs/DEMO_SCRIPT.md`                                               |
| Ready-to-paste submission and mandatory social post | `docs/SUBMISSION.md`                                                |
| Short pitch deck source                             | `docs/PITCH.md`                                                     |
| Exact research sources and decisions                | `docs/RESEARCH.md`                                                  |
| Local/live deployment and recovery                  | `docs/DEPLOYMENT.md`                                                |
| Real integration status vs unavailable/sandbox      | Landing/analyze runtime status panel                                |
| Public independent evidence                         | `/trace/:id` with hashes, receipts, checks, report, and tamper test |
| Public HTTPS judge build                            | `https://actionproof.tangvu.dev`                                    |

No users, partners, audits, or success metrics are invented. The repository and Galileo evidence are
populated and the live-demo URL is deployed; only the demo-video URL awaits external publication.

## Current external blockers

These are not unfinished local engineering tasks:

1. a reviewed, audited mainnet release plus funded mainnet roles and explicit broadcast approval;
2. owner authorization to publish the demo video and mandatory social post.

The repository owner authorized Galileo writes and supplied funded testnet roles. Mainnet remains
locked; none of the completed Galileo work implies mainnet authorization.
