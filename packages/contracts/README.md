# ActionProof contracts

`ActionProofGuard` is a fail-closed, two-transaction EIP-712 execution guard. An authorized
verifier signs an `ActionAttestation` over the agent, requester, exact target/value/calldata,
intent and report commitments, verdict, destination chain, sequential nonce, and validity window.

1. Any relayer calls `anchorAttestation(attestation, signature)`. This verifies the current
   authorized signer, stores that signer with the anchor, and consumes the `(agent, requester)`
   nonce.
2. Any relayer calls `executeAttestedAction(attestation, actionCalldata, signature)`. This requires
   the exact anchor, rechecks the signature against the verifier pinned in that anchor, and permits
   execution only for verdict code `1` (`SAFE`/`allow`).

Verdict `2` (`UNSAFE`/`block`) and verdict `3` (`REVIEW`) remain auditable on-chain but can never
execute.

## Security model

- The EIP-712 domain is `ActionProof` version `1` and binds signatures to both the runtime chain ID
  and the deployed guard address, matching `@actionproof/core`.
- `destinationChainId` is checked again as an explicit signed action field.
- Anchoring and execution are permissionless to relay. Authority comes from the authorized
  verifier signature and the completely bound action, not `msg.sender`.
- Nonces increase strictly by one per `(agent, requester)` lane at anchor time.
- `usedAttestations(digest)` prevents duplicate anchors; `executedAttestations(digest)` separately
  prevents duplicate successful execution.
- `issuedAt <= block.timestamp < expiresAt`; malformed windows fail closed.
- Intent, report root, and report hash commitments must be nonzero.
- The actual calldata and `msg.value` must match the signed values exactly.
- Execution state is committed before the target call and the guard is non-reentrant.
- Target revert data is propagated byte-for-byte. A failed target call rolls back only the
  execution flag, preserving the earlier anchor and nonce so execution can be retried.
- Verifier rotation affects future anchors only. Existing anchors retain and enforce the verifier
  that authorized them.
- `hashActionRequest` implements the exact non-domain struct hash used by `@actionproof/core`.

The authorized verifier is an ECDSA account. The owner can rotate it. Operational ownership and
the verifier key should be separate and protected by an appropriate multisig/HSM policy before a
production deployment.

## Build and test

Foundry is configured for Solidity 0.8.24, `evmVersion = "cancun"`, and optimizer 200. Solidity
0.8.24 is the first stock compiler release that accepts the Cancun target; stock 0.8.19 rejects
it even though older 0G examples mention that combination.

```bash
cd packages/contracts
forge fmt --check
forge build
forge test -vvv
# or from the workspace:
pnpm --filter @actionproof/contracts test
```

The tests vendor only a minimal cheatcode/assertion interface, so no git submodule or `forge-std`
installation is required.

## Deployment readiness

The deployment script is dry-run/readiness-first and supports the current 0G network IDs:

| Network         | Chain ID | RPC                            | Explorer                          |
| --------------- | -------: | ------------------------------ | --------------------------------- |
| Galileo testnet |    16602 | `https://evmrpc-testnet.0g.ai` | `https://chainscan-galileo.0g.ai` |
| Mainnet         |    16661 | `https://evmrpc.0g.ai`         | `https://chainscan.0g.ai`         |

Simulate Galileo without broadcasting:

```bash
AUTHORIZED_VERIFIER=0x... \
EXPECTED_CHAIN_ID=16602 \
DRY_RUN=true \
forge script script/Deploy.s.sol:Deploy --rpc-url https://evmrpc-testnet.0g.ai -vvvv
```

Broadcast only after the simulation and verifier address have been reviewed:

```bash
AUTHORIZED_VERIFIER=0x... \
DEPLOYER_PRIVATE_KEY=0x... \
EXPECTED_CHAIN_ID=16602 \
DRY_RUN=false \
DEPLOY_DEMOS=false \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --broadcast -vvvv
```

The script rejects unlisted chains by default. For a local fork, set `ALLOW_UNLISTED_CHAIN=true`.
Demo contracts are opt-in with `DEPLOY_DEMOS=true`. After a reviewed broadcast, copy the emitted
addresses and transaction metadata into the appropriate initially-empty record in `deployments/`.
Mainnet additionally refuses a non-dry run unless `ALLOW_MAINNET_BROADCAST=true`; invoking Foundry's
`--broadcast` flag and providing a deployer key are still required separately.

For ChainScan verification, use Solidity 0.8.24, Cancun, optimizer 200, and metadata bytecode hash
`none`, matching `foundry.toml`.
