import type { ActionInspection } from "./inspection.js";
import type { ActionRequest, Finding } from "./schemas.js";

export const POLICY_PACK_IDS = [
  "base",
  "erc20-approvals",
  "asset-movement",
  "nft-operators",
  "contract-administration",
  "proxy-upgrades",
] as const;

export type PolicyPackId = (typeof POLICY_PACK_IDS)[number];

function advisory(
  id: string,
  severity: Finding["severity"],
  title: string,
  description: string,
  evidence: string[],
): Finding {
  return { id, severity, category: "deterministic", title, description, evidence, blocking: false };
}

export function applicablePolicyPacks(inspection: ActionInspection): PolicyPackId[] {
  const packs: PolicyPackId[] = ["base"];
  if (inspection.category === "token-approval") packs.push("erc20-approvals");
  if (inspection.category === "token-transfer" || inspection.category === "native-transfer") {
    packs.push("asset-movement");
  }
  if (inspection.category === "nft-approval") packs.push("nft-operators");
  if (inspection.category === "administration") packs.push("contract-administration");
  if (inspection.category === "upgrade" || inspection.category === "delegated-call") {
    packs.push("proxy-upgrades");
  }
  return packs;
}

export function evaluatePolicyPacks(
  action: ActionRequest,
  inspection: ActionInspection,
  enabled: ReadonlySet<PolicyPackId>,
): Finding[] {
  const findings: Finding[] = [];
  if (
    enabled.has("erc20-approvals") &&
    inspection.category === "token-approval" &&
    !inspection.riskSignals.includes("Unlimited ERC-20 allowance.")
  ) {
    const amount = inspection.arguments.find((argument) => argument.name === "amount")?.value;
    if (amount !== undefined && amount !== "0") {
      findings.push(
        advisory(
          "ERC20_FINITE_APPROVAL_REVIEW",
          "high",
          "Token spending authority granted",
          "A finite approval still lets another address transfer tokens without another owner signature.",
          inspection.arguments.map((argument) => `${argument.name}=${argument.value}`),
        ),
      );
    }
  }
  if (enabled.has("asset-movement") && inspection.category === "token-transfer") {
    findings.push(
      advisory(
        "ASSET_MOVEMENT_REVIEW",
        "medium",
        "Direct asset movement",
        "Token movement requires intent, recipient, amount, and downstream accounting review.",
        [inspection.summary],
      ),
    );
  }
  if (
    enabled.has("asset-movement") &&
    inspection.category === "native-transfer" &&
    BigInt(action.value) > 0n
  ) {
    findings.push(
      advisory(
        "NATIVE_ASSET_MOVEMENT_REVIEW",
        "high",
        "Native asset movement",
        "The call transfers native value and may invoke target fallback behavior.",
        [`value=${action.value}`, `target=${action.target}`],
      ),
    );
  }
  return findings;
}
