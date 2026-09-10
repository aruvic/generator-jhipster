import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFormCrudSummaryCompletionPolicy } from './form-crud-summary-policy.mjs';

test('reports an early stop separately and does not publish zero product coverage ratios', () => {
  const run = {
    artifact: 'read-only-api',
    status: 'failed',
    error: { message: 'required validation probe failed' },
    workflow: {
      status: 'incomplete',
      complete: false,
      reasons: [{ reasonCode: 'operation-render-coverage-incomplete' }],
    },
    coverage: {
      declaredOperations: 3,
      renderedOperations: 0,
      submittedOperations: 0,
      apiOperationsPageTerminalResults: 0,
      schemaFields: { applicable: 0, covered: 0, unavailable: 219 },
    },
    sourceCoverage: {
      coverageGate: { status: 'not-evaluated', evaluated: false, passed: null },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ operationRenderCoverageRatio: 0, artifacts: [{ artifact: run.artifact }] }, [run]);

  assert.equal(summary.coverageSemantics.status, 'incomplete');
  assert.equal(summary.coverageSemantics.completeWorkflowRuns, 0);
  assert.equal(summary.operationRenderCoverageRatio, null);
  assert.equal(summary.combinedSourceLineCoverageRatio, null);
  assert.equal(summary.incompleteEvidence[0].observedCoverage.schemaFields.unavailable, 219);
  assert.equal(summary.artifacts[0].workflow.complete, false);
});

test('calculates coverage ratios only from complete workflows', () => {
  const complete = {
    artifact: 'mutation-api',
    status: 'passed',
    workflow: { status: 'complete', complete: true, reasons: [] },
    coverage: {
      declaredOperations: 2,
      renderedOperations: 2,
      submittedOperations: 2,
      apiOperationsPageSubmittedOperations: 2,
      apiOperationsPageTerminalResults: 2,
      schemaFields: { applicable: 10, covered: 9 },
    },
    sourceCoverage: {
      combined: {
        lines: { total: 100, covered: 80 },
        branches: { total: 50, covered: 30 },
      },
    },
  };
  const incomplete = {
    artifact: 'stopped-api',
    status: 'failed',
    workflow: { status: 'incomplete', complete: false, reasons: [{ reasonCode: 'workflow-stopped' }] },
    coverage: {
      declaredOperations: 20,
      renderedOperations: 0,
      apiOperationsPageSubmittedOperations: 0,
      apiOperationsPageTerminalResults: 0,
      schemaFields: { applicable: 0, covered: 0 },
    },
    sourceCoverage: {
      combined: {
        lines: { total: 200, covered: 20 },
        branches: { total: 100, covered: 10 },
      },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ artifacts: [] }, [complete, incomplete]);

  assert.equal(summary.coverageSemantics.status, 'partial');
  assert.equal(summary.operationRenderCoverageRatio, 1);
  assert.equal(summary.apiOperationsPageSubmissionCoverageRatio, 1);
  assert.equal(summary.schemaFieldCoverageRatio, 0.9);
  assert.equal(summary.combinedSourceLineCoverageRatio, 0.8);
  assert.equal(summary.combinedSourceBranchCoverageRatio, 0.6);
  assert.equal(summary.incompleteEvidence.length, 1);
});
