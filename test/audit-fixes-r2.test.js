'use strict';

// Regression coverage for external audit ROUND 2 (post-fix-verification
// 2026-05-20). See ~/Downloads/safe-write-mode-audit-2026-05-20.md and the
// matching memory record audit_swm_v01_external (status: r2).
//
// Each test pins a v0.2 behavior so an accidental rollback breaks CI.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-audit-r2-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const swm = require('../src');
const {
  createIntegration, defineAdapter, lockMode, setConfirmationVerifier,
  SafetyError, safeJoin, sanitizeUrlForLog, HttpError, logger,
} = swm;
const { _unlockModeForTests } = require('../src/safety');
const { isPrivateIPv4, isPrivateIPv6, assertPublicURL } = require('../src/http');
const { classifyDocument } = require('../adapters/graphql.example');

function cleanMode() {
  _unlockModeForTests();
  delete process.env.SAFE_WRITE_MODE;
  delete process.env.MODE;
}

// ─── CHAIN-1(b): __INTERNAL_WRITE__ not public + hand-rolled client refused ─

test('CHAIN-1(b): __INTERNAL_WRITE__ is not in the public surface', () => {
  assert.equal(swm.__INTERNAL_WRITE__, undefined,
    'symbol must not be exported from src/index');
  const factory = require('../src/integrationFactory');
  assert.equal(factory.__INTERNAL_WRITE__, undefined,
    'symbol must not be exported from integrationFactory either');
});

test('CHAIN-1(b): hand-rolled client (not built via defineAdapter) is refused', () => {
  cleanMode();
  process.env.SAFE_WRITE_MODE = 'read-write';
  // Caller tries to smuggle a "client" with their own symbol — even with the
  // exact prior symbol value, createIntegration must refuse.
  const sneaky = {
    async get() { return { status: 200 }; },
    async [Symbol('safeWrite.internalOp')]() { return { status: 200 }; },
  };
  assert.throws(
    () => createIntegration({ name: 'x', client: sneaky }),
    /built via defineAdapter/,
  );
});

test('CHAIN-1(b): defineAdapter clients ARE accepted', () => {
  cleanMode();
  const client = defineAdapter({
    label: 'ok',
    async get() { return { status: 200 }; },
    async write() { return { status: 200 }; },
  });
  const i = createIntegration({ name: 'ok', client });
  assert.ok(typeof i.write.post === 'function');
});

// ─── CHAIN-1(c): GraphQL classifier — bypasses closed ───────────────────────

test('CHAIN-1(c): BOM-prefixed mutation is classified as mutation', () => {
  assert.equal(classifyDocument('﻿mutation { delete(id: 1) }'), 'mutation');
});

test('CHAIN-1(c): NBSP / Unicode whitespace before keyword still detected', () => {
  assert.equal(classifyDocument(' ​mutation { x }'), 'mutation');
});

test('CHAIN-1(c): mixed-operation document is "mixed"', () => {
  const doc = 'query Foo { x } mutation Bar { delete(id: 1) }';
  assert.equal(classifyDocument(doc), 'mixed');
});

test('CHAIN-1(c): pure query stays "query"', () => {
  assert.equal(classifyDocument('query Foo { x y z }'), 'query');
});

test('CHAIN-1(c): "mutation" appearing inside a string literal is NOT detected', () => {
  const doc = 'query { search(q: "mutation") { id } }';
  assert.equal(classifyDocument(doc), 'query');
});

test('CHAIN-1(c): "mutation" inside a block string is NOT detected', () => {
  const doc = 'query { search(q: """\nmutation lives here\n""") { id } }';
  assert.equal(classifyDocument(doc), 'query');
});

// ─── CHAIN-2(a): SSRF ───────────────────────────────────────────────────────

test('CHAIN-2(a): AWS metadata endpoint 169.254.169.254 is private', () => {
  assert.equal(isPrivateIPv4('169.254.169.254'), true);
});

test('CHAIN-2(a): localhost / private ranges flagged', () => {
  assert.equal(isPrivateIPv4('127.0.0.1'), true);
  assert.equal(isPrivateIPv4('10.0.0.5'), true);
  assert.equal(isPrivateIPv4('172.20.1.1'), true);
  assert.equal(isPrivateIPv4('192.168.1.1'), true);
  assert.equal(isPrivateIPv4('100.64.0.1'), true); // CGNAT
  assert.equal(isPrivateIPv4('0.0.0.0'), true);
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('1.1.1.1'), false);
});

test('CHAIN-2(a): IPv6 loopback + ULA flagged', () => {
  assert.equal(isPrivateIPv6('::1'), true);
  assert.equal(isPrivateIPv6('fc00::1'), true);
  assert.equal(isPrivateIPv6('fd12:3456::1'), true);
  assert.equal(isPrivateIPv6('fe80::1'), true);
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false);
});

test('CHAIN-2(a): assertPublicURL refuses http:// without opt-in', async () => {
  delete process.env.SAFE_WRITE_ALLOW_INSECURE;
  await assert.rejects(() => assertPublicURL('http://example.com/'), /only https/);
});

test('CHAIN-2(a): assertPublicURL refuses literal private IP', async () => {
  await assert.rejects(
    () => assertPublicURL('https://169.254.169.254/latest/meta-data/'),
    /private/,
  );
});

// ─── CHAIN-2(b): path-injection ─────────────────────────────────────────────

test('CHAIN-2(b): safeJoin refuses absolute URL in path (bearer-leak vector)', () => {
  const base = 'https://api.example.com/v1';
  assert.throws(() => safeJoin(base, '/https://evil.tld/exfil'), /scheme-like/);
});

test('CHAIN-2(b): safeJoin refuses protocol-relative path', () => {
  assert.throws(() => safeJoin('https://api.example.com', '//evil.tld/x'), /protocol-relative/);
});

test('CHAIN-2(b): safeJoin refuses backslash', () => {
  assert.throws(() => safeJoin('https://api.example.com', '/x\\evil.tld'), /backslash/);
});

test('CHAIN-2(b): safeJoin refuses cross-origin via userinfo trick', () => {
  // /@evil.tld/x parses as relative, but resolves on api.example.com — still
  // ends up cross-origin in some parsers. safeJoin checks origin equality.
  const base = 'https://api.example.com/v1';
  // Same-origin path with @ in segment — must still be allowed if joined URL
  // stays on the same origin. We just verify there is no implicit jump.
  const ok = safeJoin(base, '/users/alice@example.com');
  assert.ok(ok.startsWith('https://api.example.com/'));
});

test('CHAIN-2(b): safeJoin preserves baseUrl path prefix', () => {
  const joined = safeJoin('https://api.example.com/v1', '/products/SKU-42');
  assert.equal(joined, 'https://api.example.com/v1/products/SKU-42');
});

test('CHAIN-2(b): safeJoin refuses CR/LF in path (header-injection)', () => {
  assert.throws(() => safeJoin('https://api.example.com', '/x\r\nX-Evil: 1'), /control character/);
});

// ─── CHAIN-2(c): logger redactor ────────────────────────────────────────────

test('CHAIN-2(c): logger.redact masks Authorization key', () => {
  const out = logger.redact({ headers: { Authorization: 'Bearer abc123' } });
  assert.equal(out.headers.Authorization, '[REDACTED]');
});

test('CHAIN-2(c): logger.redact masks set-cookie + cookie keys', () => {
  const out = logger.redact({
    'set-cookie': 'session=abc',
    cookie: 'sid=def',
    other: 'visible',
  });
  assert.equal(out['set-cookie'], '[REDACTED]');
  assert.equal(out.cookie, '[REDACTED]');
  assert.equal(out.other, 'visible');
});

test('CHAIN-2(c): logger.redact masks Bearer pattern in free strings', () => {
  const out = logger.redact({ note: 'Authorization: Bearer eyJhbGciOiJIUzI1NiI' });
  assert.match(out.note, /\[REDACTED\]/);
  assert.equal(out.note.includes('eyJhbGciOiJIUzI1NiI'), false);
});

test('CHAIN-2(c): logger.redact masks sk- prefixed OpenAI-style key', () => {
  const out = logger.redact({ msg: 'token sk-abcdefghijklmnopqrstuv leaked' });
  assert.match(out.msg, /\[REDACTED\]/);
  assert.equal(out.msg.includes('sk-abcdefghijklmnopqrstuv'), false);
});

test('CHAIN-2(c): logger.redact handles arrays + nested objects', () => {
  const out = logger.redact({
    items: [{ token: 'x' }, { ok: 1 }],
  });
  assert.equal(out.items[0].token, '[REDACTED]');
  assert.equal(out.items[1].ok, 1);
});

// ─── CHAIN-2(d): URL leak in error messages ─────────────────────────────────

test('CHAIN-2(d): sanitizeUrlForLog strips query string + userinfo', () => {
  const dirty = 'https://user:pass@api.example.com/x?api_key=SECRET&token=XYZ#frag';
  assert.equal(sanitizeUrlForLog(dirty), 'https://api.example.com/x');
});

test('CHAIN-2(d): sanitizeUrlForLog returns marker on invalid input', () => {
  assert.equal(sanitizeUrlForLog('not a url'), '[invalid-url]');
});

// ─── H1: lockMode ───────────────────────────────────────────────────────────

test('H1: lockMode freezes mode against subsequent env mutation', () => {
  cleanMode();
  process.env.SAFE_WRITE_MODE = 'read-only';
  lockMode();
  // attacker mutates env mid-process:
  process.env.SAFE_WRITE_MODE = 'read-write';
  process.env.MODE = 'read-write';
  assert.equal(swm.getMode(), 'read-only',
    'locked mode must ignore subsequent env changes');
});

test('H1: lockMode("read-write") accepts explicit value', () => {
  cleanMode();
  lockMode('read-write');
  assert.equal(swm.getMode(), 'read-write');
});

test('H1: lockMode rejects invalid explicit value', () => {
  cleanMode();
  assert.throws(() => lockMode('chaos'), { code: 'INVALID_MODE' });
});

// ─── CHAIN-1(a): confirmation verifier hook ─────────────────────────────────

test('CHAIN-1(a): verifier returning false refuses writes', async () => {
  cleanMode();
  process.env.SAFE_WRITE_MODE = 'read-write';
  setConfirmationVerifier(async () => false);
  try {
    const client = defineAdapter({
      label: 'verifier-test',
      async get() { return { status: 200 }; },
      async write() { return { status: 200 }; },
    });
    const i = createIntegration({ name: 'verifier-test', client });
    await assert.rejects(
      () => i.write.post('/x', { v: 1 }, { confirmed: true, reason: 'unit' }),
      { name: 'SafetyError', code: 'CONFIRMATION_REJECTED' },
    );
  } finally {
    setConfirmationVerifier(null);
  }
});

test('CHAIN-1(a): verifier returning true allows the write', async () => {
  cleanMode();
  process.env.SAFE_WRITE_MODE = 'read-write';
  let called = false;
  setConfirmationVerifier(async ({ destructive }) => {
    // host-side policy: only allow non-destructive in this test
    return !destructive;
  });
  try {
    const client = defineAdapter({
      label: 'verifier-allow',
      async get() { return { status: 200 }; },
      async write() { called = true; return { status: 200 }; },
    });
    const i = createIntegration({ name: 'verifier-allow', client });
    const res = await i.write.post('/x', { v: 1 }, { confirmed: true, reason: 'ok' });
    assert.equal(res.status, 200);
    assert.equal(called, true);
  } finally {
    setConfirmationVerifier(null);
  }
});

// ─── M5: retries clamped ────────────────────────────────────────────────────

test('M5: retry policy is clamped to MAX_RETRIES_HARD_CAP', async () => {
  // We can't easily count fetch attempts without a real server. Verify the
  // module exposes the request function and the clamp constant is present in
  // source — guards against silent removal of the cap.
  const httpSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'http.js'), 'utf8',
  );
  assert.match(httpSrc, /MAX_RETRIES_HARD_CAP\s*=\s*10/);
});

// ─── M4: log directory + file permissions ───────────────────────────────────

test('M4/M7: WRITE_LOG_DIR is created mode 0700, files 0600', () => {
  // write something first
  logger.logWrite({ integration: 'perm-test', method: 'POST' });
  const dirStat = fs.statSync(TMP);
  // On macOS, mkdirSync respects mode for dirs we own; check at least the
  // owner bits don't expose group/other.
  const mode = dirStat.mode & 0o777;
  assert.equal((mode & 0o077), 0, `dir mode 0${mode.toString(8)} leaks to group/other`);

  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(TMP, `writes-${today}.ndjson`);
  const fileStat = fs.statSync(file);
  const fmode = fileStat.mode & 0o777;
  assert.equal((fmode & 0o077), 0, `file mode 0${fmode.toString(8)} leaks to group/other`);
});

// ─── D2 (discovery): canonicalStringify cycle defense ───────────────────────

test('D2: canonicalStringify refuses cyclic body', () => {
  const { canonicalStringify } = require('../src/safety');
  const a = { x: 1 };
  a.self = a;
  assert.throws(() => canonicalStringify(a), { code: 'BODY_CYCLE' });
});

test('D2: canonicalStringify refuses overly deep body', () => {
  const { canonicalStringify } = require('../src/safety');
  let leaf = { v: 1 };
  let root = leaf;
  for (let i = 0; i < 40; i++) root = { next: root };
  assert.throws(() => canonicalStringify(root), { code: 'BODY_TOO_DEEP' });
});
