# safe-write-mode

> Agent-driven write protection for live systems.
> Read-only by default. Three-key write protection. Auditable by design.

`safe-write-mode` is a small set of patterns for letting AI agents (or scripts, or operators) interact with external APIs — Stripe, your ERP, your CMS, your warehouse — without ever writing something destructive by accident.

It is a **pattern, not a product**. Built originally inside a multi-entity operator's stack to keep agents from making 3am production mistakes. Published here in generic form because the pattern is broadly useful.

## What it does

```js
const { createIntegration } = require('safe-write-mode');

const erp = createIntegration({
  name: 'erp',
  client: myErpClient,
  // readOnly: true,   // → no .write property exists at all
});

// Reads always work.
await erp.read.get('/stock/SKU-42');

// Writes require three keys + explicit mode.
await erp.write.patch('/stock/SKU-42', { qty: 50 }, {
  confirmed: true,
  reason: 'manual restock after delivery 2024-09-12',
});

// DELETE additionally requires destructive: true.
await erp.write.delete('/stock/SKU-42', {
  confirmed: true,
  destructive: true,
  reason: 'SKU discontinued',
});
```

If `MODE` is not `read-write`, every write is refused before it leaves the process. Every attempt — refused, dry-run, or executed — is logged to an append-only NDJSON audit trail with a SHA-256 hash of the request body. Payload itself is never logged.

## The three keys

A write is only sent if **all three** are present:

1. **`MODE=read-write`** in the environment. Default is `read-only`.
2. **`{ confirmed: true }`** as a per-call option. Forces the caller to acknowledge that this specific operation is intentional.
3. **`{ destructive: true }`** for `DELETE` (and any operation you explicitly classify as irreversible).

Plus: **`{ dryRun: true }`** lets you rehearse the call without sending it. The audit-log records the rehearsal.

## Install

```bash
npm install safe-write-mode
```

Node ≥ 18 (uses global `fetch`). Zero runtime dependencies.

## Quick start

See [`examples/basic-read-only.js`](examples/basic-read-only.js) for the smallest possible end-to-end flow.

For the design rationale, read [`docs/philosophy.md`](docs/philosophy.md) and [`docs/three-key-protection.md`](docs/three-key-protection.md).

## What's in the box

| Module | Purpose |
|---|---|
| `safeWrite()` | Core write gate with audit logging |
| `createIntegration()` | Factory that gives you `.read` and (optionally) `.write` surfaces |
| `request()` | HTTP client with retry-after, backoff+jitter, redirect-auth guard, timeout |
| `logger` | Append-only NDJSON audit + structured console log |
| `env` | `required()` / `optional()` / `requiredJsonBase64()` helpers |
| `SafetyError` | Typed error with `code` ∈ `READ_ONLY_MODE` / `CONFIRMATION_REQUIRED` / `DESTRUCTIVE_NOT_ACKED` / `INVALID_MODE` |

## What it deliberately doesn't do

- **No vendor SDKs.** You bring your own HTTP client. See `adapters/` for skeletons.
- **No magic.** Read-only integrations have **no `.write` property** — calling it isn't blocked, it's `undefined`. This is intentional.
- **No "just this once" override.** If you need to bypass safety, change `MODE` deliberately.
- **No payload logging.** Audit trail records hashes only. Stay clear of GDPR landmines.

## Checklists

- [`checklists/pre-push.md`](checklists/pre-push.md) — 8-point gate before you push a write-enabled change
- [`checklists/guardrail-review.md`](checklists/guardrail-review.md) — skeptical-senior-operator prompt for plans involving writes
- [`checklists/post-incident.md`](checklists/post-incident.md) — what to do after a `SafetyError` fires in production

## Use as a Claude Code skill

See [`SKILL.md`](SKILL.md). Drop it into your Claude Code skill directory or invoke it as `/safe-write-mode`.

## Status

v0.1.0 — Pattern-stable, API may evolve before v1.0.
Built for one operator's e-commerce stack; battle-tested against ~17 third-party APIs (Shopify, Lexware, Google Ads/Analytics, Amazon SP-API, etc.). The integrations are not published here. Only the pattern is.

## License

MIT. See [LICENSE](LICENSE).
