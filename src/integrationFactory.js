'use strict';

const { safeWrite } = require('./safety');

// CHAIN-1(b) (audit r2): the internal-write symbol used to be exported from
// the public surface (`require('safe-write-mode').__INTERNAL_WRITE__`). That
// let any caller fabricate a fake client with their own `[__INTERNAL_WRITE__]`
// method and slip it past `createIntegration`, fully bypassing the adapter's
// auth/throttle/retry logic.
//
// In v0.2 the symbol is module-private. The only way to construct a client
// that `createIntegration` accepts is via `defineAdapter`, which registers the
// client in a WeakSet of validated origins. Hand-rolled `{ [Symbol(...)]: ... }`
// objects no longer match — the WeakSet check refuses them up-front.
const __INTERNAL_WRITE__ = Symbol('safeWrite.internalOp');
const _validatedClients = new WeakSet();

let _adapterRegistrationLocked = false;

/**
 * Construct an adapter client that `createIntegration` will accept.
 *
 * Adapter authors provide:
 *   - `label`: short identifier for logs (string)
 *   - `get`: read entrypoint `(path, opts?) => Promise<{ status, body, ... }>`
 *   - `write`: internal write entrypoint `(method, path, body, opts?) => Promise`
 *
 * The returned object is frozen and registered in the validated-clients
 * WeakSet. After `lockAdapterRegistration()` is called (typically right after
 * process startup), further calls to `defineAdapter` throw — useful when the
 * host wants to freeze the adapter surface before handing control to an agent.
 */
function defineAdapter(spec) {
  if (_adapterRegistrationLocked) {
    throw new Error(
      'Refused: adapter registration is locked. Call defineAdapter() before lockAdapterRegistration().',
    );
  }
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('defineAdapter(spec) requires an object.');
  }
  const { label, get, write } = spec;
  if (typeof label !== 'string' || label.length === 0) {
    throw new TypeError('defineAdapter: spec.label must be a non-empty string.');
  }
  if (typeof get !== 'function') {
    throw new TypeError('defineAdapter: spec.get must be a function.');
  }
  if (write != null && typeof write !== 'function') {
    throw new TypeError('defineAdapter: spec.write must be a function or omitted.');
  }
  const client = { label, get };
  if (typeof write === 'function') {
    Object.defineProperty(client, __INTERNAL_WRITE__, {
      value: write,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  Object.freeze(client);
  _validatedClients.add(client);
  return client;
}

function lockAdapterRegistration() {
  _adapterRegistrationLocked = true;
}

function isValidatedClient(client) {
  return _validatedClients.has(client);
}

function createIntegration({ name, client, readOnly = false }) {
  // N5 (audit): strict boolean check.
  if (typeof readOnly !== 'boolean') {
    throw new TypeError(
      `createIntegration({ readOnly }) must be a strict boolean (got ${typeof readOnly}: ${String(readOnly)}).`,
    );
  }
  // CHAIN-1(b) (audit r2): client must have been built by defineAdapter so we
  // know its `[__INTERNAL_WRITE__]` method (if any) was supplied at adapter-
  // registration time, not smuggled in by a caller crafting their own symbol.
  if (!client || typeof client !== 'object' || !_validatedClients.has(client)) {
    throw new TypeError(
      'createIntegration: client must be built via defineAdapter(). Hand-rolled clients are refused.',
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

  // Resolve the internal-write method once; if the adapter was registered
  // without one, expose no write surface (defensive, even though the symbol
  // lookup below would also return undefined).
  const internalWrite = client[__INTERNAL_WRITE__];
  if (typeof internalWrite !== 'function') {
    // Adapter registered read-only. Caller asked for write surface → refuse
    // loudly so they catch the misconfiguration at setup time.
    throw new Error(
      `createIntegration: adapter '${client.label}' has no write impl; pass readOnly:true or register the adapter with a 'write' function.`,
    );
  }

  surface.write = Object.freeze({
    post: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'POST', path, body, opts,
        execute: () => internalWrite.call(client, 'POST', path, body, opts),
      }),
    patch: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'PATCH', path, body, opts,
        execute: () => internalWrite.call(client, 'PATCH', path, body, opts),
      }),
    put: (path, body, opts = {}) =>
      safeWrite({
        integration: name, method: 'PUT', path, body, opts,
        execute: () => internalWrite.call(client, 'PUT', path, body, opts),
      }),
    delete: (path, opts = {}) =>
      safeWrite({
        integration: name, method: 'DELETE', path, body: null, opts,
        execute: () => internalWrite.call(client, 'DELETE', path, null, opts),
      }),
  });

  return Object.freeze(surface);
}

module.exports = {
  createIntegration,
  defineAdapter,
  lockAdapterRegistration,
  isValidatedClient,
};
