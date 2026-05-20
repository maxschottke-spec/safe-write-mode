'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function levelCap() {
  return LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
}

// ─── CHAIN-2(c) (audit r2): recursive redactor ─────────────────────────────
// The v0.1 logger spread caller-supplied `meta` straight into the JSON entry.
// A caller doing `logger.error('refresh failed', { headers })` shipped bearer
// tokens, cookies, and `set-cookie` headers verbatim into stderr AND the
// NDJSON audit log (which the docs explicitly advertise as S3/SIEM-shippable).
//
// We now redact by key (`Authorization`, `Cookie`, etc.) and by value pattern
// (`Bearer …`, `sk-…`, `ghp_…`, etc.) before serialization. Depth-cap defends
// against caller-supplied cyclic graphs.
const REDACT_KEY_RE =
  /^(authorization|cookie|set-cookie|password|secret|token|api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|x-api-key|proxy-authorization|session|sessionid|jwt)$/i;

const REDACT_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9_-]{16,}/g,
  /\bxox[bpsra]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
];

const MAX_REDACT_DEPTH = 16;

function redactValue(value, depth) {
  if (depth > MAX_REDACT_DEPTH) return '[REDACTED:depth-cap]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let s = value;
    for (const re of REDACT_VALUE_PATTERNS) s = s.replace(re, '[REDACTED]');
    return s;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return '[unserializable]';
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    // Special-case Headers-like objects (e.g. node fetch's Headers); we can't
    // iterate them with Object.entries and they routinely carry auth fields.
    if (typeof value.entries === 'function' && typeof value.get === 'function') {
      return '[Headers REDACTED]';
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEY_RE.test(k) ? '[REDACTED]' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function redact(meta) {
  if (meta == null) return meta;
  return redactValue(meta, 0);
}

function consoleLog(level, msg, meta) {
  if (LEVELS[level] > levelCap()) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...(redact(meta) || {}) };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

function writeLogFile() {
  const dir = process.env.WRITE_LOG_DIR || 'logs';
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `writes-${date}.ndjson`);
}

// M4 (audit r2): create the log directory with 0700 and open the file with
// 0600 — the previous defaults (0755 dir + 0644 file) made the audit log
// world-readable on shared hosts, even though SECURITY.md classifies it as
// operationally sensitive. M7 of round 2.
function logWrite(entry) {
  const file = writeLogFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    const redacted = redact(entry);
    fs.writeSync(fd, JSON.stringify({ ts: new Date().toISOString(), ...redacted }) + '\n');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  info: (msg, meta) => consoleLog('info', msg, meta),
  warn: (msg, meta) => consoleLog('warn', msg, meta),
  error: (msg, meta) => consoleLog('error', msg, meta),
  debug: (msg, meta) => consoleLog('debug', msg, meta),
  logWrite,
  // exported so tests / advanced callers can pre-redact before pushing meta:
  redact,
};
