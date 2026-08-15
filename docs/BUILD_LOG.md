# Build log

This log is an honest development record for judge verification. Git commit history remains the
authoritative timestamped change log; no history or timestamps are fabricated.

## 2026-08-13 — Research and architecture baseline

- Confirmed the repository was clean and effectively empty; no `AGENTS.md` instructions existed.
- Verified current official 0G Mainnet (`16661`) and Galileo (`16602`) networks, RPC/explorer URLs,
  Storage Turbo indexers, Storage Flow contracts, Compute Router endpoints, and payment contracts.
- Selected the server-side 0G Compute Router path. Recorded the Direct SDK `0.9.0` alternative and
  upstream starter drift.
- Selected and pinned the official Storage SDK npm artifact `1.2.11` with exact ethers peer
  `6.13.1`; documented the repository-manifest version drift and downloader proof caveat.
- Deferred ERC-7857 because its official guide relies on a replaceable/mock oracle. Selected the
  official ERC-8004 registries for optional read-only identity evidence without automatic writes.

## 2026-08-13 — Cryptographic and contract core

- Defined versioned action/report/attestation schemas, stable canonical JSON, action/report hashes,
  and shared EIP-712 types.
- Implemented deterministic policy rules with hard-block precedence over model output.
- Implemented `ActionProofGuard`, valueless counter/token fixtures, reentrancy fixture, deployment
  records, and dry-run-first Foundry deployment script.
- During review, identified that a one-shot "consume" path prevented the required anchor-then-execute
  lifecycle. Split anchoring and execution state, added separate duplicate-execution protection, and
  retained blocked/report-only anchors. This was fixed before deployment.
- Provisioned Foundry 1.7.1 locally in ignored tooling for Windows validation.

## 2026-08-13 — 0G adapters and orchestration

- Implemented a strict 0G Compute Router boundary: JSON-object mode, response size/timeout, 0G trace
  metadata, and runtime schema rejection without live fallback.
- Implemented Storage upload/download with canonical bytes, local pre-upload root, returned-root
  checks, retrieved-byte comparison, and mandatory root recomputation.
- Implemented Chain simulation, attestation, anchor, execution, nonce, and read verification
  boundaries against the guard ABI.
- Added explicit sandbox adapters using the actual Storage SDK Merkle implementation and ephemeral
  signing. Every sandbox artifact remains labeled.
- Added an asynchronous API job pipeline, atomic trace persistence, integration/readiness routes,
  demo fixtures, tamper verification, and an opt-in live smoke boundary.
- Added keyless public probes for Chain RPC/chain ID, Compute model catalogs, and Storage indexer
  node selection on both Galileo and Mainnet. Added live guard bytecode/verifier readiness checks.
- Added optional ERC-8004 `ownerOf`/agent-wallet/URI resolution. Matching evidence is committed to
  the report; configured lookup failures and wallet mismatch fail closed.
- Normalized Storage `txSeq` receipts into direct StorageScan submission links, including successful
  deduplicated uploads that return no new transaction hash.

## 2026-08-13 — Judge experience and delivery

- Built a responsive dark security-operations interface with landing, analyzer, actual progress,
  verdict, public trace, agent history, integration truth, architecture, empty/error/timeout/block
  states, keyboard focus, reduced motion, and mobile layouts.
- Added critical Playwright coverage for the landing trust message, safe trace, unlimited-approval
  block, fresh server-side evidence re-verification, and tamper rejection.
- Rendered and visually inspected the full desktop trace and Pixel 7 journeys; fixed isolated test
  ports, CORS configuration, a timestamp hydration mismatch, and captured the checked-in README
  screenshot from the real application.
- Updated Fastify and constrained vulnerable transitive Axios/WebSocket versions in the official
  Storage SDK dependency graph; the production dependency audit now reports no known issues.
- Added deterministic CI, secret checking, deployment/recovery guidance, threat model, demo narration,
  judging evidence map, submission copy, and pitch.
- Ran read-only Foundry deployment simulations successfully against both official Galileo (`16602`)
  and Mainnet (`16661`) RPCs. Confirmed a simulated non-dry mainnet invocation fails with
  `MainnetBroadcastNotAuthorized` unless its independent authorization gate is set.

## 2026-08-15/16 — Verified Galileo production-adapter proof

- Generated four role-separated local testnet identities without printing keys, funded them, and
  kept all secrets in the ignored `.env`. Mainnet broadcast remained disabled.
- Dry-ran, broadcast, receipt-checked, and source-verified `ActionProofGuard`, `DemoCounter`,
  `DemoToken`, and `ReentrantTarget` on Galileo. Committed exact addresses, transactions, blocks,
  compiler settings, and Explorer links.
- Exercised fail-closed behavior before success: malformed Compute JSON produced a block anchor; a
  missing source-provenance signal produced review and no execution. Neither path was mislabeled as
  a safe success.
- Tightened the real `qwen2.5-omni` structured-output prompt without application-side repair, then
  passed an isolated paid Compute request with Router request/provider/billing metadata.
- Added validated ChainScan `/open/api` source-provenance lookup. Explorer timeout or malformed data
  still degrades to `unknown`; it never invents verification.
- Completed and persisted the full live story: safe Storage upload/round-trip/anchor/execution,
  unlimited-approval Storage upload/block anchor/no execution, and calldata-tamper rejection.
- Independently checked all five final transaction receipts, counter state `2`, nonce `5`, both
  Storage roots, seven trace checks, and public Explorer links. Sanitized evidence is committed in
  `docs/evidence/galileo-live.json`.
- Rendered the live traces on desktop and Pixel 7. Fixed a mobile grid min-content overflow and a
  UI/API agent nonce-lane mismatch, then added browser regression assertions for both.

## Validation record

The latest `pnpm verify` completed successfully on 2026-08-16 in 112.7 seconds against the same
working tree as the live-evidence documentation. Mainnet deployment remains deliberately blocked by
funding, review, audit, and explicit authorization requirements.

| Check                     | Result                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- |
| Formatting                | Prettier + `forge fmt --check` passed                                        |
| ESLint                    | Passed with zero warnings                                                    |
| TypeScript                | Strict checks passed for Core, 0G adapters, API, and Web                     |
| Core tests                | 10 passed                                                                    |
| Adapter/API tests         | 17 adapter + 7 API tests passed                                              |
| Foundry unit/fuzz tests   | 31 passed; four fuzz properties ran 512 cases each                           |
| Production builds         | Contracts, Core, 0G adapters, API, and Next.js passed; guard runtime 6,127 B |
| Playwright desktop/mobile | 6 passed across Chromium desktop and Pixel 7                                 |
| Secret scan               | 106 repository files checked; passed                                         |
| Production audit          | No known vulnerabilities found                                               |
| Sandbox smoke             | Safe executed; unlimited approval blocked; tamper verification rejected      |
| Deployment evidence       | Galileo deployed/source-verified; Mainnet dry-run passed, broadcast disabled |
| Public 0G probes          | Chain, Compute catalog, and Storage indexer passed on Galileo and Mainnet    |
| Live paid 0G proof        | Safe executed; unlimited approval blocked; calldata tamper rejected          |
