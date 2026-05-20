'use strict';

// Adapter skeleton: GraphQL endpoint with mutation guard.
// GraphQL doesn't distinguish reads/writes by HTTP verb — every call is POST.
// We classify by document content. The v0.2 classifier replaces the v0.1
// `^mutation\b` regex (which the external audit broke with BOM-prefix,
// operationName-routing in a multi-op doc, and NBSP/Unicode whitespace).

const { request, getMode, SafetyError, defineAdapter } = require('../src');
const { safeJoin } = require('../src/http');

const BASE_URL = 'https://example.com/api/graphql';

// Unicode-aware "treat as whitespace" character class. Includes regular \s
// plus NBSP, zero-width space/joiner/non-joiner, line/paragraph separator,
// and BOM — every Unicode bypass the audit's PoC used.
const WS_INNER = '\\s\\u00A0\\u200B\\u200C\\u200D\\u2028\\u2029\\uFEFF';
const STRIP_LEADING_WS_RE = new RegExp('^[' + WS_INNER + ']+');
const OP_KEYWORD_RE = new RegExp(
  '(^|[' + WS_INNER + '}])(mutation|query|subscription)(?=[' + WS_INNER + '({])',
  'gi',
);

function classifyDocument(query) {
  if (typeof query !== 'string') return 'invalid';
  let s = query.normalize('NFC');
  s = s.replace(STRIP_LEADING_WS_RE, '');
  // Strip block strings ("""..."""), then regular strings.
  s = s.replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  // Strip line comments.
  s = s.replace(/#[^\n]*/g, '');
  const ops = [];
  OP_KEYWORD_RE.lastIndex = 0;
  let m;
  while ((m = OP_KEYWORD_RE.exec(s))) ops.push(m[2].toLowerCase());
  if (ops.length === 0) return 'anonymous-query';
  if (ops.length > 1) return 'mixed';
  return ops[0];
}

function isMutation(query) {
  return classifyDocument(query) === 'mutation';
}

function createGraphQLClient({ label, token, baseUrl = BASE_URL }) {
  async function call({ query, variables }) {
    return request({
      method: 'POST',
      url: baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: { query, variables },
      retry: { retries: 1, backoffMs: 500, maxBackoffMs: 4000 },
    });
  }

  return defineAdapter({
    label,
    async get(_path, { query, variables } = {}) {
      const kind = classifyDocument(query);
      if (kind === 'mutation' || kind === 'mixed') {
        throw new SafetyError(
          `Refused: GraphQL ${kind === 'mixed' ? 'multi-operation document with a mutation' : 'mutation'} passed to client.get(). Use the write surface instead.`,
          'INVALID_OPERATION',
        );
      }
      if (kind === 'subscription') {
        throw new SafetyError(
          'Refused: GraphQL subscription via HTTP adapter is not supported.',
          'INVALID_OPERATION',
        );
      }
      return call({ query, variables });
    },
    async write(method, _path, body) {
      const kind = classifyDocument(body && body.query);
      if (kind !== 'mutation') {
        throw new SafetyError(
          `Refused: write surface requires a single GraphQL mutation document (got ${kind}).`,
          'INVALID_OPERATION',
        );
      }
      if (getMode() !== 'read-write') {
        throw new SafetyError('GraphQL mutation blocked in read-only mode.', 'READ_ONLY_MODE');
      }
      return call(body);
    },
  });
}

function clientFromEnv() {
  const token = process.env.EXAMPLE_GRAPHQL_TOKEN;
  if (!token) throw new Error('EXAMPLE_GRAPHQL_TOKEN not set');
  return createGraphQLClient({ label: 'example-gql', token });
}

module.exports = { createGraphQLClient, isMutation, classifyDocument, clientFromEnv, safeJoin };
