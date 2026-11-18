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

## Reporting a bug, asking a question

Use the [issue forms](https://github.com/maxschottke-spec/safe-write-mode/issues/new/choose). A bug report needs the version you installed, your Node.js version, the smallest file that shows the problem, and what you expected versus what happened. Remove tokens, hostnames and customer data first.

A report of your first try is as welcome as a bug report, especially if you got stuck.

Security problems do not belong in a public issue. See [SECURITY.md](SECURITY.md).

## Process

1. Open an issue describing the change before writing code, unless it's a one-line fix.
2. Fork, branch, commit. Conventional Commits welcome but not required.
3. `npm test` must pass. There is nothing to install first: `git clone`, then `npm test`.
4. Add a line to the "Unreleased" section of `CHANGELOG.md` if users can notice the change.
5. PR with a clear description: what changed, why, what you tested. The pull request template asks for exactly that.

CI runs `npm test` on Ubuntu with Node 22 and 24 for every pull request.

## Code style

- No build step. CommonJS. Node ≥ 22.
- No runtime dependencies. Test-only and dev deps are fine if necessary.
- Comments only when the *why* is non-obvious. Code should be readable on its own.
- Errors thrown should be typed (`SafetyError`, `HttpError`) or extend a typed error.

## Tests

Tests live in `test/` and run with `npm test`. Running `node --test` directly fails every test that needs the test hooks (30 at the time of writing) with `TEST_HOOKS_DISABLED`, because the hooks are off by default; use `SAFE_WRITE_TEST_HOOKS=1 node --test 'test/*.test.js'`. No test framework, no test runner config.

The tests write their logs to temporary directories. The examples (`npm run example:*`) write to `./logs`, which is ignored by git. Three test files guard the documentation and are worth knowing: `test/fixes-0.2.1.test.js` runs the `first.js` block of the README as printed, `test/examples.test.js` runs every example, and `test/types.test.js` fails when `index.d.ts` and the real exports drift apart. If you add or rename an export, update `index.d.ts`.

If you can't write a test for it, reconsider whether it belongs in this library.

## Releases

Maintainer rolls releases. Semver. v0.x = API may change; v1.0 once the API is locked.
