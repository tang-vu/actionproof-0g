import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  parseAbiParameters,
  slice,
  type Hex,
} from "viem";

import type { ActionRequest } from "./schemas.js";

export interface DecodedArgument {
  name: string;
  type: string;
  value: string;
}

export interface ActionInspection {
  selector: Hex;
  recognized: boolean;
  signature?: string;
  category:
    | "native-transfer"
    | "contract-call"
    | "token-approval"
    | "token-transfer"
    | "nft-approval"
    | "administration"
    | "upgrade"
    | "delegated-call"
    | "unknown";
  summary: string;
  arguments: DecodedArgument[];
  riskSignals: string[];
  decodingError?: string;
}

export const SELECTORS = {
  increment: "0xd09de08a",
  approve: "0x095ea7b3",
  setApprovalForAll: "0xa22cb465",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  transferOwnership: "0xf2fde38b",
  renounceOwnership: "0x715018a6",
  changeAdmin: "0x8f283970",
  upgradeTo: "0x3659cfe6",
  upgradeToAndCall: "0x4f1ef286",
  functionDelegateCall: "0x4bb5274a",
} as const satisfies Record<string, Hex>;

const UINT256_MAX = (1n << 256n) - 1n;

function requireByteLength(calldata: Hex, expected: number): void {
  const actual = (calldata.length - 2) / 2;
  if (actual !== expected) {
    throw new Error(`Expected ${expected} calldata bytes, received ${actual}`);
  }
}

function selectorOf(calldata: Hex): Hex {
  return calldata.length >= 10 ? (slice(calldata, 0, 4) as Hex) : "0x";
}

function argument(name: string, type: string, value: unknown): DecodedArgument {
  const display =
    type === "address" && typeof value === "string"
      ? getAddress(value)
      : typeof value === "bigint"
        ? value.toString()
        : String(value);
  return { name, type, value: display };
}

function malformed(
  selector: Hex,
  signature: string,
  category: ActionInspection["category"],
  error: unknown,
): ActionInspection {
  return {
    selector,
    recognized: true,
    signature,
    category,
    summary: `Recognized ${signature}, but its arguments could not be decoded.`,
    arguments: [],
    riskSignals: ["Malformed known calldata must fail closed."],
    decodingError: error instanceof Error ? error.message : "Unknown ABI decoding error",
  };
}

/**
 * Produces a deterministic, selector-based explanation of an exact action.
 * This is intentionally not presented as full semantic contract analysis.
 */
export function inspectAction(action: ActionRequest): ActionInspection {
  const calldata = action.calldata as Hex;
  const selector = selectorOf(calldata);

  if (calldata === "0x") {
    return {
      selector,
      recognized: false,
      category: "native-transfer",
      summary:
        BigInt(action.value) > 0n
          ? `Send ${action.value} wei and invoke the target's receive or fallback function.`
          : "Invoke the target's receive or fallback function with zero native value.",
      arguments: [],
      riskSignals: [
        ...(BigInt(action.value) > 0n ? ["Native asset movement."] : []),
        "Fallback behavior requires target-specific review.",
      ],
    };
  }

  if (calldata.length < 10) {
    return {
      selector,
      recognized: false,
      category: "unknown",
      summary: "Calldata is shorter than a four-byte function selector.",
      arguments: [],
      riskSignals: ["Malformed or non-standard calldata."],
      decodingError: "Expected at least four selector bytes",
    };
  }

  try {
    if (selector === SELECTORS.increment) {
      if (calldata.length !== 10) {
        return malformed(
          selector,
          "increment()",
          "contract-call",
          new Error("Expected selector-only calldata"),
        );
      }
      return {
        selector,
        recognized: true,
        signature: "increment()",
        category: "contract-call",
        summary: "Call increment() with no arguments.",
        arguments: [],
        riskSignals: [],
      };
    }

    if (selector === SELECTORS.approve) {
      requireByteLength(calldata, 68);
      const [spender, amount] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        slice(calldata, 4),
      );
      return {
        selector,
        recognized: true,
        signature: "approve(address,uint256)",
        category: "token-approval",
        summary: `Set ERC-20 allowance for ${getAddress(spender)} to ${amount}.`,
        arguments: [argument("spender", "address", spender), argument("amount", "uint256", amount)],
        riskSignals:
          amount === UINT256_MAX
            ? ["Unlimited ERC-20 allowance.", "The spender may transfer the full token balance."]
            : ["ERC-20 spending authority changes."],
      };
    }

    if (selector === SELECTORS.setApprovalForAll) {
      requireByteLength(calldata, 68);
      const [operator, approved] = decodeAbiParameters(
        parseAbiParameters("address,bool"),
        slice(calldata, 4),
      );
      return {
        selector,
        recognized: true,
        signature: "setApprovalForAll(address,bool)",
        category: "nft-approval",
        summary: `${approved ? "Grant" : "Revoke"} collection-wide operator access for ${getAddress(operator)}.`,
        arguments: [
          argument("operator", "address", operator),
          argument("approved", "bool", approved),
        ],
        riskSignals: approved
          ? [
              "Collection-wide transfer authority.",
              "All compatible NFTs may be moved by the operator.",
            ]
          : [],
      };
    }

    if (selector === SELECTORS.transfer) {
      requireByteLength(calldata, 68);
      const [recipient, amount] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        slice(calldata, 4),
      );
      return {
        selector,
        recognized: true,
        signature: "transfer(address,uint256)",
        category: "token-transfer",
        summary: `Transfer ${amount} token units to ${getAddress(recipient)}.`,
        arguments: [
          argument("recipient", "address", recipient),
          argument("amount", "uint256", amount),
        ],
        riskSignals: ["ERC-20 asset movement."],
      };
    }

    if (selector === SELECTORS.transferFrom) {
      requireByteLength(calldata, 100);
      const [owner, recipient, amount] = decodeAbiParameters(
        parseAbiParameters("address,address,uint256"),
        slice(calldata, 4),
      );
      return {
        selector,
        recognized: true,
        signature: "transferFrom(address,address,uint256)",
        category: "token-transfer",
        summary: `Move ${amount} token units from ${getAddress(owner)} to ${getAddress(recipient)}.`,
        arguments: [
          argument("owner", "address", owner),
          argument("recipient", "address", recipient),
          argument("amount", "uint256", amount),
        ],
        riskSignals: ["Allowance-backed asset movement."],
      };
    }

    if (selector === SELECTORS.transferOwnership) {
      requireByteLength(calldata, 36);
      const [newOwner] = decodeAbiParameters(parseAbiParameters("address"), slice(calldata, 4));
      return {
        selector,
        recognized: true,
        signature: "transferOwnership(address)",
        category: "administration",
        summary: `Transfer contract ownership to ${getAddress(newOwner)}.`,
        arguments: [argument("newOwner", "address", newOwner)],
        riskSignals: [
          "Administrative authority changes.",
          "Potentially irreversible control transfer.",
        ],
      };
    }

    if (selector === SELECTORS.renounceOwnership) {
      if (calldata.length !== 10) {
        return malformed(
          selector,
          "renounceOwnership()",
          "administration",
          new Error("Expected selector-only calldata"),
        );
      }
      return {
        selector,
        recognized: true,
        signature: "renounceOwnership()",
        category: "administration",
        summary: "Renounce contract ownership.",
        arguments: [],
        riskSignals: ["Administrative authority is permanently removed."],
      };
    }

    if (selector === SELECTORS.changeAdmin || selector === SELECTORS.upgradeTo) {
      requireByteLength(calldata, 36);
      const [nextAddress] = decodeAbiParameters(parseAbiParameters("address"), slice(calldata, 4));
      const isUpgrade = selector === SELECTORS.upgradeTo;
      return {
        selector,
        recognized: true,
        signature: isUpgrade ? "upgradeTo(address)" : "changeAdmin(address)",
        category: isUpgrade ? "upgrade" : "administration",
        summary: isUpgrade
          ? `Change proxy implementation to ${getAddress(nextAddress)}.`
          : `Change proxy administrator to ${getAddress(nextAddress)}.`,
        arguments: [argument(isUpgrade ? "implementation" : "newAdmin", "address", nextAddress)],
        riskSignals: ["Proxy control surface.", "Contract behavior or authority may change."],
      };
    }

    if (selector === SELECTORS.upgradeToAndCall || selector === SELECTORS.functionDelegateCall) {
      const [destination, nestedCalldata] = decodeAbiParameters(
        parseAbiParameters("address,bytes"),
        slice(calldata, 4),
      );
      const canonicalArguments = encodeAbiParameters(parseAbiParameters("address,bytes"), [
        destination,
        nestedCalldata,
      ]);
      if (`${selector}${canonicalArguments.slice(2)}`.toLowerCase() !== calldata.toLowerCase()) {
        throw new Error("Calldata is not the canonical ABI encoding for this function");
      }
      const isUpgrade = selector === SELECTORS.upgradeToAndCall;
      return {
        selector,
        recognized: true,
        signature: isUpgrade
          ? "upgradeToAndCall(address,bytes)"
          : "functionDelegateCall(address,bytes)",
        category: isUpgrade ? "upgrade" : "delegated-call",
        summary: isUpgrade
          ? `Upgrade to ${getAddress(destination)} and run nested calldata.`
          : `Delegate execution to ${getAddress(destination)}.`,
        arguments: [
          argument(isUpgrade ? "implementation" : "target", "address", destination),
          argument("data", "bytes", nestedCalldata),
        ],
        riskSignals: [
          isUpgrade
            ? "Implementation and state may change."
            : "Code executes in the caller's context.",
          "Nested calldata requires separate analysis.",
        ],
      };
    }
  } catch (error) {
    const signatures: Partial<Record<Hex, readonly [string, ActionInspection["category"]]>> = {
      [SELECTORS.approve]: ["approve(address,uint256)", "token-approval"],
      [SELECTORS.setApprovalForAll]: ["setApprovalForAll(address,bool)", "nft-approval"],
      [SELECTORS.transfer]: ["transfer(address,uint256)", "token-transfer"],
      [SELECTORS.transferFrom]: ["transferFrom(address,address,uint256)", "token-transfer"],
      [SELECTORS.transferOwnership]: ["transferOwnership(address)", "administration"],
      [SELECTORS.changeAdmin]: ["changeAdmin(address)", "administration"],
      [SELECTORS.upgradeTo]: ["upgradeTo(address)", "upgrade"],
      [SELECTORS.upgradeToAndCall]: ["upgradeToAndCall(address,bytes)", "upgrade"],
      [SELECTORS.functionDelegateCall]: ["functionDelegateCall(address,bytes)", "delegated-call"],
    };
    const known = signatures[selector];
    if (known) return malformed(selector, known[0], known[1], error);
  }

  return {
    selector,
    recognized: false,
    category: "unknown",
    summary: `Unknown selector ${selector}; no ABI-level meaning is assumed.`,
    arguments: [],
    riskSignals: ["Unknown selectors require protocol-specific review."],
  };
}
