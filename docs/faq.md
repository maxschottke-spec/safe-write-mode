# FAQ

## Why not just use a feature flag library?

Feature flags toggle behavior. `safe-write-mode` enforces a contract. The two are complementary, not interchangeable.

A feature flag might say "writes enabled for cohort A." `safe-write-mode` says "if you try to write without the three keys, it doesn't matter what the flag says — `SafetyError` fires."

Use both. Feature-flag the rollout. Three-key-protect every write.

## Can I disable the audit log?

No. There is no "off" switch, and that's intentional: if you're writing, you should be auditing. If the log directory is not writable, every write is refused with `AUDIT_UNAVAILABLE`.

If you really need to disable logging for tests, mock the logger module.

## Does this work in serverless / Lambda?

Yes, with caveats:

- `WRITE_LOG_DIR=/tmp/safe-write` for ephemeral storage
- Stream logs out via a sidecar or post-invocation hook — `/tmp` doesn't survive cold starts
- The audit log inside a single invocation works fine; durability is your problem

## Does this work in browser?

No. It uses `node:fs`, `node:crypto`, and `node:path`. A browser-targeted variant could be built but isn't shipped.

If you're writing from a browser, you have bigger problems than safety wrappers.

## I'm getting `SafetyError: Refused: write blocked because SAFE_WRITE_MODE=read-only`. Help.

Working as intended. Either:

1. The write is unintentional → don't fix it, the gate did its job
2. The write is intentional → set `SAFE_WRITE_MODE=read-write` in the environment, deliberately, for this session only

Don't set `SAFE_WRITE_MODE=read-write` globally on your shell. Set it inline:

```bash
SAFE_WRITE_MODE=read-write node my-script.js
```

## How do I add a new integration?

Build a client with `defineAdapter({ label, get, write })` and pass it to `createIntegration({ name, client })`. See `adapters/*.example.js` for skeletons.

- `get(path, opts)` handles reads
- `write(method, path, body, opts)` handles writes. You never call it directly — `safeWrite` does, after the three keys have passed. Leave it out if the integration is read-only.

Clients that were not built via `defineAdapter` are refused. The internal write hook is not exported, so nothing outside the library can call a write without going through the gate.

## What about TypeScript?

The library is JS-first, zero dependencies, no build. Hand-written type definitions are in [`index.d.ts`](../index.d.ts) in the repository; they are not part of the v0.2.2 tag and ship with the next release. Use `import { createIntegration } from 'safe-write-mode'` or `import * as swm from 'safe-write-mode'`. The test suite checks that the declared names match the real exports, not every signature, so please report a type that is wrong.

## Can I use this without the integration factory?

Yes. `safeWrite` is the core. You can call it directly:

```js
const { safeWrite } = require('safe-write-mode');

await safeWrite({
  integration: 'erp',
  method: 'PATCH',
  path: '/stock/SKU-42',
  body: { qty: 50 },
  opts: { confirmed: true, reason: 'manual restock' },
  execute: async () => {
    return await myErpClient.patch('/stock/SKU-42', { qty: 50 });
  },
});
```

The factory is a convenience. The protection is in `safeWrite`.

## How is this different from `confirm` libraries or interactive prompts?

Interactive prompts work for humans. Agents don't see prompts. `safe-write-mode` is non-interactive by design: the caller signals intent through structured options, and the gate enforces the contract regardless of who's calling.

If you also want human prompts, wrap `safeWrite` and ask the human before passing through.

## What's the performance cost?

For each call: one SHA-256 hash of the body (fast), one synchronous file append (microseconds for small bodies, slower for big ones), some property lookups, and a function call. Negligible compared to the network call you're guarding.

For high-throughput callers (>1000 writes/sec), consider buffering the audit log or using a streaming sink.
