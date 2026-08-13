import type { Address, Hex, TypedDataDomain } from "viem";

import {
  attestationSchema,
  type ActionRequest,
  type Attestation,
  type Verdict,
} from "./schemas.js";
import { hashCalldata, hashIntent } from "./hashing.js";

export const ACTIONPROOF_DOMAIN_NAME = "ActionProof";
export const ACTIONPROOF_DOMAIN_VERSION = "1";

export const actionAttestationTypes = {
  ActionAttestation: [
    { name: "agent", type: "address" },
    { name: "requester", type: "address" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "calldataHash", type: "bytes32" },
    { name: "intentHash", type: "bytes32" },
    { name: "reportRoot", type: "bytes32" },
    { name: "reportHash", type: "bytes32" },
    { name: "verdict", type: "uint8" },
    { name: "destinationChainId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export const verdictToCode: Readonly<Record<Verdict, 1 | 2 | 3>> = {
  allow: 1,
  block: 2,
  review: 3,
};

export const codeToVerdict: Readonly<Record<1 | 2 | 3, Verdict>> = {
  1: "allow",
  2: "block",
  3: "review",
};

export function createAttestation(args: {
  action: ActionRequest;
  reportRoot: Hex;
  reportHash: Hex;
  verdict: Verdict;
}): Attestation {
  return attestationSchema.parse({
    agent: args.action.agent,
    requester: args.action.requester,
    target: args.action.target,
    value: args.action.value,
    calldataHash: hashCalldata(args.action.calldata as Hex),
    intentHash: hashIntent(args.action.intent),
    reportRoot: args.reportRoot,
    reportHash: args.reportHash,
    verdict: verdictToCode[args.verdict],
    destinationChainId: args.action.destinationChainId,
    nonce: args.action.nonce,
    issuedAt: args.action.issuedAt,
    expiresAt: args.action.expiresAt,
  });
}

export function actionProofDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return {
    name: ACTIONPROOF_DOMAIN_NAME,
    version: ACTIONPROOF_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export function toTypedAttestation(attestation: Attestation) {
  return {
    agent: attestation.agent as Address,
    requester: attestation.requester as Address,
    target: attestation.target as Address,
    value: BigInt(attestation.value),
    calldataHash: attestation.calldataHash as Hex,
    intentHash: attestation.intentHash as Hex,
    reportRoot: attestation.reportRoot as Hex,
    reportHash: attestation.reportHash as Hex,
    verdict: attestation.verdict,
    destinationChainId: BigInt(attestation.destinationChainId),
    nonce: BigInt(attestation.nonce),
    issuedAt: BigInt(attestation.issuedAt),
    expiresAt: BigInt(attestation.expiresAt),
  };
}
