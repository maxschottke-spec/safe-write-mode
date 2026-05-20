'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-test-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const { SafetyError, safeWrite, getMode, _unlockModeForTests } = require('../src/safety');

function cleanModeEnv() {
  _unlockModeForTests();
  delete process.env.SAFE_WRITE_MODE;
  delete process.env.MODE;
}

test('getMode defaults to read-only', () => {
  cleanModeEnv();
  assert.equal(getMode(), 'read-only');
});

test('getMode accepts read-write', () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  assert.equal(getMode(), 'read-write');
});

test('getMode rejects invalid values', () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'write-everything';
  assert.throws(() => getMode(), { code: 'INVALID_MODE' });
});

test('safeWrite refuses in read-only mode', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-only';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'POST',
      path: '/x',
      body: {},
      opts: { confirmed: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'READ_ONLY_MODE',
  );
});

test('safeWrite refuses without { confirmed: true }', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'POST',
      path: '/x',
      body: {},
      opts: {},
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'CONFIRMATION_REQUIRED',
  );
});

test('safeWrite refuses DELETE without { destructive: true }', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'DELETE',
      path: '/x',
      body: null,
      opts: { confirmed: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'DESTRUCTIVE_NOT_ACKED',
  );
});

test('safeWrite executes when all three keys are present', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  let called = false;
  const result = await safeWrite({
    integration: 'test',
    method: 'POST',
    path: '/x',
    body: { a: 1 },
    opts: { confirmed: true, reason: 'test write' },
    execute: async () => { called = true; return { status: 201 }; },
  });
  assert.equal(called, true);
  assert.equal(result.status, 201);
});

test('safeWrite respects dryRun and does not call execute', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  let called = false;
  const result = await safeWrite({
    integration: 'test',
    method: 'PATCH',
    path: '/x',
    body: { b: 2 },
    opts: { confirmed: true, dryRun: true },
    execute: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(called, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.method, 'PATCH');
});

test('safeWrite logs every attempt to the audit trail', async () => {
  cleanModeEnv();
  process.env.SAFE_WRITE_MODE = 'read-write';
  await safeWrite({
    integration: 'audit-test',
    method: 'PUT',
    path: '/audit',
    body: { hello: 'world' },
    opts: { confirmed: true, reason: 'audit log test' },
    execute: async () => ({ status: 200 }),
  });
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(TMP, `writes-${today}.ndjson`);
  assert.ok(fs.existsSync(logFile), 'audit log should exist');
  const content = fs.readFileSync(logFile, 'utf8');
  assert.ok(content.includes('"integration":"audit-test"'));
  assert.ok(content.includes('"reason":"audit log test"'));
  assert.match(content, /"requestHash":"sha256:[0-9a-f]{64}"/);
});
