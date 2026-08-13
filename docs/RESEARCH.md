# 0G integration research and architecture decisions

Status: accepted baseline for the first implementation

Last verified: 2026-08-13

Scope: 0G Chain, Compute, Storage, and Agentic ID surfaces used or considered by ActionProof

This note records what the project will build against, the upstream inconsistencies that affect that choice, and the checks required before any live claim. Sources are current 0G documentation, Builder Hub, official 0G GitHub repositories, and the published npm artifacts. No paid inference, storage upload, contract deployment, or other funded live test was performed while preparing this research.

## Decisions (ADR summary)

| Date       | Area                 | Decision                                                                                                                                                           | Why / consequence                                                                                                                                                                                                                              |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-13 | Default network      | Develop and demo on Galileo (`16602`). Mainnet (`16661`) remains an explicit opt-in behind the existing write gates.                                               | Galileo is the current official testnet. Testnet contract addresses may change, so startup must assert chain ID and configuration.                                                                                                             |
| 2026-08-13 | RPC                  | Use official public RPC URLs for development and smoke checks only; configure a managed, redundant RPC for production.                                             | The Galileo endpoint is explicitly development-only, and both network pages recommend third-party RPCs for production.                                                                                                                         |
| 2026-08-13 | Compute              | Use the Compute Router through an OpenAI-compatible client from the server.                                                                                        | This is the official recommended path for backends: one secret, one balance, provider selection and failover. Never expose its API key in the browser.                                                                                         |
| 2026-08-13 | Compute output       | Treat every model response as untrusted text. Require exactly one JSON value and validate it against a strict runtime schema before it can influence policy.       | Router compatibility does not guarantee that a chat model will honor a JSON schema. A prompt is not a validator. Invalid, extra, oversized, or incomplete output fails closed to `review`/`block`; it is never silently repaired in live mode. |
| 2026-08-13 | Compute live status  | Keep live Compute blocked until a funded testnet Router account, server-only `sk-` key, and selected live model are supplied.                                      | Router calls spend an on-chain balance. The repository contains placeholders only; therefore no successful paid-compute claim is warranted.                                                                                                    |
| 2026-08-13 | Compute alternative  | Keep Direct SDK support as a later adapter, pinned to `@0gfoundation/0g-compute-ts-sdk@0.9.0`.                                                                     | Direct is appropriate for wallet-connected dApps or per-provider control, but adds signer custody, provider discovery, acknowledgement, and provider-specific funding.                                                                         |
| 2026-08-13 | Storage              | Use Turbo and pin `@0gfoundation/0g-storage-ts-sdk@1.2.11` with `ethers@6.13.1`; test the installed artifact's API and integrity behavior in CI.                   | npm `latest` is `1.2.11`, while the repository manifest still says `1.2.9`. Exact pinning makes the executed tarball reproducible; contract tests protect against documentation/source drift.                                                  |
| 2026-08-13 | Storage integrity    | Independently recompute the Merkle root over downloaded raw bytes and compare it with the committed root.                                                          | The published `1.2.11` high-level downloader accepts `proof: true` but still contains `TODO: add proof check`; the flag is not sufficient evidence of verification.                                                                            |
| 2026-08-13 | Storage record shape | Store the canonical report as a small single-root object. Persist network, mode, root, transaction hash/sequence, byte size, and media/schema metadata separately. | A root commits bytes, not a filename or application metadata. Fragment arrays require ordered manifests and fragment-level verification.                                                                                                       |
| 2026-08-13 | Agentic ID           | Defer ERC-7857 Agentic ID minting/transfers from the MVP. Revisit ERC-8004 registration independently if discoverability becomes a requirement.                    | The ERC-7857 integration guide is illustrative and depends on a mock/replacement oracle; no production-ready official SDK/deployment path is specified. ERC-8004 registries, by contrast, have published addresses on both networks.           |

## Network and service configuration

The authoritative chain values are the current [Galileo overview](https://docs.0g.ai/developer-hub/testnet/testnet-overview) and [Mainnet overview](https://docs.0g.ai/developer-hub/mainnet/mainnet-overview).

| Setting               | Galileo testnet                                       | Mainnet                                      |
| --------------------- | ----------------------------------------------------- | -------------------------------------------- |
| Network name          | 0G Galileo Testnet                                    | 0G Mainnet                                   |
| Chain ID              | `16602` (`0x40da`)                                    | `16661` (`0x4115`)                           |
| Native symbol         | `0G`                                                  | `0G`                                         |
| Public EVM RPC        | `https://evmrpc-testnet.0g.ai`                        | `https://evmrpc.0g.ai`                       |
| Explorer              | `https://chainscan-galileo.0g.ai`                     | `https://chainscan.0g.ai`                    |
| Storage explorer      | `https://storagescan-galileo.0g.ai`                   | `https://storagescan.0g.ai`                  |
| Turbo Storage indexer | `https://indexer-storage-testnet-turbo.0g.ai`         | `https://indexer-storage-turbo.0g.ai`        |
| Storage Flow contract | `0x22E03a6A89B950F1c82ec5e74F8eCa321a105296`          | `0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526` |
| Compute Router API    | `https://router-api-testnet.integratenetwork.work/v1` | `https://router-api.0g.ai/v1`                |
| Compute Payment Layer | `0x0AD9690e0b34aB2d493DE02cDF149ee34f6C9939`          | `0xA3b15Bd2aD18BFB6b5f92D8AA9F444Dd59d1cE32` |

The Router URLs and the fact that testnet/mainnet have separate API keys and balances come from the [Router overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview). Payment Layer addresses come from [Deposits & Billing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/account/deposits).

At process startup, a live adapter must call `eth_chainId`, compare it with `OG_CHAIN_ID`, and reject a mismatch before signing or paying. The Storage SDK normally discovers the Flow address through the indexer; the addresses above are for configuration audits and explorer links, not a reason to bypass discovery. Galileo documentation warns that its contract addresses can change.

The official Galileo RPC is explicitly labeled development-only. The Mainnet page recommends third-party RPCs and redundancy. The project therefore treats both public endpoints as defaults for development/read-only checks, not as production SLAs.

## Compute integration

### Chosen server path: Router

The [Router documentation](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview) recommends Router for server-side applications, agents, and prototypes. It is OpenAI compatible:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.OG_COMPUTE_BASE_URL,
  apiKey: process.env.OG_COMPUTE_API_KEY,
});

const response = await client.chat.completions.create({
  model: process.env.OG_COMPUTE_MODEL!,
  messages,
});
```

The exact model catalogue, capabilities, context limits, provider, and prices are dynamic. Resolve them from `GET /v1/models` rather than copying a model name from an example. Router selection/failover is useful for availability, but model/provider identity and request IDs should still be captured in report metadata when returned.

Router `sk-` keys are inference secrets and belong only in the API service's secret store. `mk-` management keys have account scopes and should be separated from request-serving credentials. Testnet and mainnet keys and balances are not interchangeable. See the official [Router quickstart](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/quickstart), [authentication guide](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/authentication), and [Router versus Direct comparison](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/comparison).

### Strict JSON boundary

The model is advisory; deterministic rules and simulation remain authoritative. For a model assessment:

1. Ask for only the documented assessment object, but do not trust prompt compliance.
2. Require a non-streaming content string within a configured byte/token ceiling.
3. Parse one complete JSON value. Do not extract a fenced substring or heuristically repair output in live mode.
4. Validate with a strict runtime schema equivalent to `modelRiskAssessmentSchema`: reject unknown keys, invalid enums, out-of-range scores/confidence, empty required reasons/limitations, and excessive arrays/strings.
5. Bind the validated assessment to the action hash and model/request metadata outside the model-authored object.
6. On timeout, HTTP error, truncation, parse failure, or schema failure, emit a deterministic failure finding and fail closed according to policy.

The official chat examples read `choices[0].message.content`; they do not document guaranteed JSON-schema enforcement for chat completions. TypeScript types therefore cannot replace runtime validation.

### Funded-key blocker and costs

The Router debits a deposited on-chain balance per request. Cost is:

```text
(input_tokens * prompt_price) + (output_tokens * completion_price)
```

Prices are model-specific and reported in neuron (`1e18` neuron = `1 0G`); image/audio pricing can use different units. Current prices come from `GET /v1/models`. An empty balance eventually returns HTTP `402 insufficient_balance`. See [Deposits & Billing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/account/deposits).

The checked-in `.env.example` intentionally leaves `OG_COMPUTE_API_KEY` and `OG_COMPUTE_MODEL` empty. A live smoke test is blocked until a user:

- deposits testnet 0G into the testnet Router Payment Layer;
- creates a testnet `sk-` key at `https://pc.testnet.0g.ai/`;
- selects a currently listed model; and
- supplies those values through a server-side secret environment.

This is a credentials/funding boundary, not a code fallback opportunity. Sandbox results must remain visibly labeled and must not be described as 0G Compute responses.

### Direct SDK alternative and version drift

The alternative is the wallet-signed [official Compute SDK](https://github.com/0gfoundation/0g-compute-ts-sdk), currently [published as `0.9.0`](https://www.npmjs.com/package/@0gfoundation/0g-compute-ts-sdk/v/0.9.0):

```ts
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const broker = await createZGComputeNetworkBroker(wallet);
const services = await broker.inference.listService();
const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
const headers = await broker.inference.getRequestHeaders(providerAddress);
```

Direct requires a funded wallet, a ledger deposit, explicit provider selection/acknowledgement, and provider sub-account funding. Official docs state a minimum `3 0G` initial ledger deposit and `1 0G` locked per provider. It is a worse operational fit for this server MVP but remains appropriate for a future wallet-connected client requiring direct control.

Known drift:

- `@0glabs/0g-serving-broker` was renamed/deprecated at SDK `0.8.0`; use `@0gfoundation/0g-compute-ts-sdk`.
- The current [package manifest](https://github.com/0gfoundation/0g-compute-ts-sdk/blob/main/package.json) requires Node `>=20`, while the current Direct inference documentation lists Node `>=22`. This repository already chooses Node 22, satisfying both.
- The Router and Direct balance pools are distinct. Funding one does not fund the other.

## Storage integration

### Package selection and drift policy

Install exact versions:

```text
@0gfoundation/0g-storage-ts-sdk@1.2.11
ethers@6.13.1
```

The [official npm package](https://www.npmjs.com/package/@0gfoundation/0g-storage-ts-sdk/v/1.2.11) reports `1.2.11` as latest and requires exactly `ethers 6.13.1`. The official repository's current [package.json](https://github.com/0gfoundation/0g-storage-ts-sdk/blob/main/package.json) still reports `1.2.9`. The installed npm tarball is what production executes, so the project pins that artifact and adds runtime/CI contract tests for imports, tuple error handling, result discriminants, download behavior, and root recomputation. Do not use a caret range or assume GitHub `main` exactly represents the installed release.

The [Storage SDK guide](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk) and [SDK repository](https://github.com/0gfoundation/0g-storage-ts-sdk) identify `@0gfoundation/0g-storage-ts-sdk` as the supported TypeScript package.

### Exact upload and download contract

For the small canonical JSON reports used here:

```ts
import { Indexer, ZgFile } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(rpcUrl);
const signer = new ethers.Wallet(storagePrivateKey, provider);
const indexer = new Indexer(turboIndexerUrl);
const file = await ZgFile.fromFilePath(inputPath);

try {
  const [tree, treeError] = await file.merkleTree();
  if (treeError || !tree) throw treeError ?? new Error("No Merkle tree");
  const expectedRoot = tree.rootHash();

  const [uploaded, uploadError] = await indexer.upload(file, rpcUrl, signer);
  if (uploadError) throw uploadError;
  if (!("rootHash" in uploaded)) {
    throw new Error("Unexpected fragmented report upload");
  }
  if (uploaded.rootHash !== expectedRoot) {
    throw new Error("Upload root differs from local root");
  }
} finally {
  await file.close();
}
```

The exact result union is:

```ts
{ txHash: string; rootHash: string; txSeq: number }
| { txHashes: string[]; rootHashes: string[]; txSeqs: number[] }
```

Downloads are:

```ts
await indexer.download(rootHash, nonexistentOutputPath, true);
await indexer.download(rootHashes, nonexistentOutputPath, true);

const [blob, error] = await indexer.downloadToBlob(rootHash, { proof: true });
```

The path-based form is Node-only and expects a target path that does not already exist. `downloadToBlob` is browser/Node safe but buffers the complete object in memory. ActionProof chooses `downloadToBlob` for its strictly bounded, small JSON reports, then verifies the returned raw bytes and root before parsing. A future large-object path must use bounded filesystem streaming instead.

### Root semantics and mandatory recomputation

`merkleTree()` returns `[MerkleTree | null, Error | null]`; `tree.rootHash()` is the content commitment. The SDK uses 256-byte chunks and 256-KiB segments. Identical exact bytes produce the same root. Filename, MIME type, schema version, network, access policy, and owner are not encoded in it.

After download, recompute over the raw stored bytes:

```ts
const downloaded = await ZgFile.fromFilePath(outputPath);
try {
  const [tree, error] = await downloaded.merkleTree();
  if (error || tree?.rootHash() !== committedRoot) {
    throw error ?? new Error("Downloaded 0G root mismatch");
  }
} finally {
  await downloaded.close();
}
```

Also compare canonical bytes with the originally serialized report when both are available. If encryption is enabled later, the storage root commits ciphertext, so verify the raw encrypted object before decryption.

The default fragmentation threshold is 4 GiB. Array downloads concatenate fragments in order, but a root recomputed over the concatenated file does not equal each fragment root. ActionProof reports are intentionally constrained to the single-root path. Any future large-object path must retain an ordered fragment manifest and verify each raw fragment independently.

### High-level proof flag caveat

The documentation says the third `download` argument or `{ proof: true }` enables Merkle proof verification. However, the published [`1.2.11` downloader](https://unpkg.com/@0gfoundation/0g-storage-ts-sdk@1.2.11/lib.esm/transfer/Downloader.js) still labels the relevant implementation `TODO: add proof check` and ignores `_proof` inside `downloadTask`. The same issue is visible in [repository source](https://github.com/0gfoundation/0g-storage-ts-sdk/blob/main/src.ts/transfer/Downloader.ts).

Decision: continue passing `true` for forward compatibility, but never treat a null downloader error as cryptographic verification. Root recomputation is the integrity gate. A future SDK upgrade may remove this caveat only after a pinned-artifact test proves that corrupt segments fail proof validation.

### Costs, deduplication, and secrets

- Upload requires a funded EVM signer and pays chain gas plus a dynamically calculated storage fee. SDK upload option `fee: 0` means automatic fee calculation, not free storage.
- Default `skipIfFinalized: true` deduplicates already-finalized content. A repeat can return the existing root/sequence with an empty transaction hash, so code must not require a non-empty hash to recognize success.
- Downloads, root computation, and indexer reads do not require a signer.
- Keep the upload private key server-only in a secret manager. Do not reuse the verifier or relayer key unless an explicit custody decision authorizes that coupling.
- If encryption is added, its AES-256 or ECIES key is a separate unrecoverable secret. The network cannot recover a lost key.
- Turbo is faster and more expensive than Standard, and the two are independent storage networks. Persist `turbo` with the receipt and never assume a root is available through another indexer.

The fee and signer requirements are described in the [Storage CLI guide](https://docs.0g.ai/developer-hub/building-on-0g/storage/storage-cli); exact option behavior is implemented in the [Uploader source](https://github.com/0gfoundation/0g-storage-ts-sdk/blob/main/src.ts/transfer/Uploader.ts).

## Agentic ID deferral

0G documents two related but different identity surfaces:

- ERC-7857 Agentic IDs couple NFT ownership with encrypted agent intelligence and transfer/re-encryption flows.
- ERC-8004 supplies portable identity, discovery, and reputation registries.

The current [Agentic ID integration guide](https://docs.0g.ai/developer-hub/building-on-0g/agentic-id/integration) is not a drop-in production protocol integration. Its walkthrough deploys a custom simplified ERC-721-like contract and a mock oracle that must be replaced for production. It uses illustrative storage/compute service URLs and mixes older ethers-style calls with current dependencies. The [overview](https://docs.0g.ai/developer-hub/building-on-0g/agentic-id/overview) still labels marketplace/user paths as coming soon. Those are material security and lifecycle dependencies for ERC-7857, so ActionProof will not mint, transfer, or claim production Agentic IDs in the MVP.

ERC-8004 has a narrower, independently usable official surface with published registry addresses in the [0G ERC-8004 guide](https://docs.0g.ai/developer-hub/building-on-0g/agentic-id/erc8004):

| Registry   | Galileo (`16602`)                            | Mainnet (`16661`)                            |
| ---------- | -------------------------------------------- | -------------------------------------------- |
| Identity   | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

Registration is still deferred because it is not required to prove the core report-storage-attestation-action flow. If adopted later, the agent card must describe stable endpoints/capabilities, registration must be a separately approved on-chain write, and the global `agentId` must be persisted with its chain and registry address.

## Contradictions and deprecations to guard against

| Upstream inconsistency                                                                                                                 | Current decision                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older ecosystem pages/examples show Galileo chain ID `16601`; the current network page says `16602`.                                   | Use `16602` and assert `eth_chainId` at runtime.                                                                                                        |
| The Builder Playground shows an under-construction `@0glabs/0g-storage-sdk`/`ZeroGStorage` “v2.0.0” example.                           | Ignore it; use `@0gfoundation/0g-storage-ts-sdk`. [Playground evidence](https://build.0g.ai/playground/)                                                |
| The Storage starter kit has used the older `@0gfoundation/0g-ts-sdk` name.                                                             | Use the package named by current SDK docs and Builder Hub.                                                                                              |
| npm Storage latest is `1.2.11`, but repository `main` declares `1.2.9`.                                                                | Pin `1.2.11`; test the installed artifact; cite source-only behavior with its version caveat.                                                           |
| Storage docs say high-level proof verification is enabled, while published downloader code has an unimplemented proof check.           | Recompute and compare the complete raw-byte root.                                                                                                       |
| One Storage browser section says manual segment assembly is required, while the same docs and current typings expose `downloadToBlob`. | Use server path I/O here; if browser support is added, test the pinned `/browser` export and `downloadToBlob` rather than copying either claim blindly. |
| Compute examples historically use `@0glabs/0g-serving-broker`.                                                                         | It is deprecated; use `@0gfoundation/0g-compute-ts-sdk@0.9.0` only for Direct mode.                                                                     |
| Compute package requires Node 20 while current Direct docs list Node 22.                                                               | Project baseline remains Node 22.                                                                                                                       |
| Router and Direct appear in the same UI but use separate balances/contracts.                                                           | Record mode explicitly and never infer funding across modes.                                                                                            |
| Agentic ID examples imply an end-to-end flow but require a real oracle and production security work not supplied by the guide.         | Defer ERC-7857 integration; do not market the custom sample as production Agentic ID support.                                                           |

## Evidence required before a “live 0G” claim

All live tests use Galileo first and must retain sanitized receipts/logs without secrets.

1. RPC: `eth_chainId` returns `0x40da`; configured contract code exists at every intended address.
2. Compute: a user-funded testnet Router key completes one request; HTTP status, model, request ID, token usage, and runtime-schema result are captured. Malformed JSON is confirmed to fail closed.
3. Storage: a unique canonical report is locally rooted, uploaded through Turbo, located/finalized, downloaded to a new path, byte-compared, and independently rooted to the same value. Returned transaction data is checked on the explorer.
4. Chain: deployment and guarded action are performed only under explicit live-write gates; event data and state change are checked against the receipt.
5. Negative path: wrong chain, empty Compute balance, invalid model JSON, wrong storage root, expired attestation, and disabled mainnet broadcast all fail safely.

Until the funded steps above occur, accurate wording is “integration implemented/configured for 0G” or “sandbox demonstration,” not “live 0G inference/upload verified.”
