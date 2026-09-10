import assert from 'node:assert/strict';
import test from 'node:test';

import { exclusiveMaximum, exclusiveMinimum, validateScalarConstraints } from './schema-scalar-validation.mjs';

test('supports OpenAPI 3.0 boolean and 3.1 numeric exclusive bounds', () => {
  assert.equal(exclusiveMinimum({ minimum: 1, exclusiveMinimum: true }), 1);
  assert.equal(exclusiveMinimum({ exclusiveMinimum: 1.5 }), 1.5);
  assert.equal(exclusiveMaximum({ maximum: 9, exclusiveMaximum: true }), 9);
  assert.equal(exclusiveMaximum({ exclusiveMaximum: 9.5 }), 9.5);
  assert.deepEqual(validateScalarConstraints(1, { minimum: 1, exclusiveMinimum: true }, '/amount'), [
    '/amount expected > 1',
  ]);
  assert.deepEqual(validateScalarConstraints(9.5, { exclusiveMaximum: 9.5 }, '/amount'), ['/amount expected < 9.5']);
});

test('validates common OpenAPI string formats without rejecting unknown formats', () => {
  assert.deepEqual(validateScalarConstraints('not-a-date', { format: 'date' }, '/date'), ['/date expected format date']);
  assert.deepEqual(validateScalarConstraints('2026-09-08', { format: 'date' }, '/date'), []);
  assert.deepEqual(validateScalarConstraints('invalid', { format: 'email' }, '/email'), ['/email expected format email']);
  assert.deepEqual(validateScalarConstraints('value', { format: 'custom' }, '/custom'), []);
});
