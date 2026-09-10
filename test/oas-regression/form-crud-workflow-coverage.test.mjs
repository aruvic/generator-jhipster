import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasRequiredResourceWorkflowCoverage,
  requiredWorkflowCompletion,
  resourceWorkflowCoverage,
} from './form-crud-workflow-coverage.mjs';

test('accepts additional successful workflows without blending their counts', () => {
  assert.equal(
    hasRequiredResourceWorkflowCoverage({
      plannedUpdateResourceKeys: ['catalog:update', 'category:update'],
      successfulUpdateResourceKeys: ['catalog:update', 'category:update', 'picker:update'],
      plannedDeleteResourceKeys: ['catalog:delete'],
      successfulDeleteResourceKeys: ['catalog:delete'],
    }),
    true,
  );
});

test('reports exact missing resource workflows even when unrelated successes are numerous', () => {
  const summary = resourceWorkflowCoverage({
    plannedUpdateResourceKeys: ['catalog:update', 'category:update'],
    successfulUpdateResourceKeys: ['catalog:update', 'picker:update', 'other:update'],
    plannedDeleteResourceKeys: ['catalog:delete', 'category:delete'],
    successfulDeleteResourceKeys: ['catalog:delete', 'other:delete'],
  });

  assert.deepEqual(summary.missingUpdateResourceKeys, ['category:update']);
  assert.deepEqual(summary.missingDeleteResourceKeys, ['category:delete']);
  assert.equal(hasRequiredResourceWorkflowCoverage(summary), false);
});

test('reports an early route stop as incomplete evidence rather than product coverage failure', () => {
  const completion = requiredWorkflowCompletion({
    declaredOperationIds: ['get-point-to-point', 'get-port-schedules'],
    renderedOperationIds: [],
    terminalOperationIds: [],
    reachedCoverageGate: false,
  });

  assert.equal(completion.complete, false);
  assert.equal(completion.status, 'incomplete');
  assert.deepEqual(
    completion.reasons.map(reason => reason.reasonCode),
    ['workflow-stopped-before-coverage-gate', 'operation-render-coverage-incomplete', 'operation-terminal-coverage-incomplete'],
  );
  assert.deepEqual(completion.routeCoverage.missingRenderedOperationIds, ['get-point-to-point', 'get-port-schedules']);
});

test('marks complete read and mutation workflows as threshold eligible', () => {
  const completion = requiredWorkflowCompletion({
    declaredOperationIds: ['get-resources', 'post-resource', 'patch-resource'],
    renderedOperationIds: ['patch-resource', 'get-resources', 'post-resource'],
    terminalOperationIds: ['post-resource', 'patch-resource', 'get-resources'],
    reachedCoverageGate: true,
    resourceCoverage: {
      plannedUpdateResourceKeys: ['resources:update:patch-resource'],
      successfulUpdateResourceKeys: ['resources:update:patch-resource'],
      plannedDeleteResourceKeys: [],
      successfulDeleteResourceKeys: [],
    },
  });

  assert.equal(completion.complete, true);
  assert.equal(completion.thresholdEvaluationEligible, true);
  assert.deepEqual(completion.reasons, []);
});
