# Philosophy

## Why read-only by default

The default behavior of most API clients is "do what I tell you." That's fine for tooling humans use deliberately. It's catastrophic for tooling agents use loosely.

An LLM agent can be helpful one moment and ask "should I update the stock count?" — and confused the next moment, calling `client.patch('/products/X', { stock: 0 })` because it misread a number in a CSV.

The fix isn't smarter agents. The fix is **a default that makes the wrong thing impossible**.

`safe-write-mode` makes that default explicit:

- `SAFE_WRITE_MODE=read-only` is the default. Reads work. Writes throw `SafetyError`.
- Switching to `read-write` requires the operator to set an environment variable. It can't happen by accident.
- Even with `read-write`, every individual write requires `{ confirmed: true }`. The agent can't fire-and-forget.
- `DELETE` adds a third gate: `{ destructive: true }`. Anything irreversible should follow the same pattern.

## Why structural read-only

For integrations declared `readOnly: true`, there is **no `.write` property** on the returned object. Not "blocked." Not "throws." It simply doesn't exist.

```js
const erp = createIntegration({ name: 'erp', client, readOnly: true });
erp.write.patch(...);  // TypeError: Cannot read properties of undefined
```

This is more aggressive than a runtime check, and that's the point. If an integration is meant to be read-only — say, an analytics tool — then `.write` shouldn't even be reachable. Removing the property means even a misconfigured environment can't accidentally enable writes for that integration.

## Why audit hashes, not payloads

A naive audit log records the request body. This sounds responsible. It's a disaster:

- Bodies often contain customer PII (names, emails, addresses)
- Bodies often contain secrets (tokens, signed URLs, internal IDs)
- Audit logs typically sit at lower trust than the originating system, but inherit its sensitivity
- Storing payload-grade data multiplies your GDPR / SOC2 / breach-disclosure surface area

So `safe-write-mode` logs the **SHA-256 hash** of the body. You can prove a specific request was made (by re-hashing). You can detect tampering (the hash chain breaks). You cannot reconstruct the data.

If you actually need the payload for debugging, you can wrap `safeWrite` to record it in a separate, properly-secured store. But the default audit trail is hash-only.

## Why dry-run as a first-class concept

Production-changing operations should be **rehearseable**. `safe-write-mode` passes `dryRun: true` through `safeWrite`, which:

- Skips the actual execute
- Still logs the audit entry (so you have proof of intent)
- Returns `{ dryRun: true, ... }` so the caller can branch

This lets an agent (or operator) say "show me what would happen" without designing a separate rehearsal pipeline per integration. The pattern is uniform across all integrations.

## Why the three keys are independent

The three keys are not redundant:

- **`SAFE_WRITE_MODE`** is *session-level* trust. "This process is allowed to write at all."
- **`confirmed`** is *call-level* trust. "This specific call is intentional."
- **`destructive`** is *operation-level* trust. "I understand this cannot be undone."

Each defends against a different failure mode. Removing any one weakens the system. A loop that calls `client.write.patch(..., { confirmed: true })` 10,000 times in `SAFE_WRITE_MODE=read-only` still does nothing. A misconfigured environment in `SAFE_WRITE_MODE=read-write` without `confirmed` still does nothing. A DELETE without `destructive` still does nothing.

## Why not just use TypeScript types?

You can model these guarantees in TypeScript. Some users will. Types are great for *intent* but they don't survive:

- Mixed JS/TS codebases
- Compiled-down output that runs in production
- Agents that generate code at runtime
- Operators who write quick scripts in `node` with no compiler in the loop

Types are documentation. `safe-write-mode` is enforcement. Pair them if you like — `@types/safe-write-mode` would be welcome.

## What this isn't

- It isn't a replacement for staging environments. Use staging.
- It isn't a replacement for code review. Review the writes.
- It isn't a replacement for tests. Test the writes.
- It isn't a replacement for monitoring. Watch the writes.

It's a final-mile guardrail. The last thing between an agent and a mistake.
