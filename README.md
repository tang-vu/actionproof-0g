# ActionProof

**Proof before action.**

ActionProof is a verifiable runtime firewall that analyzes, simulates, attests, and audits
autonomous AI-agent transactions before execution on 0G.

[![CI](https://github.com/tang-vu/actionproof-0g/actions/workflows/ci.yml/badge.svg)](https://github.com/tang-vu/actionproof-0g/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-62e7e1.svg)](LICENSE)
[![0G](https://img.shields.io/badge/Built%20on-0G-7cf5a5.svg)](https://0g.ai/)

> [!WARNING]
> ActionProof is experimental security infrastructure, has not been audited, and does not guarantee
> transaction safety. Use only the included valueless demo contracts—not valuable assets.

## Why this exists

An autonomous agent's sentence—“approve the operator”—is not its transaction. The calldata may grant
an unlimited allowance, change an owner, upgrade a proxy, or target the wrong chain. A second model
saying “looks safe” is useful context, but it cannot be the enforcement boundary.

ActionProof turns a proposed action into independently checkable evidence:

1. deterministic rules extract reproducible facts and hard blocks;
2. `eth_call` preflight records whether the exact downstream call succeeds;
3. a real 0G Compute path returns a strictly validated, advisory risk assessment;
4. the complete canonical report is committed to 0G Storage;
5. EIP-712 binds the exact action, report hash, Storage root, chain, guard, nonce, and deadline;
6. a minimal contract anchors every verdict and executes an allow action once—or refuses it;
7. a public trace retrieves and re-verifies the complete chain of evidence.

The model can make a decision stricter. It can never clear a deterministic block.

![ActionProof analysis console](docs/images/actionproof-console.png)

_Screenshot is rendered from the checked-in application in explicit sandbox mode. Live mode uses the
same UI but only shows 0G receipts returned by real adapters._

## Architecture

```mermaid
flowchart LR
  A[Agent / user\nActionRequest] --> API[ActionProof API]
  API --> P[Deterministic\npolicy]
  API --> S[0G RPC\nsimulation]
  P --> C[0G Compute\nstructured assessment]
  S --> C
  P --> F[Final policy\nhard blocks win]
  S --> F
  C --> F
  F --> R[Canonical\nRiskReport]
  R --> ST[0G Storage\nMerkle root]
  R --> E[EIP-712\nattestation]
  ST --> E
  E --> G[ActionProofGuard\n0G Chain]
  G -->|ALLOW| X[One guarded\nexecution]
  G -->|BLOCK / REVIEW| B[Audit anchor\nno execution]
  ST --> V[Public verifier]
  G --> V
```

The monorepo keeps those boundaries explicit:

```text
apps/web              Next.js judge console and public verification traces
apps/api              Fastify job pipeline, persistence, demos, live smoke boundary
packages/core         schemas, canonicalization, hashing, EIP-712, deterministic policy
packages/0g           typed Chain / Compute / Storage adapters + explicit sandbox adapters
packages/contracts    Foundry guard, valueless fixtures, fuzz/security tests, deploy scripts
docs                   research, threat model, deployment, demo, pitch, submission evidence
```

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) for exact hashes, state transitions, trust boundaries,
and policy semantics.

## Real 0G integration

### 0G Chain

`ActionProofGuard` is a small, non-upgradeable EVM contract. It implements:

- shared Solidity/TypeScript action-request hashing;
- EIP-712 signing bound to chain ID and deployed guard address;
- authorized verifier rotation with verifier-at-anchor preservation;
- exact target, value, calldata, intent, report root/hash, agent, requester, nonce, and time binding;
- sequential `(agent, requester)` nonce lanes and distinct anchor/execution replay barriers;
- report-only anchors for allow, block, and review verdicts;
- allow-only guarded execution, checks-effects-interactions, reentrancy protection, and exact revert
  propagation;
- event-based public audit history.

| Network | Chain ID | Guard        | Demo Counter | Demo Token   | Status                                  |
| ------- | -------: | ------------ | ------------ | ------------ | --------------------------------------- |
| Galileo |  `16602` | Not deployed | Not deployed | Not deployed | Awaiting funded account + authorization |
| Mainnet |  `16661` | Not deployed | Not deployed | Not deployed | Broadcast disabled                      |

Verified addresses and ChainScan links will appear only after a real reviewed broadcast. The complete
workflow is ready in [DEPLOYMENT.md](docs/DEPLOYMENT.md); this repository never fabricates them.

### 0G Compute

The production adapter uses the officially recommended server-side **0G Compute Router** through its
OpenAI-compatible endpoint. It requires JSON-object mode, response byte/time limits, `x_0g_trace`
request/provider/billing metadata, and a strict Zod schema. Malformed output, missing trace data,
timeout, unsupported capability, or transport failure stops the pipeline. Live mode never falls back
to a fake model.

The current Direct SDK alternative (`@0gfoundation/0g-compute-ts-sdk@0.9.0`) and upstream drift are
recorded in [RESEARCH.md](docs/RESEARCH.md).

### 0G Storage

The production adapter pins `@0gfoundation/0g-storage-ts-sdk@1.2.11` and `ethers@6.13.1`. It uploads
the exact canonical report bytes through a Turbo indexer, checks the returned root, downloads the
object, compares bytes, parses/recanonicalizes it, and independently recomputes the SDK Merkle root.
That final check is mandatory because the current high-level downloader proof option is not by
itself sufficient evidence of proof validation.

### Agentic ID

ERC-7857 was investigated and deliberately kept out of the security-critical MVP. The current
official walkthrough relies on a mock/replaceable oracle and lacks a clearly packaged production
deployment. Claiming it would weaken the demo. ERC-8004 identity binding is a documented future
option after the three core integrations are live.

## Quick start

Prerequisites: Node.js 22+, pnpm 11.20.0, and Foundry 1.7.1.

```bash
git clone https://github.com/tang-vu/actionproof-0g.git
cd actionproof-0g
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:3000`. The safe default is the unmistakably labeled sandbox; it makes no paid
calls and no onchain claims.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
pnpm dev
```

The web app runs on port `3000`; the API runs on `8787`.

## Reproducible demo

Run all three terminal scenarios:

```bash
pnpm demo
```

- **Safe:** a valueless counter increment is analyzed, anchored, and executed.
- **Dangerous:** `approve(spender, uint256.max)` raises `UNLIMITED_ERC20_APPROVAL`, anchors a block,
  and never executes.
- **Tamper:** altered calldata/report binding fails verification; replay/duplicate execution are also
  contract-tested.

For the browser story, run `pnpm dev`, open **Analyze**, and follow
[the three-minute demo script](docs/DEMO_SCRIPT.md).

## Verification

```bash
pnpm verify
```

This single command runs formatting, ESLint, strict TypeScript, unit/integration tests, 512-run
Foundry fuzz tests, production builds, a repository-file secret scan, a high-severity production
dependency audit, and the critical Playwright journey on desktop and mobile. CI runs the same
deterministic checks and never spends funds.

Individual commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm build
pnpm test:e2e
pnpm audit:prod
pnpm test:live       # opt-in configuration/readiness checks; no implicit spending
```

## Live Galileo setup

Live mode needs:

1. a funded Galileo deployer/storage/relayer account;
2. a dedicated verifier key;
3. a funded testnet Compute Router balance and inference-only `sk-` key;
4. a currently listed JSON-capable model;
5. deployed and verified guard/demo addresses;
6. `ENABLE_LIVE_WRITES=true` after dry-run review.

Put keys only in a local `.env` or secret manager. Never prefix secrets with `NEXT_PUBLIC_`, commit
them, or paste them into chat. Mainnet also needs `ALLOW_MAINNET_BROADCAST=true` and explicit human
authorization. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for exact dry-run, verification, readiness,
rollback, and recovery steps.

## Security posture

The main invariants and attacks are documented in [THREAT_MODEL.md](docs/THREAT_MODEL.md). Important
limits:

- selector and bytecode scans are useful heuristics, not complete semantic analysis;
- simulation is a state snapshot and can differ from later execution;
- model correctness, confidence, or TEE provenance is not a safety proof;
- verifier, owner, host, RPC, and upstream chain compromise remain material trust-root failures;
- JSON persistence and single-process jobs are MVP infrastructure, not production HA;
- reports are public and no confidential-evidence mode is included;
- no audit or formal verification has occurred.

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Documentation

- [0G research and decisions](docs/RESEARCH.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Three-minute demo](docs/DEMO_SCRIPT.md)
- [Deployment and mainnet checklist](docs/DEPLOYMENT.md)
- [Build log](docs/BUILD_LOG.md)
- [Judging evidence map](docs/JUDGING_MAP.md)
- [Submission package](docs/SUBMISSION.md)
- [Pitch deck source](docs/PITCH.md)

## Roadmap

1. Deploy/verify on Galileo and retain real Compute, Storage, anchor, execution, and tamper evidence.
2. Independent contract/application audit and KMS-backed threshold verification.
3. Richer trace/state-diff simulation and protocol-aware policy modules.
4. Durable queue/database, guard event indexer, monitoring, and redundant RPCs.
5. Optional ERC-8004 agent identity; ERC-7857 only after its production oracle path is proven.

No token, NFT sale, DAO, marketplace, custody feature, or unrelated chat product is planned.

## Contributing and license

Focused security, policy, integration, accessibility, testing, and documentation contributions are
welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

ActionProof is released under the [MIT License](LICENSE).
