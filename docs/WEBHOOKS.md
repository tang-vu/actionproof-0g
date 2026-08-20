# Webhook contract

Configured tenants receive `job.completed` or `job.failed` after the terminal job state and outbox
event have committed atomically.

Headers:

```text
X-ActionProof-Event: job.completed
X-ActionProof-Delivery: <UUID>
X-ActionProof-Timestamp: <Unix seconds>
X-ActionProof-Signature: sha256=<hex HMAC>
```

The signature is `HMAC-SHA256(secret, timestamp + "." + exactBodyBytes)`. Consumers should reject
timestamps outside five minutes, compare the expected signature in constant time, and deduplicate by
delivery UUID before processing. Return any 2xx response only after the event is durable locally.

Example body:

```json
{
  "id": "delivery UUID",
  "event": "job.completed",
  "createdAt": "2026-08-20T00:00:00.000Z",
  "data": {
    "jobId": "job UUID",
    "status": "completed",
    "traceId": "trace UUID",
    "updatedAt": "2026-08-20T00:00:00.000Z"
  }
}
```

Delivery is at least once. Redirects, non-HTTPS URLs, URL credentials, localhost, and private or
loopback resolutions are rejected. Failures use bounded exponential retry; eight exhausted attempts
make readiness fail and require operator inspection. Rotating or removing a tenant secret leaves its
pending events undeliverable by design until configuration is restored.
