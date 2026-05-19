'use strict';

const { safeWrite } = require('./safety');

const __INTERNAL_WRITE__ = Symbol('safeWrite.internalOp');

function createIntegration({ name, client, readOnly = false }) {
  // N5 (audit): strict boolean check. A truthy non-boolean (string, number,
  // object) silently routed callers through different branches in v0.1 —
  // make the policy explicit.
  if (typeof readOnly !== 'boolean') {
    throw new TypeError(
      `createIntegration({ readOnly }) must be a strict boolean (got ${typeof readOnly}: ${String(readOnly)}).`,
    );
  }
  const surface = {
    name,
    readOnly,
    read: {
      get: (path, opts = {}) => client.get(path, opts),
    },
  };

  if (readOnly === true) return Object.freeze(surface);

  surface.write = Object.freeze({
    post: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'POST', path, body, opts,
        execute: () => client[__INTERNAL_WRITE__]('POST', path, body, opts),
      }),
    patch: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'PATCH', path, body, opts,
        execute: () => client[__INTERNAL_WRITE__]('PATCH', path, body, opts),
      }),
    put: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'PUT', path, body, opts,
        execute: () => client[__INTERNAL_WRITE__]('PUT', path, body, opts),
      }),
    delete: (path, opts = {}) =>
      safeWrite({
        integration: name, method: 'DELETE', path, body: null, opts,
        execute: () => client[__INTERNAL_WRITE__]('DELETE', path, null, opts),
      }),
  });

  return Object.freeze(surface);
}

module.exports = { createIntegration, __INTERNAL_WRITE__ };
