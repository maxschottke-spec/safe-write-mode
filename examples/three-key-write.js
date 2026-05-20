'use strict';

// Full three-key ceremony.
// Run with: SAFE_WRITE_MODE=read-write node examples/three-key-write.js
//
// Try omitting SAFE_WRITE_MODE or { confirmed: true } and watch SafetyError fire.

const { createIntegration, defineAdapter, SafetyError } = require('../src');

// A fake client wired through defineAdapter so createIntegration accepts it.
// In real code, replace `write` with your vendor-specific HTTP call.
const fakeClient = defineAdapter({
  label: 'fake-erp',
  async get(path) {
    return { status: 200, body: { path } };
  },
  async write(method, path, body) {
    return { status: 200, body: { method, path, written: body } };
  },
});

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
      console.log('  Hint: set SAFE_WRITE_MODE=read-write to allow writes.');
    } else {
      throw err;
    }
  }

  // Step 3: a DELETE that omits destructive — will be refused even in read-write.
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
