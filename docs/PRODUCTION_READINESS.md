# Production readiness

This runbook describes the production control plane implemented by ActionProof. It does not turn an
unaudited deployment into an audited one, and it does not authorize valuable-asset use.

## PostgreSQL and durable work

Set `DATABASE_URL` to a TLS-protected PostgreSQL connection and run:

```bash
pnpm db:migrate
```

Migrations are checksum-pinned and protected by a PostgreSQL advisory lock. Jobs and traces are
stored as validated JSONB documents. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, maintain a
lease heartbeat, and acknowledge only after a terminal result is durable. Eight exhausted claims
make readiness fail. If a process stops after a job enters an external stage, recovery fails closed
with `RECOVERY_REQUIRES_RECONCILIATION`; ActionProof never guesses whether it should rebroadcast a
paid request or chain transaction.

The atomic JSON store remains supported for local and single-host evidence deployments. Production
tenant webhooks are rejected at configuration time unless PostgreSQL is configured.

## Tenants, quota, and authorization

Generate a credential locally:

```bash
pnpm tenant:keygen
```

Give the raw key to the tenant once and retain only its SHA-256 digest:

```json
[
  {
    "id": "treasury-agent",
    "apiKeySha256": "<64 lowercase hex characters>",
    "requestsPerMinute": 30,
    "webhookUrl": "https://tenant.example/actionproof/events",
    "webhookSecret": "<32+ characters from a secret manager>"
  }
]
```

Put the JSON in the secret-managed `ACTIONPROOF_TENANTS_JSON` environment value. Clients send
`X-API-Key`; raw keys are never stored, returned, or logged. Authentication compares fixed-length
digests in constant time. A global limiter and a tenant limiter both apply. The legacy operator
bearer token remains available for supervised migration windows. PostgreSQL updates the tenant
minute window atomically, so replica count cannot multiply a configured production quota.

## Webhook outbox

Terminal job state and its webhook event enter PostgreSQL in one transaction. A separate lease
worker delivers signed HTTPS events, refuses credentials/redirects/private destinations, retries
with bounded exponential backoff, and exposes pending/leased/exhausted counts. See
[WEBHOOKS.md](WEBHOOKS.md).

## Policy and simulation

`POLICY_PACKS` enables the versioned base, ERC-20 approval, asset movement, NFT operator,
administration, and proxy-upgrade packs. Base fail-closed rules cannot be disabled. Preflight returns
the exact packs that applied.

Every live simulation records a target code hash and block number when RPC enrichment is available,
reads the EIP-1967 implementation/admin/beacon slots, and marks proxy risk. Optional
`ENABLE_STATE_DIFF=true` asks a compatible RPC for `debug_traceCall` prestate diff mode, retains only
account/storage counts, and blocks footprints over `MAX_STATE_DIFF_ACCOUNTS`. Unsupported tracing is
explicitly labeled; it is never fabricated or silently treated as proof of no state change.

## Keys

Local verifier keys remain supported for Galileo. Production can instead configure
`VERIFIER_SIGNER_URL`, `VERIFIER_SIGNER_TOKEN`, and `AUTHORIZED_VERIFIER`. The remote gateway receives
the exact EIP-712 payload and ActionProof independently recovers every returned signature before it
can be anchored. See [REMOTE_SIGNER.md](REMOTE_SIGNER.md).

## Observability and rollout

Prometheus text metrics are exposed at `/metrics`; health/readiness include persistence, job queue,
and webhook outbox state. Logs redact authorization, API keys, signing tokens, webhook secrets,
private keys, and signatures. Authorized submissions emit a structured audit event with tenant,
job, and execution-request metadata but not calldata or credentials.

Recommended rollout:

1. PostgreSQL backup/restore exercise and migration rehearsal.
2. `execute: false` shadow traffic with state diff disabled.
3. Enable tracing on a dedicated RPC and tune footprint limits from labeled test traffic.
4. Move the verifier behind the remote signer boundary and test rotation/recovery.
5. Conduct the independent audit in [AUDIT_PACKAGE.md](AUDIT_PACKAGE.md).
6. Run a low-value canary, incident drill, and SLO observation window before expanding scope.
