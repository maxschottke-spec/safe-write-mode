'use strict';

// Adapter skeleton: GraphQL endpoint with mutation guard.
// GraphQL doesn't distinguish reads/writes by HTTP verb — every call is POST.
// We classify by document keyword: `mutation { ... }` → write,
// `query { ... }` or anonymous → read.

const { request, getMode, SafetyError, __INTERNAL_WRITE__ } = require('../src');

const BASE_URL = 'https://example.com/api/graphql';

function isMutation(query) {
  // Strip leading whitespace and comments.
  const trimmed = String(query).trim().replace(/^#[^\n]*\n/gm, '');
  return /^mutation\b/i.test(trimmed);
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

  return {
    label,
    // .get is the read entrypoint; for GraphQL we accept a query document.
    async get(_path, { query, variables } = {}) {
      if (isMutation(query)) {
        throw new SafetyError(
          `Refused: GraphQL mutation passed to client.get(). Use the write surface instead.`,
          'INVALID_OPERATION',
        );
      }
      return call({ query, variables });
    },
    // Internal write entrypoint. Validates that the operation is a mutation
    // and that we're in read-write mode.
    async [__INTERNAL_WRITE__](method, _path, body) {
      if (!isMutation(body && body.query)) {
        throw new SafetyError(
          `Refused: write surface called with a non-mutation GraphQL document.`,
          'INVALID_OPERATION',
        );
      }
      if (getMode() !== 'read-write') {
        // safeWrite already gates this, but a belt-and-braces check is cheap.
        throw new SafetyError('GraphQL mutation blocked in read-only mode.', 'READ_ONLY_MODE');
      }
      return call(body);
    },
  };
}

function clientFromEnv() {
  const token = process.env.EXAMPLE_GRAPHQL_TOKEN;
  if (!token) throw new Error('EXAMPLE_GRAPHQL_TOKEN not set');
  return createGraphQLClient({ label: 'example-gql', token });
}

module.exports = { createGraphQLClient, isMutation, clientFromEnv };
