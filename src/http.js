'use strict';

class HttpError extends Error {
  constructor(message, { status, body, headers } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryable(err) {
  if (err.name === 'AbortError') return false;
  if (err.name === 'HttpError') return RETRYABLE_STATUSES.has(err.status);
  if (err.name === 'TypeError') return true;
  return false;
}

function parseRetryAfter(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const ra = headers.get('retry-after');
  if (!ra) return null;
  if (/^\d+$/.test(ra)) {
    return Math.min(60_000, parseInt(ra, 10) * 1000);
  }
  const date = Date.parse(ra);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.min(60_000, date - Date.now()));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function computeBackoff(attempt, policy) {
  const exp = Math.min(policy.maxBackoffMs, policy.backoffMs * 2 ** attempt);
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

async function doRequest({ method = 'GET', url, headers = {}, body, timeoutMs = 30_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = {
      method,
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
      redirect: 'manual',
    };
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || body instanceof URLSearchParams) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
      }
    }
    const res = await fetch(url, init);
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      const location =
        (res.headers && typeof res.headers.get === 'function' && res.headers.get('location')) || '';
      throw new HttpError(
        `Refused redirect: ${method} ${url} returned status ${res.status} (location='${location}'). Auth headers must not follow cross-host redirects.`,
        { status: res.status, body: null, headers: res.headers },
      );
    }
    const text = await res.text();
    let parsed = text;
    const ct = res.headers.get('content-type') || '';
    if ((ct.includes('application/json') || /\+json\b/.test(ct)) && text) {
      try { parsed = JSON.parse(text); } catch { /* fall through */ }
    }
    if (!res.ok) {
      throw new HttpError(`HTTP ${res.status} ${res.statusText} for ${method} ${url}`, {
        status: res.status,
        body: parsed,
        headers: res.headers,
      });
    }
    return { status: res.status, body: parsed, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

async function request(opts) {
  const policy = opts.retry || { retries: 0, backoffMs: 250, maxBackoffMs: 4000 };
  let lastErr;
  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    try {
      return await doRequest(opts);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === policy.retries) throw err;
      const after = parseRetryAfter(err.headers);
      const delay = after != null ? after : computeBackoff(attempt, policy);
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { request, HttpError };
