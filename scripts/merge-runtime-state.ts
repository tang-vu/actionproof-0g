import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface IdentifiedRecord {
  id: string;
  [key: string]: unknown;
}

interface RuntimeState {
  version: 1;
  jobs: IdentifiedRecord[];
  traces: IdentifiedRecord[];
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveInsideWorkspace(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`${name} is required`);
  const workspace = path.resolve(import.meta.dirname, "..");
  const resolved = path.resolve(workspace, value);
  if (!resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new TypeError(`${name} must stay inside the ActionProof workspace`);
  }
  return resolved;
}

function parseState(text: string, name: string): RuntimeState {
  const value = JSON.parse(text) as Partial<RuntimeState>;
  if (value.version !== 1 || !Array.isArray(value.jobs) || !Array.isArray(value.traces)) {
    throw new TypeError(`${name} is not an ActionProof runtime state v1 file`);
  }
  for (const record of [...value.jobs, ...value.traces]) {
    if (typeof record !== "object" || record === null || typeof record.id !== "string") {
      throw new TypeError(`${name} contains a record without a string ID`);
    }
  }
  return value as RuntimeState;
}

function mergeRecords(
  target: IdentifiedRecord[],
  source: IdentifiedRecord[],
  label: string,
): IdentifiedRecord[] {
  const merged = new Map(target.map((record) => [record.id, record]));
  for (const record of source) {
    const existing = merged.get(record.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new Error(`Refusing conflicting ${label} record ${record.id}`);
    }
    merged.set(record.id, record);
  }
  return [...merged.values()];
}

const sourcePath = resolveInsideWorkspace(argument("--source"), "--source");
const targetPath = resolveInsideWorkspace(argument("--target"), "--target");
if (sourcePath === targetPath) throw new TypeError("Source and target state files must differ");

const [source, target] = await Promise.all([
  readFile(sourcePath, "utf8").then((text) => parseState(text, "source")),
  readFile(targetPath, "utf8").then((text) => parseState(text, "target")),
]);
const merged: RuntimeState = {
  version: 1,
  jobs: mergeRecords(target.jobs, source.jobs, "job"),
  traces: mergeRecords(target.traces, source.traces, "trace"),
};
const summary = {
  source: { jobs: source.jobs.length, traces: source.traces.length },
  targetBefore: { jobs: target.jobs.length, traces: target.traces.length },
  targetAfter: { jobs: merged.jobs.length, traces: merged.traces.length },
  importedTraceIds: source.traces
    .filter((trace) => !target.traces.some((existing) => existing.id === trace.id))
    .map((trace) => trace.id),
};

if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ ...summary, applied: false }, null, 2));
  process.exit(0);
}

await mkdir(path.dirname(targetPath), { recursive: true });
const temporaryPath = path.join(path.dirname(targetPath), `.merge-${randomUUID()}.tmp`);
await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporaryPath, targetPath);
console.log(JSON.stringify({ ...summary, applied: true }, null, 2));
