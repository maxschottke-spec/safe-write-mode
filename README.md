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

If `SAFE_WRITE_MODE` is not `read-write`, every write is refused before it leaves the process. Every attempt — refused, dry-run, or executed — is logged to an NDJSON audit trail with a SHA-256 hash of the request body. Payload itself is never logged.

## The three keys

A write is only sent if **all three** are present:

1. **`SAFE_WRITE_MODE=read-write`** in the environment (legacy `MODE=read-write` is honored with a deprecation warning). Default is `read-only`.
2. **`{ confirmed: true }`** as a per-call option. Forces the caller to acknowledge that this specific operation is intentional.
3. **`{ destructive: true }`** for `DELETE` (and any operation matching the destructive-path patterns, e.g. `/reset`, `/purge`, `/wipe`).

Plus: **`{ dryRun: true }`** lets you rehearse the call without sending it. The audit-log records the rehearsal.

> **Threat-model honesty.** The three keys protect against *accidental* writes from a process running with `read-only` defaults. They are **not** a security boundary against a hostile agent in the same Node process: any caller can set `confirmed: true` and `destructive: true` themselves. To get a real boundary, combine this library with read-only API tokens at your vendor and call `lockMode()` + `setConfirmationVerifier()` at startup. See [`SECURITY.md`](SECURITY.md) for the full threat model.

## Install

```bash
npm install safe-write-mode
```

Node ≥ 20.18 (active LTS, uses global `fetch` + `node:dns/promises`). Zero runtime dependencies.

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

v0.2.0 — Two rounds of external security audit completed (round-1 + round-2 post-fix verification). Pattern-stable, API may evolve before v1.0.

Built for one operator's e-commerce stack; tested in production against multiple third-party APIs (Shopify, Lexware, Google Ads/Analytics, Amazon SP-API, etc.). The integrations are not published here. Only the pattern is.

**Breaking change v0.1 → v0.2:** The internal-write symbol `__INTERNAL_WRITE__` is no longer exported. Build adapter clients via `defineAdapter({ label, get, write })` and pass them to `createIntegration({ client })`. Hand-rolled clients are refused. See `examples/three-key-write.js` for the new shape.

## License

MIT. See [LICENSE](LICENSE).
