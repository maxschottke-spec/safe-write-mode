'use strict';

// Adapter skeleton: REST API with static bearer token.
// Replace BASE_URL, env var names, and rate limit per your vendor.

const { request, getMode, SafetyError, defineAdapter } = require('../src');
const { safeJoin } = require('../src/http');

const BASE_URL = 'https://api.example.com/v1';
const MIN_INTERVAL_MS = 250;

// CHAIN-2 (audit r2): adapter-level input validation. Reject newline-injected
// or absurdly short/long tokens before they ever hit a header.
const TOKEN_RE = /^[A-Za-z0-9\-_.~+/=]+$/;
function validateToken(name, value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 4096) {
    throw new Error(`${name}: must be a string of length 16..4096`);
  }
  if (!TOKEN_RE.test(value)) {
    throw new Error(`${name}: contains characters not allowed in HTTP header values`);
  }
}

function createRestBearerClient({ label, token, baseUrl = BASE_URL }) {
  validateToken('token', token);
  let lastCallAt = 0;

  async function throttle() {
    const now = Date.now();
    const delta = now - lastCallAt;
    if (delta < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - delta));
    }
    lastCallAt = Date.now();
  }

  async function call(method, path, body) {
    await throttle();
    // CHAIN-2(b): safeJoin refuses cross-origin, scheme-injection, protocol-
    // relative, backslash, and userinfo path-injection attempts — every
    // documented "bearer leak via path injection" pattern.
    const url = safeJoin(baseUrl, path);
    return request({
      method,
      url,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body,
      retry: { retries: 2, backoffMs: 500, maxBackoffMs: 4000 },
    });
  }

  return defineAdapter({
    label,
    async get(path) {
      return call('GET', path);
    },
    async write(method, path, body) {
      if (getMode() === 'read-only') {
        throw new SafetyError(
          `Refused: write blocked because SAFE_WRITE_MODE=read-only (adapter-level recheck, ${method} ${path}).`,
          'READ_ONLY_MODE',
        );
      }
      return call(method, path, body);
    },
  });
}

function clientFromEnv() {
  const token = process.env.EXAMPLE_API_TOKEN;
  if (!token) throw new Error('EXAMPLE_API_TOKEN not set');
  return createRestBearerClient({ label: 'example-rest', token });
}

module.exports = { createRestBearerClient, clientFromEnv };
