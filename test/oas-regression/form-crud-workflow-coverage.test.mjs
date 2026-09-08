import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRequiredResourceWorkflowCoverage } from './form-crud-workflow-coverage.mjs';

test('accepts additional successful updates from other required GUI workflows', () => {
  assert.equal(
    hasRequiredResourceWorkflowCoverage({
      plannedUpdateResources: 5,
      successfulUpdateResources: 21,
      plannedDeleteResources: 7,
      successfulDeleteResources: 7,
    }),
    true,
  );
});

test('still rejects required resource workflow shortfalls', () => {
  assert.equal(
    hasRequiredResourceWorkflowCoverage({
      plannedUpdateResources: 5,
      successfulUpdateResources: 4,
      plannedDeleteResources: 7,
      successfulDeleteResources: 7,
    }),
    false,
  );
  assert.equal(
    hasRequiredResourceWorkflowCoverage({
      plannedUpdateResources: 5,
      successfulUpdateResources: 5,
      plannedDeleteResources: 7,
      successfulDeleteResources: 6,
    }),
    false,
  );
});
