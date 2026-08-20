import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { StateStore } from "./store.js";
import type { StoredJob, WebhookOutboxItem } from "./types.js";

import type { TenantRegistry } from "./tenancy.js";

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (address.startsWith("10.") || address.startsWith("127.") || address.startsWith("192.168."))
    return true;
  const [first, second] = address.split(".").map(Number);
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) return true;
  const lowered = address.toLowerCase();
  return (
    lowered.startsWith("fc") ||
    lowered.startsWith("fd") ||
    lowered.startsWith("fe8") ||
    lowered.startsWith("fe9") ||
    lowered.startsWith("fea") ||
    lowered.startsWith("feb")
  );
}

async function assertPublicDestination(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("Webhook destinations must use HTTPS");
  if (url.username || url.password)
    throw new Error("Webhook destinations cannot contain credentials");
  if (url.hostname === "localhost") throw new Error("Webhook destinations cannot target localhost");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Webhook destination resolved to a private or loopback address");
  }
}

export class WebhookDispatcher {
  readonly #workerId = randomUUID();
  readonly #store: StateStore;
  readonly #tenants: TenantRegistry;
  readonly #timeoutMs: number;
  readonly #leaseMs: number;
  readonly #pollMs: number;
  #timer?: NodeJS.Timeout;
  #drain = Promise.resolve();
  #closed = false;

  constructor(args: {
    store: StateStore;
    tenants: TenantRegistry;
    timeoutMs: number;
    leaseMs: number;
    pollMs: number;
  }) {
    this.#store = args.store;
    this.#tenants = args.tenants;
    this.#timeoutMs = args.timeoutMs;
    this.#leaseMs = args.leaseMs;
    this.#pollMs = args.pollMs;
    this.#timer = setInterval(() => this.#schedule(), this.#pollMs);
    this.#timer.unref();
    this.#schedule();
  }

  eventFor(job: StoredJob): Omit<WebhookOutboxItem, "attempts"> | undefined {
    if (!job.tenantId || !this.#tenants.get(job.tenantId)?.webhookUrl) return undefined;
    return {
      id: randomUUID(),
      tenantId: job.tenantId,
      jobId: job.id,
      event: job.status === "completed" ? "job.completed" : "job.failed",
      createdAt: new Date().toISOString(),
    };
  }

  stats() {
    return this.#store.webhookStats();
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    await this.#drain;
  }

  #schedule(): void {
    if (this.#closed) return;
    this.#drain = this.#drain.then(
      () => this.#drainOutbox(),
      () => this.#drainOutbox(),
    );
  }

  async #drainOutbox(): Promise<void> {
    while (!this.#closed) {
      const item = await this.#store.claimNextWebhook(this.#workerId, this.#leaseMs);
      if (!item) return;
      try {
        await this.#deliver(item);
        await this.#store.acknowledgeWebhook(item.id, this.#workerId);
      } catch {
        const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(item.attempts - 1, 8));
        await this.#store.rescheduleWebhook(item.id, this.#workerId, delayMs);
      }
    }
  }

  async #deliver(item: WebhookOutboxItem): Promise<void> {
    const tenant = this.#tenants.get(item.tenantId);
    if (!tenant?.webhookUrl || !tenant.webhookSecret) {
      throw new Error("Webhook tenant configuration is no longer available");
    }
    const job = await this.#store.getJob(item.jobId);
    if (!job) throw new Error("Webhook job no longer exists");
    const endpoint = new URL(tenant.webhookUrl);
    await assertPublicDestination(endpoint);
    const body = JSON.stringify({
      id: item.id,
      event: item.event,
      createdAt: item.createdAt,
      data: {
        jobId: job.id,
        status: job.status,
        traceId: job.traceId,
        error: job.error,
        updatedAt: job.updatedAt,
      },
    });
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = createHmac("sha256", tenant.webhookSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "ActionProof-Webhooks/1.0",
        "x-actionproof-event": item.event,
        "x-actionproof-delivery": item.id,
        "x-actionproof-timestamp": timestamp,
        "x-actionproof-signature": `sha256=${signature}`,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new Error(`Webhook destination returned HTTP ${response.status}`);
  }
}
