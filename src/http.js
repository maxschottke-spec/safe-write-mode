'use strict';

class HttpError extends Error {
  constructor(message, { status, body, headers } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    // N8 (audit): keep body/headers off the error envelope when serialized to
    // audit log. Stored as non-enumerable so they remain accessible to direct
    // catch-handlers but don't leak through JSON.stringify / spread.
    Object.defineProperty(this, 'body', { value: body, enumerable: false });
    Object.defineProperty(this, 'headers', { value: headers, enumerable: false });
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRY_AFTER_MIN_MS = 250;

function isMethodRetryable(method) {
  return IDEMPOTENT_METHODS.has(String(method ?? 'GET').toUpperCase());
}

function isRetryable(err, method) {
  if (err.name === 'AbortError') return false;
  if (err.name === 'HttpError') {
    if (!RETRYABLE_STATUSES.has(err.status)) return false;
    // M1: 429 is server-stated "try again" → always safe to retry.
    // 5xx without idempotency cannot distinguish "request did not arrive" from
    // "request committed then crashed" → only retry idempotent methods.
    if (err.status === 429) return true;
    return isMethodRetryable(method);
  }
  if (err.name === 'TypeError') {
    // M1: network error on POST/PATCH → can't tell if server committed.
    // Only retry idempotent methods.
    return isMethodRetryable(method);
  }
  return false;
}

function parseRetryAfter(headers) {
  if (!headers || typeof headers.get !== 'function') return null;
  const ra = headers.get('retry-after');
  if (!ra) return null;
  // N3: bound header length to defeat absurd inputs.
  if (ra.length > 32) return null;
  if (/^\d+$/.test(ra)) {
    // N3: enforce minimum delay so a server-stated Retry-After: 0 cannot
    // produce a zero-delay retry storm.
    return Math.min(60_000, Math.max(RETRY_AFTER_MIN_MS, parseInt(ra, 10) * 1000));
  }
  const date = Date.parse(ra);
  if (Number.isNaN(date)) return null;
  return Math.max(RETRY_AFTER_MIN_MS, Math.min(60_000, date - Date.now()));
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
  const method = opts.method || 'GET';
  let lastErr;
  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    try {
      return await doRequest(opts);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err, method) || attempt === policy.retries) throw err;
      const after = parseRetryAfter(err.headers);
      const delay = after != null ? after : computeBackoff(attempt, policy);
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { request, HttpError };
