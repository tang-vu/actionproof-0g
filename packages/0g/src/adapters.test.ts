import {
  createAttestation,
  hashActionRequest,
  hashCanonical,
  type ActionRequest,
  type CanonicalValue,
  type Finding,
  type ModelRiskAssessment,
  type RiskReport,
  type SimulationResult,
} from "@actionproof/core";
import { getAddress, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { ZgComputeRouterAdapter, type RouterCompletionTransport } from "./compute.js";
import { ERC8004_IDENTITY_REGISTRIES, Erc8004IdentityResolver } from "./agentic-id.js";
import { ZgChainAdapter } from "./chain.js";
import { actionProofGuardAbi } from "./guard-abi.js";
import { probePublicNetwork, type PublicProbeDependencies } from "./readiness.js";
import { SandboxChainAdapter, SandboxComputeAdapter, SandboxStorageAdapter } from "./sandbox.js";
import {
  ZgStorageAdapter,
  calculateZgMerkleRoot,
  type StorageNetworkTransport,
} from "./storage.js";

const fixedDate = new Date("2026-08-13T00:00:00.000Z");
const fixedClock = () => new Date(fixedDate);
const now = Math.floor(fixedDate.getTime() / 1_000);

const agent = getAddress("0x1000000000000000000000000000000000000001");
const requester = getAddress("0x2000000000000000000000000000000000000002");
const target = getAddress("0x3000000000000000000000000000000000000003");

const action: ActionRequest = {
  version: "1",
  agent,
  requester,
  target,
  value: "0",
  calldata: "0x12345678",
  intent: "Increment the deterministic demo counter",
  destinationChainId: 16602,
  nonce: "0",
  issuedAt: now - 10,
  expiresAt: now + 600,
};

const simulation: SimulationResult = {
  success: true,
  networkChainId: 16602,
  targetHasCode: true,
  targetVerification: "verified",
  gasEstimate: "45000",
  returnData: "0x",
  effects: [{ kind: "state-change", summary: "Counter increments", unexpected: false }],
  observedAt: fixedDate.toISOString(),
};

const deterministicFindings: Finding[] = [];

const assessment: ModelRiskAssessment = {
  verdict: "allow",
  riskScore: 8,
  confidence: 0.91,
  modelFindings: [],
  evidence: ["Valueless call"],
  reasons: ["No material asset movement"],
  recommendedAction: "Allow under the configured policy.",
  limitations: ["Model output is advisory."],
};

function riskReport(): RiskReport {
  return {
    schemaVersion: "1.0",
    actionHash: hashActionRequest(action),
    action,
    verdict: "allow",
    riskScore: assessment.riskScore,
    confidence: assessment.confidence,
    deterministicFindings,
    simulation,
    modelAssessment: assessment,
    compute: {
      service: "0G Compute",
      mode: "sandbox",
      model: "sandbox/deterministic-risk-model",
      provider: "sandbox/in-memory",
      generatedAt: fixedDate.toISOString(),
    },
    finalPolicy: {
      version: "actionproof-policy/1",
      blockingRuleIds: [],
      reasons: assessment.reasons,
    },
    generatedAt: fixedDate.toISOString(),
  };
}

const assessmentInput = {
  action,
  simulation,
  deterministicFindings,
  policyVersion: "actionproof-policy/1",
};

class CapturingComputeTransport implements RouterCompletionTransport {
  request: Parameters<RouterCompletionTransport["create"]>[0] | undefined;
  response: unknown;

  constructor(response: unknown) {
    this.response = response;
  }

  async create(
    request: Parameters<RouterCompletionTransport["create"]>[0],
    _signal: AbortSignal,
  ): Promise<unknown> {
    this.request = request;
    return this.response;
  }
}

describe("0G Compute Router", () => {
  it("forces JSON-object mode, validates the core schema, and extracts trace metadata", async () => {
    const transport = new CapturingComputeTransport({
      choices: [{ message: { content: JSON.stringify(assessment) } }],
      x_0g_trace: {
        request_id: "req-test",
        provider: "0xprovider",
        billing: { total_cost: "42" },
      },
    });
    const adapter = new ZgComputeRouterAdapter({
      apiKey: "sk-test-only",
      baseURL: "https://router.invalid/v1",
      model: "test-model",
      clock: fixedClock,
      transport,
    });

    const result = await adapter.assess(assessmentInput);

    expect(transport.request?.response_format).toEqual({ type: "json_object" });
    expect(transport.request?.temperature).toBe(0);
    expect(result.assessment).toEqual(assessment);
    expect(result.compute).toMatchObject({
      mode: "router",
      provider: "0xprovider",
      requestId: "req-test",
      billing: { total_cost: "42" },
    });
  });

  it("fails closed on missing trace metadata or schema-invalid output", async () => {
    const missingTrace = new ZgComputeRouterAdapter({
      apiKey: "sk-test-only",
      baseURL: "https://router.invalid/v1",
      model: "test-model",
      transport: new CapturingComputeTransport({
        choices: [{ message: { content: JSON.stringify(assessment) } }],
      }),
    });
    await expect(missingTrace.assess(assessmentInput)).rejects.toThrow("x_0g_trace");

    const invalidAssessment = new ZgComputeRouterAdapter({
      apiKey: "sk-test-only",
      baseURL: "https://router.invalid/v1",
      model: "test-model",
      transport: new CapturingComputeTransport({
        choices: [{ message: { content: '{"verdict":"allow"}' } }],
        x_0g_trace: { request_id: "req", provider: "provider", billing: {} },
      }),
    });
    await expect(invalidAssessment.assess(assessmentInput)).rejects.toThrow();

    const extraField = new ZgComputeRouterAdapter({
      apiKey: "sk-test-only",
      baseURL: "https://router.invalid/v1",
      model: "test-model",
      transport: new CapturingComputeTransport({
        choices: [{ message: { content: JSON.stringify({ ...assessment, untrusted: true }) } }],
        x_0g_trace: { request_id: "req", provider: "provider", billing: {} },
      }),
    });
    await expect(extraField.assess(assessmentInput)).rejects.toThrow();
  });

  it("aborts a request at the configured deadline", async () => {
    const neverCompletes: RouterCompletionTransport = {
      create: async (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    };
    const adapter = new ZgComputeRouterAdapter({
      apiKey: "sk-test-only",
      baseURL: "https://router.invalid/v1",
      model: "test-model",
      timeoutMs: 5,
      transport: neverCompletes,
    });
    await expect(adapter.assess(assessmentInput)).rejects.toThrow("timed out");
  });
});

describe("read-only public 0G readiness", () => {
  it("validates chain ID, selected Compute model, and Storage node availability", async () => {
    const dependencies: PublicProbeDependencies = {
      async getChainState() {
        return { chainId: 16602, blockNumber: 123n };
      },
      async getJson() {
        return { data: [{ id: "demo/model", provider_count: 2 }] };
      },
      async selectStorageNodes() {
        return 1;
      },
    };
    const results = await probePublicNetwork(
      {
        chainId: 16602,
        rpcUrl: "https://rpc.invalid",
        computeBaseUrl: "https://compute.invalid/v1/",
        storageIndexerUrl: "https://storage.invalid",
        selectedModel: "demo/model",
      },
      dependencies,
    );

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === "available")).toBe(true);
    expect(results.find((result) => result.id === "chain")?.detail).toContain("block 123");
  });

  it("reports each failed dependency without rejecting the whole probe", async () => {
    const dependencies: PublicProbeDependencies = {
      async getChainState() {
        return { chainId: 1, blockNumber: 123n };
      },
      async getJson() {
        return { data: [{ id: "other/model", provider_count: 1 }] };
      },
      async selectStorageNodes() {
        return 0;
      },
    };
    const results = await probePublicNetwork(
      {
        chainId: 16602,
        rpcUrl: "https://rpc.invalid",
        computeBaseUrl: "https://compute.invalid/v1",
        storageIndexerUrl: "https://storage.invalid",
        selectedModel: "demo/model",
      },
      dependencies,
    );

    expect(results.every((result) => result.status === "unavailable")).toBe(true);
    expect(results.find((result) => result.id === "compute")?.detail).toContain("not listed");
  });
});

describe("ERC-8004 Agentic ID", () => {
  it("binds the official Galileo registry wallet to the exact action agent", async () => {
    const expectedWallet = getAddress("0x4000000000000000000000000000000000000004");
    const resolver = new Erc8004IdentityResolver({
      publicClient: {
        async readContract({ functionName }: { functionName: string }) {
          if (functionName === "ownerOf") return requester;
          if (functionName === "getAgentWallet") return expectedWallet;
          if (functionName === "tokenURI") return "ipfs://actionproof-agent-card";
          throw new Error(`unexpected function ${functionName}`);
        },
      } as never,
      chainId: 16602,
      explorerBaseUrl: "https://chainscan-galileo.0g.ai/",
      clock: fixedClock,
    });

    const identity = await resolver.resolve("7", expectedWallet);
    expect(identity).toMatchObject({
      standard: "ERC-8004",
      agentId: "7",
      registry: ERC8004_IDENTITY_REGISTRIES[16602],
      owner: requester,
      agentWallet: expectedWallet,
      matchesActionAgent: true,
      checkedAt: fixedDate.toISOString(),
    });
    expect(identity.explorerUrl).toContain(identity.registry);
  });
});

class MemoryStorageTransport implements StorageNetworkTransport {
  bytes: Uint8Array | undefined;
  readonly transactionHash = keccak256(toBytes("storage-upload"));

  async upload(file: Parameters<StorageNetworkTransport["upload"]>[0]) {
    const read = await file.readFromFile(0, file.size());
    this.bytes = read.buffer.slice(0, read.bytesRead);
    const rootHash = await calculateZgMerkleRoot(this.bytes);
    return [{ txHash: this.transactionHash, rootHash, txSeq: 1 }, null] as [
      { txHash: string; rootHash: string; txSeq: number },
      null,
    ];
  }

  async downloadToBytes(_rootHash: Hex): Promise<Uint8Array> {
    if (this.bytes === undefined) throw new Error("nothing uploaded");
    return this.bytes.slice();
  }
}

describe("0G Storage", () => {
  it("uploads canonical in-memory bytes and mandates byte plus Merkle verification", async () => {
    const transport = new MemoryStorageTransport();
    const adapter = new ZgStorageAdapter({
      indexerUrl: "https://indexer.invalid",
      rpcUrl: "https://rpc.invalid",
      explorerUrl: "https://storagescan.invalid",
      signer: {} as never,
      clock: fixedClock,
      transport,
    });
    const report = riskReport();
    const uploaded = await adapter.uploadReport(report);
    const retrieved = await adapter.retrieveAndVerify(uploaded.receipt.rootHash, report);

    expect(uploaded.receipt).toMatchObject({
      mode: "0g",
      transactionHash: transport.transactionHash,
      sequence: "1",
      explorerUrl: "https://storagescan.invalid/submission/1",
      size: uploaded.canonicalBytes.byteLength,
    });
    expect(retrieved.report).toEqual(report);
    expect(retrieved.rootHash).toBe(uploaded.receipt.rootHash);
  });

  it("rejects retrieval when a byte is altered", async () => {
    const transport = new MemoryStorageTransport();
    const adapter = new ZgStorageAdapter({
      indexerUrl: "https://indexer.invalid",
      rpcUrl: "https://rpc.invalid",
      signer: {} as never,
      transport,
    });
    const report = riskReport();
    const uploaded = await adapter.uploadReport(report);
    if (transport.bytes === undefined) throw new Error("test upload failed");
    transport.bytes[0] = (transport.bytes[0] ?? 0) ^ 1;
    await expect(adapter.retrieveAndVerify(uploaded.receipt.rootHash, report)).rejects.toThrow(
      "Merkle-root verification",
    );
  });

  it("accepts a deduplicated upload without a new transaction hash", async () => {
    const transport = new MemoryStorageTransport();
    const originalUpload = transport.upload.bind(transport);
    transport.upload = async (file) => {
      const [result] = await originalUpload(file);
      if (!("rootHash" in result)) throw new Error("expected a single-root upload");
      return [{ ...result, txHash: "", txSeq: 42 }, null];
    };
    const adapter = new ZgStorageAdapter({
      indexerUrl: "https://indexer.invalid",
      rpcUrl: "https://rpc.invalid",
      signer: {} as never,
      explorerUrl: "https://storagescan.invalid/",
      transport,
    });

    const uploaded = await adapter.uploadReport(riskReport());
    expect(uploaded.receipt.transactionHash).toBeUndefined();
    expect(uploaded.receipt.sequence).toBe("42");
    expect(uploaded.receipt.explorerUrl).toBe("https://storagescan.invalid/submission/42");
  });

  it("provides an explicitly labeled in-memory sandbox adapter", async () => {
    const adapter = new SandboxStorageAdapter({ clock: fixedClock });
    const report = riskReport();
    const uploaded = await adapter.uploadReport(report);
    const retrieved = await adapter.retrieveAndVerify(uploaded.receipt.rootHash, report);
    expect(uploaded.receipt.mode).toBe("sandbox");
    expect(retrieved.report).toEqual(report);
  });
});

describe("sandbox compute and chain", () => {
  it("returns only the explicitly configured sandbox assessment", async () => {
    const adapter = new SandboxComputeAdapter({ assessment, clock: fixedClock });
    const result = await adapter.assess(assessmentInput);
    expect(result.assessment).toEqual(assessment);
    expect(result.compute.mode).toBe("sandbox");
    expect(result.compute.requestId).toBe(
      hashCanonical(assessmentInput as unknown as CanonicalValue),
    );
  });

  it("anchors, then executes once without consuming the nonce a second time", async () => {
    const adapter = new SandboxChainAdapter({
      chainId: 16602,
      seed: "deterministic-test",
      clock: fixedClock,
    });
    const report = riskReport();
    const attestation = createAttestation({
      action,
      reportRoot: `0x${"11".repeat(32)}` as Hex,
      reportHash: hashCanonical(report as unknown as CanonicalValue),
      verdict: "allow",
    });
    const signature = await adapter.signAttestation(attestation);
    const anchorSubmission = await adapter.anchorAttestation(attestation, signature);
    const executionSubmission = await adapter.executeAttestedAction(
      attestation,
      action.calldata as Hex,
      signature,
    );
    const verification = await adapter.verifyAnchor(attestation, signature);

    expect(anchorSubmission.receipt.mode).toBe("sandbox");
    expect(executionSubmission.receipt.mode).toBe("sandbox");
    expect(verification).toMatchObject({
      anchored: true,
      executed: true,
      matches: true,
      digest: anchorSubmission.digest,
    });
    expect(await adapter.nextNonce(agent, requester)).toBe(1n);
    await expect(adapter.anchorAttestation(attestation, signature)).rejects.toThrow(
      "already anchored",
    );
    await expect(
      adapter.executeAttestedAction(attestation, action.calldata as Hex, signature),
    ).rejects.toThrow("already executed");
  });

  it("anchors review verdicts but refuses to execute them", async () => {
    const adapter = new SandboxChainAdapter({
      chainId: 16602,
      seed: "review-test",
      clock: fixedClock,
    });
    const report = riskReport();
    const review = createAttestation({
      action,
      reportRoot: `0x${"22".repeat(32)}` as Hex,
      reportHash: hashCanonical(report as unknown as CanonicalValue),
      verdict: "review",
    });
    const signature = await adapter.signAttestation(review);
    await adapter.anchorAttestation(review, signature);

    expect(await adapter.verifyAnchor(review, signature)).toMatchObject({
      anchored: true,
      executed: false,
      matches: true,
    });
    await expect(
      adapter.executeAttestedAction(review, action.calldata as Hex, signature),
    ).rejects.toThrow("allow verdict");
    expect(await adapter.nextNonce(agent, requester)).toBe(1n);
  });

  it("requires execution to reference an existing anchor", async () => {
    const adapter = new SandboxChainAdapter({
      chainId: 16602,
      seed: "unanchored-test",
      clock: fixedClock,
    });
    const report = riskReport();
    const attestation = createAttestation({
      action,
      reportRoot: `0x${"33".repeat(32)}` as Hex,
      reportHash: hashCanonical(report as unknown as CanonicalValue),
      verdict: "allow",
    });
    const signature = await adapter.signAttestation(attestation);
    await expect(
      adapter.executeAttestedAction(attestation, action.calldata as Hex, signature),
    ).rejects.toThrow("not anchored");
  });

  it("labels deterministic sandbox effects for the demo increment and ERC-20 approval", async () => {
    const adapter = new SandboxChainAdapter({ chainId: 16602, seed: "effects" });
    const incremented = await adapter.simulateAction({ ...action, calldata: "0xd09de08a" });
    expect(incremented.effects).toEqual([
      expect.objectContaining({ kind: "state-change", unexpected: false }),
    ]);

    const approvalCalldata = `0x095ea7b3${requester.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}`;
    const approved = await adapter.simulateAction({ ...action, calldata: approvalCalldata });
    expect(approved.effects).toEqual([
      expect.objectContaining({ kind: "approval", to: requester, amount: "1" }),
    ]);
  });

  it("exposes the required guard methods in the production ABI", () => {
    const names = actionProofGuardAbi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "anchorAttestation",
        "executeAttestedAction",
        "hashAttestation",
        "anchors",
        "usedAttestations",
        "executedAttestations",
        "nextNonce",
      ]),
    );
    const anchorGetter = actionProofGuardAbi.find(
      (entry) => entry.type === "function" && entry.name === "anchors",
    );
    expect(anchorGetter?.outputs.map((output) => output.name)).toEqual([
      "agent",
      "requester",
      "verifier",
      "reportRoot",
      "reportHash",
      "verdict",
      "anchoredAt",
    ]);
  });
});

describe("production chain adapter wiring", () => {
  it("simulates downstream calls from the guard and relays anchor then execution", async () => {
    const guardAddress = getAddress("0x4000000000000000000000000000000000000004");
    const relayer = privateKeyToAccount(keccak256(toBytes("test-only-relayer")));
    const verifier = privateKeyToAccount(keccak256(toBytes("test-only-verifier")));
    const rpcRequests: Array<{ method: string; params?: readonly unknown[] }> = [];
    const simulatedFunctions: string[] = [];
    const writtenFunctions: string[] = [];
    let explorerPayload: unknown = {
      status: "1",
      message: "OK",
      result: [{ SourceCode: "contract Verified {}", ABI: "[]" }],
    };
    let transactionIndex = 0;
    const publicClient = {
      getChainId: async () => 16602,
      getBytecode: async () => "0x6000",
      request: async (request: { method: string; params?: readonly unknown[] }) => {
        rpcRequests.push(request);
        return request.method === "eth_estimateGas" ? "0xb0" : "0x";
      },
      simulateContract: async (request: { functionName: string }) => {
        simulatedFunctions.push(request.functionName);
        return { request };
      },
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: BigInt(transactionIndex),
      }),
    };
    const walletClient = {
      writeContract: async (request: { account: { address: string }; functionName: string }) => {
        expect(request.account.address).toBe(relayer.address);
        writtenFunctions.push(request.functionName);
        transactionIndex += 1;
        return keccak256(toBytes(`production-transaction:${transactionIndex}`));
      },
    };
    const adapter = new ZgChainAdapter({
      publicClient: publicClient as never,
      walletClient: walletClient as never,
      relayerAccount: relayer,
      verifierAccount: verifier,
      guardAddress,
      explorerBaseUrl: "https://chainscan.invalid/",
      explorerApiUrl: "https://chainscan.invalid/open/api",
      fetchFn: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.searchParams.get("module")).toBe("contract");
        expect(url.searchParams.get("action")).toBe("getsourcecode");
        expect(url.searchParams.get("address")).toBe(target);
        return new Response(JSON.stringify(explorerPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      clock: fixedClock,
    });

    const simulationResult = await adapter.simulateAction(action);
    expect(simulationResult.gasEstimate).toBe("176");
    expect(simulationResult.targetVerification).toBe("verified");
    expect(rpcRequests[0]?.params?.[0]).toMatchObject({ from: guardAddress });

    explorerPayload = { status: "0", result: "Contract source code not verified" };
    expect((await adapter.simulateAction(action)).targetVerification).toBe("unverified");
    explorerPayload = { status: "0", result: "Max rate limit reached" };
    expect((await adapter.simulateAction(action)).targetVerification).toBe("unknown");
    explorerPayload = { broken: true };
    expect((await adapter.simulateAction(action)).targetVerification).toBe("unknown");

    const report = riskReport();
    const attestation = createAttestation({
      action,
      reportRoot: `0x${"44".repeat(32)}` as Hex,
      reportHash: hashCanonical(report as unknown as CanonicalValue),
      verdict: "allow",
    });
    const signature = await adapter.signAttestation(attestation);
    const anchored = await adapter.anchorAttestation(attestation, signature);
    const executed = await adapter.executeAttestedAction(
      attestation,
      action.calldata as Hex,
      signature,
    );

    expect(simulatedFunctions).toEqual(["anchorAttestation", "executeAttestedAction"]);
    expect(writtenFunctions).toEqual(["anchorAttestation", "executeAttestedAction"]);
    expect(anchored.receipt.explorerUrl).toContain(anchored.receipt.transactionHash);
    expect(executed.receipt.explorerUrl).toContain(executed.receipt.transactionHash);
  });
});
