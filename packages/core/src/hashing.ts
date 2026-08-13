import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
  toBytes,
  type Hex,
} from "viem";

import { canonicalize, type CanonicalValue } from "./canonical.js";
import { actionRequestSchema, type ActionRequest } from "./schemas.js";

export const ACTION_REQUEST_TYPE =
  "ActionRequest(address agent,address requester,address target,uint256 value,bytes32 calldataHash,bytes32 intentHash,uint256 destinationChainId,uint256 nonce,uint64 issuedAt,uint64 expiresAt)";

export const ACTION_REQUEST_TYPEHASH = keccak256(stringToHex(ACTION_REQUEST_TYPE));

export function hashCalldata(calldata: Hex): Hex {
  return keccak256(calldata);
}

export function hashIntent(intent: string): Hex {
  return keccak256(toBytes(intent));
}

export function hashActionRequest(input: ActionRequest): Hex {
  const action = actionRequestSchema.parse(input);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,address,address,address,uint256,bytes32,bytes32,uint256,uint256,uint64,uint64",
      ),
      [
        ACTION_REQUEST_TYPEHASH,
        action.agent,
        action.requester,
        action.target,
        BigInt(action.value),
        hashCalldata(action.calldata as Hex),
        hashIntent(action.intent),
        BigInt(action.destinationChainId),
        BigInt(action.nonce),
        BigInt(action.issuedAt),
        BigInt(action.expiresAt),
      ],
    ),
  );
}

export function hashCanonical(value: CanonicalValue): Hex {
  return keccak256(toBytes(canonicalize(value)));
}
