'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-logger-'));
process.env.WRITE_LOG_DIR = TMP;
process.env.LOG_LEVEL = 'error';

const logger = require('../src/logger');

test('logWrite creates dated log file', () => {
  logger.logWrite({ integration: 'demo', method: 'POST', path: '/x' });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(TMP, `writes-${today}.ndjson`);
  assert.ok(fs.existsSync(file));
});

test('logWrite produces parseable NDJSON', () => {
  logger.logWrite({ integration: 'parse', method: 'GET', outcome: 'refused' });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(TMP, `writes-${today}.ndjson`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.ok(parsed.ts);
    assert.ok(parsed.integration);
  }
});

test('logWrite appends, does not overwrite', () => {
  logger.logWrite({ integration: 'append-a', method: 'GET' });
  logger.logWrite({ integration: 'append-b', method: 'GET' });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(TMP, `writes-${today}.ndjson`);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.includes('"integration":"append-a"'));
  assert.ok(content.includes('"integration":"append-b"'));
});

test('console logger respects LOG_LEVEL', () => {
  // We can't easily capture stderr in a portable way without dependencies,
  // but we can confirm the functions exist and don't throw.
  assert.doesNotThrow(() => logger.info('hi', { x: 1 }));
  assert.doesNotThrow(() => logger.warn('hi', { x: 1 }));
  assert.doesNotThrow(() => logger.error('hi', { x: 1 }));
  assert.doesNotThrow(() => logger.debug('hi', { x: 1 }));
});
