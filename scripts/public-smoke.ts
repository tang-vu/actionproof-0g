import { readFile } from "node:fs/promises";
import path from "node:path";

interface EvidenceFile {
  safe: { traceId: string };
  dangerous: { traceId: string };
}

interface AgenticEvidenceFile {
  agentId: string;
  registrationUri: string;
}

interface TraceSummary {
  id: string;
  mode: string;
  action: {
    version: "1";
    agent: string;
    requester: string;
    target: string;
    value: string;
    calldata: string;
    intent: string;
    destinationChainId: number;
    nonce: string;
    issuedAt: number;
    expiresAt: number;
  };
  report: { verdict: string };
  execution: { status: string };
  verification: { valid: boolean };
}

interface IntegrationStatus {
  mode: string;
  writesEnabled: boolean;
  capabilities: {
    instantPreflight: boolean;
    fullAttestation: boolean;
    publicVerification: boolean;
  };
  operatorAuthorization: { required: boolean; configured: boolean };
  services: Array<{ id: string; status: string }>;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Public smoke failed: ${message}`);
}

async function get(origin: string, route: string): Promise<Response> {
  const response = await fetch(`${origin}${route}`, {
    headers: { Accept: "application/json,text/html" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  invariant(response.ok, `GET ${route} returned ${response.status}`);
  return response;
}

const rawOrigin =
  argument("--origin") ?? process.env.PUBLIC_DEMO_URL ?? "https://actionproof.tangvu.dev";
const parsedOrigin = new URL(rawOrigin);
invariant(
  parsedOrigin.protocol === "https:" && parsedOrigin.origin === rawOrigin.replace(/\/$/u, ""),
  "origin must be an HTTPS origin without path, query, or fragment",
);
const origin = parsedOrigin.origin;
const evidence = JSON.parse(
  await readFile(path.resolve(import.meta.dirname, "../docs/evidence/galileo-live.json"), "utf8"),
) as EvidenceFile;
const agenticEvidence = JSON.parse(
  await readFile(
    path.resolve(import.meta.dirname, "../docs/evidence/agentic-id-galileo.json"),
    "utf8",
  ),
) as AgenticEvidenceFile;

const root = await get(origin, "/");
const rootHtml = await root.text();
invariant(rootHtml.includes("ActionProof"), "landing page does not identify ActionProof");
for (const header of [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
]) {
  invariant(root.headers.has(header), `landing page is missing ${header}`);
}

const health = (await (await get(origin, "/healthz")).json()) as { ok: boolean; mode: string };
invariant(health.ok && health.mode === "live", "health endpoint is not live");

const integrations = (await (await get(origin, "/v1/integrations")).json()) as IntegrationStatus;
invariant(integrations.mode === "live", "integration endpoint is not live");
invariant(
  integrations.writesEnabled === false,
  "public deployment unexpectedly permits paid writes",
);
invariant(
  integrations.operatorAuthorization.required === false,
  "read-only deployment unexpectedly requests operator authorization",
);
invariant(
  integrations.capabilities.instantPreflight && integrations.capabilities.publicVerification,
  "public read-only product capabilities are unavailable",
);
invariant(
  integrations.capabilities.fullAttestation === false,
  "public deployment unexpectedly exposes full attestation",
);
for (const id of ["chain", "compute", "storage"]) {
  invariant(
    integrations.services.some((service) => service.id === id && service.status === "available"),
    `${id} integration is not available`,
  );
}
invariant(
  integrations.services.some(
    (service) => service.id === "identity" && service.status === "available",
  ),
  `ERC-8004 agent ${agenticEvidence.agentId} is not available or does not bind the action agent`,
);
const registration = await get(origin, new URL(agenticEvidence.registrationUri).pathname);
const registrationJson = (await registration.json()) as {
  registrations?: Array<{ agentId?: number }>;
};
invariant(
  registrationJson.registrations?.some(
    (entry) => String(entry.agentId) === agenticEvidence.agentId,
  ),
  "public ERC-8004 registration file does not contain the committed agent ID",
);

const before = (await (await get(origin, "/v1/traces")).json()) as { traces: TraceSummary[] };
const expected = [
  [evidence.safe.traceId, "allow", "executed"],
  [evidence.dangerous.traceId, "block", "blocked"],
] as const;
for (const [traceId, verdict, execution] of expected) {
  const trace = before.traces.find((candidate) => candidate.id === traceId);
  invariant(trace?.mode === "live", `${verdict} evidence is missing or not live`);
  invariant(trace.report.verdict === verdict, `${traceId} has the wrong verdict`);
  invariant(trace.execution.status === execution, `${traceId} has the wrong execution status`);
  invariant(trace.verification.valid, `${traceId} does not pass stored integrity checks`);

  const tracePage = await get(origin, `/trace/${traceId}`);
  const html = await tracePage.text();
  invariant(html.includes(traceId), `${traceId} is not rendered on its public trace page`);
}

const safeTrace = before.traces.find((candidate) => candidate.id === evidence.safe.traceId);
invariant(safeTrace, "safe trace is unavailable for the preflight probe");
const nonceResponse = await get(
  origin,
  `/v1/nonces/${safeTrace.action.requester}?agent=${safeTrace.action.agent}`,
);
const currentNonce = (await nonceResponse.json()) as { nonce: string };
const now = Math.floor(Date.now() / 1_000);
const previewResponse = await fetch(`${origin}/v1/preflight`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: {
      ...safeTrace.action,
      nonce: currentNonce.nonce,
      issuedAt: now,
      expiresAt: now + 600,
    },
  }),
  signal: AbortSignal.timeout(20_000),
});
invariant(previewResponse.ok, `public preflight returned ${previewResponse.status}`);
const preview = (await previewResponse.json()) as {
  previewOnly: boolean;
  mode: string;
  disposition: string;
  notice: string;
};
invariant(preview.previewOnly && preview.mode === "live", "preflight provenance is incorrect");
invariant(preview.disposition === "pass", `safe preflight returned ${preview.disposition}`);
invariant(
  preview.notice.includes("no 0G Compute inference"),
  "preflight does not disclose its no-spend boundary",
);

const rejected = await fetch(`${origin}/v1/jobs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(20_000),
});
const rejection = (await rejected.json()) as { error?: { code?: string } };
invariant(
  rejected.status === 503,
  `public POST /v1/jobs returned ${rejected.status}, expected 503`,
);
invariant(
  rejection.error?.code === "LIVE_WRITES_DISABLED",
  "public write did not fail at safety gate",
);

const after = (await (await get(origin, "/v1/traces")).json()) as { traces: TraceSummary[] };
invariant(after.traces.length === before.traces.length, "read-only probe changed the trace count");

console.log(
  JSON.stringify(
    {
      ok: true,
      origin,
      mode: integrations.mode,
      writesEnabled: integrations.writesEnabled,
      integrations: ["chain", "compute", "storage", `erc-8004:${agenticEvidence.agentId}`],
      verifiedEvidence: expected.map(([traceId, verdict]) => ({ traceId, verdict })),
      publicWriteProbe: "LIVE_WRITES_DISABLED",
      instantPreflight: preview.disposition,
      traceCountUnchanged: after.traces.length,
    },
    null,
    2,
  ),
);
