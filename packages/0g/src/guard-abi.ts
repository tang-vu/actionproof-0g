/** Minimal ActionProofGuard ABI used by the chain adapter. */
export const actionProofGuardAbi = [
  {
    type: "function",
    name: "anchorAttestation",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
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
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "executeAttestedAction",
    stateMutability: "payable",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
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
      },
      { name: "actionCalldata", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "returnData", type: "bytes" }],
  },
  {
    type: "function",
    name: "hashAttestation",
    stateMutability: "view",
    inputs: [
      {
        name: "attestation",
        type: "tuple",
        components: [
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
      },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [
      { name: "agent", type: "address" },
      { name: "requester", type: "address" },
      { name: "verifier", type: "address" },
      { name: "reportRoot", type: "bytes32" },
      { name: "reportHash", type: "bytes32" },
      { name: "verdict", type: "uint8" },
      { name: "anchoredAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "usedAttestations",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [{ name: "used", type: "bool" }],
  },
  {
    type: "function",
    name: "executedAttestations",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [{ name: "executed", type: "bool" }],
  },
  {
    type: "function",
    name: "authorizedVerifier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "requester", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

export type GuardAttestation = {
  agent: `0x${string}`;
  requester: `0x${string}`;
  target: `0x${string}`;
  value: bigint;
  calldataHash: `0x${string}`;
  intentHash: `0x${string}`;
  reportRoot: `0x${string}`;
  reportHash: `0x${string}`;
  verdict: number;
  destinationChainId: bigint;
  nonce: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
};
