'use strict';

// Runs the shipped examples as a user would. Each run gets its own log
// directory and store file, so nothing is left behind in the repository.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function run(file, args, extraEnv, dir) {
  const env = { ...process.env, WRITE_LOG_DIR: path.join(dir, 'logs'), LOG_LEVEL: 'error',
    AGENT_TOOL_STORE: path.join(dir, 'stock.json'), ...extraEnv };
  delete env.SAFE_WRITE_TEST_HOOKS;
  if (!('SAFE_WRITE_MODE' in extraEnv)) delete env.SAFE_WRITE_MODE;
  delete env.MODE;
  return spawnSync(process.execPath, [path.join(root, 'examples', file), ...args], { cwd: dir, env, encoding: 'utf8' });
}

function logLines(dir) {
  const logs = path.join(dir, 'logs');
  if (!fs.existsSync(logs)) return [];
  return fs.readdirSync(logs)
    .flatMap((f) => fs.readFileSync(path.join(logs, f), 'utf8').trim().split('\n'))
    .filter(Boolean).map((l) => JSON.parse(l));
}

test('examples: the four basic examples exit 0 the way package.json runs them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-examples-'));
  assert.equal(run('basic-read-only.js', [], {}, dir).status, 0);
  assert.equal(run('multi-tenant.js', [], {}, dir).status, 0);
  assert.equal(run('three-key-write.js', [], { SAFE_WRITE_MODE: 'read-write' }, dir).status, 0);
  assert.equal(run('dry-run-flow.js', [], { SAFE_WRITE_MODE: 'read-write' }, dir).status, 0);
});

test('examples: agent-tool reads, is refused without the mode, and writes with all keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-agent-'));
  const set = ['set', 'SKU-42', '50', '--reason', 'delivery received'];

  const read = run('agent-tool.js', ['get', 'SKU-42'], {}, dir);
  assert.deepEqual(JSON.parse(read.stdout), { sku: 'SKU-42', qty: 42 });

  // Default mode: refused, exit code 2, nothing stored, one refused log entry.
  const refused = run('agent-tool.js', [...set, '--confirm'], {}, dir);
  assert.equal(refused.status, 2);
  assert.equal(JSON.parse(refused.stdout).code, 'READ_ONLY_MODE');
  assert.equal(fs.existsSync(path.join(dir, 'stock.json')), false);
  assert.deepEqual(logLines(dir).map((e) => [e.outcome, e.reasonCode]), [['refused', 'READ_ONLY_MODE']]);

  // Mode set, but no --confirm: still refused.
  const unconfirmed = run('agent-tool.js', set, { SAFE_WRITE_MODE: 'read-write' }, dir);
  assert.equal(unconfirmed.status, 2);
  assert.equal(JSON.parse(unconfirmed.stdout).code, 'CONFIRMATION_REQUIRED');
  assert.equal(fs.existsSync(path.join(dir, 'stock.json')), false);

  // Dry run: passes the gate, sends nothing.
  const rehearsal = run('agent-tool.js', [...set, '--confirm', '--dry-run'], { SAFE_WRITE_MODE: 'read-write' }, dir);
  assert.equal(JSON.parse(rehearsal.stdout).dryRun, true);
  assert.equal(fs.existsSync(path.join(dir, 'stock.json')), false);

  // All keys: written and read back.
  const ok = run('agent-tool.js', [...set, '--confirm'], { SAFE_WRITE_MODE: 'read-write' }, dir);
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout), { written: true, verified: true, after: { sku: 'SKU-42', qty: 50 } });
  assert.deepEqual(JSON.parse(run('agent-tool.js', ['get', 'SKU-42'], {}, dir).stdout), { sku: 'SKU-42', qty: 50 });
  assert.deepEqual(logLines(dir).map((e) => e.outcome), ['refused', 'refused', 'dry-run', 'pending', 'ok']);
});
