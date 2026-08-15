import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { canonicalize, riskReportSchema, type CanonicalValue } from "@actionproof/core";

import { calculateZgMerkleRoot } from "./storage.js";

const rootHash = process.argv[2];
if (!rootHash || !/^0x[0-9a-fA-F]{64}$/u.test(rootHash)) {
  throw new TypeError("Usage: inspect:storage <0x-prefixed root hash>");
}

const indexer = new Indexer("https://indexer-storage-testnet-turbo.0g.ai");
const [blob, error] = await indexer.downloadToBlob(rootHash, { proof: true });
if (error) throw new Error("0G Storage download failed", { cause: error });
const bytes = new Uint8Array(await blob.arrayBuffer());
const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const report = riskReportSchema.parse(JSON.parse(text) as unknown);
if (canonicalize(report as unknown as CanonicalValue) !== text) {
  throw new Error("Stored report is not canonical JSON");
}
const computedRoot = await calculateZgMerkleRoot(bytes);
if (computedRoot.toLowerCase() !== rootHash.toLowerCase()) {
  throw new Error(`Storage root mismatch: computed ${computedRoot}`);
}

console.log(
  JSON.stringify(
    {
      rootHash: computedRoot,
      size: bytes.byteLength,
      actionHash: report.actionHash,
      verdict: report.verdict,
      riskScore: report.riskScore,
      deterministicRuleIds: report.deterministicFindings.map((finding) => finding.id),
      deterministicFindings: report.deterministicFindings.map((finding) => ({
        id: finding.id,
        description: finding.description,
        evidence: finding.evidence,
      })),
      blockingRuleIds: report.finalPolicy.blockingRuleIds,
      model: report.compute.model,
      provider: report.compute.provider,
      requestId: report.compute.requestId,
      modelVerdict: report.modelAssessment.verdict,
      modelReasons: report.modelAssessment.reasons,
      generatedAt: report.generatedAt,
    },
    null,
    2,
  ),
);
