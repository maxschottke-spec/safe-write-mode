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

function rejectDangerousKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error(`Refused: dangerous key '${key}' at ${path}.`);
    }
    rejectDangerousKeys(value[key], `${path}.${key}`);
  }
}

function requiredJsonBase64(name) {
  const raw = required(name);
  // N6: Buffer.from(base64) is tolerant — silently decodes garbage. Validate
  // strictly before decoding so a malformed env var fails fast instead of
  // producing nonsense JSON parse errors downstream.
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
  // N6: prototype-pollution defense.
  rejectDangerousKeys(parsed);
  return parsed;
}

module.exports = { required, optional, requiredJsonBase64 };
