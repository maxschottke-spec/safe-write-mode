'use strict';

// Operating multiple entities (tenants, brands, mandants) with one shared
// safe-write-mode setup. Each tenant gets its own integration instance with
// its own audit-log labels.
//
// Run with: node examples/multi-tenant.js

const { createIntegration, __INTERNAL_WRITE__ } = require('../src');

function makeFakeClient(tenantId) {
  return {
    async get(path) {
      return { status: 200, body: { tenant: tenantId, path } };
    },
    async [__INTERNAL_WRITE__](method, path, body) {
      return { status: 200, body: { tenant: tenantId, method, path, body } };
    },
  };
}

const TENANTS = ['acme', 'globex', 'initech'];

async function main() {
  const integrations = TENANTS.map((tenantId) =>
    createIntegration({
      name: `erp:${tenantId}`,
      client: makeFakeClient(tenantId),
      readOnly: true,
    })
  );

  // Read the same path from every tenant in parallel.
  const results = await Promise.all(
    integrations.map((i) => i.read.get('/products/SKU-42'))
  );

  for (const r of results) {
    console.log(`${r.body.tenant}: stock fetched from ${r.body.path}`);
  }

  // Note: each integration has its own `name`, so audit log entries
  // are clearly labeled per tenant. Useful for compliance, billing,
  // and forensics.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
