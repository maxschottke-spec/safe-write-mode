'use strict';

// Smallest possible end-to-end example.
// Run with: node examples/basic-read-only.js

const { createIntegration, defineAdapter } = require('../src');

const fakeClient = defineAdapter({
  label: 'fake-erp',
  async get(path) {
    return { status: 200, body: { path, stock: 42 } };
  },
});

async function main() {
  const erp = createIntegration({
    name: 'fake-erp',
    client: fakeClient,
    readOnly: true,
  });

  const result = await erp.read.get('/products/SKU-42');
  console.log('Read result:', result);
  console.log('erp.write is undefined ->', erp.write === undefined);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
