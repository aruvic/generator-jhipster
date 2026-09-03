import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyOperationPreparationFailure, classifyOperationResponse, isDeclaredResponseStatus } from './operation-response.mjs';

test('matches exact, range, and default OpenAPI response keys', () => {
  assert.equal(isDeclaredResponseStatus(['202', '404'], 404), true);
  assert.equal(isDeclaredResponseStatus(['2XX'], 204), true);
  assert.equal(isDeclaredResponseStatus(['default'], 409), true);
  assert.equal(isDeclaredResponseStatus(['202', '404'], 400), false);
});

test('never treats a declared server error as a successful contract outcome', () => {
  assert.equal(classifyOperationResponse(['201'], 201), 'success');
  assert.equal(classifyOperationResponse(['404'], 404), 'declared-response');
  assert.equal(classifyOperationResponse(['400'], 404), 'unexpected-response');
  assert.equal(classifyOperationResponse(['500', 'default'], 500), 'server-error');
});

test('only explicitly marked workflow prerequisites are accounted as blocked', () => {
  assert.equal(
    classifyOperationPreparationFailure({
      reason: 'no identity created during the API Operations sweep',
      workflowBlocked: true,
    }),
    'workflow-blocked',
  );
  assert.equal(classifyOperationPreparationFailure({ reason: 'required request body could not be synthesized' }), 'failed');
  assert.equal(classifyOperationPreparationFailure({ reason: 'operation form remains invalid' }), 'failed');
});
