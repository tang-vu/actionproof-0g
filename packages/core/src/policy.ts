import {
  decodeAbiParameters,
  getAddress,
  parseAbiParameters,
  slice,
  type Address,
  type Hex,
} from "viem";

import type {
  ActionRequest,
  Finding,
  ModelRiskAssessment,
  SimulationResult,
  Verdict,
} from "./schemas.js";
import { inspectAction, SELECTORS } from "./inspection.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;

const ADMIN_SELECTORS = new Map<string, string>([
  [SELECTORS.transferOwnership, "transferOwnership(address)"],
  [SELECTORS.renounceOwnership, "renounceOwnership()"],
  [SELECTORS.changeAdmin, "changeAdmin(address)"],
  [SELECTORS.upgradeTo, "upgradeTo(address)"],
  [SELECTORS.upgradeToAndCall, "upgradeToAndCall(address,bytes)"],
  [SELECTORS.functionDelegateCall, "functionDelegateCall(address,bytes)"],
]);

export interface PolicyContext {
  expectedChainId: number;
  now: number;
  maxNativeValueWei: bigint;
  deniedSpenders: ReadonlySet<string>;
  allowedTargets?: ReadonlySet<string>;
  duplicate: boolean;
  targetBytecode?: Hex;
}

function finding(
  id: string,
  severity: Finding["severity"],
  title: string,
  description: string,
  evidence: string[],
  blocking: boolean,
): Finding {
  return { id, severity, category: "deterministic", title, description, evidence, blocking };
}

function selectorOf(calldata: Hex): Hex {
  return calldata.length >= 10 ? (slice(calldata, 0, 4) as Hex) : "0x";
}

function normalized(address: string): string {
  return address.toLowerCase();
}

export function evaluateDeterministicPolicy(
  action: ActionRequest,
  simulation: SimulationResult,
  context: PolicyContext,
): Finding[] {
  const findings: Finding[] = [];
  const actionCalldata = action.calldata as Hex;
  const selector = selectorOf(actionCalldata);
  const inspection = inspectAction(action);

  if (inspection.decodingError) {
    findings.push(
      finding(
        "MALFORMED_CALLDATA",
        "critical",
        "Malformed transaction calldata",
        "The exact calldata is too short or cannot be decoded for its recognized selector.",
        [inspection.decodingError],
        true,
      ),
    );
  } else if (!inspection.recognized) {
    findings.push(
      finding(
        "UNKNOWN_SELECTOR",
        "high",
        "Unknown function selector",
        "No built-in ABI decoder recognizes this selector. Protocol-specific review is required.",
        [`selector=${inspection.selector}`],
        false,
      ),
    );
  }

  if (action.destinationChainId !== context.expectedChainId) {
    findings.push(
      finding(
        "CHAIN_MISMATCH",
        "critical",
        "Destination chain mismatch",
        "The signed destination chain differs from the connected simulation chain.",
        [`requested=${action.destinationChainId}`, `observed=${context.expectedChainId}`],
        true,
      ),
    );
  }

  if (action.expiresAt <= context.now) {
    findings.push(
      finding(
        "REQUEST_EXPIRED",
        "critical",
        "Action request expired",
        "Expired requests are never eligible for attestation or execution.",
        [`expiresAt=${action.expiresAt}`, `now=${context.now}`],
        true,
      ),
    );
  }

  if (action.issuedAt > context.now) {
    findings.push(
      finding(
        "REQUEST_NOT_YET_VALID",
        "critical",
        "Action request is not yet valid",
        "Future-issued requests cannot be anchored before their signed validity window.",
        [`issuedAt=${action.issuedAt}`, `now=${context.now}`],
        true,
      ),
    );
  }

  if (context.duplicate) {
    findings.push(
      finding(
        "DUPLICATE_REQUEST",
        "critical",
        "Nonce or action already observed",
        "Reusing an action request can indicate replay.",
        [`requester=${action.requester}`, `nonce=${action.nonce}`],
        true,
      ),
    );
  }

  if (BigInt(action.value) > context.maxNativeValueWei) {
    findings.push(
      finding(
        "NATIVE_VALUE_LIMIT",
        "critical",
        "Native value exceeds policy limit",
        "The proposed native-token value is greater than the configured ceiling.",
        [`value=${action.value}`, `limit=${context.maxNativeValueWei}`],
        true,
      ),
    );
  }

  if (normalized(action.target) === ZERO_ADDRESS) {
    findings.push(
      finding(
        "ZERO_TARGET",
        "critical",
        "Zero-address target",
        "A contract call cannot be safely directed to the zero address.",
        [action.target],
        true,
      ),
    );
  }

  if (context.allowedTargets && !context.allowedTargets.has(normalized(action.target))) {
    findings.push(
      finding(
        "TARGET_NOT_ALLOWLISTED",
        "high",
        "Target is outside the allowlist",
        "The configured deployment restricts autonomous calls to known demo targets.",
        [action.target],
        true,
      ),
    );
  }

  if (!simulation.targetHasCode) {
    findings.push(
      finding(
        "TARGET_WITHOUT_CODE",
        "critical",
        "Target has no contract bytecode",
        "The target was expected to be a contract but the simulation RPC returned empty code.",
        [action.target],
        true,
      ),
    );
  } else if (simulation.targetVerification === "unverified") {
    findings.push(
      finding(
        "UNVERIFIED_BYTECODE",
        "medium",
        "Target source is unverified",
        "Explorer verification was not found. This is a provenance warning, not full analysis.",
        [action.target],
        false,
      ),
    );
  } else if (simulation.targetVerification === "unknown") {
    findings.push(
      finding(
        "SOURCE_VERIFICATION_UNKNOWN",
        "low",
        "Target source verification is unknown",
        "The RPC simulation proved bytecode exists, but explorer source provenance was not established.",
        [action.target],
        false,
      ),
    );
  }

  if (!simulation.success) {
    findings.push(
      finding(
        "SIMULATION_FAILED",
        "critical",
        "Preflight simulation failed",
        "Malformed or reverting actions fail closed.",
        [simulation.error ?? "RPC returned an unsuccessful simulation"],
        true,
      ),
    );
  }

  if (context.targetBytecode?.toLowerCase().includes("f4")) {
    findings.push(
      finding(
        "DELEGATECALL_OPCODE_HEURISTIC",
        "medium",
        "Target bytecode contains DELEGATECALL opcode bytes",
        "Byte-pattern scanning is heuristic and may include PUSH data; it does not prove reachability.",
        ["opcode=0xf4"],
        false,
      ),
    );
  }

  const adminFunction = ADMIN_SELECTORS.get(selector.toLowerCase());
  if (adminFunction) {
    findings.push(
      finding(
        "DANGEROUS_ADMIN_SELECTOR",
        "critical",
        "Dangerous administrative function",
        "Ownership, proxy, admin, or delegated calls are outside the autonomous demo policy.",
        [`selector=${selector}`, `signature=${adminFunction}`],
        true,
      ),
    );
  }

  try {
    if (selector === SELECTORS.approve && action.calldata.length >= 138) {
      const [spender, amount] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        slice(actionCalldata, 4),
      );
      if (amount === UINT256_MAX) {
        findings.push(
          finding(
            "UNLIMITED_ERC20_APPROVAL",
            "critical",
            "Unlimited ERC-20 approval",
            "The spender would receive the maximum possible token allowance.",
            [`spender=${spender}`, `amount=${amount}`],
            true,
          ),
        );
      }
      if (context.deniedSpenders.has(normalized(spender))) {
        findings.push(
          finding(
            "DENIED_APPROVAL_SPENDER",
            "critical",
            "Approval to denied spender",
            "The decoded spender is explicitly denied by policy.",
            [`spender=${spender}`],
            true,
          ),
        );
      }
    }

    if (selector === SELECTORS.setApprovalForAll && action.calldata.length >= 138) {
      const [operator, approved] = decodeAbiParameters(
        parseAbiParameters("address,bool"),
        slice(actionCalldata, 4),
      );
      if (approved) {
        findings.push(
          finding(
            "NFT_APPROVAL_FOR_ALL",
            "critical",
            "Collection-wide operator approval",
            "The operator would be able to transfer every compatible asset owned by the caller.",
            [`operator=${operator}`],
            true,
          ),
        );
      }
    }

    if (selector === SELECTORS.transfer && action.calldata.length >= 138) {
      const [recipient] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        slice(actionCalldata, 4),
      );
      if (normalized(recipient) === ZERO_ADDRESS) {
        findings.push(
          finding(
            "ZERO_RECIPIENT",
            "critical",
            "Token transfer to zero address",
            "The decoded transfer recipient is the zero address.",
            [getAddress(recipient)],
            true,
          ),
        );
      }
    }
  } catch (error) {
    findings.push(
      finding(
        "MALFORMED_KNOWN_CALLDATA",
        "critical",
        "Malformed recognized calldata",
        "A recognized function selector could not be decoded using its standard ABI.",
        [error instanceof Error ? error.message : "Unknown ABI decoding error"],
        true,
      ),
    );
  }

  for (const effect of simulation.effects.filter((item) => item.unexpected)) {
    findings.push(
      finding(
        "UNEXPECTED_SIMULATED_EFFECT",
        "high",
        "Unexpected simulated effect",
        "The simulator observed an effect that was not explained by the declared intent.",
        [effect.summary],
        true,
      ),
    );
  }

  return findings;
}

export interface FinalDecision {
  verdict: Verdict;
  riskScore: number;
  confidence: number;
  blockingRuleIds: string[];
  reasons: string[];
}

/** Deterministic blocks always win. Model output can make a decision stricter, never looser. */
export function decideFinalVerdict(
  deterministic: Finding[],
  model: ModelRiskAssessment,
): FinalDecision {
  const blockers = deterministic.filter((item) => item.blocking);
  const deterministicFloor = deterministic.reduce((score, item) => {
    const weight = { info: 0, low: 10, medium: 35, high: 70, critical: 100 }[item.severity];
    return Math.max(score, weight);
  }, 0);
  const riskScore = Math.max(deterministicFloor, model.riskScore);

  if (blockers.length > 0) {
    return {
      verdict: "block",
      riskScore,
      confidence: model.confidence,
      blockingRuleIds: blockers.map((item) => item.id),
      reasons: blockers.map((item) => item.title),
    };
  }

  if (model.verdict === "block" || riskScore >= 75) {
    return {
      verdict: "block",
      riskScore,
      confidence: model.confidence,
      blockingRuleIds: ["MODEL_BLOCK_THRESHOLD"],
      reasons: model.reasons,
    };
  }

  if (model.verdict === "review" || riskScore >= 45) {
    return {
      verdict: "review",
      riskScore,
      confidence: model.confidence,
      blockingRuleIds: [],
      reasons: model.reasons,
    };
  }

  return {
    verdict: "allow",
    riskScore,
    confidence: model.confidence,
    blockingRuleIds: [],
    reasons: model.reasons,
  };
}

export function normalizedAddressSet(values: readonly Address[]): ReadonlySet<string> {
  return new Set(values.map((value) => normalized(value)));
}
