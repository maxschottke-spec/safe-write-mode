# Adapters

This directory contains **skeletons** for wrapping common HTTP / API patterns into `safe-write-mode` clients. They are deliberately incomplete — you fill in the endpoints, auth, and rate limits for your specific vendor.

None of these files contain real vendor endpoints, real credentials, or real business logic.

## Available skeletons

| File | Pattern | When to use |
|---|---|---|
| [`rest-bearer.example.js`](rest-bearer.example.js) | REST API with static bearer token | DataForSEO-style, simple SaaS APIs, internal services |
| [`rest-oauth.example.js`](rest-oauth.example.js) | REST API with OAuth refresh-token rotation | Google APIs, Microsoft Graph, Amazon SP-API, many enterprise services |
| [`graphql.example.js`](graphql.example.js) | GraphQL endpoint with mutation guard | Shopify Admin API, GitHub API, modern SaaS GraphQL services |

## Pattern (v0.2+)

Build every adapter via `defineAdapter({ label, get, write })` — the internal
write symbol is no longer exported, so hand-rolled clients are refused by
`createIntegration`.

```js
const { defineAdapter, request } = require('safe-write-mode');
const { safeJoin } = require('safe-write-mode').http;

const client = defineAdapter({
  label: 'my-vendor',
  async get(path, opts) {
    return request({ method: 'GET', url: safeJoin(BASE_URL, path), ... });
  },
  // Omit `write` for read-only adapters.
  async write(method, path, body, opts) {
    return request({ method, url: safeJoin(BASE_URL, path), body, ... });
  },
});
```

The integration factory wires `.read.get → client.get` and (if not read-only)
`.write.{post,patch,put,delete} → safeWrite(... → client.write())`.

**Always use `safeJoin(baseUrl, path)` when building URLs** — it refuses
absolute-URL injection (`/https://evil.tld/x`), protocol-relative paths
(`//evil.tld/x`), backslashes, scheme-like prefixes, CR/LF (header injection),
and cross-origin escapes. The strict path validation is what closes the
"Bearer-leak via path injection" CHAIN-2(b) vector from the round-2 review.

## What we deliberately don't ship

- Real vendor SDK wrappers — those belong in your project, not this library
- Rate limiters tuned to a specific vendor's quota
- Auth refresh schedules tuned to a specific token TTL
- Retry/backoff policies tuned to a specific endpoint's flakiness

Those are correct things to build. They are wrong things to *standardize* across
projects, because every vendor is different.

## Recipe

To build your own adapter:

1. Copy the closest skeleton.
2. Rename it (e.g. `stripe.js` — keep it in your own repo, not this one).
3. Fill in: base URL, auth header, retry policy, rate limiter, any pre-flight
   checks.
4. Test against the vendor's sandbox before flipping to production.
5. Run the smoke test (see `examples/basic-read-only.js` as a template).

If you build something genuinely vendor-agnostic and want to contribute it
back, open an issue first. See [CONTRIBUTING.md](../CONTRIBUTING.md).
