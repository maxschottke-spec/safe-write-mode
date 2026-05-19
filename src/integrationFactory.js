'use strict';

const { safeWrite } = require('./safety');

const __INTERNAL_WRITE__ = Symbol('safeWrite.internalOp');

function createIntegration({ name, client, readOnly = false }) {
  const surface = {
    name,
    readOnly,
    read: {
      get: (path, opts = {}) => client.get(path, opts),
    },
  };

  if (readOnly) return Object.freeze(surface);

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
