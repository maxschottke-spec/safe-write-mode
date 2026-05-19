'use strict';

// Adapter skeleton: REST API with OAuth2 refresh-token flow.
// Refreshes the access token ~30s before expiry. Replace token endpoint,
// client_id/secret env names, and base URL per your vendor.

const { request, getMode, SafetyError, __INTERNAL_WRITE__ } = require('../src');

const BASE_URL = 'https://api.example.com/v2';
const TOKEN_URL = 'https://auth.example.com/oauth/token';
const REFRESH_LEAD_MS = 30_000;

function createOauthClient({ label, clientId, clientSecret, refreshToken, baseUrl = BASE_URL }) {
  let accessToken = null;
  let expiresAt = 0;
  // N2 (audit): cache in-flight refresh promise so parallel callers share a
  // single refresh request instead of stampeding the auth server.
  let refreshPromise = null;

  async function refreshAccessToken() {
    const res = await request({
      method: 'POST',
      url: TOKEN_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
    // N2: validate token endpoint response BEFORE mutating state. A token
    // server that returns malformed/error JSON without expires_in would
    // otherwise set expiresAt=NaN and trap the client in 'Bearer undefined'
    // forever (Date.now() >= NaN is false → refresh never runs again).
    const newToken = res?.body?.access_token;
    const newExpiresIn = Number(res?.body?.expires_in);
    if (typeof newToken !== 'string' || newToken.length === 0) {
      throw new Error('OAuth refresh failed: missing access_token in response');
    }
    if (!Number.isFinite(newExpiresIn) || newExpiresIn <= 0) {
      throw new Error('OAuth refresh failed: missing or invalid expires_in in response');
    }
    accessToken = newToken;
    expiresAt = Date.now() + newExpiresIn * 1000 - REFRESH_LEAD_MS;
  }

  async function ensureToken() {
    if (accessToken && Date.now() < expiresAt) return;
    // N2: share the in-flight promise across concurrent callers.
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
  }

  async function call(method, path, body) {
    await ensureToken();
    return request({
      method,
      url: `${baseUrl}${path}`,
      headers: { Authorization: `Bearer ${accessToken}` },
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
  const clientId = process.env.EXAMPLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.EXAMPLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.EXAMPLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth env vars not set (EXAMPLE_OAUTH_CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN)');
  }
  return createOauthClient({
    label: 'example-oauth',
    clientId,
    clientSecret,
    refreshToken,
  });
}

module.exports = { createOauthClient, clientFromEnv };
