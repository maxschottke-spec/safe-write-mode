'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-factory-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const { createIntegration, defineAdapter } = require('../src/integrationFactory');

function makeFake() {
  const calls = [];
  const client = defineAdapter({
    label: `fake-${Math.random().toString(36).slice(2, 8)}`,
    async get(p) { calls.push(['GET', p]); return { status: 200, body: { p } }; },
    async write(method, p, body) {
      calls.push([method, p, body]);
      return { status: 200, body: { method, p, body } };
    },
  });
  return { client, calls };
}

test('read-only integrations have no .write property', () => {
  const { client } = makeFake();
  const i = createIntegration({ name: 'ro', client, readOnly: true });
  assert.equal(i.readOnly, true);
  assert.equal(i.write, undefined);
  assert.ok(i.read.get, 'read.get should exist');
});

test('read-write integrations expose all four verbs', () => {
  const { client } = makeFake();
  const i = createIntegration({ name: 'rw', client });
  assert.ok(typeof i.write.post === 'function');
  assert.ok(typeof i.write.patch === 'function');
  assert.ok(typeof i.write.put === 'function');
  assert.ok(typeof i.write.delete === 'function');
});

test('read surface delegates to client.get', async () => {
  const { client, calls } = makeFake();
  const i = createIntegration({ name: 'rw', client, readOnly: true });
  await i.read.get('/x');
  assert.deepEqual(calls, [['GET', '/x']]);
});

test('write surface routes through safeWrite (refused in read-only)', async () => {
  delete process.env.SAFE_WRITE_MODE;
  process.env.MODE = 'read-only';
  const { client, calls } = makeFake();
  const i = createIntegration({ name: 'rw', client });
  await assert.rejects(
    () => i.write.post('/x', { a: 1 }, { confirmed: true }),
    { name: 'SafetyError', code: 'READ_ONLY_MODE' },
  );
  assert.equal(calls.length, 0);
});

test('write surface executes when keys + mode are right', async () => {
  process.env.SAFE_WRITE_MODE = 'read-write';
  const { client, calls } = makeFake();
  const i = createIntegration({ name: 'rw', client });
  const res = await i.write.patch('/x', { a: 1 }, { confirmed: true, reason: 'test' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'PATCH');
});

test('factory surface is frozen', () => {
  const { client } = makeFake();
  const i = createIntegration({ name: 'frozen', client });
  assert.ok(Object.isFrozen(i));
  assert.ok(Object.isFrozen(i.write));
  assert.throws(() => { 'use strict'; i.name = 'changed'; });
});
