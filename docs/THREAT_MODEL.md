# Threat model

Status: experimental, unaudited MVP. This document describes intended controls, not a guarantee of
safety.

## Security objective

ActionProof should prevent an attacker from executing a different, expired, replayed, unapproved, or
deterministically blocked action by reusing a valid assessment. It should preserve enough public
evidence to independently detect tampering with the request, report, storage reference, signer,
network, nonce, or execution state.

It does **not** prove that an allowed contract is economically safe, correctly specified, free of
unknown vulnerabilities, or immune to state changes after simulation.

## Assets and invariants

| Asset / invariant      | Required property                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Exact action           | Target, value, calldata, intent, agent, requester, chain, nonce, and time window cannot change after assessment |
| Decision integrity     | A deterministic block cannot be overridden by model output or a client                                          |
| Report integrity       | Retrieved canonical bytes match both `reportHash` and the committed Storage root                                |
| Verifier authority     | Only the configured verifier at anchoring can create an accepted attestation                                    |
| Replay resistance      | One sequential nonce anchors once; one allow anchor executes once                                               |
| Destination isolation  | A signature for one chain or guard cannot be accepted by another                                                |
| Secret confidentiality | Compute, verifier, relayer, and storage secrets never reach browser bundles or logs                             |
| Honest provenance      | Sandbox artifacts are never presented as live 0G evidence                                                       |

## Adversaries

- a malicious or compromised autonomous agent proposing crafted calldata or a misleading intent;
- a hostile target contract that reverts, reenters, changes behavior by caller/state, or returns
  malformed data;
- a user who changes a field after assessment;
- a relayer or observer attempting front-running, replay, substitution, or cross-chain reuse;
- a model/provider returning optimistic, malicious, malformed, truncated, or stale output;
- a compromised/unavailable RPC, indexer, storage node, API client, or browser;
- an attacker with read access to public traces;
- an operator mistake such as the wrong chain, wrong verifier, stale contract address, or mainnet
  flag.

Compromise of the live verifier private key, guard owner, application host, or upstream chain
consensus is considered a trust-root compromise. Controls limit blast radius but do not make those
events harmless.

## Trust boundaries and controls

### Browser to API

All request bodies, route params, addresses, hex strings, integers, and model/network responses pass
runtime schemas. The API applies body limits, CORS policy, security headers, request IDs, timeouts,
and rate limits. The browser is untrusted and cannot select live adapters or supply verifier keys.

### Deterministic analysis

Critical rules block before inference. ABI decoding is attempted only for recognized selectors;
malformed recognized calldata blocks. Unknown selectors are not automatically safe. Bytecode opcode
scanning is a warning because byte patterns can occur in push data and reachability is unknown.

The target bytecode verification state is provenance only. Verified source can still be dangerous;
unverified source can be benign. The MVP does not perform full symbolic execution or decompilation.

### Simulation

The live adapter uses the configured 0G chain and simulates the downstream call from the guard
address. A chain mismatch, missing code, RPC failure, revert, or unexpected effect fails closed.

Simulation is a snapshot. A target can change because of another transaction, a proxy upgrade,
block/timestamp/oracle conditions, or deliberate anti-simulation behavior. The executor does not
guarantee the state remains identical between simulation and execution. Demo targets are immutable
and valueless to reduce this gap.

### 0G Compute

Inference is advisory. The Router response must contain trace metadata and exactly one schema-valid
JSON assessment under size/time limits. There is no fallback to a fake model in live mode. A model
cannot remove a deterministic finding, change an action field, sign an attestation, upload data, or
broadcast a transaction.

TEE/provider metadata can strengthen provenance but does not imply correctness of security judgment.
Model confidence is displayed as model confidence—not transaction safety probability.

### 0G Storage

The report is public and must contain no private keys, API keys, authentication headers, or personal
secrets. Its exact canonical bytes are committed. Retrieval compares bytes and independently
recomputes the SDK Merkle root because the current high-level proof option is not sufficient on its
own. Storage availability is not guaranteed forever by this application; the trace must distinguish
integrity from availability.

### ERC-8004 identity evidence

Identity is optional and read-only. When configured, the API reads the official registry on the
destination chain and requires `getAgentWallet(agentId)` to equal the exact action-agent address.
The registry owner, metadata URI, wallet, registry address, chain, and lookup time enter the signed
canonical report. A stale/malicious metadata URI cannot change the wallet comparison or clear any
policy finding. Registry compromise, wallet rotation between assessment and execution, and metadata
availability remain trust and freshness risks; short action deadlines limit but do not remove them.

### Verifier and relayer

Verifier and relayer keys are server-only and should be separate in production. The verifier signs
only after every mandatory stage completes. A permissionless relayer can anchor or execute because
it cannot alter the signed envelope; it must supply any exact native value itself. This avoids making
the requester key a server custody requirement.

If the verifier key is compromised, an attacker can sign new allow attestations within contract
policy. The owner can rotate the verifier. Existing anchors retain the verifier proven at anchor so
later rotation cannot silently invalidate their evidence. Rotation does not revoke an already
anchored allow action; operators should use short deadlines and pause deployment traffic during an
incident. The MVP intentionally has no upgradeable proxy or generalized pause authority.

### ActionProofGuard

The contract uses:

- EIP-712 domain binding to chain and guard address;
- explicit destination chain binding;
- low-`s`, valid-`v`, fixed-length ECDSA checks;
- nonzero agent/requester/target/report/intent commitments;
- issuance/expiration validation;
- sequential `(agent, requester)` nonce lanes;
- separate anchored and executed replay barriers;
- an allow-only execution gate;
- calldata and `msg.value` equality checks;
- checks-effects-interactions and non-reentrancy;
- exact downstream revert propagation;
- event-based evidence history.

The guard is non-custodial in design but may transiently receive the exact `msg.value` during a call.
It has no general withdrawal function; failed target calls revert the whole transaction and value.

## Abuse cases

| Attack                                                        | Expected result                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Change calldata/target/value/intent/root/report after signing | EIP-712 digest mismatch; signature or anchor lookup fails               |
| Replay same anchor                                            | Used digest or nonce rejects                                            |
| Execute same safe anchor twice                                | Executed digest rejects                                                 |
| Anchor block/review, then execute                             | Verdict gate rejects                                                    |
| Use signature on another chain                                | Domain and explicit chain check reject                                  |
| Use signature on another guard                                | Domain verifying-contract check rejects                                 |
| Unauthorized verifier signs                                   | Recovered signer rejects                                                |
| Unlimited approval with optimistic model                      | Deterministic `UNLIMITED_ERC20_APPROVAL` forces block                   |
| Model returns prose/malformed JSON                            | Inference stage fails closed; no attestation                            |
| Storage returns different bytes                               | Report hash/root recomputation rejects                                  |
| Target reenters executor                                      | Non-reentrancy guard rejects nested execution                           |
| Downstream target reverts                                     | Execution transaction reverts; anchor remains, execution bit rolls back |
| Mainnet config accidentally selected                          | Startup/write gates require explicit mainnet broadcast opt-in           |
| ERC-8004 wallet differs or lookup fails while enforced        | Deterministic identity finding forces block                             |

## Out of scope / known limitations

- complete contract semantic analysis, exploit detection, or economic simulation;
- MEV, oracle manipulation, governance capture, bridge safety, or offchain side effects;
- target state equality between simulation and later execution;
- private reports or access-controlled storage;
- threshold/multisignature verification, verifier staking, or decentralized policy governance;
- key recovery, KMS/HSM integration, production database/queue/high availability;
- ERC-8004 registration/reputation writes and production ERC-7857 oracle/TEE integration;
- formal verification or a third-party audit.

## Operational requirements

Use a fresh low-value deployer, verifier, storage, and relayer separation where possible. Keep
deadlines short. Verify source and bytecode on ChainScan. Record deployment compiler/settings. Alert
on verifier rotation, failed verification, nonce gaps, repeated malformed model output, storage root
mismatch, and unexpected guard events. Never move valuable assets through the demo contracts.
