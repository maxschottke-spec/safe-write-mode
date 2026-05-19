'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function levelCap() {
  return LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
}

function consoleLog(level, msg, meta) {
  if (LEVELS[level] > levelCap()) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

function writeLogFile() {
  const dir = process.env.WRITE_LOG_DIR || 'logs';
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `writes-${date}.ndjson`);
}

function logWrite(entry) {
  const file = writeLogFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

module.exports = {
  info: (msg, meta) => consoleLog('info', msg, meta),
  warn: (msg, meta) => consoleLog('warn', msg, meta),
  error: (msg, meta) => consoleLog('error', msg, meta),
  debug: (msg, meta) => consoleLog('debug', msg, meta),
  logWrite,
};
