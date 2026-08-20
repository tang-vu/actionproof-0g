import { createHash, timingSafeEqual } from "node:crypto";

import type { TenantConfig } from "./config.js";
import { ApiError } from "./errors.js";
import type { StateStore } from "./store.js";

export class TenantRegistry {
  readonly #tenants: ReadonlyMap<string, TenantConfig>;
  readonly #store: StateStore;

  constructor(tenants: readonly TenantConfig[], store: StateStore) {
    this.#tenants = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    this.#store = store;
  }

  get size(): number {
    return this.#tenants.size;
  }

  get(id: string): TenantConfig | undefined {
    return this.#tenants.get(id);
  }

  async authenticate(apiKey: string | undefined): Promise<TenantConfig | undefined> {
    if (!apiKey) return undefined;
    const supplied = createHash("sha256").update(apiKey).digest();
    let matched: TenantConfig | undefined;
    for (const tenant of this.#tenants.values()) {
      const expected = Buffer.from(tenant.apiKeySha256, "hex");
      if (expected.length === supplied.length && timingSafeEqual(supplied, expected))
        matched = tenant;
    }
    if (!matched) {
      throw new ApiError(401, "TENANT_AUTH_REQUIRED", "The supplied tenant API key is invalid");
    }
    if (
      !(await this.#store.consumeTenantQuota(matched.id, matched.requestsPerMinute, Date.now()))
    ) {
      throw new ApiError(
        429,
        "TENANT_QUOTA_EXCEEDED",
        `Tenant ${matched.id} exceeded its ${matched.requestsPerMinute} requests/minute quota`,
        true,
      );
    }
    return matched;
  }
}
