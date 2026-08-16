# Three-minute demo script

The default demo is a clearly labeled local sandbox. It proves product behavior without pretending
to create 0G transactions. The live variant uses the same orchestration and trace verifier after the
credentials and deployed addresses in [DEPLOYMENT.md](DEPLOYMENT.md) are supplied.

## Prepare once

```bash
pnpm install
pnpm --filter @actionproof/web exec playwright install chromium
pnpm verify
```

Start the judge console:

```bash
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:3000`. Confirm the top-right badge and Integration Status panel say
`Sandbox`, unless a reviewed live Galileo configuration was deliberately supplied.

The CLI alternative is:

```bash
pnpm demo
```

It runs safe, dangerous, and tamper fixtures, prints their trace IDs and verdict evidence, and exits
nonzero if any invariant is missing.

For the verified Galileo production-adapter story, use `pnpm demo:live`. The reference evidence is
checked in at `docs/evidence/galileo-live.json`; safe trace ID is
`fdad8624-8cce-4b8a-8576-c724463469c7` and dangerous trace ID is
`e68696d3-e399-49f9-ab70-3188fac06ab1` in the persisted operator data directory.

### Fastest judge path — no setup and no spend

Open `https://actionproof.tangvu.dev`. The three story cards are an ordered guided demo:

1. **Allow** opens the preserved live Galileo safe trace with Storage, anchor, and execution links.
2. **Block** opens the preserved unlimited-approval trace with its deterministic rule and no
   execution transaction.
3. **Break** jumps to the safe trace's live server-side tamper control; click **Run tamper test**.

The hosted Analyze page mirrors the selected envelope and links to the matching preserved proof.
It intentionally does not spend funded server balances. `pnpm smoke:public` independently verifies
that this deployment is live, the evidence is intact, and anonymous writes fail synchronously.

## Narration

### 0:00–0:25 — Problem and boundary

> Autonomous agents can generate and submit transactions faster than a human can review them. A
> natural-language intent is not the transaction, and an AI opinion is not enforcement. ActionProof
> creates proof before action: deterministic checks, simulation, advisory inference, immutable
> evidence, and an onchain guard.

On the landing page, point to “The model is one witness. Never the judge.” Briefly show the runtime
status. Say explicitly whether the demo is sandbox or live Galileo.

### 0:25–1:15 — Safe action

1. Open **Analyze**.
2. Keep **Safe counter** selected.
3. Expand calldata and point out the exact `increment()` selector, target, zero value, chain, nonce,
   intent, and deadline.
4. In sandbox or a supervised write window, click **Analyze & attest**. On the public hosted build,
   click **Inspect safe Galileo proof** instead.
5. For a new run, let the actual pipeline states complete: policy, simulation, Compute, Storage,
   Chain anchor, then guarded execution. For hosted evidence, walk the recorded stage receipts.
6. Open the public trace.
7. Point out the fresh **Verify evidence now** server check before demonstrating tampering.

> The exact action hash is independent of the report. The canonical report has its own hash, 0G
> Storage supplies the Merkle root, and EIP-712 binds both to this chain, this guard, this nonce, and
> this deadline. Only an allow anchor reaches the valueless counter.

On a live Galileo run, open the ChainScan anchor/execution links and StorageScan link/transaction
from the trace. In sandbox, do not imply those hashes exist on 0G.

### 1:15–2:05 — Dangerous action

1. Return to **Analyze**.
2. Select **Unlimited approval**.
3. Show that the declared intent sounds ordinary while calldata contains `approve(spender,
uint256.max)`.
4. Click **Analyze & attest** in a writable run, or **Inspect blocked Galileo proof** on the public
   hosted build, then open the trace.

> The deterministic engine decoded the standard ABI and raised
> `UNLIMITED_ERC20_APPROVAL`. That hard rule forces block. The model cannot lower it. The report is
> still stored and anchored for audit, but the execution stage is skipped and the contract rejects
> any attempt to execute a block verdict.

Point to the blocking rule ID, evidence, skipped/blocked execution status, and all integrity checks.

### 2:05–2:40 — Tamper and replay

1. On either trace, click **Run tamper test**.
2. Show the one-byte calldata mutation and **Verification rejected**.

> The original signature covers `keccak256(calldata)`. One changed byte changes the request and
> attestation digest, so the anchored evidence no longer matches. The same contract also rejects
> wrong targets, values, roots, chain IDs, expired deadlines, stale nonces, reused anchors, and a
> second execution.

If using the CLI, show its replay/tamper rejection lines.

### 2:40–3:00 — Architecture and honesty

Open **Architecture**.

> ActionProof is open-source experimental infrastructure, not audited and not a guarantee of
> safety. This MVP uses valueless demo contracts. The real adapters use 0G Compute Router, 0G
> Storage Turbo with independent root recomputation, and 0G Chain for EIP-712 anchors and guarded
> execution. Production mainnet broadcast remains disabled until explicitly authorized and funded.

## Live evidence checklist

Before describing a run as live, verify all of these on screen:

- Integration Status says `0G live`, not sandbox;
- chain ID is `16602` (or explicitly authorized mainnet `16661`);
- Compute metadata contains a real Router request ID and provider;
- Storage receipt contains the returned root and transaction data;
- anchor/execution receipts link to the correct ChainScan;
- contract addresses equal committed deployment records;
- retrieved bytes reproduce the report hash and Storage root.

If any service is unavailable, show the failure state. Do not switch modes during the narration.

## Reset / recovery

Sandbox state is isolated under the configured API data directory. Stop both processes before
moving that directory aside for a clean demo. Do not delete or overwrite live deployment records.
If a browser stage appears stuck, retain the API request ID/log, refresh the job route, and describe
the actual timeout rather than claiming completion.
