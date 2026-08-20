import { describe, expect, it } from "vitest";

import { ActionProofClient } from "./index.js";

const address = "0x1000000000000000000000000000000000000001" as const;

describe("ActionProof SDK", () => {
  it("sends an exact validated envelope with tenant authentication", async () => {
    let request: Request | undefined;
    const client = new ActionProofClient({
      origin: "https://actionproof.example.test",
      apiKey: "tenant-key",
      fetchFn: async (input, init) => {
        request = new Request(input, init);
        return new Response(
          JSON.stringify({
            schemaVersion: "1.0",
            previewOnly: true,
            disposition: "pass",
            findings: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const now = Math.floor(Date.now() / 1_000);
    await client.preflight({
      version: "1",
      agent: address,
      requester: address,
      target: address,
      value: "0",
      calldata: "0xd09de08a",
      intent: "Test an exact SDK envelope",
      destinationChainId: 16602,
      nonce: "0",
      issuedAt: now,
      expiresAt: now + 60,
    });

    expect(request?.headers.get("x-api-key")).toBe("tenant-key");
    expect(await request?.json()).toMatchObject({ action: { calldata: "0xd09de08a" } });
  });
});
