import assert from 'node:assert/strict';
import test from 'node:test';

import { parameterCoverageValue, responseBrowsingFixture } from './form-crud-browser-workflows.mjs';

test('builds a populated response fixture for browser table and detail workflows', () => {
  const fixture = responseBrowsingFixture({
    responseBodyFields: [
      {
        name: 'body',
        path: [],
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'id', type: 'string', readOnly: true, example: 'resource-1' },
            {
              name: 'locations',
              type: 'array',
              items: {
                type: 'object',
                fields: [
                  { name: 'name', type: 'string', required: true, minLength: 3 },
                  { name: 'active', type: 'boolean' },
                ],
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(fixture, [
    {
      id: 'resource-1',
      locations: [{ name: 'xxx', active: true }],
    },
  ]);
});

test('prefers declared parameter values and avoids inventing values for patterns', () => {
  assert.equal(parameterCoverageValue({ example: 'NLAMS', type: 'string' }), 'NLAMS');
  assert.equal(parameterCoverageValue({ enumValues: ['FULL_VOYAGE'], type: 'string' }), 'FULL_VOYAGE');
  assert.equal(parameterCoverageValue({ format: 'date-time', type: 'string' }), '2026-01-01T00:00');
  assert.equal(parameterCoverageValue({ type: 'integer', minimum: 10 }), '10');
  assert.equal(parameterCoverageValue({ type: 'string', pattern: '^[A-Z]{3}$' }), undefined);
});
