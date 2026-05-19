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

// M3 (audit): prefer SAFE_WRITE_MODE — namespaced so unrelated tooling that
// happens to set MODE in the parent process cannot toggle the kill switch.
// MODE remains as legacy fallback with a one-shot deprecation warning.
let _legacyModeWarned = false;
function getMode() {
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

// L1 (audit): canonical JSON serialization so semantically identical requests
// always hash to the same value. Sorts object keys recursively before hashing.
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k]))
      .join(',') +
    '}'
  );
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

// N1 (audit, partial): paths that are semantically destructive regardless of
// HTTP method. Caller must ack `destructive: true` for any write that hits
// these patterns. Full N1 fix (destructive-by-default for PUT) requires an
// API change deferred to v0.2.
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

async function safeWrite({ integration, method, path: target, body, opts = {}, execute }) {
  const {
    dryRun = false,
    confirmed = false,
    destructive = false,
    reason = null,
    requireReason = false,
  } = opts;
  const normalizedMethod = String(method ?? '').toUpperCase();
  const mode = getMode();

  const baseEntry = {
    integration,
    method: normalizedMethod,
    path: target,
    requestHash: hashRequest(body),
    dryRun,
    destructive,
    reason,
  };

  if (!ALLOWED_METHODS.has(normalizedMethod)) {
    refuse(
      baseEntry,
      'INVALID_METHOD',
      `Refused: method must be one of POST/PUT/PATCH/DELETE (got '${method}').`,
    );
  }
  if (mode === 'read-only') {
    refuse(
      baseEntry,
      'READ_ONLY_MODE',
      `Refused: write blocked because MODE=read-only (${integration} ${normalizedMethod} ${target}).`,
    );
  }
  if (!confirmed) {
    refuse(
      baseEntry,
      'CONFIRMATION_REQUIRED',
      `Refused: write requires { confirmed: true } (${integration} ${normalizedMethod} ${target}).`,
    );
  }
  if (normalizedMethod === 'DELETE' && !destructive) {
    refuse(
      baseEntry,
      'DESTRUCTIVE_NOT_ACKED',
      `Refused: DELETE requires { destructive: true } (${integration} ${target}).`,
    );
  }
  // N1 partial: destructive paths require ack regardless of method.
  if (isDestructivePath(target) && !destructive) {
    refuse(
      baseEntry,
      'DESTRUCTIVE_NOT_ACKED',
      `Refused: path '${target}' looks destructive — set { destructive: true } to proceed (${integration} ${normalizedMethod}).`,
    );
  }
  // M2: optional enforcement. Off by default to preserve v0.1 API; opt-in via
  // opts.requireReason or via env SAFE_WRITE_REQUIRE_REASON=1. When on,
  // refuses writes without a non-empty reason string.
  const reasonEnforced =
    requireReason ||
    process.env.SAFE_WRITE_REQUIRE_REASON === '1' ||
    process.env.SAFE_WRITE_REQUIRE_REASON === 'true';
  if (reasonEnforced) {
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) {
      refuse(
        baseEntry,
        'REASON_REQUIRED',
        `Refused: write requires non-empty { reason } (${integration} ${normalizedMethod} ${target}).`,
      );
    }
  }

  if (dryRun) {
    logger.logWrite({ ...baseEntry, outcome: 'dry-run' });
    logger.info('write[dry-run]', baseEntry);
    return { dryRun: true, integration, method, path: target };
  }

  // H4 (audit): write a `pending` audit entry BEFORE execute() so that if
  // execute() commits the change at the remote but logWrite throws afterwards,
  // we still have a trail. The pending entry is paired with a later ok/error
  // record sharing the same auditId.
  const auditId = crypto.randomUUID();
  const start = Date.now();
  try {
    logger.logWrite({ ...baseEntry, auditId, outcome: 'pending' });
  } catch (logErr) {
    // H4: if we cannot even write the pending entry, fail BEFORE execute so we
    // never have a committed remote write with no trail at all. Fail-fast.
    logger.error('write[audit-unavailable]', {
      ...baseEntry,
      error: logErr.message,
    });
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
        ...baseEntry,
        auditId,
        outcome: 'ok',
        status: result?.status ?? null,
        durationMs,
      });
    } catch (logErr) {
      // H4: write succeeded at the remote but final audit entry failed.
      // Surface to logs but DO NOT throw — the caller's success path must
      // reflect the remote outcome, not the audit-store outcome. The pending
      // entry above means the trail is not lost; an external reconciliation
      // job can match pending-without-final entries.
      logger.error('write[audit-partial]', {
        ...baseEntry,
        auditId,
        error: logErr.message,
        remoteStatus: result?.status ?? null,
      });
    }
    logger.info('write[ok]', { ...baseEntry, auditId, durationMs, status: result?.status ?? null });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    try {
      logger.logWrite({
        ...baseEntry,
        auditId,
        outcome: 'error',
        durationMs,
        error: err.message,
        status: err.status ?? null,
      });
    } catch {
      // already logged pending; nothing actionable here.
    }
    logger.error('write[error]', { ...baseEntry, auditId, durationMs, error: err.message });
    throw err;
  }
}

module.exports = { SafetyError, safeWrite, getMode, canonicalStringify, isDestructivePath };
