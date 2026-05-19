'use strict';

// Adapter skeleton: REST API with OAuth2 refresh-token flow.
// Refreshes the access token ~30s before expiry. Replace token endpoint,
// client_id/secret env names, and base URL per your vendor.

const { request, __INTERNAL_WRITE__ } = require('../src');

const BASE_URL = 'https://api.example.com/v2';
const TOKEN_URL = 'https://auth.example.com/oauth/token';
const REFRESH_LEAD_MS = 30_000;

function createOauthClient({ label, clientId, clientSecret, refreshToken, baseUrl = BASE_URL }) {
  let accessToken = null;
  let expiresAt = 0;

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
    accessToken = res.body.access_token;
    expiresAt = Date.now() + (res.body.expires_in * 1000) - REFRESH_LEAD_MS;
  }

  async function ensureToken() {
    if (!accessToken || Date.now() >= expiresAt) {
      await refreshAccessToken();
    }
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
