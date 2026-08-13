# Judging evidence map

This document lets a reviewer verify each judging criterion without relying on marketing claims.
Live addresses/receipts remain blank until a funded, explicitly authorized deployment occurs.

## Progress and momentum — 40%

| Evidence                                      | Where to verify                                                        | What it demonstrates                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Working monorepo and one-command verification | `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`           | Reproducible delivery rather than disconnected snippets                         |
| Timestamped decisions and milestones          | `docs/RESEARCH.md`, `docs/BUILD_LOG.md`, Git history                   | Research-to-implementation momentum and honest blockers                         |
| Complete product journey                      | `apps/web`, `apps/api`, `docs/DEMO_SCRIPT.md`                          | Proposal through analysis, storage, anchor, execution/refusal, and public trace |
| Safe / dangerous / tamper fixtures            | API demo CLI, core policy tests, contract tests, Playwright suite      | Three dramatic scenarios are repeatable in CLI and browser                      |
| Deployment-ready records and gates            | `packages/contracts/deployments`, `docs/DEPLOYMENT.md`, `.env.example` | Galileo/mainnet work can proceed without redesign                               |

Fast review:

```bash
pnpm install
pnpm verify
pnpm demo
pnpm dev
```

Then open `http://127.0.0.1:3000`.

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
- Adapter tests use only injected transports. A paid live smoke requires a funded Router key.

### 0G Storage

- [`storage.ts`](../packages/0g/src/storage.ts) uses the official exact-pinned TypeScript SDK,
  computes the report root locally, validates upload roots, retrieves exact bytes, and independently
  recomputes the Merkle root.
- This extra verification addresses the current documented/published high-level proof-check gap.
- The exact root plus canonical report hash are both signed and anchored.

### Agentic ID

- `docs/RESEARCH.md` records a deliberate defer decision rather than claiming a mock ERC-7857 oracle
  as production identity. The current ERC-8004 registry addresses and safe future integration path
  are documented.

## Technical execution, architecture, completeness, security — 20%

| Requirement              | Concrete evidence                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| AI is not an oracle      | `packages/core/src/policy.ts`; deterministic blocks win; UI architecture copy                  |
| Cryptographic binding    | Core action/report hashes, EIP-712 shared types, matching Solidity type hashes                 |
| Replay/tamper resistance | Sequential anchor nonces, executed digest map, chain/contract domain, tamper route/tests       |
| Fail-closed boundaries   | Zod schemas, API job failure states, Router strict parse, Storage root mismatch errors         |
| Minimal contract         | No custody system, proxy, tokenomics, DAO, marketplace, or arbitrary privileged execution      |
| Security transparency    | `docs/THREAT_MODEL.md`, `SECURITY.md`, visible UI disclaimers, explicit limitations            |
| Operational safety       | server-only secrets, mainnet double gate, dry-run deploy, recovery playbook                    |
| Quality gates            | formatting, lint, TypeScript, unit/fuzz, build, browser journey, secret scan, dependency audit |

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

No users, partners, audits, deployments, transaction IDs, or success metrics are invented. Repository
and live demo URLs remain explicit placeholders until the owner publishes them.

## Current external blockers

These are not unfinished local engineering tasks:

1. a funded Galileo deployer/storage/relayer account;
2. a funded 0G Compute Router testnet balance and inference-only key;
3. explicit authorization to broadcast Galileo or mainnet transactions;
4. hosting accounts/domain if a public instance is desired;
5. owner authorization to push/publish/social-post.

Until they are supplied, judges should evaluate the deterministic sandbox, tests, live adapter code,
dry-run/read-only probes, and deployment readiness—not nonexistent Explorer links.
