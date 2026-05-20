'use strict';

const {
  SafetyError,
  safeWrite,
  getMode,
  lockMode,
  isModeLocked,
  setConfirmationVerifier,
} = require('./safety');
const {
  createIntegration,
  defineAdapter,
  lockAdapterRegistration,
} = require('./integrationFactory');
const http = require('./http');
const { request, HttpError, safeJoin, sanitizeUrlForLog } = http;
const logger = require('./logger');
const env = require('./env');

module.exports = {
  // Core safety surface
  SafetyError,
  safeWrite,
  getMode,
  lockMode,
  isModeLocked,
  setConfirmationVerifier,
  // Adapter / integration surface — note: __INTERNAL_WRITE__ is intentionally
  // NOT exported in v0.2. Build clients via defineAdapter().
  createIntegration,
  defineAdapter,
  lockAdapterRegistration,
  // HTTP surface
  request,
  HttpError,
  safeJoin,
  sanitizeUrlForLog,
  // Namespace exports (for `const swm = require('safe-write-mode'); swm.http.*`)
  http,
  logger,
  env,
};
