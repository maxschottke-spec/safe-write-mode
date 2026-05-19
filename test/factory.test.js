'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-factory-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const { createIntegration, __INTERNAL_WRITE__ } = require('../src/integrationFactory');

function makeFake() {
  const calls = [];
  return {
    calls,
    async get(p) { calls.push(['GET', p]); return { status: 200, body: { p } }; },
    async [__INTERNAL_WRITE__](method, p, body) {
      calls.push([method, p, body]);
      return { status: 200, body: { method, p, body } };
    },
  };
}

test('read-only integrations have no .write property', () => {
  const fake = makeFake();
  const i = createIntegration({ name: 'ro', client: fake, readOnly: true });
  assert.equal(i.readOnly, true);
  assert.equal(i.write, undefined);
  assert.ok(i.read.get, 'read.get should exist');
});

test('read-write integrations expose all four verbs', () => {
  const fake = makeFake();
  const i = createIntegration({ name: 'rw', client: fake });
  assert.ok(typeof i.write.post === 'function');
  assert.ok(typeof i.write.patch === 'function');
  assert.ok(typeof i.write.put === 'function');
  assert.ok(typeof i.write.delete === 'function');
});

test('read surface delegates to client.get', async () => {
  const fake = makeFake();
  const i = createIntegration({ name: 'rw', client: fake, readOnly: true });
  await i.read.get('/x');
  assert.deepEqual(fake.calls, [['GET', '/x']]);
});

test('write surface routes through safeWrite (refused in read-only)', async () => {
  process.env.MODE = 'read-only';
  const fake = makeFake();
  const i = createIntegration({ name: 'rw', client: fake });
  await assert.rejects(
    () => i.write.post('/x', { a: 1 }, { confirmed: true }),
    { name: 'SafetyError', code: 'READ_ONLY_MODE' },
  );
  // execute must not have been called.
  assert.equal(fake.calls.length, 0);
});

test('write surface executes when keys + mode are right', async () => {
  process.env.MODE = 'read-write';
  const fake = makeFake();
  const i = createIntegration({ name: 'rw', client: fake });
  const res = await i.write.patch('/x', { a: 1 }, { confirmed: true, reason: 'test' });
  assert.equal(res.status, 200);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0][0], 'PATCH');
});

test('factory surface is frozen', () => {
  const fake = makeFake();
  const i = createIntegration({ name: 'frozen', client: fake });
  assert.ok(Object.isFrozen(i));
  assert.ok(Object.isFrozen(i.write));
  // Mutating should silently fail in non-strict, throw in strict.
  assert.throws(() => { 'use strict'; i.name = 'changed'; });
});
