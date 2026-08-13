# Contributing

ActionProof welcomes focused fixes to policy correctness, evidence verification, 0G integration,
accessibility, tests, and documentation.

1. Use Node 22, pnpm 11.20.0, and Foundry 1.7.1.
2. Create a branch and keep changes scoped.
3. Run `pnpm verify` before opening a pull request.
4. Never commit funded keys, API keys, or `.env` files.
5. Label sandbox behavior explicitly; tests must never silently replace unavailable 0G services.

Security-sensitive changes should include the broken invariant, the test that proves it, and any new
trust assumption. By contributing, you agree that your contribution is licensed under MIT.
