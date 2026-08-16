import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function readArgument(name: string): string | undefined {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requirePort(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

const rawOrigin = readArgument("--origin");
if (!rawOrigin) {
  throw new TypeError("Usage: pnpm configure:hosting -- --origin https://actionproof.example.com");
}

const originUrl = new URL(rawOrigin);
if (originUrl.protocol !== "https:" || originUrl.origin !== rawOrigin.replace(/\/$/u, "")) {
  throw new TypeError("--origin must be an HTTPS origin without a path, query, or fragment");
}

const origin = originUrl.origin;
const apiPort = requirePort(readArgument("--api-port"), 8787, "--api-port");
const webPort = requirePort(readArgument("--web-port"), 3020, "--web-port");
const envPath = path.resolve(import.meta.dirname, "../.env");
const evidencePath = path.resolve(import.meta.dirname, "../docs/evidence/galileo-live.json");
if (!existsSync(envPath)) {
  throw new TypeError(".env is missing; copy .env.example and configure live 0G credentials first");
}

function evidenceTraceId(scenario: "safe" | "dangerous"): string {
  if (!existsSync(evidencePath)) return "";
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
  const section = evidence[scenario];
  if (typeof section !== "object" || section === null) return "";
  const traceId = (section as Record<string, unknown>).traceId;
  return typeof traceId === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(traceId)
    ? traceId
    : "";
}

const updates = new Map<string, string>([
  ["API_HOST", "127.0.0.1"],
  ["API_PORT", String(apiPort)],
  ["API_DATA_DIR", "apps/api/.actionproof-data"],
  ["API_CORS_ORIGINS", `${origin},http://127.0.0.1:${webPort},http://localhost:${webPort}`],
  ["NEXT_PUBLIC_API_URL", origin],
  ["NEXT_PUBLIC_ACTIONPROOF_MODE", "live"],
  ["NEXT_PUBLIC_SAFE_TRACE_ID", evidenceTraceId("safe")],
  ["NEXT_PUBLIC_BLOCK_TRACE_ID", evidenceTraceId("dangerous")],
  ["ENABLE_LIVE_WRITES", "false"],
  ["ALLOW_MAINNET_BROADCAST", "false"],
]);

const original = readFileSync(envPath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
const seen = new Set<string>();
const lines = original.split(/\r?\n/u).map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/u.exec(line);
  if (!match) return line;
  const key = match[1];
  if (!key || !updates.has(key)) return line;
  seen.add(key);
  return `${key}=${updates.get(key)}`;
});

for (const [key, value] of updates) {
  if (!seen.has(key)) lines.push(`${key}=${value}`);
}

writeFileSync(envPath, lines.join(newline), { encoding: "utf8", mode: 0o600 });
console.log(
  `Configured ${origin} for read-only local production hosting (web ${webPort}, API ${apiPort}); live writes and mainnet broadcast are disabled, and no secret values were printed.`,
);
