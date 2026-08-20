CREATE TABLE IF NOT EXISTS actionproof_jobs (
  id uuid PRIMARY KEY,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS actionproof_traces (
  id uuid PRIMARY KEY,
  action_hash text NOT NULL UNIQUE,
  root_hash text NOT NULL UNIQUE,
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS actionproof_job_queue (
  job_id uuid PRIMARY KEY REFERENCES actionproof_jobs(id) ON DELETE CASCADE,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS actionproof_queue_claim_idx
  ON actionproof_job_queue (available_at, lease_until, attempts);

CREATE TABLE IF NOT EXISTS actionproof_webhook_outbox (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES actionproof_jobs(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('job.completed', 'job.failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS actionproof_webhook_claim_idx
  ON actionproof_webhook_outbox (available_at, lease_until, attempts);

CREATE TABLE IF NOT EXISTS actionproof_tenant_quota (
  tenant_id text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL
);
