import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const examplePath = path.join(workspaceRoot, ".env.example");
const envPath = path.join(workspaceRoot, ".env");

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
}

void main();
