# Security Policy

## Threat model

`safe-write-mode` is a **defensive** library. It does not:

- Make network calls from the core gate (you provide the client; the bundled adapters are skeletons). The optional `request()` helper does make them: `fetch` plus a DNS lookup
- Store credentials (you provide them via env)
- Process untrusted input (callers provide validated payloads)
- Run code from configuration

It does:

- Read `process.env.SAFE_WRITE_MODE` (and legacy `MODE`), `LOG_LEVEL`, `WRITE_LOG_DIR` and the other variables listed in the README from the environment. `SAFE_WRITE_AUDIT_KEY` is read once and then deleted from `process.env`
- Compute SHA-256 hashes of request bodies
- Append to log files in `WRITE_LOG_DIR` (default: `./logs/`)
- Write to `process.stderr`

If your threat model requires that this library cannot read the environment or write to disk, **don't use it as-is**. Vendor it, or wrap it.

## What it protects against — and what it does not

### Protects against

- Accidental writes from a process running with the default `read-only` mode
- Caller-supplied payload typos hitting destructive endpoints (`{ destructive: true }` ack required for `DELETE` and for any path matching `/reset|/purge|/wipe|/clear|/flush|/destroy|/factory-reset/i`; the path match is a best-effort heuristic, not a complete list)
- SSRF against link-local, loopback, RFC1918, RFC6598, IPv6 ULA, and cloud-metadata endpoints (e.g. `169.254.169.254`), including their IPv4-mapped and NAT64 IPv6 forms
- Bearer-token leak via path-injection: example adapters refuse cross-origin paths, protocol-relative paths, scheme-prefixed paths, backslash paths
- Secret leak through structured logs: keys named `authorization|cookie|set-cookie|password|secret|token|api[_-]?key|...` are redacted; values matching `Bearer …` / `sk-…` / `ghp_…` / `xox?-…` / `AKIA…` are masked
- Secret leak through error messages: full URLs (query string + userinfo) are stripped before being interpolated into `HttpError` messages
- Crafted client smuggling: `createIntegration` only accepts clients constructed via `defineAdapter`; the internal write symbol is not exported
- Mode tampering: `lockMode()` captures the current mode; later mutations to `process.env.SAFE_WRITE_MODE` are ignored, and a second `lockMode()` call with a different mode throws `MODE_LOCKED`
- Verifier removal: once `setConfirmationVerifier()` has installed a verifier, it cannot be replaced or cleared (`VERIFIER_LOCKED`)
- Loose consent flags: `confirmed` and `destructive` must be the boolean `true`; strings and numbers are refused
- GraphQL mutation smuggling: classifier strips BOM/Unicode whitespace and string/comment content, refuses mixed-operation documents

### Does NOT protect against (by design — in-process trust boundary)

- A hostile agent running in the same Node process can:
  - Construct its own `defineAdapter(...)` client with arbitrary semantics
  - Set `confirmed: true` and `destructive: true` on its own writes (these flags are caller-controlled — they are *ergonomics*, not a security boundary)
  - Modify `process.env` *before* `lockMode()` is called
- DNS rebind attacks against SSRF: lookup happens at request prep, fetch resolves again at connect time
- Audit-log tamper after the fact: NDJSON files are file-system writable; a hash-chain is on the v0.3 roadmap

To get a real boundary against an in-process agent, combine `safe-write-mode` with:
- Read-only API tokens at the provider (the strongest mitigation)
- Network-egress allowlists (firewall / VPC)
- A separate process / kernel boundary between the agent and the writes (see `setConfirmationVerifier` for an extension point that can talk to a host process)

## Audit log handling

The NDJSON audit trail contains:

- ISO timestamps
- Integration names (strings you provide)
- HTTP method + path (strings you provide; the query string is cut off before logging)
- SHA-256 hashes of bodies (no plaintext)
- Boolean flags (dryRun, destructive)
- Free-form `reason` strings (caller-provided)
- Error messages from caught exceptions (URLs sanitized — see CHAIN-2(d) in `audits/2026-05-20-round-2.md`)

It does **not** contain:

- Request bodies
- Response bodies
- Credentials, tokens, or any header values

Treat audit logs as **operationally sensitive** — they reveal integration names and call patterns. Directory is created with mode `0700`; files are opened with mode `0600`. Rotate to long-term storage.

## Reporting vulnerabilities

If you find a security issue:

1. **Do not** open a public GitHub issue.
2. Email `max.schottke@gmail.com` with subject `[safe-write-mode SECURITY]` and include a description, proof of concept if possible, and the version you tested against.
3. Expect an acknowledgement within 5 business days.

Coordinated disclosure preferred. Public credit for reporters who follow the process.

## Out of scope

- Vulnerabilities in `node:crypto`, `node:fs`, `node:dns`, or the `fetch` runtime
- Misuse of the library outside its documented contract (e.g. catching `SafetyError` silently to bypass safety; setting `SAFE_WRITE_MODE=read-write` system-wide; never calling `lockMode()`)
- DNS rebind against SSRF guard (acknowledged limitation — pin-IP agent on v0.3 roadmap)
- Audit-log tamper after the fact (hash-chain on v0.3 roadmap)
- Hostile code in the same Node process that reloads the module or edits the `require` cache. The test hooks in `src/safety.js` are disabled unless `SAFE_WRITE_TEST_HOOKS=1` was set before the library was loaded, but in-process code that controls module loading is outside what a library can defend against

## Known limitations

- `getMode()` reads `process.env.SAFE_WRITE_MODE` at call time unless `lockMode()` has been called. Hosts that need a real freeze must call `lockMode()` during startup before any agent code runs.
- Audit log writes are synchronous (`writeSync`). High-throughput callers may want to buffer.
- HTTP layer follows `redirect: 'manual'` and refuses 3xx. If your target intentionally redirects, you must handle it before calling `request()`.
- SSRF guard refuses `http://` unless `SAFE_WRITE_ALLOW_INSECURE=1` is set. The opt-in permits `http:` only. Loopback and private addresses stay blocked, so `request()` cannot reach `localhost` or `127.0.0.1`; test against a mock with your own client or stub `get`/`write`.

## Audit trail

`safe-write-mode` has been reviewed adversarially by AI agents, not by a third-party human auditor. See [`audits/`](audits/) for the history. Round-2 fixes (2026-05-20) have regression coverage in `test/audit-fixes-r2.test.js`, round-3 fixes (2026-11-18) in `test/fixes-0.2.1.test.js`.
