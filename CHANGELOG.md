# Changelog

## 0.2.1 — 2026-11-18

A third adversarial review (by AI agents) found seven ways around the gate and
several places where the documentation contradicted the code.

### Fixed

- `lockMode()` could be called a second time with a different mode, which
  reopened a locked read-only process. A second call with a different mode now
  throws `MODE_LOCKED`; a second call without an argument no longer re-reads
  the environment.
- `setConfirmationVerifier(null)` removed an installed verifier. A verifier can
  now be installed once and neither replaced nor cleared (`VERIFIER_LOCKED`).
- `confirmed` and `destructive` were checked for truthiness, so `'false'` or
  `1` counted as consent. Only the boolean `true` is accepted now.
- The SSRF guard let IPv4-mapped IPv6 addresses through, because the URL parser
  turns `[::ffff:127.0.0.1]` into `::ffff:7f00:1`. That form and the NAT64
  prefix `64:ff9b::/96` are now converted back to IPv4 and checked.
- Query strings were written to the audit log together with the path. The log
  now records the path without the query, plus `targetHash`, an HMAC-SHA-256 of
  the full target (key from `SAFE_WRITE_AUDIT_KEY`, otherwise random per
  process), so an entry still identifies the exact request without making the
  query guessable.
- A path that is not a string (for example an object with `pathname` and
  `search`) skipped both the destructive-path check and the query-string cut.
  Such targets are now refused with `INVALID_PATH`.
- The test hooks that undo a mode lock or remove the verifier were reachable
  through `require('safe-write-mode/src/safety')`. They now throw
  `TEST_HOOKS_DISABLED` unless `SAFE_WRITE_TEST_HOOKS=1` was set before the
  library was loaded.

### Changed

- **Breaking for callers that relied on loose flags:** pass `confirmed: true`
  and `destructive: true` as booleans.
- Node ≥ 22 is required (Node 20 reached end of life in April 2026).
- Documentation: the first README example now uses `defineAdapter`; the install
  command points to GitHub (the package is not on the npm registry); the FAQ no
  longer describes the v0.1 symbol API; all docs use `SAFE_WRITE_MODE` instead
  of the legacy `MODE`; "external security audit" was replaced by an accurate
  description of the reviews; a "Known limitations" section was added.
- `npm run example:write` and `example:dry-run` set the mode themselves.
- CI: `npm test` on Node 22 and 24.

## 0.2.0 — 2026-05-20

Round-2 review fixes. See `audits/2026-05-20-round-2.md`.
