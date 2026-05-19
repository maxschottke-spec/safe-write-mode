# Audit Trail

`safe-write-mode` writes an append-only NDJSON log for every write attempt — refused, dry-run, or executed.

## Format

One JSON object per line. Each line has:

```json
{
  "ts": "2026-05-19T14:33:01.234Z",
  "integration": "erp",
  "method": "PATCH",
  "path": "/stock/SKU-42",
  "requestHash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "dryRun": false,
  "destructive": false,
  "reason": "manual restock after delivery 2026-05-19",
  "outcome": "ok",
  "status": 200,
  "durationMs": 142
}
```

Other possible `outcome` values:

| Outcome | When it appears |
|---|---|
| `refused` | The write was blocked by one of the three keys. Includes `reasonCode`. |
| `dry-run` | Dry-run was requested. `execute()` was not called. |
| `ok` | Write executed successfully. Includes `status` and `durationMs`. |
| `error` | `execute()` threw. Includes `error` (message), `status` (if HTTP), and `durationMs`. |

For `refused` entries, the `reasonCode` field tells you which gate fired:

- `READ_ONLY_MODE`
- `CONFIRMATION_REQUIRED`
- `DESTRUCTIVE_NOT_ACKED`
- `INVALID_MODE`

## Where it goes

By default: `./logs/writes-YYYY-MM-DD.ndjson`, rotated daily.

Override with `WRITE_LOG_DIR`:

```bash
WRITE_LOG_DIR=/var/log/safe-write npm start
```

The directory is created with `mkdirSync({ recursive: true })`. Make sure your process has write permissions.

## What's NOT in the log

By design:

- Request bodies (only their SHA-256 hash)
- Response bodies
- HTTP headers
- Authorization tokens or credentials
- PII of any kind (unless you put it in `reason`, which you shouldn't)

This makes the log safe to share with team members, store in version control (don't actually do that), or replicate to long-term storage. The hash lets you verify "yes, this request was made" without exposing what was in it.

## Operational guidance

- **Rotate offsite.** Logs sitting on the producing machine are vulnerable. Stream to S3, GCS, or a SIEM.
- **Restrict directory permissions.** `chmod 700` the log directory.
- **Monitor size.** A misconfigured loop generating thousands of refused writes will fill the disk fast. Add log-volume monitoring.
- **Don't put secrets in `reason`.** Free-form strings are tempting. Resist.
- **Read the log after incidents.** When something breaks, the audit trail tells you what was attempted and what was refused. That's often the first place to look.

## Why NDJSON and not a database

- Zero dependencies. The standard library does it.
- Streamable. Tools like `jq`, `awk`, `grep` work out of the box.
- Append-only. Tampering breaks readability without sophisticated tooling.
- Forward-compatible. If you later want to ship to a database, replay the NDJSON.

If you want database-grade audit (queryable, indexed, with retention policies), wrap `logWrite` or stream the NDJSON into your warehouse.

## Verifying audit integrity

Given a stored audit entry and the original request body, you can verify that the body matches:

```js
const crypto = require('node:crypto');
function verify(body, hashFromAudit) {
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  const h = 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
  return h === hashFromAudit;
}
```

Note: this only works if the body is **byte-identical** — same key order, same whitespace, same types. JSON serialization is not deterministic across runtimes, so this is best-effort. Use it to confirm "this looks plausible," not "this is mathematically the exact request."
