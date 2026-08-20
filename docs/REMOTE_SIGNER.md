# Remote verifier signer protocol

`actionproof-remote-signer/1` is the narrow boundary for a KMS, HSM, MPC, or threshold-signing
gateway. The gateway accepts an authenticated HTTPS POST containing:

- the ActionProof EIP-712 domain;
- the exact `ActionAttestation` types and primary type;
- the exact attestation message.

It returns `{ "signature": "0x..." }` with a canonical 65-byte Ethereum signature. ActionProof
recovers the signer against the same typed payload and requires it to equal `AUTHORIZED_VERIFIER`.
A malformed response, timeout, redirect, wrong recovered address, or unavailable gateway fails
closed before anchoring.

The same authenticated URL responds to `GET` with `{ "ok": true, "address": "0x..." }`. Readiness
requires the checksummed address to match `AUTHORIZED_VERIFIER`; this probes gateway reachability but
does not replace per-signature recovery.

The gateway should enforce its own mTLS/workload identity, destination-chain and guard allowlists,
rate limits, audit log, approval policy, and key-rotation ceremony. `VERIFIER_SIGNER_TOKEN` is an
application credential, not the signing key. Keep it in a secret manager and rotate it separately.

Direct cloud-KMS DER signatures are intentionally not parsed inside the API. A small reviewed
gateway must normalize provider-specific signatures and recovery IDs while the ActionProof side
retains one provider-neutral, independently verified protocol.
