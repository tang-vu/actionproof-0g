# Deployment and operations

No mainnet transaction is broadcast by repository scripts unless the operator supplies credentials,
sets both live-write gates, and explicitly invokes a broadcast command. Never paste a private key
into an issue, terminal recording, browser field, or chat. Put secrets in a local `.env` excluded by
Git, or in the hosting provider's encrypted secret manager.

## Toolchain

- Node.js 22+
- pnpm 11.20.0
- Foundry 1.7.1
- Solidity 0.8.24, Cancun, optimizer 200, metadata bytecode hash `none`

0G supports Foundry and Cancun. Solidity 0.8.24 is used because it is the first stock compiler that
accepts the Cancun target; the settings must match during explorer verification.

## Configuration tiers

Start from `.env.example`. The checked-in file contains descriptions and no secrets.

### Sandbox

```text
ACTIONPROOF_MODE=sandbox
NEXT_PUBLIC_ACTIONPROOF_MODE=sandbox
```

No 0G service is called and no funds are spent. All receipts are labeled sandbox.

### Live Galileo

Required server configuration:

```text
ACTIONPROOF_MODE=live
OG_NETWORK=galileo
OG_CHAIN_ID=16602
OG_RPC_URL=<managed Galileo RPC; public development RPC for smoke only>
OG_EXPLORER_URL=https://chainscan-galileo.0g.ai
OG_STORAGE_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
OG_STORAGE_EXPLORER_URL=https://storagescan-galileo.0g.ai
OG_STORAGE_PRIVATE_KEY=<separate low-value server-only 0x-prefixed key>
OG_COMPUTE_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
OG_COMPUTE_API_KEY=<server-only sk- key>
OG_COMPUTE_MODEL=<currently listed model with JSON mode>
READINESS_TIMEOUT_MS=10000
VERIFIER_PRIVATE_KEY=<server-only 0x-prefixed key>
RELAYER_PRIVATE_KEY=<server-only 0x-prefixed key>
ACTIONPROOF_GUARD_ADDRESS=<deployed guard>
ACTIONPROOF_AGENT_ADDRESS=<exact action-agent wallet>
# Optional; when set, its official ERC-8004 agentWallet must match ACTIONPROOF_AGENT_ADDRESS.
OG_AGENTIC_ID=<global uint256 agent ID>
DEMO_COUNTER_ADDRESS=<deployed demo counter>
DEMO_TOKEN_ADDRESS=<deployed demo token>
ENABLE_LIVE_WRITES=true
ALLOW_MAINNET_BROADCAST=false
```

Keep the funded Storage signer separate from the verifier. The API startup validator reports exact
missing variables.

### Mainnet

Mainnet additionally requires:

```text
OG_NETWORK=mainnet
OG_CHAIN_ID=16661
OG_RPC_URL=<managed mainnet RPC>
OG_EXPLORER_URL=https://chainscan.0g.ai
OG_STORAGE_INDEXER_URL=https://indexer-storage-turbo.0g.ai
OG_STORAGE_EXPLORER_URL=https://storagescan.0g.ai
OG_COMPUTE_BASE_URL=https://router-api.0g.ai/v1
ALLOW_MAINNET_BROADCAST=true
```

Setting variables is not authorization by itself. The operator must review the checklist below and
explicitly approve the broadcast.

## Contract deployment

1. Create fresh, low-value deployer/verifier/relayer accounts.
   `pnpm bootstrap:testnet` can create the four isolated keys in ignored local `.env` without
   printing secrets; it preserves any valid keys already present.
2. Fund the deployer on Galileo from `https://faucet.0g.ai`.
3. Keep private keys in local environment variables. Inspect addresses with `cast wallet address`
   without printing private keys.
4. Build and test:

```bash
pnpm test:contracts
```

5. Run a dry simulation (it creates contracts only inside the local simulation):

```bash
cd packages/contracts
AUTHORIZED_VERIFIER=0x... EXPECTED_CHAIN_ID=16602 DRY_RUN=true DEPLOY_DEMOS=true \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://evmrpc-testnet.0g.ai -vvvv
```

PowerShell equivalent:

```powershell
$env:AUTHORIZED_VERIFIER='0x...'
$env:EXPECTED_CHAIN_ID='16602'
$env:DRY_RUN='true'
$env:DEPLOY_DEMOS='true'
forge script script/Deploy.s.sol:Deploy --rpc-url https://evmrpc-testnet.0g.ai -vvvv
```

6. Review bytecode size, predicted addresses, chain ID, verifier, balances, gas estimate, and diff.
7. Broadcast only after approval:

```bash
DRY_RUN=false DEPLOYER_PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$OG_RPC_URL" --broadcast -vvvv
```

On mainnet the deployment script also requires `ALLOW_MAINNET_BROADCAST=true`. The dry-run flag,
Foundry `--broadcast`, deployer key, and mainnet gate are independent controls; a mainnet broadcast
must still have the repository owner's explicit authorization.

8. Copy actual addresses, deployer, block/transaction IDs, compiler settings, and UTC timestamp to
   `packages/contracts/deployments/galileo.json`. Do not fill fields from predictions.

## Explorer verification

ChainScan custom verification endpoints:

- Galileo: `https://chainscan-galileo.0g.ai/open/api`
- Mainnet: `https://chainscan.0g.ai/open/api`

Use the exact compiler and settings from `foundry.toml`:

```bash
forge verify-contract <GUARD_ADDRESS> src/ActionProofGuard.sol:ActionProofGuard \
  --chain 16602 \
  --verifier custom \
  --verifier-url https://chainscan-galileo.0g.ai/open/api \
  --compiler-version 0.8.24 \
  --watch
```

Supply constructor arguments when requested. Repeat for demo contracts. Open each ChainScan page,
confirm source/ABI/settings, and add direct links to the deployment record and README.

## Compute and Storage readiness

1. At `https://pc.testnet.0g.ai`, connect a low-value wallet, deposit testnet 0G into the Router
   Payment Layer, and create an inference-only `sk-` key.
2. Read `GET /v1/models`; choose a current model supporting `response_format`. Do not copy a stale
   documentation model ID.
3. Fund the Storage/relayer accounts only enough for demo operations.
4. Run the non-spending checks first:

```bash
pnpm probe:0g
pnpm test:live
```

`pnpm probe:0g` needs no key and makes no paid request. It checks the public Chain RPC and chain ID,
the unauthenticated Compute `/models` catalog, and Storage indexer node selection on both official
networks. Live API readiness additionally checks guard bytecode, the onchain authorized verifier,
the configured model, and optional ERC-8004 wallet binding.

5. After explicitly enabling Galileo writes, run the full safe scenario and retain sanitized
   receipts. The smoke script never treats sandbox output as a live success.

```bash
LIVE_SMOKE_CONFIRM=SPEND_GALILEO_0G pnpm demo:live
```

For mainnet, the separate acknowledgement is `LIVE_SMOKE_CONFIRM=SPEND_MAINNET_0G`; do not set it
without explicit owner authorization and a reviewed maximum spend.

## Web/API hosting

The API requires a persistent writable data directory and server-side secrets; deploy it as a Node
service, not an edge function. Restrict CORS to the exact frontend origin. Put it behind TLS and a
reverse proxy with request size/time limits. The web app can run on any Node-compatible Next.js host.

Set only public values under `NEXT_PUBLIC_*`. A CI/build-time search should find no private key,
Compute key, management key, or funded signer in `.next/static`.

Recommended process layout:

```text
frontend.example       -> Next.js :3000
api.frontend.example   -> Fastify :8787 -> persistent volume
```

Use a managed redundant RPC for production and monitor Router/indexer/RPC health separately.

## Mainnet readiness checklist

- [ ] `pnpm verify` passes on the exact commit.
- [ ] Contract bytecode/source/settings match the Galileo verified deployment.
- [ ] Safe, block, tamper, expiry, replay, reentrancy, and downstream-revert evidence is reviewed.
- [ ] Independent security review/audit completed; residual findings accepted in writing.
- [ ] Owner, verifier, relayer, and storage signer roles/keys are separated and access-reviewed.
- [ ] Owner rotation/recovery procedure tested.
- [ ] Managed mainnet RPC and fallback are configured; chain ID check returns `16661`.
- [ ] Current 0G Compute model, price, key scope, and balance are reviewed.
- [ ] `pnpm probe:0g` passes and live `/ready` confirms guard bytecode/verifier/model/indexer checks.
- [ ] If `OG_AGENTIC_ID` is enabled, its registered wallet equals the exact configured action agent.
- [ ] Storage fee estimate and independent download/root verification succeed on a unique object.
- [ ] Mainnet deployer is funded with a deliberate maximum spend.
- [ ] `ENABLE_LIVE_WRITES=true` and `ALLOW_MAINNET_BROADCAST=true` are approved for one window only.
- [ ] Deployment simulation, gas, verifier address, and predicted addresses have a second reviewer.
- [ ] Mainnet broadcast explicitly authorized by the repository owner.
- [ ] ChainScan source verification and deployment record update are completed immediately.
- [ ] Demo still uses valueless assets and UI security disclaimer remains visible.

## Recovery and rollback

Contracts are not upgradeable. A code defect requires deploying a new guard, verifying it, updating
configuration/deployment records, and leaving the old address visible as deprecated. Never overwrite
old records.

For verifier compromise, rotate `authorizedVerifier` from the owner, disable API writes, rotate
server credentials, audit recent `AttestationAnchored` events, and redeploy if ownership is in doubt.
Rotation does not revoke already anchored actions, so deadlines are deliberately short.

For an application release defect, disable live writes first, roll the web/API back to the last
verified image, keep trace data read-only, and reconcile pending jobs/nonces before re-enabling. For
a wrong Storage upload, retain the immutable object but do not anchor it; publish a corrected report
under a new root. Onchain history cannot and should not be deleted.
