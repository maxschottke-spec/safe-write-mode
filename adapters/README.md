# Adapters

This directory contains **skeletons** for wrapping common HTTP / API patterns into `safe-write-mode` clients. They are deliberately incomplete — you fill in the endpoints, auth, and rate limits for your specific vendor.

None of these files contain real vendor endpoints, real credentials, or real business logic.

## Available skeletons

| File | Pattern | When to use |
|---|---|---|
| [`rest-bearer.example.js`](rest-bearer.example.js) | REST API with static bearer token | DataForSEO-style, simple SaaS APIs, internal services |
| [`rest-oauth.example.js`](rest-oauth.example.js) | REST API with OAuth refresh-token rotation | Google APIs, Microsoft Graph, Amazon SP-API, many enterprise services |
| [`graphql.example.js`](graphql.example.js) | GraphQL endpoint with mutation guard | Shopify Admin API, GitHub API, modern SaaS GraphQL services |

## Pattern

Every adapter exposes the contract `createIntegration` expects:

```js
// Read-only or read-write:
const client = {
  async get(path, opts) { /* ... */ },
};

// Write-capable additionally:
client[__INTERNAL_WRITE__] = async (method, path, body, opts) => {
  // ...
};
```

The integration factory wires `.read.get → client.get` and (if not read-only)
`.write.{post,patch,put,delete} → safeWrite(... → client[__INTERNAL_WRITE__])`.

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
