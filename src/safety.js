'use strict';

const crypto = require('node:crypto');
const logger = require('./logger');

class SafetyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SafetyError';
    this.code = code;
  }
}

// ─── H1 (audit r2): mode-lock ───────────────────────────────────────────────
// The kill-switch lives in `process.env`. Any in-process plugin can flip
// `process.env.SAFE_WRITE_MODE = 'read-write'` and reopen the gate. M3 fixed
// the M3-specific MODE-collision, but the structural pattern stays open until
// the host captures the mode at startup and freezes it.
//
// Usage:
//   const { lockMode } = require('safe-write-mode');
//   process.env.SAFE_WRITE_MODE = 'read-only';
//   lockMode();   // any subsequent env mutation is ignored.
//
// After lockMode() the value is final for the lifetime of the process:
// a second lockMode() call may repeat the locked value, but any attempt to
// lock a different mode throws MODE_LOCKED (v0.2.1).
// Test hooks (_unlockModeForTests, _resetConfirmationVerifierForTests) only
// work if SAFE_WRITE_TEST_HOOKS=1 was set when this module was first loaded.
// The value is captured once, so code running later in the same process
// cannot switch the hooks on and use them to undo a lock.
const TEST_HOOKS_ENABLED = process.env.SAFE_WRITE_TEST_HOOKS === '1';
function assertTestHooks(name) {
  if (!TEST_HOOKS_ENABLED) {
    throw new SafetyError(
      `Refused: ${name} is a test hook and only available when SAFE_WRITE_TEST_HOOKS=1 is set before the library is loaded.`,
      'TEST_HOOKS_DISABLED',
    );
  }
}

let _lockedMode = null;
let _legacyModeWarned = false;

function readModeFromEnv() {
  let raw = process.env.SAFE_WRITE_MODE;
  if (raw == null || raw === '') {
    if (process.env.MODE != null && process.env.MODE !== '') {
      if (!_legacyModeWarned) {
        logger.warn(
          'safe-write-mode',
          'Using legacy env var MODE — please switch to SAFE_WRITE_MODE. ' +
            'MODE will be ignored in a future major version.',
        );
        _legacyModeWarned = true;
      }
      raw = process.env.MODE;
    }
  }
  const m = (raw || 'read-only').toLowerCase();
  if (m !== 'read-only' && m !== 'read-write') {
    throw new SafetyError(`Invalid SAFE_WRITE_MODE='${m}'. Use 'read-only' or 'read-write'.`, 'INVALID_MODE');
  }
  return m;
}

function getMode() {
  if (_lockedMode != null) return _lockedMode;
  return readModeFromEnv();
}

function lockMode(explicit) {
  // Accept an explicit mode argument so the host can pin the value without a
  // round-trip through process.env (useful in tests and embedded hosts).
  let requested = null;
  if (explicit != null) {
    requested = String(explicit).toLowerCase();
    if (requested !== 'read-only' && requested !== 'read-write') {
      throw new SafetyError(`Invalid lockMode('${explicit}'). Use 'read-only' or 'read-write'.`, 'INVALID_MODE');
    }
  }
  if (_lockedMode != null) {
    // Already locked. Never re-read the environment and never switch modes.
    if (requested != null && requested !== _lockedMode) {
      throw new SafetyError(
        `Refused: mode is already locked to '${_lockedMode}' and cannot be changed to '${requested}'.`,
        'MODE_LOCKED',
      );
    }
    return _lockedMode;
  }
  _lockedMode = requested != null ? requested : readModeFromEnv();
  logger.info('safe-write-mode', { event: 'mode-locked', mode: _lockedMode });
  return _lockedMode;
}

function isModeLocked() {
  return _lockedMode != null;
}

// Test-only: undo the lock. Not exported through src/index.js — tests reach
// into ../src/safety directly.
function _unlockModeForTests() {
  assertTestHooks('_unlockModeForTests');
  _lockedMode = null;
  _legacyModeWarned = false;
}

// L1 (audit): canonical JSON serialization with depth + cycle defense (D2).
const MAX_CANONICAL_DEPTH = 32;
function canonicalStringify(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new SafetyError('Refused: body exceeds max canonicalization depth (32).', 'BODY_TOO_DEEP');
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) {
    throw new SafetyError('Refused: body contains a cyclic reference.', 'BODY_CYCLE');
  }
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = '[' + value.map((v) => canonicalStringify(v, depth + 1, seen)).join(',') + ']';
  } else {
    const keys = Object.keys(value).sort();
    out =
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k], depth + 1, seen))
        .join(',') +
      '}';
  }
  seen.delete(value);
  return out;
}

function hashRequest(body) {
  if (body === null || body === undefined) return null;
  const str = typeof body === 'string' ? body : canonicalStringify(body);
  return 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
}

function refuse(baseEntry, code, message) {
  logger.logWrite({ ...baseEntry, outcome: 'refused', reasonCode: code });
  logger.warn('write[refused]', { ...baseEntry, reasonCode: code });
  throw new SafetyError(message, code);
}

const ALLOWED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const DESTRUCTIVE_PATH_PATTERNS = [
  /\/reset(\b|\/)/i,
  /\/purge(\b|\/)/i,
  /\/wipe(\b|\/)/i,
  /\/clear(\b|\/)/i,
  /\/flush(\b|\/)/i,
  /\/destroy(\b|\/)/i,
  /\/factory[-_]?reset(\b|\/)/i,
];

function isDestructivePath(target) {
  if (typeof target !== 'string') return false;
  return DESTRUCTIVE_PATH_PATTERNS.some((re) => re.test(target));
}

// CHAIN-1(a) (audit r2): callers can pass `confirmed: true` and
// `destructive: true` themselves — there is no separate host-channel that
// distinguishes "a human pressed yes" from "the agent set the flag". A host
// that needs a real boundary can install a confirmation verifier here.
let _confirmationVerifier = null;
function setConfirmationVerifier(fn) {
  if (fn != null && typeof fn !== 'function') {
    throw new TypeError('setConfirmationVerifier expects a function or null.');
  }
  // v0.2.1: once a verifier is installed it cannot be removed or replaced.
  // Otherwise the code it is meant to constrain could simply call
  // setConfirmationVerifier(null) and fall back to self-attestation.
  if (_confirmationVerifier != null) {
    throw new SafetyError(
      'Refused: a confirmation verifier is already installed and cannot be replaced or removed.',
      'VERIFIER_LOCKED',
    );
  }
  _confirmationVerifier = fn;
}

// Test-only: remove the verifier. Not exported through src/index.js.
function _resetConfirmationVerifierForTests() {
  assertTestHooks('_resetConfirmationVerifierForTests');
  _confirmationVerifier = null;
}

// The audit log must not carry query strings: they routinely contain
// identifiers, e-mail addresses or API keys. Only the path part is logged.
// A bare hash of a low-entropy query (an e-mail address, a short id) can be
// guessed by anyone who reads the log. targetHash is therefore an HMAC. The
// key comes from SAFE_WRITE_AUDIT_KEY (captured once at load, never logged);
// without it a random per-process key is used, which still lets entries of
// one run be matched against each other but not across runs.
const AUDIT_KEY = process.env.SAFE_WRITE_AUDIT_KEY
  ? Buffer.from(process.env.SAFE_WRITE_AUDIT_KEY, 'utf8')
  : crypto.randomBytes(32);
function targetMac(target) {
  return 'hmac-sha256:' + crypto.createHmac('sha256', AUDIT_KEY).update(target).digest('hex');
}

function pathForLog(target) {
  if (typeof target !== 'string') return '[non-string target]';
  const q = target.search(/[?#]/);
  return q === -1 ? target : target.slice(0, q);
}

async function safeWrite({ integration, method, path: target, body, opts = {}, execute }) {
  const {
    dryRun = false,
    confirmed = false,
    destructive = false,
    reason = null,
    requireReason = false,
    confirmationToken = null,
  } = opts;
  const normalizedMethod = String(method ?? '').toUpperCase();
  const mode = getMode();

  const baseEntry = {
    integration,
    method: normalizedMethod,
    path: pathForLog(target),
    // The query string is not logged, but the entry must still bind to the
    // exact request: targetHash is a keyed MAC over the full target.
    targetHash: typeof target === 'string' ? targetMac(target) : null,
    requestHash: hashRequest(body),
    dryRun,
    destructive,
    reason,
  };

  // v0.2.1: the target must be a string. Objects would bypass both the
  // destructive-path check and the query-string cut for the audit log.
  if (typeof target !== 'string') {
    refuse(baseEntry, 'INVALID_PATH',
      `Refused: path must be a string (got ${target === null ? 'null' : typeof target}).`);
  }
  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    refuse(baseEntry, 'INVALID_METHOD',
      `Refused: method must be one of POST/PUT/PATCH/DELETE (got '${method}').`);
  }
  if (mode === 'read-only') {
    refuse(baseEntry, 'READ_ONLY_MODE',
      `Refused: write blocked because SAFE_WRITE_MODE=read-only (${integration} ${normalizedMethod} ${target}).`);
  }
  // v0.2.1: strict booleans. Agents often pass arguments as strings, and
  // 'false' or 1 must not count as consent.
  if (confirmed !== true) {
    refuse(baseEntry, 'CONFIRMATION_REQUIRED',
      `Refused: write requires { confirmed: true } (${integration} ${normalizedMethod} ${target}).`);
  }
  if (normalizedMethod === 'DELETE' && destructive !== true) {
    refuse(baseEntry, 'DESTRUCTIVE_NOT_ACKED',
      `Refused: DELETE requires { destructive: true } (${integration} ${target}).`);
  }
  if (isDestructivePath(target) && destructive !== true) {
    refuse(baseEntry, 'DESTRUCTIVE_NOT_ACKED',
      `Refused: path '${target}' looks destructive — set { destructive: true } to proceed (${integration} ${normalizedMethod}).`);
  }
  // CHAIN-1(a): if a host-supplied confirmation verifier is installed, route
  // every write through it. The verifier returns true to allow, false/throw to
  // refuse. This is the only way to actually escape the "self-attestation"
  // limitation — the verifier should consult an out-of-process channel.
  if (_confirmationVerifier) {
    let verifierOk = false;
    try {
      verifierOk = await _confirmationVerifier({
        integration,
        method: normalizedMethod,
        path: target,
        requestHash: baseEntry.requestHash,
        destructive,
        reason,
        confirmationToken,
      });
    } catch (verifierErr) {
      refuse(baseEntry, 'CONFIRMATION_REJECTED',
        `Refused: confirmation verifier threw — ${verifierErr.message}`);
    }
    if (verifierOk !== true) {
      refuse(baseEntry, 'CONFIRMATION_REJECTED',
        `Refused: host confirmation verifier did not approve this write.`);
    }
  }

  const reasonEnforced =
    requireReason ||
    process.env.SAFE_WRITE_REQUIRE_REASON === '1' ||
    process.env.SAFE_WRITE_REQUIRE_REASON === 'true';
  if (reasonEnforced) {
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) {
      refuse(baseEntry, 'REASON_REQUIRED',
        `Refused: write requires non-empty { reason } (${integration} ${normalizedMethod} ${target}).`);
    }
  }

  if (dryRun) {
    logger.logWrite({ ...baseEntry, outcome: 'dry-run' });
    logger.info('write[dry-run]', baseEntry);
    return { dryRun: true, integration, method, path: target };
  }

  const auditId = crypto.randomUUID();
  const start = Date.now();
  try {
    logger.logWrite({ ...baseEntry, auditId, outcome: 'pending' });
  } catch (logErr) {
    logger.error('write[audit-unavailable]', { ...baseEntry, error: logErr.message });
    throw new SafetyError(
      `Refused: audit log unavailable (${logErr.message}). Writes blocked until WRITE_LOG_DIR is writable.`,
      'AUDIT_UNAVAILABLE',
    );
  }

  try {
    const result = await execute();
    const durationMs = Date.now() - start;
    try {
      logger.logWrite({
        ...baseEntry, auditId, outcome: 'ok',
        status: result?.status ?? null, durationMs,
      });
    } catch (logErr) {
      logger.error('write[audit-partial]', {
        ...baseEntry, auditId, error: logErr.message,
        remoteStatus: result?.status ?? null,
      });
    }
    logger.info('write[ok]', { ...baseEntry, auditId, durationMs, status: result?.status ?? null });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    try {
      logger.logWrite({
        ...baseEntry, auditId, outcome: 'error', durationMs,
        error: err.message, status: err.status ?? null,
      });
    } catch { /* already logged pending */ }
    logger.error('write[error]', { ...baseEntry, auditId, durationMs, error: err.message });
    throw err;
  }
}

module.exports = {
  SafetyError,
  safeWrite,
  getMode,
  lockMode,
  isModeLocked,
  setConfirmationVerifier,
  canonicalStringify,
  isDestructivePath,
  pathForLog,
  targetMac,
  _unlockModeForTests,
  _resetConfirmationVerifierForTests,
};
