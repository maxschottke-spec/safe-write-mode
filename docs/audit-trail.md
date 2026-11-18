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
  "targetHash": "hmac-sha256:5b1c…",
  "requestHash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "dryRun": false,
  "destructive": false,
  "reason": "manual restock after delivery 2026-05-19",
  "auditId": "0b6f1c1e-6d0a-4a0e-9a57-2f6f3b1d7c11",
  "outcome": "ok",
  "status": 200,
  "durationMs": 142
}
```

Other possible `outcome` values:

| Outcome | When it appears |
|---|---|
| `refused` | The write was blocked by one of the gates. Includes `reasonCode`. |
| `pending` | Written BEFORE `execute()` runs. Pairs with a later `ok`/`error` entry via `auditId`. Lets you reconcile "request committed at remote but final log write failed" cases. |
| `dry-run` | Dry-run was requested. `execute()` was not called. |
| `ok` | Write executed successfully. Includes `status` and `durationMs`. |
| `error` | `execute()` threw. Includes `error` (message), `status` (if HTTP), and `durationMs`. |

For `refused` entries, the `reasonCode` field tells you which gate fired:

- `READ_ONLY_MODE`
- `CONFIRMATION_REQUIRED`
- `DESTRUCTIVE_NOT_ACKED` (DELETE without ack, or any method on a destructive-shaped path)
- `INVALID_MODE` is thrown before the first log entry and therefore never appears in the log; the same applies to `BODY_CYCLE` and `BODY_TOO_DEEP`
- `INVALID_METHOD` (non POST/PUT/PATCH/DELETE)
- `CONFIRMATION_REJECTED` (a host verifier refused or threw)
- `INVALID_PATH` (the target is not a string; the log shows `[non-string target]` instead of the value)
- `REASON_REQUIRED` (when `opts.requireReason` or `SAFE_WRITE_REQUIRE_REASON=1`)
- `AUDIT_UNAVAILABLE` (pre-execute fail-fast when log dir is not writable)

## Where it goes

By default: `./logs/writes-YYYY-MM-DD.ndjson` (UTC date; `ts` is UTC too). Files are date-named, not actively rotated — old files are not deleted by the library. Ship to long-term storage and prune manually, or wrap `logWrite` with retention logic.

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
- Query strings (cut off before logging; `targetHash` is an HMAC-SHA-256 of the full target, so an entry still identifies the exact request. Set `SAFE_WRITE_AUDIT_KEY` to keep the key stable across runs (the library reads it once at load and then removes it from `process.env`); without it a random per-process key is used. `requestHash` is a plain SHA-256 of the body: do not rely on it to hide short or guessable bodies)

Path, `reason` and error messages are logged as given. Keep identifiers, personal data and secrets out of them.

The log is still operationally sensitive (paths, reasons, timing): share it deliberately, keep it out of version control, and replicate it to long-term storage if you need it later. The hash lets you verify "yes, this request was made" without exposing what was in it.

## Operational guidance

- **Rotate offsite.** Logs sitting on the producing machine are vulnerable. Stream to S3, GCS, or a SIEM.
- **Restrict directory permissions.** `chmod 700` the log directory.
- **Monitor size.** A misconfigured loop generating thousands of refused writes will fill the disk fast. Add log-volume monitoring.
- **Don't put secrets in `reason`.** Free-form strings are tempting. Resist.
- **Read the log after incidents.** When something breaks, the audit trail tells you what was attempted and what was refused. That's often the first place to look.

## Why NDJSON and not a database

- Zero dependencies. The standard library does it.
- Streamable. Tools like `jq`, `awk`, `grep` work out of the box.
- Forward-compatible. If you later want to ship to a database, replay the NDJSON.

**Note on tamper-resistance.** The on-disk file is plain text — anyone with
write access to the directory can edit or delete lines cleanly. The "append-only"
property is a convention enforced by the library, not by the filesystem. If you
need actual tamper-evidence:

- Stream entries off-machine to append-only storage (S3 with object lock, a SIEM,
  a hash-chained ledger).
- Or wrap `logWrite` to add HMAC signatures per line with a key the application
  process cannot read after startup.
- Or set `chattr +a` on the file (Linux ext-family filesystems) to enforce
  append-only at the kernel level — but the library will not do this for you.

If you want database-grade audit (queryable, indexed, with retention policies), wrap `logWrite` or stream the NDJSON into your warehouse.

## Verifying audit integrity

Given a stored audit entry and the original request body, you can verify that the body matches by re-serializing with the same canonical algorithm:

```js
const { canonicalStringify } = require('safe-write-mode/src/safety');
const crypto = require('node:crypto');

function verify(body, hashFromAudit) {
  const str = typeof body === 'string' ? body : canonicalStringify(body);
  const h = 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
  return h === hashFromAudit;
}
```

`canonicalStringify` sorts object keys recursively before serializing, so semantically identical bodies (same data, different key order) produce the same hash. This means `verify` confirms "yes, an equivalent body was hashed" rather than "this exact byte sequence was sent." For an attacker-grade integrity proof you still want HMAC or a hash chain — see the tamper-resistance note above.
