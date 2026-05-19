'use strict';

const { SafetyError, safeWrite, getMode } = require('./safety');
const { createIntegration, __INTERNAL_WRITE__ } = require('./integrationFactory');
const http = require('./http');
const { request, HttpError } = http;
const logger = require('./logger');
const env = require('./env');

module.exports = {
  // Named exports
  SafetyError,
  safeWrite,
  getMode,
  createIntegration,
  __INTERNAL_WRITE__,
  request,
  HttpError,
  // Namespace exports (for default-style imports: `const http = require('safe-write-mode').http`)
  http,
  logger,
  env,
};
