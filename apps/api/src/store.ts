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

import { ApiError } from "./errors.js";
import { stageIds, type ActionTrace, type PersistedState, type StoredJob } from "./types.js";

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
  putJob(job: StoredJob): Promise<void>;
  getJob(id: string): StoredJob | undefined;
  listJobs(): StoredJob[];
  putTrace(trace: ActionTrace): Promise<void>;
  getTrace(id: string): ActionTrace | undefined;
  listTraces(): ActionTrace[];
  findTraceByActionHash(actionHash: string): ActionTrace | undefined;
  findTraceByRoot(rootHash: string): ActionTrace | undefined;
}

function initialState(): PersistedState {
  return { version: 1, jobs: [], traces: [] };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStateStore implements StateStore {
  protected state: PersistedState = initialState();

  async initialize(): Promise<void> {}

  async putJob(job: StoredJob): Promise<void> {
    const parsed = jobSchema.parse(job) as StoredJob;
    const index = this.state.jobs.findIndex((entry) => entry.id === parsed.id);
    if (index < 0) this.state.jobs.push(copy(parsed));
    else this.state.jobs[index] = copy(parsed);
  }

  getJob(id: string): StoredJob | undefined {
    assertSafeId(id);
    const job = this.state.jobs.find((entry) => entry.id === id);
    return job ? copy(job) : undefined;
  }

  listJobs(): StoredJob[] {
    return copy(this.state.jobs);
  }

  async putTrace(trace: ActionTrace): Promise<void> {
    const parsed = traceSchema.parse(trace) as ActionTrace;
    const index = this.state.traces.findIndex((entry) => entry.id === parsed.id);
    if (index < 0) this.state.traces.push(copy(parsed));
    else this.state.traces[index] = copy(parsed);
  }

  getTrace(id: string): ActionTrace | undefined {
    assertSafeId(id);
    const trace = this.state.traces.find((entry) => entry.id === id);
    return trace ? copy(trace) : undefined;
  }

  listTraces(): ActionTrace[] {
    return copy(
      [...this.state.traces].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
  }

  findTraceByActionHash(actionHash: string): ActionTrace | undefined {
    const trace = this.state.traces.find(
      (entry) => entry.actionHash.toLowerCase() === actionHash.toLowerCase(),
    );
    return trace ? copy(trace) : undefined;
  }

  findTraceByRoot(rootHash: string): ActionTrace | undefined {
    const trace = this.state.traces.find(
      (entry) => entry.storage.rootHash.toLowerCase() === rootHash.toLowerCase(),
    );
    return trace ? copy(trace) : undefined;
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

export function assertSafeId(id: string): void {
  if (!idSchema.safeParse(id).success) {
    throw new ApiError(400, "INVALID_ID", "Resource ID must be a UUID");
  }
}
