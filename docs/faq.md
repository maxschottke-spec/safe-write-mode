# FAQ

## Why not just use a feature flag library?

Feature flags toggle behavior. `safe-write-mode` enforces a contract. The two are complementary, not interchangeable.

A feature flag might say "writes enabled for cohort A." `safe-write-mode` says "if you try to write without the three keys, it doesn't matter what the flag says — `SafetyError` fires."

Use both. Feature-flag the rollout. Three-key-protect every write.

## Can I disable the audit log?

You can set `WRITE_LOG_DIR` to a path your process can't write to, and `logWrite` will throw on its first attempt. But there's no "off" switch and that's intentional. If you're writing, you should be auditing.

If you really need to disable logging for tests, mock the logger module.

## Does this work in serverless / Lambda?

Yes, with caveats:

- `WRITE_LOG_DIR=/tmp/safe-write` for ephemeral storage
- Stream logs out via a sidecar or post-invocation hook — `/tmp` doesn't survive cold starts
- The audit log inside a single invocation works fine; durability is your problem

## Does this work in browser?

No. It uses `node:fs`, `node:crypto`, and `node:path`. A browser-targeted variant could be built but isn't shipped.

If you're writing from a browser, you have bigger problems than safety wrappers.

## I'm getting `SafetyError: Refused: write blocked because MODE=read-only`. Help.

Working as intended. Either:

1. The write is unintentional → don't fix it, the gate did its job
2. The write is intentional → set `MODE=read-write` in the environment, deliberately, for this session only

Don't set `MODE=read-write` globally on your shell. Set it inline:

```bash
MODE=read-write node my-script.js
```

## How do I add a new integration?

There's no "add an integration" step. `createIntegration` takes any object with a `client` that has the right shape. See `adapters/*.example.js` for skeletons.

The factory expects the client to expose:

- `client.get(path, opts)` for reads
- `client[__INTERNAL_WRITE__](method, path, body, opts)` for writes (or no method at all if `readOnly: true`)

The `__INTERNAL_WRITE__` symbol is exported. Your adapter implements that method; you never call it directly — `safeWrite` does, after passing the three keys.

## Why a Symbol for the internal write method?

To make it nearly impossible to accidentally call from outside. `client.post(...)` would be tempting and dangerous. `client[__INTERNAL_WRITE__](...)` requires you to import the symbol, which means you read the docs and understood what you're doing.

## What about TypeScript?

The library is JS-first, zero dependencies, no build. You can use it from TypeScript with `import * as swm from 'safe-write-mode'`. Types aren't bundled. If someone wants to publish `@types/safe-write-mode`, that's welcomed.

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
