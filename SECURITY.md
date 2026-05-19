# Security Policy

## Threat model

`safe-write-mode` is a **defensive** library. It does not:

- Make network calls on its own (you provide the client)
- Store credentials (you provide them via env)
- Process untrusted input (callers provide validated payloads)
- Run code from configuration

It does:

- Read `process.env.MODE`, `LOG_LEVEL`, `WRITE_LOG_DIR` from environment
- Compute SHA-256 hashes of request bodies
- Append to log files in `WRITE_LOG_DIR` (default: `./logs/`)
- Write to `process.stderr`

If your threat model requires that this library cannot read the environment or write to disk, **don't use it as-is**. Vendor it, or wrap it.

## Audit log handling

The NDJSON audit trail contains:

- ISO timestamps
- Integration names (strings you provide)
- HTTP method + path (strings you provide)
- SHA-256 hashes of bodies (no plaintext)
- Boolean flags (dryRun, destructive)
- Free-form `reason` strings (caller-provided)
- Error messages from caught exceptions

It does **not** contain:

- Request bodies
- Response bodies
- Credentials, tokens, or any header values

Treat audit logs as **operationally sensitive** — they reveal integration names and call patterns. Restrict directory permissions. Rotate to long-term storage.

## Reporting vulnerabilities

If you find a security issue:

1. **Do not** open a public GitHub issue.
2. Email the maintainer (see repository metadata) with a description, proof of concept if possible, and the version you tested against.
3. Expect an acknowledgement within 5 business days.

Coordinated disclosure preferred. Public credit for reporters who follow the process.

## Out of scope

- Vulnerabilities in `node:crypto`, `node:fs`, or the `fetch` runtime
- Misuse of the library outside its documented contract (e.g. catching `SafetyError` silently to bypass safety)
- Operator-error scenarios (running with `MODE=read-write` set system-wide, etc.)

## Known limitations

- `getMode()` reads `process.env.MODE` at call time. If env is mutated mid-process, behavior changes. This is intentional but worth knowing.
- Audit log writes are synchronous (`appendFileSync`). High-throughput callers may want to buffer.
- HTTP layer follows `redirect: 'manual'` and refuses 3xx. If your target intentionally redirects, you must handle it before calling `request()`.
