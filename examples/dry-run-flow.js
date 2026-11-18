'use strict';

// Rehearse a batch of writes with dryRun: true, review the audit log,
// then run the real batch.
//
// Run with: SAFE_WRITE_MODE=read-write WRITE_LOG_DIR=./logs node examples/dry-run-flow.js

const fs = require('node:fs');
const path = require('node:path');
const { createIntegration, defineAdapter } = require('../src');

const fakeClient = defineAdapter({
  label: 'fake-cms',
  async get() { return { status: 200, body: {} }; },
  async write(method, p, body) {
    return { status: 200, body: { method, p, body } };
  },
});

async function main() {
  const cms = createIntegration({ name: 'fake-cms', client: fakeClient });

  const updates = [
    { path: '/pages/home', body: { title: 'New homepage' } },
    { path: '/pages/about', body: { title: 'About us' } },
    { path: '/pages/contact', body: { title: 'Contact' } },
  ];

  console.log('--- Step 1: dry-run ---');
  for (const u of updates) {
    const r = await cms.write.patch(u.path, u.body, {
      confirmed: true,
      reason: 'CMS bulk update example',
      dryRun: true,
    });
    console.log('  rehearsed:', r);
  }

  const logDir = process.env.WRITE_LOG_DIR || 'logs';
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `writes-${today}.ndjson`);
  console.log('--- Step 2: review audit log at', logFile, '---');
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-3);
    lines.forEach((l) => console.log('  ', l));
  }

  console.log('--- Step 3: execute live ---');
  for (const u of updates) {
    const r = await cms.write.patch(u.path, u.body, {
      confirmed: true,
      reason: 'CMS bulk update example (live)',
    });
    console.log('  written:', r.status, u.path);
  }
}

main().catch((err) => {
  if (err && err.name === 'SafetyError') {
    console.log('Refused by SafetyError:', err.code, '-', err.message);
    if (err.code === 'READ_ONLY_MODE') {
      console.log('  Hint: set SAFE_WRITE_MODE=read-write to allow writes (a dry-run needs it too).');
    }
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
