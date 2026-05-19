'use strict';

// Full three-key ceremony.
// Run with: MODE=read-write node examples/three-key-write.js
//
// Try omitting MODE or { confirmed: true } and watch SafetyError fire.

const { createIntegration, SafetyError, __INTERNAL_WRITE__ } = require('../src');

// A fake client that supports the internal write contract.
const fakeClient = {
  async get(path) {
    return { status: 200, body: { path } };
  },
  async [__INTERNAL_WRITE__](method, path, body) {
    // Real implementations would call fetch/axios/etc. here.
    return { status: 200, body: { method, path, written: body } };
  },
};

async function main() {
  const erp = createIntegration({ name: 'fake-erp', client: fakeClient });

  // Step 1: dry-run.
  const rehearsal = await erp.write.patch('/stock/SKU-42', { qty: 50 }, {
    confirmed: true,
    reason: 'example: simulated restock',
    dryRun: true,
  });
  console.log('Dry-run result:', rehearsal);

  // Step 2: real write.
  try {
    const result = await erp.write.patch('/stock/SKU-42', { qty: 50 }, {
      confirmed: true,
      reason: 'example: simulated restock (live)',
    });
    console.log('Live result:', result);
  } catch (err) {
    if (err instanceof SafetyError) {
      console.log('Refused by SafetyError:', err.code, '-', err.message);
      console.log('  Hint: set MODE=read-write to allow writes.');
    } else {
      throw err;
    }
  }

  // Step 3: a DELETE that omits destructive — will be refused even with MODE=read-write.
  try {
    await erp.write.delete('/stock/SKU-42', { confirmed: true, reason: 'cleanup' });
  } catch (err) {
    if (err instanceof SafetyError) {
      console.log('DELETE refused:', err.code, '-', err.message);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
