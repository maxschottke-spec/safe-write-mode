# Contributing

`safe-write-mode` aims to stay small, focused, and battle-tested. Contributions that fit that scope are welcome.

## What we accept

- Bug fixes with a test that reproduces the bug
- Test coverage improvements
- Documentation fixes
- New `examples/` showing the pattern in different contexts (no real vendor names or endpoints)
- New `adapters/*.example.js` skeletons (mock endpoints only)
- Performance fixes with a benchmark
- Translations of `SKILL.md` (must preserve the ritual structure)

## What we don't accept

- Vendor-specific integrations (Stripe SDK wrapping, etc.) — keep those in your own repo
- "Convenience" features that hide one of the three keys
- Bypass mechanisms for `SafetyError`
- New runtime dependencies (zero-dep is a feature)
- Refactors without a stated reason

## Process

1. Open an issue describing the change before writing code, unless it's a one-line fix.
2. Fork, branch, commit. Conventional Commits welcome but not required.
3. `npm test` must pass.
4. PR with a clear description: what changed, why, what you tested.

## Code style

- No build step. CommonJS. Node ≥ 18.
- No runtime dependencies. Test-only and dev deps are fine if necessary.
- Comments only when the *why* is non-obvious. Code should be readable on its own.
- Errors thrown should be typed (`SafetyError`, `HttpError`) or extend a typed error.

## Tests

Tests live in `test/` and run with `node --test`. No test framework, no test runner config. If you can't write a test for it, reconsider whether it belongs in this library.

## Releases

Maintainer rolls releases. Semver. v0.x = API may change; v1.0 once the API is locked.
