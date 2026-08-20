import { encodeFunctionData, getAddress, maxUint256 } from "viem";
import { describe, expect, it } from "vitest";

import { canonicalize } from "./canonical.js";
import { createAttestation, verdictToCode } from "./eip712.js";
import { hashActionRequest, hashCanonical } from "./hashing.js";
import { inspectAction } from "./inspection.js";
import { decideFinalVerdict, evaluateDeterministicPolicy } from "./policy.js";
import type { ActionRequest, ModelRiskAssessment, SimulationResult } from "./schemas.js";

const requester = getAddress("0x1000000000000000000000000000000000000001");
const target = getAddress("0x2000000000000000000000000000000000000002");
const spender = getAddress("0x3000000000000000000000000000000000000003");

function action(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    version: "1",
    agent: requester,
    requester,
    target,
    value: "0",
    calldata: "0xd09de08a",
    intent: "Increment the valueless demo counter once",
    destinationChainId: 16602,
    nonce: "0",
    issuedAt: 1_700_000_000,
    expiresAt: 1_700_000_600,
    ...overrides,
  };
}

const simulation: SimulationResult = {
  success: true,
  networkChainId: 16602,
  targetHasCode: true,
  targetVerification: "verified",
  gasEstimate: "45000",
  returnData: "0x",
  effects: [{ kind: "state-change", summary: "Demo counter increments", unexpected: false }],
  observedAt: "2026-08-13T00:00:00.000Z",
};

const model: ModelRiskAssessment = {
  verdict: "allow",
  riskScore: 8,
  confidence: 0.91,
  modelFindings: [],
  evidence: ["Valueless demo call"],
  reasons: ["No material asset movement detected"],
  recommendedAction: "Allow under the configured demo policy.",
  limitations: ["Model output is advisory and may be wrong."],
};

describe("canonicalization and hashing", () => {
  it("sorts nested keys deterministically", () => {
    expect(canonicalize({ z: 1, a: { y: true, b: "x" } })).toBe('{"a":{"b":"x","y":true},"z":1}');
  });

  it("changes the request hash when a bound field changes", () => {
    const original = hashActionRequest(action());
    expect(hashActionRequest(action({ target: spender }))).not.toBe(original);
    expect(hashActionRequest(action({ calldata: "0x12345679" }))).not.toBe(original);
    expect(hashActionRequest(action({ intent: "Different intent" }))).not.toBe(original);
    expect(hashActionRequest(action({ nonce: "1" }))).not.toBe(original);
  });

  it("binds both report root and report hash in an attestation", () => {
    const reportHash = hashCanonical({ verdict: "allow" });
    const attestation = createAttestation({
      action: action(),
      reportHash,
      reportRoot: `0x${"11".repeat(32)}`,
      verdict: "allow",
    });
    expect(attestation.reportHash).toBe(reportHash);
    expect(attestation.verdict).toBe(verdictToCode.allow);
  });
});

describe("deterministic policy", () => {
  it("blocks an unlimited approval regardless of model optimism", () => {
    const calldata = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [spender, maxUint256],
    });
    const findings = evaluateDeterministicPolicy(action({ calldata }), simulation, {
      expectedChainId: 16602,
      now: 1_700_000_010,
      maxNativeValueWei: 10n ** 16n,
      deniedSpenders: new Set(),
      duplicate: false,
    });
    expect(findings.map((item) => item.id)).toContain("UNLIMITED_ERC20_APPROVAL");
    expect(decideFinalVerdict(findings, model).verdict).toBe("block");
  });

  it("allows the harmless scenario when every layer agrees", () => {
    const findings = evaluateDeterministicPolicy(action(), simulation, {
      expectedChainId: 16602,
      now: 1_700_000_010,
      maxNativeValueWei: 10n ** 16n,
      deniedSpenders: new Set(),
      duplicate: false,
    });
    expect(findings.filter((item) => item.blocking)).toHaveLength(0);
    expect(decideFinalVerdict(findings, model).verdict).toBe("allow");
  });

  it.each([
    ["expired", { expiresAt: 1_700_000_000 }, "REQUEST_EXPIRED"],
    [
      "not yet valid",
      { issuedAt: 1_700_000_100, expiresAt: 1_700_000_200 },
      "REQUEST_NOT_YET_VALID",
    ],
    ["wrong chain", { destinationChainId: 1 }, "CHAIN_MISMATCH"],
    ["excess value", { value: "10000000000000001" }, "NATIVE_VALUE_LIMIT"],
  ])("blocks %s requests", (_name, override, rule) => {
    const findings = evaluateDeterministicPolicy(action(override), simulation, {
      expectedChainId: 16602,
      now: 1_700_000_001,
      maxNativeValueWei: 10n ** 16n,
      deniedSpenders: new Set(),
      duplicate: false,
    });
    expect(findings.map((item) => item.id)).toContain(rule);
  });

  it("fails closed when simulation fails", () => {
    const findings = evaluateDeterministicPolicy(
      action(),
      { ...simulation, success: false, error: "execution reverted" },
      {
        expectedChainId: 16602,
        now: 1_700_000_010,
        maxNativeValueWei: 10n ** 16n,
        deniedSpenders: new Set(),
        duplicate: false,
      },
    );
    expect(decideFinalVerdict(findings, model).verdict).toBe("block");
  });

  it("loads an ERC-20 policy pack for finite spending authority", () => {
    const calldata = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [spender, 100n],
    });
    const findings = evaluateDeterministicPolicy(action({ calldata }), simulation, {
      expectedChainId: 16602,
      now: 1_700_000_010,
      maxNativeValueWei: 10n ** 16n,
      deniedSpenders: new Set(),
      duplicate: false,
      policyPacks: new Set(["base", "erc20-approvals"]),
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ id: "ERC20_FINITE_APPROVAL_REVIEW", blocking: false }),
    );
    expect(decideFinalVerdict(findings, model).verdict).toBe("review");
  });

  it("blocks a state footprint above the configured account limit", () => {
    const findings = evaluateDeterministicPolicy(
      action(),
      {
        ...simulation,
        stateDiff: {
          status: "available",
          accountsChanged: 9,
          storageSlotsChanged: 12,
          note: "Test-only summarized state diff.",
        },
      },
      {
        expectedChainId: 16602,
        now: 1_700_000_010,
        maxNativeValueWei: 10n ** 16n,
        deniedSpenders: new Set(),
        duplicate: false,
        maxStateDiffAccounts: 8,
      },
    );
    expect(findings.map((item) => item.id)).toContain("STATE_FOOTPRINT_LIMIT");
    expect(decideFinalVerdict(findings, model).verdict).toBe("block");
  });
});

describe("action inspection", () => {
  it("decodes an unlimited approval into human-checkable arguments and risk signals", () => {
    const calldata = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [spender, maxUint256],
    });
    const inspection = inspectAction(action({ calldata }));

    expect(inspection).toMatchObject({
      recognized: true,
      signature: "approve(address,uint256)",
      category: "token-approval",
    });
    expect(inspection.arguments).toEqual([
      { name: "spender", type: "address", value: spender },
      { name: "amount", type: "uint256", value: maxUint256.toString() },
    ]);
    expect(inspection.riskSignals).toContain("Unlimited ERC-20 allowance.");
  });

  it("labels unknown selectors without pretending to understand their semantics", () => {
    expect(inspectAction(action({ calldata: "0x12345678" }))).toMatchObject({
      selector: "0x12345678",
      recognized: false,
      category: "unknown",
    });
  });

  it("rejects trailing bytes on a recognized no-argument call", () => {
    const inspection = inspectAction(action({ calldata: "0xd09de08a00" }));
    expect(inspection).toMatchObject({
      recognized: true,
      signature: "increment()",
      category: "contract-call",
    });
    expect(inspection.decodingError).toContain("selector-only calldata");
  });

  it("requires review for receive and fallback behavior", () => {
    expect(inspectAction(action({ calldata: "0x" }))).toMatchObject({
      recognized: false,
      category: "native-transfer",
    });
  });
});
