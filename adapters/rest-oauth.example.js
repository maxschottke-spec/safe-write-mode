'use strict';

// Adapter skeleton: REST API with OAuth2 refresh-token flow.

const { request, getMode, SafetyError, defineAdapter } = require('../src');
const { safeJoin } = require('../src/http');

const BASE_URL = 'https://api.example.com/v2';
const TOKEN_URL = 'https://auth.example.com/oauth/token';
const REFRESH_LEAD_MS = 30_000;

// CHAIN-2 (audit r2): newline/control-char injection into URLSearchParams or
// Authorization headers — both refuse via this allowlist.
const SECRET_RE = /^[A-Za-z0-9\-_.~+/=]+$/;
function validateSecret(name, value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 4096) {
    throw new Error(`${name}: must be a string of length 8..4096`);
  }
  if (!SECRET_RE.test(value)) {
    throw new Error(`${name}: contains characters not allowed in OAuth fields`);
  }
}

function createOauthClient({
  label, clientId, clientSecret, refreshToken,
  baseUrl = BASE_URL, tokenUrl = TOKEN_URL, expectedTokenType = 'Bearer',
}) {
  validateSecret('clientId', clientId);
  validateSecret('clientSecret', clientSecret);
  validateSecret('refreshToken', refreshToken);

  let accessToken = null;
  let expiresAt = 0;
  let refreshPromise = null;
  // M3 (audit r2): treat 401 as terminal for static-bearer-style paths; the
  // OAuth flow has its own refresh, so any 401 after a fresh refresh means the
  // token is structurally invalid (revoked, wrong scope, wrong audience).
  // Surface that, don't loop.

  async function refreshAccessToken() {
    const res = await request({
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
    const newToken = res?.body?.access_token;
    const newExpiresIn = Number(res?.body?.expires_in);
    const tokenType = res?.body?.token_type;
    if (typeof newToken !== 'string' || newToken.length === 0) {
      throw new Error('OAuth refresh failed: missing access_token in response');
    }
    if (!Number.isFinite(newExpiresIn) || newExpiresIn <= 0) {
      throw new Error('OAuth refresh failed: missing or invalid expires_in in response');
    }
    // M1 (audit r2): pin expected token type. Refuses providers that try to
    // switch from Bearer to MAC/HOBA mid-flow without explicit caller opt-in.
    if (tokenType && tokenType.toLowerCase() !== expectedTokenType.toLowerCase()) {
      throw new Error(
        `OAuth refresh failed: token_type='${tokenType}' does not match expected '${expectedTokenType}'`,
      );
    }
    accessToken = newToken;
    expiresAt = Date.now() + newExpiresIn * 1000 - REFRESH_LEAD_MS;
  }

  async function ensureToken() {
    if (accessToken && Date.now() < expiresAt) return;
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
  }

  async function call(method, path, body) {
    await ensureToken();
    // CHAIN-2(b): same safeJoin guard as the bearer adapter.
    const url = safeJoin(baseUrl, path);
    return request({
      method,
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
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
