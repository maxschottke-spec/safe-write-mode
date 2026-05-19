'use strict';

// Regression coverage for external audit findings — see audit_swm_v01_external.
// Each test pins the new behavior so accidental rollback breaks CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-audit-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const {
  SafetyError,
  safeWrite,
  getMode,
  canonicalStringify,
  isDestructivePath,
} = require('../src/safety');
const { createIntegration } = require('../src/integrationFactory');

function fakeClient() {
  return {
    async get() { return { status: 200 }; },
    // eslint-disable-next-line no-undef
    async [require('../src/integrationFactory').__INTERNAL_WRITE__]() {
      return { status: 200 };
    },
  };
}

// ─── M3: SAFE_WRITE_MODE namespace ─────────────────────────────────────────

test('M3: SAFE_WRITE_MODE overrides legacy MODE when set', () => {
  delete process.env.MODE;
  process.env.SAFE_WRITE_MODE = 'read-write';
  assert.equal(getMode(), 'read-write');
  delete process.env.SAFE_WRITE_MODE;
});

test('M3: legacy MODE still works as fallback', () => {
  delete process.env.SAFE_WRITE_MODE;
  process.env.MODE = 'read-write';
  assert.equal(getMode(), 'read-write');
});

// ─── N4: case-insensitive method + allowlist ───────────────────────────────

test('N4: lowercase delete is treated as DELETE (destructive check fires)', async () => {
  delete process.env.SAFE_WRITE_MODE;
  process.env.MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'delete',
      path: '/x',
      body: null,
      opts: { confirmed: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'DESTRUCTIVE_NOT_ACKED',
  );
});

test('N4: invalid method is refused with INVALID_METHOD', async () => {
  process.env.MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'TRACE',
      path: '/x',
      body: null,
      opts: { confirmed: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'INVALID_METHOD',
  );
});

// ─── N1 partial: destructive path detection ─────────────────────────────────

test('N1: destructive-shaped path requires ack even for PUT', async () => {
  process.env.MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'PUT',
      path: '/accounts/X/reset',
      body: {},
      opts: { confirmed: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'DESTRUCTIVE_NOT_ACKED',
  );
});

test('N1: isDestructivePath matches /reset /purge /wipe /clear /flush', () => {
  assert.equal(isDestructivePath('/accounts/X/reset'), true);
  assert.equal(isDestructivePath('/queue/purge'), true);
  assert.equal(isDestructivePath('/tenants/123/wipe/all'), true);
  assert.equal(isDestructivePath('/cache/clear'), true);
  assert.equal(isDestructivePath('/buffer/flush'), true);
  assert.equal(isDestructivePath('/admin/factory-reset'), true);
  assert.equal(isDestructivePath('/users/123'), false);
  assert.equal(isDestructivePath('/orders'), false);
});

// ─── M2: optional reason enforcement ────────────────────────────────────────

test('M2: opts.requireReason refuses writes without non-empty reason', async () => {
  process.env.MODE = 'read-write';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'POST',
      path: '/x',
      body: {},
      opts: { confirmed: true, requireReason: true },
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'REASON_REQUIRED',
  );
});

test('M2: SAFE_WRITE_REQUIRE_REASON=1 enforces reason globally', async () => {
  process.env.MODE = 'read-write';
  process.env.SAFE_WRITE_REQUIRE_REASON = '1';
  await assert.rejects(
    () => safeWrite({
      integration: 'test',
      method: 'POST',
      path: '/x',
      body: {},
      opts: { confirmed: true, reason: '   ' }, // whitespace-only counts as missing
      execute: async () => ({ status: 200 }),
    }),
    (err) => err instanceof SafetyError && err.code === 'REASON_REQUIRED',
  );
  delete process.env.SAFE_WRITE_REQUIRE_REASON;
});

// ─── L1: canonical request hash ─────────────────────────────────────────────

test('L1: canonicalStringify is key-order independent', () => {
  const a = canonicalStringify({ b: 2, a: 1, c: [3, { y: 2, x: 1 }] });
  const b = canonicalStringify({ c: [3, { x: 1, y: 2 }], a: 1, b: 2 });
  assert.equal(a, b);
});

// ─── N5: strict boolean readOnly ────────────────────────────────────────────

test('N5: createIntegration rejects non-boolean readOnly', () => {
  const fake = fakeClient();
  assert.throws(() => createIntegration({ name: 'x', client: fake, readOnly: 'true' }), TypeError);
  assert.throws(() => createIntegration({ name: 'x', client: fake, readOnly: 1 }), TypeError);
  assert.throws(() => createIntegration({ name: 'x', client: fake, readOnly: null }), TypeError);
  // boolean values accepted
  assert.ok(createIntegration({ name: 'x', client: fake, readOnly: true }));
  assert.ok(createIntegration({ name: 'x', client: fake, readOnly: false }));
});

// ─── N6: base64 input validation ────────────────────────────────────────────

test('N6: requiredJsonBase64 rejects malformed base64', () => {
  const { requiredJsonBase64 } = require('../src/env');
  process.env.SWM_TEST_BAD64 = '!!!not-base64!!!';
  assert.throws(() => requiredJsonBase64('SWM_TEST_BAD64'), /not valid base64/);
  delete process.env.SWM_TEST_BAD64;
});

test('N6: requiredJsonBase64 rejects __proto__ pollution', () => {
  const { requiredJsonBase64 } = require('../src/env');
  // Use literal JSON string — JS-literal {__proto__: X} sets the prototype,
  // not a key, so we have to build the JSON by hand to embed the dangerous
  // key string verbatim.
  const dangerousJson = '{"__proto__":{"polluted":true}}';
  process.env.SWM_TEST_PROTO = Buffer.from(dangerousJson).toString('base64');
  assert.throws(() => requiredJsonBase64('SWM_TEST_PROTO'), /dangerous key/);
  delete process.env.SWM_TEST_PROTO;
});

// ─── N8: HttpError fields are non-enumerable ────────────────────────────────

test('N8: HttpError body/headers do not leak via JSON.stringify or spread', () => {
  const { HttpError } = require('../src/http');
  const err = new HttpError('boom', {
    status: 500,
    body: { secret: 'leaky' },
    headers: { 'set-cookie': 'session=abc' },
  });
  // direct access still works (intentional for catch handlers)
  assert.equal(err.body.secret, 'leaky');
  // but enumeration and JSON do not surface them
  const enumerated = Object.keys(err);
  assert.equal(enumerated.includes('body'), false);
  assert.equal(enumerated.includes('headers'), false);
  const json = JSON.parse(JSON.stringify({ ...err, message: err.message }));
  assert.equal(json.body, undefined);
  assert.equal(json.headers, undefined);
});

// ─── H4: pending audit entry written before execute ─────────────────────────

test('H4: audit log records pending entry before execute(), with auditId', async () => {
  process.env.MODE = 'read-write';
  await safeWrite({
    integration: 'h4-test',
    method: 'POST',
    path: '/x',
    body: { v: 1 },
    opts: { confirmed: true, reason: 'pending check' },
    execute: async () => ({ status: 201 }),
  });
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(TMP, `writes-${today}.ndjson`);
  const content = fs.readFileSync(logFile, 'utf8');
  const h4Lines = content.split('\n').filter((l) => l.includes('"integration":"h4-test"'));
  // Expect at least one pending + one ok entry sharing the same auditId.
  const pending = h4Lines.find((l) => l.includes('"outcome":"pending"'));
  const ok = h4Lines.find((l) => l.includes('"outcome":"ok"'));
  assert.ok(pending, 'pending entry should be written before execute');
  assert.ok(ok, 'ok entry should be written after execute');
  const pendingId = JSON.parse(pending).auditId;
  const okId = JSON.parse(ok).auditId;
  assert.equal(pendingId, okId);
  assert.ok(pendingId, 'auditId should be set');
});
