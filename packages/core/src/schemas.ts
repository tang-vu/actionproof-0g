import { isAddress } from "viem";
import { z } from "zod";

export const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: true }), "Expected a checksummed EVM address");

export const hexSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2})*$/u, "Expected an even-length 0x-prefixed hex value");

export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u, "Expected bytes32 hex");
export const uintStringSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u, "Expected uint decimal");

export const verdictSchema = z.enum(["allow", "block", "review"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const actionRequestSchema = z
  .object({
    version: z.literal("1"),
    agent: addressSchema,
    requester: addressSchema,
    target: addressSchema,
    value: uintStringSchema,
    calldata: hexSchema,
    intent: z.string().trim().min(1).max(500),
    destinationChainId: z.number().int().positive(),
    nonce: uintStringSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .superRefine((action, context) => {
    const maxUint256 = (1n << 256n) - 1n;
    if (BigInt(action.value) > maxUint256) {
      context.addIssue({ code: "custom", message: "value exceeds uint256", path: ["value"] });
    }
    if (BigInt(action.nonce) > maxUint256) {
      context.addIssue({ code: "custom", message: "nonce exceeds uint256", path: ["nonce"] });
    }
    if (action.expiresAt <= action.issuedAt) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be later than issuedAt",
        path: ["expiresAt"],
      });
    }
  });

export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const findingSchema = z.object({
  id: z.string().min(1).max(80),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  category: z.enum(["deterministic", "simulation", "model"]),
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(1_000),
  evidence: z.array(z.string().max(500)).max(20),
  blocking: z.boolean(),
});

export type Finding = z.infer<typeof findingSchema>;

export const simulatedEffectSchema = z.object({
  kind: z.enum([
    "call",
    "native-transfer",
    "token-transfer",
    "approval",
    "state-change",
    "unknown",
  ]),
  summary: z.string().min(1).max(500),
  asset: z.string().max(100).optional(),
  from: addressSchema.optional(),
  to: addressSchema.optional(),
  amount: uintStringSchema.optional(),
  unexpected: z.boolean().default(false),
});

export const simulationResultSchema = z.object({
  success: z.boolean(),
  networkChainId: z.number().int().positive(),
  targetHasCode: z.boolean(),
  targetVerification: z.enum(["verified", "unverified", "unknown"]),
  gasEstimate: uintStringSchema.optional(),
  returnData: hexSchema.optional(),
  error: z.string().max(1_000).optional(),
  effects: z.array(simulatedEffectSchema).max(100),
  targetAnalysis: z
    .object({
      codeHash: bytes32Schema,
      blockNumber: uintStringSchema,
      proxy: z
        .object({
          standard: z.literal("EIP-1967"),
          implementation: addressSchema.optional(),
          admin: addressSchema.optional(),
          beacon: addressSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  stateDiff: z
    .object({
      status: z.enum(["available", "disabled", "unsupported", "failed"]),
      accountsChanged: z.number().int().nonnegative().optional(),
      storageSlotsChanged: z.number().int().nonnegative().optional(),
      note: z.string().min(1).max(500),
    })
    .optional(),
  observedAt: z.string().datetime(),
});

export type SimulationResult = z.infer<typeof simulationResultSchema>;

export const modelRiskAssessmentSchema = z.object({
  verdict: verdictSchema,
  riskScore: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  modelFindings: z.array(findingSchema.extend({ category: z.literal("model") })).max(30),
  evidence: z.array(z.string().min(1).max(500)).max(30),
  reasons: z.array(z.string().min(1).max(500)).min(1).max(20),
  recommendedAction: z.string().min(1).max(1_000),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(20),
});

export type ModelRiskAssessment = z.infer<typeof modelRiskAssessmentSchema>;

export const computeMetadataSchema = z.object({
  service: z.literal("0G Compute"),
  mode: z.enum(["router", "direct", "sandbox"]),
  model: z.string().min(1),
  provider: z.string().optional(),
  requestId: z.string().optional(),
  billing: z.record(z.string(), z.unknown()).optional(),
  generatedAt: z.string().datetime(),
});

export const agentIdentityEvidenceSchema = z.object({
  standard: z.literal("ERC-8004"),
  chainId: z.number().int().positive(),
  registry: addressSchema,
  agentId: uintStringSchema,
  owner: addressSchema,
  agentWallet: addressSchema,
  tokenUri: z.string().min(1).max(2_048),
  matchesActionAgent: z.boolean(),
  checkedAt: z.string().datetime(),
  explorerUrl: z.string().url(),
});

export type AgentIdentityEvidence = z.infer<typeof agentIdentityEvidenceSchema>;

export const riskReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  actionHash: bytes32Schema,
  action: actionRequestSchema,
  verdict: verdictSchema,
  riskScore: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  deterministicFindings: z.array(findingSchema),
  simulation: simulationResultSchema,
  modelAssessment: modelRiskAssessmentSchema,
  compute: computeMetadataSchema,
  agentIdentity: agentIdentityEvidenceSchema.optional(),
  finalPolicy: z.object({
    version: z.literal("actionproof-policy/1"),
    packs: z.array(z.string().min(1)).optional(),
    blockingRuleIds: z.array(z.string()),
    reasons: z.array(z.string().min(1)),
  }),
  generatedAt: z.string().datetime(),
});

export type RiskReport = z.infer<typeof riskReportSchema>;

export const attestationSchema = z.object({
  agent: addressSchema,
  requester: addressSchema,
  target: addressSchema,
  value: uintStringSchema,
  calldataHash: bytes32Schema,
  intentHash: bytes32Schema,
  reportRoot: bytes32Schema,
  reportHash: bytes32Schema,
  verdict: z.number().int().min(1).max(3),
  destinationChainId: z.number().int().positive(),
  nonce: uintStringSchema,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type Attestation = z.infer<typeof attestationSchema>;

export const storageReceiptSchema = z.object({
  mode: z.enum(["0g", "sandbox"]),
  rootHash: bytes32Schema,
  transactionHash: bytes32Schema.optional(),
  sequence: uintStringSchema.optional(),
  indexerUrl: z.string().url().optional(),
  explorerUrl: z.string().url().optional(),
  uploadedAt: z.string().datetime(),
  size: z.number().int().nonnegative(),
});

export type StorageReceipt = z.infer<typeof storageReceiptSchema>;

export const chainReceiptSchema = z.object({
  mode: z.enum(["0g", "sandbox"]),
  chainId: z.number().int().positive(),
  guardAddress: addressSchema,
  transactionHash: bytes32Schema,
  blockNumber: uintStringSchema.optional(),
  explorerUrl: z.string().url().optional(),
  anchoredAt: z.string().datetime(),
});

export type ChainReceipt = z.infer<typeof chainReceiptSchema>;
