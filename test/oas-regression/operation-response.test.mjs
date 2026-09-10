import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyOperationPreparationFailure, classifyOperationResponse, isDeclaredResponseStatus } from './operation-response.mjs';

test('matches exact, range, and default OpenAPI response keys', () => {
  assert.equal(isDeclaredResponseStatus(['202', '404'], 404), true);
  assert.equal(isDeclaredResponseStatus(['2XX'], 204), true);
  assert.equal(isDeclaredResponseStatus(['default'], 409), true);
  assert.equal(isDeclaredResponseStatus(['202', '404'], 400), false);
});

test('only accepts 2xx for executable happy-path operations', () => {
  assert.equal(classifyOperationResponse(['201'], 201), 'success-2xx');
  assert.equal(classifyOperationResponse(['404'], 404), 'unexpected-failure');
  assert.equal(classifyOperationResponse(['default'], 409), 'unexpected-failure');
  assert.equal(classifyOperationResponse(['500', 'default'], 500), 'unexpected-failure');
});

test('requires an explicit expected-negative scenario and status', () => {
  assert.equal(
    classifyOperationResponse(['400', '404'], 404, {
      expectation: 'expected-negative',
      expectedNegativeStatusCodes: ['404'],
    }),
    'expected-negative',
  );
  assert.equal(
    classifyOperationResponse(['400', '404'], 400, {
      expectation: 'expected-negative',
      expectedNegativeStatusCodes: ['404'],
    }),
    'unexpected-failure',
  );
  assert.equal(
    classifyOperationResponse(['204', '404'], 204, {
      expectation: 'expected-negative',
      expectedNegativeStatusCodes: ['404'],
    }),
    'unexpected-failure',
  );
});

test('distinguishes unexecutable prerequisites from harness errors', () => {
  assert.equal(
    classifyOperationPreparationFailure({
      reason: 'no identity created during the API Operations sweep',
      reasonCode: 'missing-upstream-resource',
      unexecutable: true,
    }),
    'unexecutable',
  );
  assert.equal(
    classifyOperationPreparationFailure({
      reason: 'required request body could not be synthesized',
      reasonCode: 'unsynthesizable-required-body',
      unexecutable: true,
    }),
    'unexecutable',
  );
  assert.equal(classifyOperationPreparationFailure({ reason: 'operation form remains invalid' }), 'harness-error');
});
