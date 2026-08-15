import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, isAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const examplePath = path.join(workspaceRoot, ".env.example");
const envPath = path.join(workspaceRoot, ".env");
const deploymentPath = path.join(
  workspaceRoot,
  "packages",
  "contracts",
  "deployments",
  "galileo.json",
);

const privateKeyNames = [
  "DEPLOYER_PRIVATE_KEY",
  "VERIFIER_PRIVATE_KEY",
  "RELAYER_PRIVATE_KEY",
  "OG_STORAGE_PRIVATE_KEY",
] as const;

type PrivateKeyName = (typeof privateKeyNames)[number];

function readValue(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`^${name}=(.*)$`, "mu"));
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

function setValue(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}=.*$`, "mu");
  if (pattern.test(source)) return source.replace(pattern, `${name}=${value}`);
  return `${source.trimEnd()}\n${name}=${value}\n`;
}

function validPrivateKey(value: string | undefined, name: PrivateKeyName): Hex {
  if (!value) return generatePrivateKey();
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError(`${name} exists but is not a valid 0x-prefixed private key`);
  }
  return value as Hex;
}

function contractAddress(record: unknown, name: string): string {
  if (typeof record !== "object" || record === null)
    throw new TypeError("Invalid deployment record");
  const contracts = (record as Record<string, unknown>)["contracts"];
  if (typeof contracts !== "object" || contracts === null) {
    throw new TypeError("Deployment record has no contracts");
  }
  const contract = (contracts as Record<string, unknown>)[name];
  if (typeof contract !== "object" || contract === null) {
    throw new TypeError(`${name} is not deployed in the Galileo record`);
  }
  const address = (contract as Record<string, unknown>)["address"];
  if (typeof address !== "string" || !isAddress(address, { strict: false })) {
    throw new TypeError(`${name} deployment address is invalid`);
  }
  if ((contract as Record<string, unknown>)["sourceVerified"] !== true) {
    throw new TypeError(`${name} deployment source is not marked verified`);
  }
  return getAddress(address);
}

async function main(): Promise<void> {
  const example = await readFile(examplePath, "utf8");
  const current = await readFile(envPath, "utf8").catch(() => example);
  let next = current;
  const keys = new Map<PrivateKeyName, Hex>();

  for (const name of privateKeyNames) {
    const key = validPrivateKey(readValue(current, name), name);
    keys.set(name, key);
    next = setValue(next, name, key);
  }

  const verifier = privateKeyToAccount(keys.get("VERIFIER_PRIVATE_KEY")!);
  const relayer = privateKeyToAccount(keys.get("RELAYER_PRIVATE_KEY")!);
  if (!readValue(current, "AUTHORIZED_VERIFIER")) {
    next = setValue(next, "AUTHORIZED_VERIFIER", verifier.address);
  }
  if (!readValue(current, "ACTIONPROOF_AGENT_ADDRESS")) {
    next = setValue(next, "ACTIONPROOF_AGENT_ADDRESS", relayer.address);
  }

  if (process.argv.includes("--enable-live")) {
    const deployment = JSON.parse(await readFile(deploymentPath, "utf8")) as unknown;
    if (
      typeof deployment !== "object" ||
      deployment === null ||
      (deployment as Record<string, unknown>)["chainId"] !== 16602
    ) {
      throw new TypeError("Refusing live configuration: deployment is not Galileo chain 16602");
    }
    const guard = contractAddress(deployment, "ActionProofGuard");
    const counter = contractAddress(deployment, "DemoCounter");
    const token = contractAddress(deployment, "DemoToken");
    next = setValue(next, "ACTIONPROOF_MODE", "live");
    next = setValue(next, "NEXT_PUBLIC_ACTIONPROOF_MODE", "live");
    next = setValue(next, "ACTIONPROOF_GUARD_ADDRESS", guard);
    next = setValue(next, "ACTIONPROOF_AGENT_ADDRESS", relayer.address);
    next = setValue(next, "NEXT_PUBLIC_ACTIONPROOF_AGENT_ADDRESS", relayer.address);
    next = setValue(next, "DEMO_COUNTER_ADDRESS", counter);
    next = setValue(next, "DEMO_TOKEN_ADDRESS", token);
    next = setValue(next, "NEXT_PUBLIC_DEMO_COUNTER_ADDRESS", counter);
    next = setValue(next, "NEXT_PUBLIC_DEMO_TOKEN_ADDRESS", token);
    next = setValue(next, "ENABLE_LIVE_WRITES", "true");
    next = setValue(next, "ALLOW_MAINNET_BROADCAST", "false");
    next = setValue(next, "LIVE_SMOKE_CONFIRM", "SPEND_GALILEO_0G");
  }

  await writeFile(envPath, next, { encoding: "utf8", mode: 0o600 });
  await chmod(envPath, 0o600).catch(() => undefined);

  const addresses = Object.fromEntries(
    privateKeyNames.map((name) => [
      name.replace("_PRIVATE_KEY", ""),
      getAddress(privateKeyToAccount(keys.get(name)!).address),
    ]),
  );
  console.log(
    "Created/preserved Galileo testnet keys in ignored .env. Private keys were not printed.",
  );
  console.log(JSON.stringify(addresses, null, 2));
  console.log(`ACTIONPROOF_AGENT=${getAddress(relayer.address)}`);
  console.log(`AUTHORIZED_VERIFIER=${getAddress(verifier.address)}`);
  if (process.argv.includes("--enable-live")) {
    console.log("Enabled live Galileo configuration from the verified deployment record.");
  }
}

void main();
