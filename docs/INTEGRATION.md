# Integrating ActionProof

ActionProof provides two deliberately separate product surfaces:

1. **Instant Preflight** is a read-only, no-spend inspection path for arbitrary exact transaction
   envelopes.
2. **Full Assessment** adds 0G Compute, canonical evidence on 0G Storage, an EIP-712 attestation,
   an onchain audit anchor, and optional guarded execution.

Do not treat a preflight response as an attestation or safety guarantee. Its purpose is to reject
obvious policy violations early and give developers a machine-readable explanation before paid or
irreversible stages begin.

For TypeScript services, `@actionproof/sdk` validates the exact envelope locally, sends tenant
authentication only to the configured origin, exposes typed preflight/job responses, and provides a
bounded terminal-job poller. The HTTP contract below remains the source of truth for other clients.

## 1. Construct the exact action

An `ActionRequest` binds every field that later enters the action hash and attestation:

```ts
const issuedAt = Math.floor(Date.now() / 1000);
const action = {
  version: "1",
  agent: "0x...",
  requester: "0x...",
  target: "0x...",
  value: "0",
  calldata: "0x...",
  intent: "The exact outcome this action is supposed to produce",
  destinationChainId: 16602,
  nonce: "0",
  issuedAt,
  expiresAt: issuedAt + 600,
};
```

Read the current guard nonce first:

```http
GET /v1/nonces/:requester?agent=:agent
```

ActionProof never repairs or rewrites a stale nonce.

## 2. Run Instant Preflight

The hosted endpoint is intended for server-to-server calls and is rate limited. Direct browser
calls work only from explicitly allowed origins; do not weaken CORS to `*` in order to bypass that
boundary.

```http
POST /v1/preflight
Content-Type: application/json

{ "action": { ... } }
```

This route performs only:

- selector-based calldata inspection;
- read-only chain simulation from the guard execution context;
- target bytecode/source-provenance checks;
- configured limits, allowlist, denied-spender, chain, deadline, nonce, replay, identity, and
  deterministic policy checks.

It does **not** call 0G Compute, upload to 0G Storage, sign anything, submit a chain transaction, or
execute the target. The response always includes a `notice` that states this boundary.

The `disposition` has three values:

- `pass`: no deterministic finding requires review or block;
- `review`: the action has no hard blocker but contains a material warning, such as an unknown
  selector or unverified source;
- `block`: at least one deterministic blocking rule fired.

`eligibleForFullAssessment` means only that no deterministic blocker prevents progressing to the
next stages. It is not an allow verdict.

## 3. Request full evidence

An authorized deployment can submit the same, unchanged envelope:

```http
POST /v1/jobs
Authorization: Bearer <operator-token>
X-API-Key: <tenant-key>
Content-Type: application/json

{ "action": { ... }, "execute": false }
```

Use either the tenant API key or the separately gated legacy operator token, never both. The public
Galileo deployment intentionally disables this paid/write path. Self-hosted operators
must configure funded role-separated accounts, the 0G Compute Router, 0G Storage, a deployed guard,
and the independent write gates described in [DEPLOYMENT.md](DEPLOYMENT.md).

Poll `GET /v1/jobs/:id` until `completed` or `failed`. A completed response exposes `traceId`.
Setting `execute: false` produces and anchors the evidence without asking the guard to call the
target. Use this mode before enabling execution in a new integration.

## 4. Verify the trace

```http
GET  /v1/traces/:traceId
POST /v1/traces/:traceId/verify
GET  /v1/reports/:storageRoot
```

Verification recomputes the action hash, canonical report hash, Storage root, EIP-712 binding,
signer/domain, and chain anchor/execution state. Integrators should fail closed if `valid` is not
exactly `true` or if a required check is absent.

## Production integration checklist

- Keep action deadlines short and fetch the nonce immediately before submission.
- Preserve the original envelope byte-for-byte across preview and full assessment.
- Treat unknown selectors and protocol-specific calls as review until a policy module exists.
- Use `execute: false` during rollout and incident response.
- Separate verifier, relayer, Storage, and deployment identities.
- Put full-assessment authorization behind server-side identity, quotas, and audit logs.
- Replace the MVP JSON store with a transactional database and durable queue before horizontal
  scaling.
- Move verifier keys to KMS/HSM or threshold signing and obtain an independent contract/application
  audit before valuable-asset use.
- Monitor `/metrics`, exhausted queue/outbox work, integration health, and integrity failures against
  the proposed objectives in [SLO.md](SLO.md).
