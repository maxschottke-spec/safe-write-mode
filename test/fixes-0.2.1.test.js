'use strict';

// Regression coverage for v0.2.1 (review of 2026-11-18).
// Each test pins one way the gate could previously be bypassed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-021-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';
const AUDIT_KEY = 'test-audit-key';
process.env.SAFE_WRITE_AUDIT_KEY = AUDIT_KEY;

const { createIntegration, defineAdapter, lockMode, setConfirmationVerifier } = require('../src');
const { _unlockModeForTests, _resetConfirmationVerifierForTests, pathForLog } = require('../src/safety');
const { isPrivateIPv6, assertPublicURL } = require('../src/http');

function reset() {
  _unlockModeForTests();
  _resetConfirmationVerifierForTests();
  delete process.env.SAFE_WRITE_MODE;
  delete process.env.MODE;
}

function integration(calls) {
  const client = defineAdapter({
    label: 'fixture',
    async get() { return { status: 200 }; },
    async write(method, target) { calls.push([method, target]); return { status: 200 }; },
  });
  return createIntegration({ name: 'fixture', client });
}

function readLog() {
  return fs.readdirSync(TMP)
    .filter((f) => f.endsWith('.ndjson'))
    .map((f) => fs.readFileSync(path.join(TMP, f), 'utf8'))
    .join('\n');
}

test('lockMode: a locked read-only mode cannot be re-locked to read-write', async () => {
  reset();
  lockMode('read-only');
  assert.throws(() => lockMode('read-write'), { code: 'MODE_LOCKED' });
  const calls = [];
  const api = integration(calls);
  await assert.rejects(api.write.post('/x', {}, { confirmed: true }), { code: 'READ_ONLY_MODE' });
  assert.equal(calls.length, 0);
});

test('lockMode: a second argument-less call does not re-read the environment', () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-only';
  assert.equal(lockMode(), 'read-only');
  process.env.SAFE_WRITE_MODE = 'read-write';
  assert.equal(lockMode(), 'read-only');
});

test('lockMode: repeating the locked value is allowed', () => {
  reset();
  lockMode('read-write');
  assert.equal(lockMode('read-write'), 'read-write');
});

test('verifier: cannot be removed or replaced once installed', async () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-write';
  setConfirmationVerifier(async () => false);
  assert.throws(() => setConfirmationVerifier(null), { code: 'VERIFIER_LOCKED' });
  assert.throws(() => setConfirmationVerifier(async () => true), { code: 'VERIFIER_LOCKED' });
  const calls = [];
  const api = integration(calls);
  await assert.rejects(api.write.post('/x', {}, { confirmed: true }), { code: 'CONFIRMATION_REJECTED' });
  assert.equal(calls.length, 0);
});

test('confirmed: only the boolean true counts', async () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-write';
  const calls = [];
  const api = integration(calls);
  for (const value of ['false', 'true', 1, 'yes', {}, []]) {
    await assert.rejects(
      api.write.post('/x', {}, { confirmed: value }),
      { code: 'CONFIRMATION_REQUIRED' },
      `confirmed=${JSON.stringify(value)} must be refused`,
    );
  }
  assert.equal(calls.length, 0);
});

test('destructive: only the boolean true counts', async () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-write';
  const calls = [];
  const api = integration(calls);
  for (const value of ['false', 'true', 1]) {
    await assert.rejects(
      api.write.delete('/x', { confirmed: true, destructive: value }),
      { code: 'DESTRUCTIVE_NOT_ACKED' },
    );
    await assert.rejects(
      api.write.post('/db/reset', {}, { confirmed: true, destructive: value }),
      { code: 'DESTRUCTIVE_NOT_ACKED' },
    );
  }
  assert.equal(calls.length, 0);
});

test('audit log: query strings are not written to the log', async () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-write';
  const calls = [];
  const api = integration(calls);
  await api.write.post('/customers?email=jane@example.com&api_key=SECRETKEY123', { a: 1 }, { confirmed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '/customers?email=jane@example.com&api_key=SECRETKEY123', 'the adapter still gets the full target');
  const log = readLog();
  assert.ok(log.includes('"path":"/customers"'));
  assert.ok(!log.includes('SECRETKEY123'));
  assert.ok(!log.includes('jane@example.com'));
  const full = '/customers?email=jane@example.com&api_key=SECRETKEY123';
  const crypto = require('node:crypto');
  const mac = (s) => 'hmac-sha256:' + crypto.createHmac('sha256', AUDIT_KEY).update(s).digest('hex');
  assert.ok(log.includes(`"targetHash":"${mac(full)}"`), 'entry binds to the full target via a keyed MAC');
  assert.equal(process.env.SAFE_WRITE_AUDIT_KEY, undefined, 'key is removed from the environment after load');
  assert.equal(require('../src/safety').targetMac, undefined, 'the MAC function is not exported');
  const bare = crypto.createHash('sha256').update(full).digest('hex');
  assert.ok(!log.includes(bare), 'no unkeyed hash of the target that could be guessed offline');
  assert.notEqual(mac(full), mac('/customers?email=john@example.com'));
  assert.equal(pathForLog('/a/b#frag'), '/a/b');
});

test('SSRF: IPv4-mapped and NAT64 IPv6 forms of private addresses are refused', async () => {
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:a00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe']) {
    assert.equal(isPrivateIPv6(ip), true, ip);
  }
  assert.equal(isPrivateIPv6('::ffff:808:808'), false, 'public 8.8.8.8 stays allowed');
  await assert.rejects(assertPublicURL('https://[::ffff:127.0.0.1]/'), /private\/loopback/);
  await assert.rejects(assertPublicURL('https://[::ffff:169.254.169.254]/latest/meta-data'), /private\/loopback/);
});

test('SSRF: compressed NAT64 and IPv4-compatible forms are refused, public ones stay allowed', async () => {
  for (const url of [
    'https://[64:ff9b::0.0.0.1]/', 'https://[64:ff9b::]/', 'https://[64:ff9b::10.0.0.1]/',
    'https://[0:0:0:0:0:ffff:7f00:1]/', 'https://[::127.0.0.1]/', 'https://[::ffff:192.168.1.1]/',
  ]) {
    await assert.rejects(assertPublicURL(url), /private\/loopback/, url);
  }
  await assertPublicURL('https://[::ffff:8.8.8.8]/');
  await assertPublicURL('https://[64:ff9b::8.8.8.8]/');
  await assertPublicURL('https://[2606:4700:4700::1111]/');
});

test('target: non-string paths are refused and never reach the audit log', async () => {
  reset();
  process.env.SAFE_WRITE_MODE = 'read-write';
  const calls = [];
  const api = integration(calls);
  const sneaky = { pathname: '/db/reset', search: '?api_key=OBJECTSECRET999' };
  await assert.rejects(api.write.post(sneaky, {}, { confirmed: true, dryRun: true }), { code: 'INVALID_PATH' });
  await assert.rejects(api.write.post(sneaky, {}, { confirmed: true }), { code: 'INVALID_PATH' });
  assert.equal(calls.length, 0);
  assert.ok(!readLog().includes('OBJECTSECRET999'));
  assert.equal(pathForLog(sneaky), '[non-string target]');
});

test('test hooks: disabled unless SAFE_WRITE_TEST_HOOKS=1 was set at load time', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    const s = require(${JSON.stringify(require.resolve('../src/safety'))});
    const out = [];
    for (const fn of ['_unlockModeForTests', '_resetConfirmationVerifierForTests']) {
      try { s[fn](); out.push('OPEN'); } catch (e) { out.push(e.code); }
    }
    process.env.SAFE_WRITE_TEST_HOOKS = '1';
    try { s._unlockModeForTests(); out.push('OPEN'); } catch (e) { out.push(e.code); }
    console.log(out.join(','));
  `;
  const env = { ...process.env, LOG_LEVEL: 'error' };
  delete env.SAFE_WRITE_TEST_HOOKS;
  const result = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }).trim();
  assert.equal(result, 'TEST_HOOKS_DISABLED,TEST_HOOKS_DISABLED,TEST_HOOKS_DISABLED');
});
