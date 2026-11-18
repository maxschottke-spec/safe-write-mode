# Three-Key Protection

A write is only sent to a remote system if **all three** of these are true:

| Key | Where set | Defends against |
|---|---|---|
| `SAFE_WRITE_MODE=read-write` | Environment variable | Misconfigured agents, runaway loops, mistaken environments |
| `{ confirmed: true }` | Per-call options | Forgotten flags, copy-pasted code, accidental batching |
| `{ destructive: true }` | Per-call options (only for `DELETE` or operations you classify as irreversible) | Confusing a delete for an update, irreversible API calls |

Plus `{ dryRun: true }` lets you exercise the same code path without sending the request.

## Failure modes each key prevents

### SAFE_WRITE_MODE=read-only (default)

Defends against: an agent or script running in a "wrong" environment. Examples:

- A developer copies a production credential into their laptop's `.env`. Without `SAFE_WRITE_MODE=read-write`, nothing they run can write to prod.
- An agent loop has a bug and tries to send 500 PATCH calls in 30 seconds. Without `SAFE_WRITE_MODE=read-write`, all 500 throw `SafetyError`.
- A CI job inherits credentials. Without explicitly setting `SAFE_WRITE_MODE=read-write`, no writes leak out of CI.

Default MUST be read-only. Switching is **deliberate per session**, not per code change.

### { confirmed: true }

Defends against: well-intentioned writes that the caller didn't actually mean to send. Examples:

- An agent invokes `client.write.patch(...)` while reasoning through a plan. Without `confirmed: true`, the call is refused, the agent gets the refusal logged, and it has to re-plan.
- A new contributor adds a `client.write.put(...)` line for a "test" and pushes it. Without `confirmed: true`, it never fires in production.

The flag must be set **at the call site**, not at the client level. Don't hardcode `confirmed: true` in your client wrapper. That defeats the point.

### { destructive: true }

Defends against: confusing a destructive operation with a non-destructive one. Examples:

- `DELETE /products/X` looks like `PATCH /products/X` in code, but the consequences differ by 6 orders of magnitude. The destructive flag forces the caller to say it out loud.
- An agent generating cleanup code might emit DELETEs that the operator didn't ask for. Without `destructive: true`, all DELETEs are refused.

Use this flag for any operation that is hard or impossible to reverse: deleting records, cancelling orders, charging cards, sending emails, posting to public channels.

## The `dryRun` companion

`dryRun: true` is **not** a fourth key — it's a parallel mode. When set:

- All three keys are still checked, including the mode: a dry-run needs `SAFE_WRITE_MODE=read-write` and `confirmed: true` (and dry-running a destructive write still requires `destructive: true`)
- The `execute()` callback is **not** called
- The audit log records the attempt with `outcome: 'dry-run'`
- Returns `{ dryRun: true, integration, method, path }`

Use dry-run as the first step of any new write. Show the user/operator the dry-run output, then run the real call with the same options minus `dryRun`.

## Where to put each flag

```js
// .env or shell — session-level
SAFE_WRITE_MODE=read-write

// Code — call-level
await integration.write.patch('/path', body, {
  confirmed: true,         // always at call site
  destructive: false,      // explicit, even when false
  reason: 'why this call exists',
  dryRun: false,
});
```

The `reason` field is not enforced but is strongly recommended. It lands in the audit log. Future-you reading the log six months later will thank present-you.
