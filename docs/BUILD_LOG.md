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

## 2026-08-16 — Public evidence deployment

- Created a dedicated `actionproof-0g` Cloudflare Tunnel and routed
  `https://actionproof.tangvu.dev` to isolated loopback-only API and Next.js production origins.
- Added reproducible PM2 hosting configuration, a Cloudflare ingress template, host build/status
  commands, and an environment configurator that never prints secrets.
- Published the two persisted real Galileo traces through History and public Trace pages; live Chain,
  Compute catalog, and Storage node-selection probes remain visible.
- Disabled anonymous paid writes and mainnet broadcast in the hosted configuration. Added a
  synchronous 503 API gate and UI read-only state so public traffic cannot create jobs or spend
  funded server balances.
- Added CSP, HSTS, ordered tunnel path validation, DNS/HTTPS/CORS checks, and PM2 recovery at owner
  logon after reboot.

## 2026-08-17 — Guided judge demo and funded-service control

- Replaced the hosted analyzer's disabled dead end with scenario-aware links to the preserved real
  Galileo safe/block traces; made the landing Allow/Block/Break cards direct proof navigation.
- Added a supervised-write authorization boundary. Even after enabling the network write gate, live
  API submissions fail closed without a separate 32+ character operator bearer token. Comparison is
  constant-time, headers are redacted, and the browser keeps the token only in memory.
- Added `pnpm smoke:public`, a no-spend assertion of HTTPS security headers, live integration status,
  both preserved traces, trace-page rendering, synchronous public-write refusal, and unchanged state.
- Expanded Playwright coverage for the guided read-only journey on desktop and Pixel 7, including
  link accessibility and horizontal-overflow regression checks.

## 2026-08-17 — Registered identity and identity-bound live proof

- Registered ActionProof as ERC-8004 agent `278` through the official Galileo Identity Registry,
  then set and independently read back its public standards-compliant registration URI. Both
  receipts and owner/wallet/URI checks are committed without secrets.
- Re-ran the paid production-adapter safe/block/tamper story with ERC-8004 evidence bound inside the
  canonical reports: Storage sequences `146979` and `146980`, two audit anchors, one safe guarded
  execution, one deterministic block, and seven independent checks per original trace.
- Exercised a real transient RPC receipt-lookup failure. The job failed closed and never executed;
  the Chain adapter was hardened to recover only the exact already-broadcast hash without
  resubmission. Adapter regression coverage now reproduces that failure mode.
- Corrected filtered-CLI runtime path resolution, added an atomic dry-run-first state merge utility,
  retained the historical traces, and moved the new identity-bound traces into the canonical public
  history. The hosted API remains read-only.
- Added and exercised a read-only captioned demo recorder. The local reference output is a 77.4-second
  1280×720 H.264 MP4; generated media remains ignored until the owner approves publication.

## 2026-08-20 — Product-grade Instant Preflight

- Added a public, rate-limited `POST /v1/preflight` capability that accepts an arbitrary exact action,
  computes its hash, simulates from the guard, resolves the current nonce and optional identity, and
  runs deterministic policy without Compute, Storage, signing, persistence, or chain writes.
- Extracted reusable selector inspection with structured arguments and risk signals for token/NFT
  approvals, transfers, ownership changes, proxy upgrades, delegate calls, malformed calldata, and
  unknown selectors. Unknown meaning now creates a review floor instead of a false-safe result.
- Turned the analyzer into a transaction lab with custom envelope input, explicit pass/review/block
  output, decoded call details, simulation provenance, findings, and a visible boundary between
  instant preview and full 0G evidence.
- Added a developer integration page and guide, capability discovery, live no-spend smoke coverage,
  API unit coverage, and desktop/mobile browser journeys for arbitrary custom calldata.

## 2026-08-20 — Production control plane and integration hardening

- Added PostgreSQL JSONB persistence, checksum-locked migrations, `SKIP LOCKED` job leases,
  heartbeats, exhausted-work readiness, and fail-closed recovery that forbids automatic external
  rebroadcast after an interrupted stage.
- Added SHA-256 tenant API keys, constant-time authentication, tenant quota, structured/redacted audit
  logs, and a transactional webhook outbox with HMAC, retry, DNS/private-network SSRF controls, and
  delivery metrics.
- Added modular ERC-20/asset/NFT/admin/proxy policy packs, EIP-1967 implementation/admin/beacon
  inspection, code-hash/block provenance, and optional summarized `debug_traceCall` state footprint.
- Added a provider-neutral remote signer protocol for KMS/HSM gateways with independent EIP-712
  recovery, a typed TypeScript SDK, Prometheus metrics, proposed SLOs, production runbook, and an
  honest independent-audit package. No external audit or SLA is claimed.

## Validation record

The latest `pnpm verify` completed successfully on 2026-08-20 against the exact product-grade
preflight and identity-bound evidence tree. Mainnet deployment remains deliberately blocked by
funding, review, audit, and explicit authorization requirements.

| Check                     | Result                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- |
| Formatting                | Prettier + `forge fmt --check` passed                                        |
| ESLint                    | Passed with zero warnings                                                    |
| TypeScript                | Strict checks passed for Core, 0G adapters, SDK, API, and Web                |
| Core tests                | 16 passed                                                                    |
| Adapter/API/SDK tests     | 18 adapter + 13 API + 1 SDK tests passed                                     |
| PostgreSQL integration    | 2 passed against PostgreSQL 17: lease/outbox atomicity and replica quota     |
| Foundry unit/fuzz tests   | 31 passed; four fuzz properties ran 512 cases each                           |
| Production builds         | Contracts, Core, 0G, SDK, API, Next.js passed; guard runtime 6,127 B         |
| Playwright desktop/mobile | 12 passed across Chromium desktop and Pixel 7                                |
| Secret scan               | All tracked and unignored repository files checked; passed                   |
| Production audit          | No known vulnerabilities found                                               |
| Sandbox smoke             | Safe executed; unlimited approval blocked; tamper verification rejected      |
| Deployment evidence       | Galileo deployed/source-verified; Mainnet dry-run passed, broadcast disabled |
| Public 0G probes          | Chain, Compute, Storage, and ERC-8004 agent `278` passed                     |
| Live paid 0G proof        | Identity-bound safe executed; unlimited approval blocked; tamper rejected    |
| Public preflight          | Live no-spend arbitrary-action preview passed without creating a trace       |
