import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import {
  bytes32Schema,
  canonicalize,
  riskReportSchema,
  storageReceiptSchema,
  type CanonicalValue,
  type RiskReport,
} from "@actionproof/core";
import type { Signer } from "ethers";
import type { Hex } from "viem";

import type { Clock, RetrievedReport, StorageAdapter, StoredReport } from "./interfaces.js";
import { systemClock } from "./interfaces.js";

type UploadResult =
  | { txHash: string; rootHash: string; txSeq: number }
  | { txHashes: string[]; rootHashes: string[]; txSeqs: number[] };

export interface StorageNetworkTransport {
  upload(file: MemData): Promise<[UploadResult, Error | null]>;
  downloadToBytes(rootHash: Hex): Promise<Uint8Array>;
}

export interface ZgStorageConfig {
  indexerUrl: string;
  rpcUrl: string;
  signer: Signer;
  explorerUrl?: string;
  clock?: Clock;
  transport?: StorageNetworkTransport;
}

class OfficialStorageTransport implements StorageNetworkTransport {
  readonly #indexer: Indexer;
  readonly #rpcUrl: string;
  readonly #signer: Signer;

  constructor(config: ZgStorageConfig) {
    this.#indexer = new Indexer(config.indexerUrl);
    this.#rpcUrl = config.rpcUrl;
    this.#signer = config.signer;
  }

  upload(file: MemData): Promise<[UploadResult, Error | null]> {
    return this.#indexer.upload(file, this.#rpcUrl, this.#signer);
  }

  async downloadToBytes(rootHash: Hex): Promise<Uint8Array> {
    const [blob, error] = await this.#indexer.downloadToBlob(rootHash, { proof: true });
    if (error) throw new Error("0G Storage download failed", { cause: error });
    return new Uint8Array(await blob.arrayBuffer());
  }
}

function canonicalReportBytes(report: RiskReport): Uint8Array {
  const parsed = riskReportSchema.parse(report);
  return new TextEncoder().encode(canonicalize(parsed as unknown as CanonicalValue));
}

export async function calculateZgMerkleRoot(bytes: Uint8Array): Promise<Hex> {
  const file = new MemData(bytes);
  const [tree, error] = await file.merkleTree();
  if (error) throw new Error("0G Storage Merkle calculation failed", { cause: error });
  const root = tree?.rootHash();
  return bytes32Schema.parse(root) as Hex;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function optionalTransactionHash(value: string | undefined): Hex | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return bytes32Schema.parse(value) as Hex;
}

function normalizeUpload(
  result: UploadResult,
  expectedRoot: Hex,
): { transactionHash?: Hex; sequence: string } {
  if ("rootHash" in result) {
    if (result.rootHash.toLowerCase() !== expectedRoot.toLowerCase()) {
      throw new Error("0G Storage upload root does not match the locally calculated root");
    }
    const transactionHash = optionalTransactionHash(result.txHash);
    return {
      ...(transactionHash ? { transactionHash } : {}),
      sequence: result.txSeq.toString(),
    };
  }

  const index = result.rootHashes.findIndex(
    (rootHash) => rootHash.toLowerCase() === expectedRoot.toLowerCase(),
  );
  if (index < 0) {
    throw new Error("0G Storage fragmented upload omitted the locally calculated root");
  }
  const txHash = result.txHashes[index];
  const txSeq = result.txSeqs[index];
  if (txSeq === undefined) throw new Error("0G Storage fragmented upload omitted its sequence");
  const transactionHash = optionalTransactionHash(txHash);
  return {
    ...(transactionHash ? { transactionHash } : {}),
    sequence: txSeq.toString(),
  };
}

function storageExplorerLink(baseUrl: string | undefined, sequence: string): string | undefined {
  return baseUrl === undefined
    ? undefined
    : `${baseUrl.replace(/\/$/u, "")}/submission/${sequence}`;
}

function decodeCanonicalReport(bytes: Uint8Array): RiskReport {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError("Retrieved 0G Storage report is not valid UTF-8", { cause: error });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    throw new TypeError("Retrieved 0G Storage report is not valid JSON", { cause: error });
  }
  const report = riskReportSchema.parse(decoded);
  const recanonicalized = canonicalize(report as unknown as CanonicalValue);
  if (recanonicalized !== text) {
    throw new Error("Retrieved 0G Storage report is not in canonical JSON form");
  }
  return report;
}

/** Production adapter using the official in-memory MemData and Indexer APIs. */
export class ZgStorageAdapter implements StorageAdapter {
  readonly mode = "0g" as const;
  readonly #indexerUrl: string;
  readonly #explorerUrl: string | undefined;
  readonly #clock: Clock;
  readonly #transport: StorageNetworkTransport;

  constructor(config: ZgStorageConfig) {
    if (config.indexerUrl.trim().length === 0) throw new TypeError("indexerUrl is required");
    if (config.rpcUrl.trim().length === 0) throw new TypeError("rpcUrl is required");
    this.#indexerUrl = config.indexerUrl;
    this.#explorerUrl = config.explorerUrl;
    this.#clock = config.clock ?? systemClock;
    this.#transport = config.transport ?? new OfficialStorageTransport(config);
  }

  async uploadReport(report: RiskReport): Promise<StoredReport> {
    const canonicalBytes = canonicalReportBytes(report);
    const rootHash = await calculateZgMerkleRoot(canonicalBytes);
    const [uploadResult, error] = await this.#transport.upload(new MemData(canonicalBytes));
    if (error) throw new Error("0G Storage upload failed", { cause: error });
    const normalized = normalizeUpload(uploadResult, rootHash);
    const receipt = storageReceiptSchema.parse({
      mode: "0g",
      rootHash,
      ...(normalized.transactionHash ? { transactionHash: normalized.transactionHash } : {}),
      sequence: normalized.sequence,
      indexerUrl: this.#indexerUrl,
      ...(storageExplorerLink(this.#explorerUrl, normalized.sequence)
        ? { explorerUrl: storageExplorerLink(this.#explorerUrl, normalized.sequence) }
        : {}),
      uploadedAt: this.#clock().toISOString(),
      size: canonicalBytes.byteLength,
    });
    return { receipt, canonicalBytes };
  }

  async retrieveAndVerify(rootHash: string, expectedReport: RiskReport): Promise<RetrievedReport> {
    const expectedRoot = bytes32Schema.parse(rootHash) as Hex;
    const expectedBytes = canonicalReportBytes(expectedReport);
    const downloaded = await this.#transport.downloadToBytes(expectedRoot);
    const recomputedRoot = await calculateZgMerkleRoot(downloaded);
    if (recomputedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
      throw new Error("Retrieved 0G Storage data failed mandatory Merkle-root verification");
    }
    if (!sameBytes(downloaded, expectedBytes)) {
      throw new Error("Retrieved 0G Storage bytes differ from the canonical expected report");
    }
    const report = decodeCanonicalReport(downloaded);
    return { report, rootHash: recomputedRoot, canonicalBytes: downloaded };
  }
}

export const storageInternals = {
  canonicalReportBytes,
  decodeCanonicalReport,
  normalizeUpload,
  storageExplorerLink,
};
