import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  actionRequestSchema,
  attestationSchema,
  chainReceiptSchema,
  riskReportSchema,
  storageReceiptSchema,
} from "@actionproof/core";
import { z } from "zod";
import { Pool } from "pg";

import { ApiError } from "./errors.js";
import {
  stageIds,
  type ActionTrace,
  type PersistedState,
  type QueueStats,
  type StoredJob,
  type WebhookOutboxItem,
} from "./types.js";

const idSchema = z.uuid();
const hexSchema = z.string().regex(/^0x[a-fA-F0-9]+$/u);
const stepSchema = z.object({
  id: z.enum(stageIds),
  label: z.string(),
  status: z.enum(["pending", "active", "complete", "failed", "skipped"]),
  detail: z.string().optional(),
});
const jobSchema = z.object({
  id: idSchema,
  status: z.enum([
    "queued",
    "preflight",
    "simulation",
    "inference",
    "storage",
    "anchoring",
    "execution",
    "completed",
    "failed",
  ]),
  steps: z.array(stepSchema).length(stageIds.length),
  traceId: idSchema.optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  action: actionRequestSchema,
  execute: z.boolean(),
  tenantId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u)
    .optional(),
});
const verificationSchema = z.object({
  valid: z.boolean(),
  checkedAt: z.iso.datetime(),
  checks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      valid: z.boolean(),
      detail: z.string(),
    }),
  ),
});
const traceSchema = z.object({
  id: idSchema,
  mode: z.enum(["live", "sandbox"]),
  createdAt: z.iso.datetime(),
  action: actionRequestSchema,
  actionHash: hexSchema,
  report: riskReportSchema,
  reportCanonical: z.string(),
  reportHash: hexSchema,
  storage: storageReceiptSchema,
  attestation: attestationSchema,
  signature: hexSchema,
  chain: chainReceiptSchema,
  execution: z.object({
    status: z.enum(["executed", "blocked", "not-requested"]),
    transactionHash: hexSchema.optional(),
    error: z.string().optional(),
    explorerUrl: z.url().optional(),
  }),
  verification: verificationSchema,
});
const stateSchema = z.object({
  version: z.literal(1),
  jobs: z.array(jobSchema),
  traces: z.array(traceSchema),
});

export interface StateStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  putJob(job: StoredJob): Promise<void>;
  finalizeJob(job: StoredJob, webhook?: Omit<WebhookOutboxItem, "attempts">): Promise<void>;
  getJob(id: string): Promise<StoredJob | undefined>;
  listJobs(): Promise<StoredJob[]>;
  putTrace(trace: ActionTrace): Promise<void>;
  getTrace(id: string): Promise<ActionTrace | undefined>;
  listTraces(): Promise<ActionTrace[]>;
  findTraceByActionHash(actionHash: string): Promise<ActionTrace | undefined>;
  findTraceByRoot(rootHash: string): Promise<ActionTrace | undefined>;
  enqueueJob(id: string): Promise<void>;
  claimNextJob(workerId: string, leaseMs: number): Promise<string | undefined>;
  renewJobLease(id: string, workerId: string, leaseMs: number): Promise<boolean>;
  acknowledgeJob(id: string, workerId: string): Promise<void>;
  queueStats(): Promise<QueueStats>;
  enqueueWebhook(item: Omit<WebhookOutboxItem, "attempts">): Promise<void>;
  claimNextWebhook(workerId: string, leaseMs: number): Promise<WebhookOutboxItem | undefined>;
  acknowledgeWebhook(id: string, workerId: string): Promise<void>;
  rescheduleWebhook(id: string, workerId: string, delayMs: number): Promise<void>;
  webhookStats(): Promise<QueueStats>;
  consumeTenantQuota(tenantId: string, limit: number, nowMs: number): Promise<boolean>;
}

function initialState(): PersistedState {
  return { version: 1, jobs: [], traces: [] };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStateStore implements StateStore {
  protected state: PersistedState = initialState();
  protected readonly queue = new Map<
    string,
    { leaseOwner?: string; leaseUntil?: number; attempts: number }
  >();
  protected readonly webhookQueue = new Map<
    string,
    WebhookOutboxItem & { leaseOwner?: string; leaseUntil?: number; availableAt: number }
  >();
  protected readonly tenantQuota = new Map<string, { windowStart: number; count: number }>();

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async putJob(job: StoredJob): Promise<void> {
    const parsed = jobSchema.parse(job) as StoredJob;
    const index = this.state.jobs.findIndex((entry) => entry.id === parsed.id);
    if (index < 0) this.state.jobs.push(copy(parsed));
    else this.state.jobs[index] = copy(parsed);
  }

  async finalizeJob(job: StoredJob, webhook?: Omit<WebhookOutboxItem, "attempts">): Promise<void> {
    await this.putJob(job);
    if (webhook) await this.enqueueWebhook(webhook);
  }

  async getJob(id: string): Promise<StoredJob | undefined> {
    assertSafeId(id);
    const job = this.state.jobs.find((entry) => entry.id === id);
    return job ? copy(job) : undefined;
  }

  async listJobs(): Promise<StoredJob[]> {
    return copy(this.state.jobs);
  }

  async putTrace(trace: ActionTrace): Promise<void> {
    const parsed = traceSchema.parse(trace) as ActionTrace;
    const index = this.state.traces.findIndex((entry) => entry.id === parsed.id);
    if (index < 0) this.state.traces.push(copy(parsed));
    else this.state.traces[index] = copy(parsed);
  }

  async getTrace(id: string): Promise<ActionTrace | undefined> {
    assertSafeId(id);
    const trace = this.state.traces.find((entry) => entry.id === id);
    return trace ? copy(trace) : undefined;
  }

  async listTraces(): Promise<ActionTrace[]> {
    return copy(
      [...this.state.traces].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  }

  async findTraceByActionHash(actionHash: string): Promise<ActionTrace | undefined> {
    const trace = this.state.traces.find(
      (entry) => entry.actionHash.toLowerCase() === actionHash.toLowerCase(),
    );
    return trace ? copy(trace) : undefined;
  }

  async findTraceByRoot(rootHash: string): Promise<ActionTrace | undefined> {
    const trace = this.state.traces.find(
      (entry) => entry.storage.rootHash.toLowerCase() === rootHash.toLowerCase(),
    );
    return trace ? copy(trace) : undefined;
  }

  async enqueueJob(id: string): Promise<void> {
    assertSafeId(id);
    if (!this.queue.has(id)) this.queue.set(id, { attempts: 0 });
  }

  async claimNextJob(workerId: string, leaseMs: number): Promise<string | undefined> {
    const now = Date.now();
    for (const [id, item] of this.queue) {
      if (item.attempts >= 8 || (item.leaseUntil !== undefined && item.leaseUntil > now)) continue;
      item.leaseOwner = workerId;
      item.leaseUntil = now + leaseMs;
      item.attempts += 1;
      return id;
    }
    return undefined;
  }

  async acknowledgeJob(id: string, workerId: string): Promise<void> {
    const item = this.queue.get(id);
    if (item?.leaseOwner === workerId) this.queue.delete(id);
  }

  async renewJobLease(id: string, workerId: string, leaseMs: number): Promise<boolean> {
    const item = this.queue.get(id);
    if (item?.leaseOwner !== workerId) return false;
    item.leaseUntil = Date.now() + leaseMs;
    return true;
  }

  async queueStats(): Promise<QueueStats> {
    const now = Date.now();
    const values = [...this.queue.values()];
    return {
      pending: values.filter(
        (item) => item.attempts < 8 && !(item.leaseUntil && item.leaseUntil > now),
      ).length,
      leased: values.filter((item) => item.leaseUntil !== undefined && item.leaseUntil > now)
        .length,
      exhausted: values.filter((item) => item.attempts >= 8).length,
    };
  }

  async enqueueWebhook(item: Omit<WebhookOutboxItem, "attempts">): Promise<void> {
    if (!this.webhookQueue.has(item.id)) {
      this.webhookQueue.set(item.id, { ...copy(item), attempts: 0, availableAt: Date.now() });
    }
  }

  async claimNextWebhook(
    workerId: string,
    leaseMs: number,
  ): Promise<WebhookOutboxItem | undefined> {
    const now = Date.now();
    for (const item of this.webhookQueue.values()) {
      if (
        item.attempts >= 8 ||
        item.availableAt > now ||
        (item.leaseUntil !== undefined && item.leaseUntil > now)
      )
        continue;
      item.leaseOwner = workerId;
      item.leaseUntil = now + leaseMs;
      item.attempts += 1;
      return copy(item);
    }
    return undefined;
  }

  async acknowledgeWebhook(id: string, workerId: string): Promise<void> {
    const item = this.webhookQueue.get(id);
    if (item?.leaseOwner === workerId) this.webhookQueue.delete(id);
  }

  async rescheduleWebhook(id: string, workerId: string, delayMs: number): Promise<void> {
    const item = this.webhookQueue.get(id);
    if (item?.leaseOwner !== workerId) return;
    delete item.leaseOwner;
    delete item.leaseUntil;
    item.availableAt = Date.now() + delayMs;
  }

  async webhookStats(): Promise<QueueStats> {
    const now = Date.now();
    const values = [...this.webhookQueue.values()];
    return {
      pending: values.filter(
        (item) =>
          item.attempts < 8 &&
          item.availableAt <= now &&
          !(item.leaseUntil && item.leaseUntil > now),
      ).length,
      leased: values.filter((item) => item.leaseUntil !== undefined && item.leaseUntil > now)
        .length,
      exhausted: values.filter((item) => item.attempts >= 8).length,
    };
  }

  async consumeTenantQuota(tenantId: string, limit: number, nowMs: number): Promise<boolean> {
    const windowStart = Math.floor(nowMs / 60_000) * 60_000;
    const current = this.tenantQuota.get(tenantId);
    const next =
      !current || current.windowStart !== windowStart
        ? { windowStart, count: 1 }
        : { ...current, count: current.count + 1 };
    this.tenantQuota.set(tenantId, next);
    return next.count <= limit;
  }
}

export class JsonFileStateStore extends MemoryStateStore {
  readonly #directory: string;
  readonly #statePath: string;
  #writeQueue = Promise.resolve();

  constructor(directory: string) {
    super();
    this.#directory = path.resolve(directory);
    this.#statePath = path.resolve(this.#directory, "state.json");
    const relative = path.relative(this.#directory, this.#statePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new TypeError("Persistence path escapes its configured data directory");
    }
  }

  override async initialize(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    try {
      const text = await readFile(this.#statePath, "utf8");
      this.state = stateSchema.parse(JSON.parse(text)) as PersistedState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.#persist();
    }
    for (const job of this.state.jobs) {
      if (job.status !== "completed" && job.status !== "failed") await this.enqueueJob(job.id);
    }
  }

  override async putJob(job: StoredJob): Promise<void> {
    const parsed = copy(jobSchema.parse(job) as StoredJob);
    await this.#mutateAndPersist((state) => {
      const index = state.jobs.findIndex((entry) => entry.id === parsed.id);
      if (index < 0) state.jobs.push(parsed);
      else state.jobs[index] = parsed;
    });
  }

  override async putTrace(trace: ActionTrace): Promise<void> {
    const parsed = copy(traceSchema.parse(trace) as ActionTrace);
    await this.#mutateAndPersist((state) => {
      const index = state.traces.findIndex((entry) => entry.id === parsed.id);
      if (index < 0) state.traces.push(parsed);
      else state.traces[index] = parsed;
    });
  }

  #persist(): Promise<void> {
    const operation = async () => {
      await this.#writeState(this.state);
    };
    this.#writeQueue = this.#writeQueue.then(operation, operation);
    return this.#writeQueue;
  }

  #mutateAndPersist(mutate: (state: PersistedState) => void): Promise<void> {
    const operation = async () => {
      const next = copy(this.state);
      mutate(next);
      await this.#writeState(next);
      // A terminal job is not observable through reads until its corresponding
      // atomic rename has completed.
      this.state = next;
    };
    this.#writeQueue = this.#writeQueue.then(operation, operation);
    return this.#writeQueue;
  }

  async #writeState(state: PersistedState): Promise<void> {
    const snapshot = JSON.stringify(stateSchema.parse(state));
    const tempPath = path.resolve(this.#directory, `.state-${randomUUID()}.tmp`);
    const relative = path.relative(this.#directory, tempPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new TypeError("Temporary persistence path escaped its configured directory");
    }
    await writeFile(tempPath, `${snapshot}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, this.#statePath);
  }
}

export class PostgresStateStore extends MemoryStateStore {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    super();
    const parsed = new URL(connectionString);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new TypeError("DATABASE_URL must use postgres:// or postgresql://");
    }
    this.#pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  override async initialize(): Promise<void> {
    const schema = await this.#pool.query<{
      jobs: string | null;
      traces: string | null;
      queue: string | null;
      outbox: string | null;
      quota: string | null;
    }>(`
      SELECT
        to_regclass('actionproof_jobs')::text AS jobs,
        to_regclass('actionproof_traces')::text AS traces,
        to_regclass('actionproof_job_queue')::text AS queue,
        to_regclass('actionproof_webhook_outbox')::text AS outbox,
        to_regclass('actionproof_tenant_quota')::text AS quota
    `);
    const tables = schema.rows[0];
    if (!tables || Object.values(tables).some((table) => !table)) {
      throw new Error("PostgreSQL schema is missing; run pnpm db:migrate before starting the API");
    }
    const [jobs, traces] = await Promise.all([
      this.#pool.query<{ document: unknown }>("SELECT document FROM actionproof_jobs"),
      this.#pool.query<{ document: unknown }>(
        "SELECT document FROM actionproof_traces ORDER BY created_at DESC",
      ),
    ]);
    this.state = {
      version: 1,
      jobs: jobs.rows.map((row) => jobSchema.parse(row.document) as StoredJob),
      traces: traces.rows.map((row) => traceSchema.parse(row.document) as ActionTrace),
    };
    await this.#pool.query(`
      INSERT INTO actionproof_job_queue (job_id)
      SELECT id FROM actionproof_jobs
      WHERE document->>'status' NOT IN ('completed', 'failed')
      ON CONFLICT (job_id) DO NOTHING
    `);
  }

  override async close(): Promise<void> {
    await this.#pool.end();
  }

  override async putJob(job: StoredJob): Promise<void> {
    const parsed = copy(jobSchema.parse(job) as StoredJob);
    await this.#pool.query(
      `INSERT INTO actionproof_jobs (id, document, updated_at)
       VALUES ($1, $2::jsonb, $3::timestamptz)
       ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = EXCLUDED.updated_at`,
      [parsed.id, JSON.stringify(parsed), parsed.updatedAt],
    );
    await super.putJob(parsed);
  }

  override async finalizeJob(
    job: StoredJob,
    webhook?: Omit<WebhookOutboxItem, "attempts">,
  ): Promise<void> {
    const parsed = copy(jobSchema.parse(job) as StoredJob);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO actionproof_jobs (id, document, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = EXCLUDED.updated_at`,
        [parsed.id, JSON.stringify(parsed), parsed.updatedAt],
      );
      if (webhook) {
        await client.query(
          `INSERT INTO actionproof_webhook_outbox (id, tenant_id, job_id, event, created_at)
           VALUES ($1, $2, $3, $4, $5::timestamptz)
           ON CONFLICT (id) DO NOTHING`,
          [webhook.id, webhook.tenantId, webhook.jobId, webhook.event, webhook.createdAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const index = this.state.jobs.findIndex((entry) => entry.id === parsed.id);
    if (index < 0) this.state.jobs.push(parsed);
    else this.state.jobs[index] = parsed;
  }

  override async putTrace(trace: ActionTrace): Promise<void> {
    const parsed = copy(traceSchema.parse(trace) as ActionTrace);
    await this.#pool.query(
      `INSERT INTO actionproof_traces (id, action_hash, root_hash, document, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         action_hash = EXCLUDED.action_hash,
         root_hash = EXCLUDED.root_hash,
         document = EXCLUDED.document,
         created_at = EXCLUDED.created_at`,
      [
        parsed.id,
        parsed.actionHash.toLowerCase(),
        parsed.storage.rootHash.toLowerCase(),
        JSON.stringify(parsed),
        parsed.createdAt,
      ],
    );
    await super.putTrace(parsed);
  }

  override async getJob(id: string): Promise<StoredJob | undefined> {
    assertSafeId(id);
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_jobs WHERE id = $1",
      [id],
    );
    const document = result.rows[0]?.document;
    return document === undefined ? undefined : (jobSchema.parse(document) as StoredJob);
  }

  override async listJobs(): Promise<StoredJob[]> {
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_jobs ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => jobSchema.parse(row.document) as StoredJob);
  }

  override async getTrace(id: string): Promise<ActionTrace | undefined> {
    assertSafeId(id);
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_traces WHERE id = $1",
      [id],
    );
    const document = result.rows[0]?.document;
    return document === undefined ? undefined : (traceSchema.parse(document) as ActionTrace);
  }

  override async listTraces(): Promise<ActionTrace[]> {
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_traces ORDER BY created_at DESC",
    );
    return result.rows.map((row) => traceSchema.parse(row.document) as ActionTrace);
  }

  override async findTraceByActionHash(actionHash: string): Promise<ActionTrace | undefined> {
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_traces WHERE action_hash = $1",
      [actionHash.toLowerCase()],
    );
    const document = result.rows[0]?.document;
    return document === undefined ? undefined : (traceSchema.parse(document) as ActionTrace);
  }

  override async findTraceByRoot(rootHash: string): Promise<ActionTrace | undefined> {
    const result = await this.#pool.query<{ document: unknown }>(
      "SELECT document FROM actionproof_traces WHERE root_hash = $1",
      [rootHash.toLowerCase()],
    );
    const document = result.rows[0]?.document;
    return document === undefined ? undefined : (traceSchema.parse(document) as ActionTrace);
  }

  override async enqueueJob(id: string): Promise<void> {
    assertSafeId(id);
    await this.#pool.query(
      "INSERT INTO actionproof_job_queue (job_id) VALUES ($1) ON CONFLICT (job_id) DO NOTHING",
      [id],
    );
  }

  override async claimNextJob(workerId: string, leaseMs: number): Promise<string | undefined> {
    const result = await this.#pool.query<{ job_id: string }>(
      `WITH candidate AS (
         SELECT job_id FROM actionproof_job_queue
         WHERE available_at <= now()
           AND (lease_until IS NULL OR lease_until <= now())
           AND attempts < 8
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE actionproof_job_queue queue
       SET lease_owner = $1,
           lease_until = now() + ($2::text || ' milliseconds')::interval,
           attempts = attempts + 1
       FROM candidate
       WHERE queue.job_id = candidate.job_id
       RETURNING queue.job_id`,
      [workerId, leaseMs],
    );
    return result.rows[0]?.job_id;
  }

  override async acknowledgeJob(id: string, workerId: string): Promise<void> {
    await this.#pool.query(
      "DELETE FROM actionproof_job_queue WHERE job_id = $1 AND lease_owner = $2",
      [id, workerId],
    );
  }

  override async renewJobLease(id: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE actionproof_job_queue
       SET lease_until = now() + ($3::text || ' milliseconds')::interval
       WHERE job_id = $1 AND lease_owner = $2`,
      [id, workerId, leaseMs],
    );
    return result.rowCount === 1;
  }

  override async queueStats(): Promise<QueueStats> {
    const result = await this.#pool.query<QueueStats>(`
      SELECT
        count(*) FILTER (WHERE attempts < 8 AND (lease_until IS NULL OR lease_until <= now()))::int AS pending,
        count(*) FILTER (WHERE lease_until > now())::int AS leased,
        count(*) FILTER (WHERE attempts >= 8)::int AS exhausted
      FROM actionproof_job_queue
    `);
    return result.rows[0] ?? { pending: 0, leased: 0, exhausted: 0 };
  }

  override async enqueueWebhook(item: Omit<WebhookOutboxItem, "attempts">): Promise<void> {
    await this.#pool.query(
      `INSERT INTO actionproof_webhook_outbox (id, tenant_id, job_id, event, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [item.id, item.tenantId, item.jobId, item.event, item.createdAt],
    );
  }

  override async claimNextWebhook(
    workerId: string,
    leaseMs: number,
  ): Promise<WebhookOutboxItem | undefined> {
    const result = await this.#pool.query<{
      id: string;
      tenant_id: string;
      job_id: string;
      event: WebhookOutboxItem["event"];
      created_at: Date;
      attempts: number;
    }>(
      `WITH candidate AS (
         SELECT id FROM actionproof_webhook_outbox
         WHERE available_at <= now()
           AND (lease_until IS NULL OR lease_until <= now())
           AND attempts < 8
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE actionproof_webhook_outbox outbox
       SET lease_owner = $1,
           lease_until = now() + ($2::text || ' milliseconds')::interval,
           attempts = attempts + 1
       FROM candidate
       WHERE outbox.id = candidate.id
       RETURNING outbox.id, outbox.tenant_id, outbox.job_id, outbox.event,
                 outbox.created_at, outbox.attempts`,
      [workerId, leaseMs],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          jobId: row.job_id,
          event: row.event,
          createdAt: row.created_at.toISOString(),
          attempts: row.attempts,
        }
      : undefined;
  }

  override async acknowledgeWebhook(id: string, workerId: string): Promise<void> {
    await this.#pool.query(
      "DELETE FROM actionproof_webhook_outbox WHERE id = $1 AND lease_owner = $2",
      [id, workerId],
    );
  }

  override async rescheduleWebhook(id: string, workerId: string, delayMs: number): Promise<void> {
    await this.#pool.query(
      `UPDATE actionproof_webhook_outbox
       SET lease_owner = NULL,
           lease_until = NULL,
           available_at = now() + ($3::text || ' milliseconds')::interval
       WHERE id = $1 AND lease_owner = $2`,
      [id, workerId, delayMs],
    );
  }

  override async webhookStats(): Promise<QueueStats> {
    const result = await this.#pool.query<QueueStats>(`
      SELECT
        count(*) FILTER (WHERE attempts < 8 AND available_at <= now()
          AND (lease_until IS NULL OR lease_until <= now()))::int AS pending,
        count(*) FILTER (WHERE lease_until > now())::int AS leased,
        count(*) FILTER (WHERE attempts >= 8)::int AS exhausted
      FROM actionproof_webhook_outbox
    `);
    return result.rows[0] ?? { pending: 0, leased: 0, exhausted: 0 };
  }

  override async consumeTenantQuota(
    tenantId: string,
    limit: number,
    nowMs: number,
  ): Promise<boolean> {
    const result = await this.#pool.query<{ allowed: boolean }>(
      `WITH quota AS (
         INSERT INTO actionproof_tenant_quota (tenant_id, window_start, count)
         VALUES ($1, date_trunc('minute', to_timestamp($3::double precision / 1000.0)), 1)
         ON CONFLICT (tenant_id) DO UPDATE SET
           window_start = CASE
             WHEN actionproof_tenant_quota.window_start < EXCLUDED.window_start
             THEN EXCLUDED.window_start ELSE actionproof_tenant_quota.window_start END,
           count = CASE
             WHEN actionproof_tenant_quota.window_start < EXCLUDED.window_start
             THEN 1 ELSE actionproof_tenant_quota.count + 1 END
         RETURNING count
       )
       SELECT count <= $2 AS allowed FROM quota`,
      [tenantId, limit, nowMs],
    );
    return result.rows[0]?.allowed ?? false;
  }
}

export function assertSafeId(id: string): void {
  if (!idSchema.safeParse(id).success) {
    throw new ApiError(400, "INVALID_ID", "Resource ID must be a UUID");
  }
}
