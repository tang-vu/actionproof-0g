# Security policy

ActionProof is experimental security infrastructure and has **not** been audited. Do not use it to
protect valuable assets. The repository's demo contracts and fixtures are intentionally valueless.

## Reporting a vulnerability

Please avoid publishing exploit details in a public issue. Use GitHub's private vulnerability
reporting for this repository when it is enabled, or contact the repository maintainer privately.
Include the affected commit, impact, reproduction steps, and a minimal proof of concept.

## Supported version

Only the latest commit on `main` is maintained during the hackathon. No deployed address should be
trusted unless it appears in a committed deployment record and its bytecode is verified on 0G
ChainScan.

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for trust assumptions and known limitations.
