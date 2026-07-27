'use strict';

// Regression coverage: the HTTP layer must NEVER follow redirects, because a
// 3xx Location pointing at another origin would otherwise let fetch replay the
// Authorization header to an attacker-controlled host. src/http.js pins
// `redirect: 'manual'` and refuses any 3xx with an HttpError. This test pins
// that behavior so an accidental change (e.g. dropping `redirect: 'manual'` or
// the refusal branch) breaks CI. It also asserts the refusal message leaks
// neither the request-side bearer token nor the redirect target's query secret.

const test = require('node:test');
const assert = require('node:assert/strict');

// Skip the DNS/SSRF resolution so the test stays offline and deterministic.
process.env.SAFE_WRITE_SKIP_DNS_CHECK = '1';

const { request, HttpError } = require('../src/http');

function withMockedFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test('refuses a 3xx redirect instead of following it', async () => {
  let followedLocation = false;
  const mock = async (url) => {
    // If the layer (wrongly) followed the redirect, it would call fetch again
    // with the evil location — flag that so we can assert it never happens.
    if (String(url).includes('evil.example.com')) followedLocation = true;
    return {
      status: 302,
      type: 'default',
      ok: false,
      headers: new Headers({ location: 'https://evil.example.com/steal?token=SECRET_QUERY' }),
      async text() { return ''; },
    };
  };

  await withMockedFetch(mock, async () => {
    await assert.rejects(
      () =>
        request({
          method: 'GET',
          url: 'https://api.example.com/orders',
          headers: { Authorization: 'Bearer SECRET_BEARER' },
        }),
      (err) => {
        assert.ok(err instanceof HttpError, 'expected an HttpError');
        assert.equal(err.status, 302);
        assert.match(err.message, /Refused redirect/i);
        // No secret from either side may appear in the human-readable message.
        assert.doesNotMatch(err.message, /SECRET_BEARER/);
        assert.doesNotMatch(err.message, /SECRET_QUERY/);
        return true;
      },
    );
  });

  assert.equal(followedLocation, false, 'must not fetch the redirect target');
});

test('does not follow even a same-origin redirect (manual, refuse-all)', async () => {
  let calls = 0;
  const mock = async () => {
    calls += 1;
    return {
      status: 301,
      type: 'default',
      ok: false,
      headers: new Headers({ location: 'https://api.example.com/orders/v2' }),
      async text() { return ''; },
    };
  };

  await withMockedFetch(mock, async () => {
    await assert.rejects(
      () => request({ method: 'GET', url: 'https://api.example.com/orders' }),
      /Refused redirect/i,
    );
  });

  assert.equal(calls, 1, 'exactly one fetch, no follow');
});
