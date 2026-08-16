import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

const privateKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u);
const addressSchema = z.string().refine((value) => isAddress(value, { strict: false }));
const optionalUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.url().optional(),
);
const optionalPrivateKey = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  privateKeySchema.optional(),
);
const optionalAddress = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  addressSchema.optional(),
);
const optionalUintString = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/u)
    .optional(),
);
const optionalOperatorToken = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z
    .string()
    .min(32, "ACTIONPROOF_OPERATOR_TOKEN must contain at least 32 characters")
    .max(256)
    .regex(/^[A-Za-z0-9._~-]+$/u, "ACTIONPROOF_OPERATOR_TOKEN contains unsafe characters")
    .optional(),
);
const boolFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false" || value === "" || value === undefined) return false;
  return value;
}, z.boolean());
const intFromEnv = (fallback: number, minimum = 1) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? fallback : Number(value)),
    z.number().int().min(minimum),
  );

const envSchema = z
  .object({
    ACTIONPROOF_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().min(1).default("127.0.0.1"),
    API_PORT: intFromEnv(8787),
    API_BODY_LIMIT: intFromEnv(262_144, 1_024),
    API_RATE_LIMIT_MAX: intFromEnv(120),
    API_RATE_LIMIT_WINDOW: z.string().min(1).default("1 minute"),
    API_CORS_ORIGINS: z.string().default("http://127.0.0.1:3000,http://localhost:3000"),
    API_DATA_DIR: z.string().default(".actionproof-data"),
    ACTIONPROOF_OPERATOR_TOKEN: optionalOperatorToken,
    OG_NETWORK: z.enum(["galileo", "mainnet"]).default("galileo"),
    OG_RPC_URL: optionalUrl,
    OG_CHAIN_ID: intFromEnv(16602),
    OG_EXPLORER_URL: optionalUrl,
    OG_STORAGE_INDEXER_URL: optionalUrl,
    OG_STORAGE_EXPLORER_URL: optionalUrl,
    OG_STORAGE_PRIVATE_KEY: optionalPrivateKey,
    OG_COMPUTE_BASE_URL: optionalUrl,
    OG_COMPUTE_API_KEY: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.string().min(1).optional(),
    ),
    OG_COMPUTE_MODEL: z.preprocess(
      (value) => (value === "" || value === undefined ? undefined : value),
      z.string().min(1).optional(),
    ),
    OG_COMPUTE_TIMEOUT_MS: intFromEnv(60_000),
    READINESS_TIMEOUT_MS: intFromEnv(10_000),
    VERIFIER_PRIVATE_KEY: optionalPrivateKey,
    RELAYER_PRIVATE_KEY: optionalPrivateKey,
    ACTIONPROOF_GUARD_ADDRESS: optionalAddress,
    ACTIONPROOF_AGENT_ADDRESS: optionalAddress,
    OG_AGENTIC_ID: optionalUintString,
    DEMO_COUNTER_ADDRESS: optionalAddress,
    DEMO_TOKEN_ADDRESS: optionalAddress,
    ENABLE_LIVE_WRITES: boolFromEnv.default(false),
    ALLOW_MAINNET_BROADCAST: boolFromEnv.default(false),
    LIVE_SMOKE_CONFIRM: z.string().optional(),
    MAX_NATIVE_VALUE_WEI: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)$/u)
      .default("10000000000000000"),
    ALLOWED_TARGETS: z.string().default(""),
    DENIED_SPENDERS: z.string().default(""),
    JOB_TTL_MS: intFromEnv(900_000),
  })
  .superRefine((env, context) => {
    const expectedChain = env.OG_NETWORK === "galileo" ? 16602 : 16661;
    if (env.OG_CHAIN_ID !== expectedChain) {
      context.addIssue({
        code: "custom",
        path: ["OG_CHAIN_ID"],
        message: `${env.OG_NETWORK} requires chain ID ${expectedChain}`,
      });
    }
    if (env.OG_NETWORK === "mainnet" && env.ENABLE_LIVE_WRITES && !env.ALLOW_MAINNET_BROADCAST) {
      context.addIssue({
        code: "custom",
        path: ["ALLOW_MAINNET_BROADCAST"],
        message: "Mainnet writes require ALLOW_MAINNET_BROADCAST=true",
      });
    }
    if (env.ACTIONPROOF_MODE === "live") {
      const required = [
        "OG_RPC_URL",
        "OG_EXPLORER_URL",
        "OG_STORAGE_INDEXER_URL",
        "OG_STORAGE_EXPLORER_URL",
        "OG_STORAGE_PRIVATE_KEY",
        "OG_COMPUTE_BASE_URL",
        "OG_COMPUTE_API_KEY",
        "OG_COMPUTE_MODEL",
        "VERIFIER_PRIVATE_KEY",
        "RELAYER_PRIVATE_KEY",
        "ACTIONPROOF_GUARD_ADDRESS",
      ] as const;
      for (const key of required) {
        if (env[key] === undefined) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required in live mode`,
          });
        }
      }
    }
  });

export type RawEnv = Record<string, string | undefined>;
type ParsedEnv = z.infer<typeof envSchema>;

const ENV_KEYS = Object.keys(envSchema._zod.def.shape) as Array<keyof ParsedEnv>;

function parseAddressList(value: string, name: string): ReadonlySet<string> | undefined {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  for (const entry of entries) {
    if (!isAddress(entry, { strict: false }))
      throw new TypeError(`${name} contains an invalid address`);
  }
  return new Set(entries.map((entry) => entry.toLowerCase()));
}

export interface AppConfig extends ParsedEnv {
  corsOrigins: ReadonlySet<string>;
  allowedTargets: ReadonlySet<string> | undefined;
  deniedSpenders: ReadonlySet<string>;
  maxNativeValueWei: bigint;
  liveWriteEnabled: boolean;
  defaultAgentAddress: Address;
}

export const DEFAULT_AGENT_ADDRESS = "0xA17e000000000000000000000000000000000001" as Address;

export function parseEnv(source: RawEnv = process.env): AppConfig {
  const selected: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) selected[key] = source[key];
  const env = envSchema.parse(selected);
  const origins = new Set(
    env.API_CORS_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (origins.has("*") && env.NODE_ENV === "production") {
    throw new TypeError("Wildcard CORS is forbidden in production");
  }
  return {
    ...env,
    corsOrigins: origins,
    allowedTargets: parseAddressList(env.ALLOWED_TARGETS, "ALLOWED_TARGETS"),
    deniedSpenders: parseAddressList(env.DENIED_SPENDERS, "DENIED_SPENDERS") ?? new Set(),
    maxNativeValueWei: BigInt(env.MAX_NATIVE_VALUE_WEI),
    liveWriteEnabled:
      env.ACTIONPROOF_MODE === "sandbox" ||
      (env.ENABLE_LIVE_WRITES && (env.OG_NETWORK !== "mainnet" || env.ALLOW_MAINNET_BROADCAST)),
    defaultAgentAddress: (env.ACTIONPROOF_AGENT_ADDRESS ?? DEFAULT_AGENT_ADDRESS) as Address,
  };
}

export function requireLiveValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new TypeError(`${name} is required in live mode`);
  return value;
}

export function asPrivateKey(value: string | undefined, name: string): Hex {
  return requireLiveValue(value, name) as Hex;
}
