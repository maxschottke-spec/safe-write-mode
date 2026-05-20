'use strict';

function required(name) {
  const v = process.env[name];
  if (v == null || v === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name, fallback = null) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_INPUT_BYTES = 256 * 1024;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// L2 (audit r2): bound the traversal depth so a deeply-nested attacker-
// supplied JSON can't blow the call stack and trigger a silent abort before
// the prototype-pollution check completes.
const MAX_REJECT_DEPTH = 32;

function rejectDangerousKeys(value, path = '$', depth = 0) {
  if (depth > MAX_REJECT_DEPTH) {
    throw new Error(`Refused: env JSON exceeds max depth (${MAX_REJECT_DEPTH}) at ${path}.`);
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`Refused: dangerous key '${key}' at ${path}.`);
    }
    rejectDangerousKeys(value[key], `${path}.${key}`, depth + 1);
  }
}

function requiredJsonBase64(name) {
  const raw = required(name);
  if (raw.length > MAX_BASE64_INPUT_BYTES) {
    throw new Error(`Env var ${name} exceeds max base64 size (${MAX_BASE64_INPUT_BYTES} bytes).`);
  }
  if (!BASE64_RE.test(raw)) {
    throw new Error(`Env var ${name} is not valid base64.`);
  }
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error(`Env var ${name} (base64-decoded) is not valid JSON.`);
  }
  rejectDangerousKeys(parsed);
  return parsed;
}

module.exports = { required, optional, requiredJsonBase64 };
