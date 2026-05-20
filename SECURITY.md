# Security Policy

## Threat model

`safe-write-mode` is a **defensive** library. It does not:

- Make network calls on its own (you provide the client; the bundled adapters are skeletons)
- Store credentials (you provide them via env)
- Process untrusted input (callers provide validated payloads)
- Run code from configuration

It does:

- Read `process.env.SAFE_WRITE_MODE` (and legacy `MODE`), `LOG_LEVEL`, `WRITE_LOG_DIR` from environment
- Compute SHA-256 hashes of request bodies
- Append to log files in `WRITE_LOG_DIR` (default: `./logs/`)
- Write to `process.stderr`

If your threat model requires that this library cannot read the environment or write to disk, **don't use it as-is**. Vendor it, or wrap it.

## What v0.2 protects against — and what it does not

### Protects against (v0.2)

- Accidental writes from a process running with the default `read-only` mode
- Caller-supplied payload typos hitting destructive endpoints (`{ destructive: true }` ack required for `DELETE` and for any path matching `/reset|/purge|/wipe|/clear|/flush|/destroy|/factory-reset/i`)
- SSRF against link-local, loopback, RFC1918, RFC6598, IPv6 ULA, and cloud-metadata endpoints (e.g. `169.254.169.254`)
- Bearer-token leak via path-injection: example adapters refuse cross-origin paths, protocol-relative paths, scheme-prefixed paths, backslash paths
- Secret leak through structured logs: keys named `authorization|cookie|set-cookie|password|secret|token|api[_-]?key|...` are redacted; values matching `Bearer …` / `sk-…` / `ghp_…` / `xox?-…` / `AKIA…` are masked
- Secret leak through error messages: full URLs (query string + userinfo) are stripped before being interpolated into `HttpError` messages
- Crafted client smuggling: `createIntegration` only accepts clients constructed via `defineAdapter`; the internal write symbol is not exported
- Mode tampering: `lockMode()` captures the current mode in a frozen closure; later mutations to `process.env.SAFE_WRITE_MODE` are ignored
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
- HTTP method + path (strings you provide)
- SHA-256 hashes of bodies (no plaintext)
- Boolean flags (dryRun, destructive)
- Free-form `reason` strings (caller-provided)
- Error messages from caught exceptions (URLs sanitized — see CHAIN-2(d) in audit_swm_v01_external)

It does **not** contain:

- Request bodies
- Response bodies
- Credentials, tokens, or any header values

Treat audit logs as **operationally sensitive** — they reveal integration names and call patterns. Directory is created with mode `0700`; files are opened with mode `0600`. Rotate to long-term storage.

## Reporting vulnerabilities

If you find a security issue:

1. **Do not** open a public GitHub issue.
2. Use GitHub Private Vulnerability Reporting on https://github.com/maxschottke-spec/safe-write-mode/security/advisories/new — OR email `max.schottke@gmail.com` with subject `[safe-write-mode SECURITY]` and include a description, proof of concept if possible, and the version you tested against.
3. Expect an acknowledgement within 5 business days.

Coordinated disclosure preferred. Public credit for reporters who follow the process.

## Out of scope

- Vulnerabilities in `node:crypto`, `node:fs`, `node:dns`, or the `fetch` runtime
- Misuse of the library outside its documented contract (e.g. catching `SafetyError` silently to bypass safety; setting `SAFE_WRITE_MODE=read-write` system-wide; never calling `lockMode()`)
- DNS rebind against SSRF guard (acknowledged limitation — pin-IP agent on v0.3 roadmap)
- Audit-log tamper after the fact (hash-chain on v0.3 roadmap)

## Known limitations

- `getMode()` reads `process.env.SAFE_WRITE_MODE` at call time unless `lockMode()` has been called. Hosts that need a real freeze must call `lockMode()` during startup before any agent code runs.
- Audit log writes are synchronous (`writeSync`). High-throughput callers may want to buffer.
- HTTP layer follows `redirect: 'manual'` and refuses 3xx. If your target intentionally redirects, you must handle it before calling `request()`.
- SSRF guard refuses `http://` unless `SAFE_WRITE_ALLOW_INSECURE=1` is set. The opt-in is intended for local development against a vendor sandbox on `localhost`; the IP-range check still runs.

## Audit trail

`safe-write-mode` is independently audited. See [`audit_swm_v01_external`](../memory/audit_swm_v01_external.md) (internal Max-Schottke memory) for the full history; round-2 fixes (2026-05-20) are documented in `test/audit-fixes-r2.test.js` as executable regression coverage.
