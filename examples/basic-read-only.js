'use strict';

// Smallest possible end-to-end example.
// Run with: node examples/basic-read-only.js

const { createIntegration } = require('../src');

// A fake client. In real code this wraps your HTTP layer.
const fakeClient = {
  async get(path) {
    return { status: 200, body: { path, stock: 42 } };
  },
};

async function main() {
  const erp = createIntegration({
    name: 'fake-erp',
    client: fakeClient,
    readOnly: true,
  });

  // Reads work as expected.
  const result = await erp.read.get('/products/SKU-42');
  console.log('Read result:', result);

  // Attempting to access .write on a read-only integration:
  console.log('erp.write is undefined ->', erp.write === undefined);
  // That's the point. Read-only by structure, not by runtime check.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
