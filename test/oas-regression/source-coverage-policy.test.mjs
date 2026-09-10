import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSourceCoverageThresholds } from './source-coverage-policy.mjs';

test('enforces every applicable component independently', () => {
  const report = evaluateSourceCoverageThresholds([
    {
      id: 'form-crud',
      applicable: true,
      missingFiles: [],
      thresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
      summary: {
        lines: { pct: 85 },
        statements: { pct: 84 },
        functions: { pct: 75 },
        branches: { pct: 70 },
      },
    },
    {
      id: 'openapi-operations',
      applicable: true,
      missingFiles: [],
      thresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
      summary: {
        lines: { pct: 69 },
        statements: { pct: 75 },
        functions: { pct: 65 },
        branches: { pct: 60 },
      },
    },
  ]);

  assert.equal(report.passed, false);
  assert.deepEqual(report.failures, [{ component: 'openapi-operations', metric: 'lines', actual: 69, minimum: 70 }]);
});

test('fails when an applicable handwritten source file is absent from coverage', () => {
  const report = evaluateSourceCoverageThresholds([
    {
      id: 'reference-picker',
      applicable: true,
      missingFiles: ['src/main/webapp/app/admin/form-crud-reference-pickers/form-crud-reference-pickers.ts'],
      thresholds: {},
      summary: {},
    },
  ]);

  assert.equal(report.passed, false);
  assert.equal(report.failures[0].metric, 'files');
});

test('reports partial source coverage without enforcing thresholds after an incomplete workflow', () => {
  const report = evaluateSourceCoverageThresholds(
    [
      {
        id: 'openapi-operations',
        applicable: true,
        missingFiles: [],
        thresholds: { lines: 70 },
        summary: { lines: { pct: 61.6 } },
      },
    ],
    {
      workflowComplete: false,
      incompleteReasons: [{ reasonCode: 'operation-render-coverage-incomplete' }],
    },
  );

  assert.equal(report.status, 'not-evaluated');
  assert.equal(report.evaluated, false);
  assert.equal(report.passed, null);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.observedShortfalls, [{ component: 'openapi-operations', metric: 'lines', actual: 61.6, minimum: 70 }]);
  assert.equal(report.components[0].passed, null);
});
