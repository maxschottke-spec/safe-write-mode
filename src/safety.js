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

function getMode() {
  const m = (process.env.MODE || 'read-only').toLowerCase();
  if (m !== 'read-only' && m !== 'read-write') {
    throw new SafetyError(`Invalid MODE='${m}'. Use 'read-only' or 'read-write'.`, 'INVALID_MODE');
  }
  return m;
}

function hashRequest(body) {
  if (body === null || body === undefined) return null;
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  return 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
}

function refuse(baseEntry, code, message) {
  logger.logWrite({ ...baseEntry, outcome: 'refused', reasonCode: code });
  logger.warn('write[refused]', { ...baseEntry, reasonCode: code });
  throw new SafetyError(message, code);
}

async function safeWrite({ integration, method, path: target, body, opts = {}, execute }) {
  const { dryRun = false, confirmed = false, destructive = false, reason = null } = opts;
  const mode = getMode();

  const baseEntry = {
    integration,
    method,
    path: target,
    requestHash: hashRequest(body),
    dryRun,
    destructive,
    reason,
  };

  if (mode === 'read-only') {
    refuse(
      baseEntry,
      'READ_ONLY_MODE',
      `Refused: write blocked because MODE=read-only (${integration} ${method} ${target}).`,
    );
  }
  if (!confirmed) {
    refuse(
      baseEntry,
      'CONFIRMATION_REQUIRED',
      `Refused: write requires { confirmed: true } (${integration} ${method} ${target}).`,
    );
  }
  if (method === 'DELETE' && !destructive) {
    refuse(
      baseEntry,
      'DESTRUCTIVE_NOT_ACKED',
      `Refused: DELETE requires { destructive: true } (${integration} ${target}).`,
    );
  }

  if (dryRun) {
    logger.logWrite({ ...baseEntry, outcome: 'dry-run' });
    logger.info('write[dry-run]', baseEntry);
    return { dryRun: true, integration, method, path: target };
  }

  const start = Date.now();
  try {
    const result = await execute();
    const durationMs = Date.now() - start;
    logger.logWrite({
      ...baseEntry,
      outcome: 'ok',
      status: result?.status ?? null,
      durationMs,
    });
    logger.info('write[ok]', { ...baseEntry, durationMs, status: result?.status ?? null });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.logWrite({
      ...baseEntry,
      outcome: 'error',
      durationMs,
      error: err.message,
      status: err.status ?? null,
    });
    logger.error('write[error]', { ...baseEntry, durationMs, error: err.message });
    throw err;
  }
}

module.exports = { SafetyError, safeWrite, getMode };
