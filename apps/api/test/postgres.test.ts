import { randomUUID } from "node:crypto";

import type { ActionRequest } from "@actionproof/core";
import { describe, expect, it } from "vitest";

import { PostgresStateStore } from "../src/store.js";
import { stageIds, type StoredJob } from "../src/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL control plane", () => {
  it("claims jobs exclusively and commits terminal state with its webhook outbox", async () => {
    const store = new PostgresStateStore(databaseUrl as string);
    try {
      await store.initialize();
      const now = new Date().toISOString();
      const address = "0x1000000000000000000000000000000000000001" as const;
      const action: ActionRequest = {
        version: "1",
        agent: address,
        requester: address,
        target: address,
        value: "0",
        calldata: "0xd09de08a",
        intent: "PostgreSQL lease integration test",
        destinationChainId: 16602,
        nonce: "0",
        issuedAt: Math.floor(Date.now() / 1_000),
        expiresAt: Math.floor(Date.now() / 1_000) + 60,
      };
      const job: StoredJob = {
        id: randomUUID(),
        status: "queued",
        steps: stageIds.map((id) => ({ id, label: id, status: "pending" })),
        action,
        execute: false,
        tenantId: "postgres-test",
        createdAt: now,
        updatedAt: now,
      };
      await store.putJob(job);
      await store.enqueueJob(job.id);

      await expect(store.claimNextJob("worker-a", 30_000)).resolves.toBe(job.id);
      await expect(store.claimNextJob("worker-b", 30_000)).resolves.toBeUndefined();
      await store.renewJobLease(job.id, "worker-a", 30_000);

      job.status = "completed";
      job.updatedAt = new Date().toISOString();
      const deliveryId = randomUUID();
      await store.finalizeJob(job, {
        id: deliveryId,
        tenantId: "postgres-test",
        jobId: job.id,
        event: "job.completed",
        createdAt: job.updatedAt,
      });
      await store.acknowledgeJob(job.id, "worker-a");
      await expect(store.getJob(job.id)).resolves.toMatchObject({ status: "completed" });

      const delivery = await store.claimNextWebhook("webhook-a", 30_000);
      expect(delivery).toMatchObject({ id: deliveryId, jobId: job.id, attempts: 1 });
      await store.acknowledgeWebhook(deliveryId, "webhook-a");
      await expect(store.webhookStats()).resolves.toEqual({ pending: 0, leased: 0, exhausted: 0 });
    } finally {
      await store.close();
    }
  });

  it("enforces one quota across concurrent replicas", async () => {
    const firstReplica = new PostgresStateStore(databaseUrl as string);
    const secondReplica = new PostgresStateStore(databaseUrl as string);
    try {
      await Promise.all([firstReplica.initialize(), secondReplica.initialize()]);
      const tenantId = `quota-${randomUUID()}`;
      const attempts = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          (index % 2 === 0 ? firstReplica : secondReplica).consumeTenantQuota(
            tenantId,
            4,
            Date.now(),
          ),
        ),
      );
      expect(attempts.filter(Boolean)).toHaveLength(4);
    } finally {
      await Promise.all([firstReplica.close(), secondReplica.close()]);
    }
  });
});
