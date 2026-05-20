'use strict';

// Operating multiple entities (tenants, brands, mandants) with one shared
// safe-write-mode setup. Each tenant gets its own integration instance with
// its own audit-log labels.
//
// Run with: node examples/multi-tenant.js

const { createIntegration, defineAdapter } = require('../src');

function makeFakeClient(tenantId) {
  return defineAdapter({
    label: `fake-erp:${tenantId}`,
    async get(p) {
      return { status: 200, body: { tenant: tenantId, path: p } };
    },
    async write(method, p, body) {
      return { status: 200, body: { tenant: tenantId, method, path: p, body } };
    },
  });
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

  const results = await Promise.all(
    integrations.map((i) => i.read.get('/products/SKU-42'))
  );

  for (const r of results) {
    console.log(`${r.body.tenant}: stock fetched from ${r.body.path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
