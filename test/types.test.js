'use strict';

// index.d.ts is written by hand. These tests keep it honest: every name it
// declares must exist at runtime and every runtime export must be declared.
// They compare names, not signatures; `tsc` is not a dependency of this repo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dts = fs.readFileSync(path.join(root, 'index.d.ts'), 'utf8');
const swm = require('../src');

function sorted(iterable) {
  return [...new Set(iterable)].sort();
}

function membersOf(constName) {
  const block = dts.split(`export const ${constName}: {\n`)[1].split('\n};')[0];
  return sorted([...block.matchAll(/^  ([A-Za-z0-9_]+)[(<:]/gm)].map((m) => m[1]));
}

test('types: declared values match the runtime exports of src/index.js', () => {
  const declared = sorted(
    [...dts.matchAll(/^export (?:function|class|const) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]),
  );
  assert.deepEqual(declared, sorted(Object.keys(swm)));
});

test('types: http, logger and env namespaces match the runtime objects', () => {
  for (const ns of ['http', 'logger', 'env']) {
    assert.deepEqual(membersOf(ns), sorted(Object.keys(swm[ns])), ns);
  }
});

test('types: SafetyErrorCode lists exactly the codes used in src/safety.js', () => {
  const union = dts.split('export type SafetyErrorCode =')[1].split(';')[0];
  const declared = sorted([...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
  const source = fs.readFileSync(path.join(root, 'src', 'safety.js'), 'utf8');
  const methods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const used = sorted(
    [...source.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]).filter((c) => !methods.has(c)),
  );
  assert.deepEqual(declared, used);
});

test('types: package.json points to index.d.ts and ships it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.types, 'index.d.ts');
  assert.ok(pkg.files.includes('index.d.ts'));
  assert.ok(fs.existsSync(path.join(root, pkg.types)));
});
