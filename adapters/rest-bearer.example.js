'use strict';

// Adapter skeleton: REST API with static bearer token.
// Replace BASE_URL, env var names, and rate limit per your vendor.

const { request, getMode, SafetyError, __INTERNAL_WRITE__ } = require('../src');

const BASE_URL = 'https://api.example.com/v1';
const MIN_INTERVAL_MS = 250;

function createRestBearerClient({ label, token, baseUrl = BASE_URL }) {
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
    return request({
      method,
      url: `${baseUrl}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body,
      retry: { retries: 2, backoffMs: 500, maxBackoffMs: 4000 },
    });
  }

  return {
    label,
    async get(path) {
      return call('GET', path);
    },
    async [__INTERNAL_WRITE__](method, path, body) {
      if (getMode() === 'read-only') {
        throw new SafetyError(
          `Refused: write blocked because MODE=read-only (adapter-level recheck, ${method} ${path}).`,
          'READ_ONLY_MODE',
        );
      }
      return call(method, path, body);
    },
  };
}

function clientFromEnv() {
  const token = process.env.EXAMPLE_API_TOKEN;
  if (!token) throw new Error('EXAMPLE_API_TOKEN not set');
  return createRestBearerClient({ label: 'example-rest', token });
}

module.exports = { createRestBearerClient, clientFromEnv };
