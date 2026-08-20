# Independent audit package

Audit status: **not audited**. This document prepares a reproducible scope; it is not an audit report
and must never be described as one.

## In-scope security boundaries

- `packages/contracts/src/ActionProofGuard.sol` and deployment settings;
- action/report hashing, canonicalization, EIP-712 and policy precedence in `packages/core`;
- live Chain, Compute, Storage, identity, and remote-signer adapters in `packages/0g`;
- API authorization, tenancy, persistence, queues, webhook outbox, SSRF controls, and redaction;
- public verification UI and cross-origin/content-security policy;
- deployment gates, migration, backup/restore, rotation, and incident procedures.

## Required reviewer exercises

1. Recompute all hashes and typed-data constants across TypeScript/Solidity.
2. Attempt nonce, chain, target, value, calldata, root, report, signer, deadline, and replay tampering.
3. Fault every external call before and after a possible side effect; prove no automatic rebroadcast.
4. Review PostgreSQL lease concurrency, migration rollback, outbox atomicity, and exhausted-work flow.
5. Attack API-key timing/quota isolation and webhook DNS rebinding/redirect/signature/replay handling.
6. Test EIP-1967 false positives, unsupported tracers, state-footprint limits, and proxy upgrades between
   simulation and execution.
7. Compromise/rotate each role independently and verify the documented blast radius.
8. Fuzz contract and schema boundaries, then repeat the public safe/block/tamper evidence story.

## Handoff artifacts

- exact commit hash and dependency lockfile;
- compiler/optimizer/EVM settings and deployed bytecode hashes;
- `pnpm verify` output and CI run;
- Galileo evidence JSON and public explorer links;
- architecture, threat model, production runbook, remote signer protocol, webhook contract, and SLO;
- a separate private inventory of infrastructure and key ownership, never committed to this repository.

Findings should have severity, affected commit, proof of concept, remediation, regression test, and
reviewer retest status. Only a signed final report from the independent reviewer can change the
public audit status.
