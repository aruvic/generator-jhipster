import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFormCrudSummaryCompletionPolicy } from './form-crud-summary-policy.mjs';

function sourceCoverageMetric(source, { total, covered, status = 'available', passed = true, reasonCode } = {}) {
  const summary =
    status === 'available' ?
      {
        files: 1,
        lines: { total, covered, skipped: 0, pct: (covered / total) * 100 },
        statements: { total, covered, skipped: 0, pct: (covered / total) * 100 },
        functions: { total, covered, skipped: 0, pct: (covered / total) * 100 },
        branches: { total, covered, skipped: 0, pct: (covered / total) * 100 },
      }
    : null;
  let gateStatus = 'failed';
  if (passed === null) gateStatus = 'unknown';
  else if (passed) gateStatus = 'passed';
  return {
    metricLabel: source === 'browser' ? 'browser-e2e-source-coverage' : 'vitest-unit-source-coverage',
    source,
    status,
    evidenceFiles: { coverageMap: `${source}/coverage-final.json` },
    thresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
    summary,
    coverageGate: {
      status: gateStatus,
      passed,
      failures: passed === false ? [{ component: 'form-crud', metric: 'lines', actual: 60, minimum: 70 }] : [],
      ...(reasonCode ? { reasonCode } : {}),
    },
    ...(reasonCode ? { reasonCode } : {}),
  };
}

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
      schemaFields: {
        observedInstanceCoverage: {
          metricLabel: 'observed-instance-field-coverage',
          denominator: 0,
          covered: 0,
          notCovered: 0,
          absentObservations: 219,
          coverageRatio: null,
        },
        contractCompleteness: {
          metricLabel: 'contract-field-completeness',
          denominator: 219,
          covered: 0,
          uncovered: 0,
          unknown: 219,
          completenessRatio: 0,
        },
      },
      schemaFieldGate: {
        metricLabel: 'artifact-schema-contract-enterprise-gate',
        status: 'not-evaluated',
        evaluated: false,
        passed: null,
      },
    },
    sourceCoverage: {
      coverageGate: { status: 'not-evaluated', evaluated: false, passed: null },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ operationRenderCoverageRatio: 0, artifacts: [{ artifact: run.artifact }] }, [run]);

  assert.equal(summary.coverageSemantics.status, 'incomplete');
  assert.equal(summary.coverageSemantics.completeWorkflowRuns, 0);
  assert.equal(summary.operationRenderCoverageRatio, null);
  assert.equal(summary.sourceCoverage.browser.status, 'unavailable');
  assert.equal(summary.sourceCoverage.browser.summary, null);
  assert.equal(summary.sourceCoverage.compatibleUnion.status, 'unavailable');
  assert.equal(summary.schemaObservedInstanceCoverageRatio, null);
  assert.equal(summary.schemaContractCompletenessRatio, null);
  assert.equal(summary.incompleteEvidence[0].observedCoverage.schemaFields.contractCompleteness.unknown, 219);
  assert.equal(summary.schemaCoverage.enterpriseGate.status, 'not-evaluated');
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
      schemaFields: {
        observedInstanceCoverage: {
          metricLabel: 'observed-instance-field-coverage',
          denominator: 8,
          covered: 8,
          notCovered: 0,
          absentObservations: 2,
          coverageRatio: 1,
        },
        contractCompleteness: {
          metricLabel: 'contract-field-completeness',
          denominator: 10,
          covered: 9,
          uncovered: 1,
          unknown: 0,
          notApplicableWithEvidence: 0,
          excluded: 2,
          completenessRatio: 0.9,
        },
      },
      schemaFieldGate: {
        metricLabel: 'artifact-schema-contract-enterprise-gate',
        status: 'passed',
        evaluated: true,
        passed: true,
        failures: [],
      },
    },
    sourceCoverage: {
      browser: sourceCoverageMetric('browser', { total: 100, covered: 80 }),
      vitest: sourceCoverageMetric('vitest', { total: 120, covered: 108 }),
      compatibleUnion: {
        metricLabel: 'compatible-instrumentation-union-source-coverage',
        status: 'unavailable',
        reasonCode: 'incompatible-source-coverage-instrumentation',
        summary: null,
      },
      coverageGate: { status: 'passed', passed: true, failures: [] },
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
      schemaFields: {
        observedInstanceCoverage: {
          metricLabel: 'observed-instance-field-coverage',
          denominator: 0,
          covered: 0,
          notCovered: 0,
          absentObservations: 20,
          coverageRatio: null,
        },
        contractCompleteness: {
          metricLabel: 'contract-field-completeness',
          denominator: 20,
          covered: 0,
          uncovered: 0,
          unknown: 20,
          completenessRatio: 0,
        },
      },
      schemaFieldGate: {
        metricLabel: 'artifact-schema-contract-enterprise-gate',
        status: 'not-evaluated',
        evaluated: false,
        passed: null,
      },
    },
    sourceCoverage: {
      browser: sourceCoverageMetric('browser', { total: 200, covered: 20, passed: null }),
      vitest: sourceCoverageMetric('vitest', { total: 220, covered: 22, passed: null }),
      compatibleUnion: { status: 'unavailable', reasonCode: 'incompatible-source-coverage-instrumentation', summary: null },
      coverageGate: { status: 'unknown', passed: null, failures: [] },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy(
    {
      schemaFieldCoverageRatio: 0.9,
      totalApplicableSchemaFields: 30,
      artifacts: [{ artifact: complete.artifact }, { artifact: incomplete.artifact }],
    },
    [complete, incomplete],
  );

  assert.equal(summary.coverageSemantics.status, 'partial');
  assert.equal(summary.operationRenderCoverageRatio, 1);
  assert.equal(summary.apiOperationsPageSubmissionCoverageRatio, 1);
  assert.equal(summary.schemaObservedInstanceCoverageRatio, 1);
  assert.equal(summary.schemaContractCompletenessRatio, 0.9);
  assert.equal(summary.schemaCoverage.observedInstanceCoverage.metricLabel, 'observed-instance-field-coverage');
  assert.equal(summary.schemaCoverage.contractCompleteness.metricLabel, 'contract-field-completeness');
  assert.equal(summary.schemaCoverage.observedInstanceCoverage.denominator, 8);
  assert.equal(summary.schemaCoverage.contractCompleteness.denominator, 10);
  assert.equal(summary.schemaCoverage.contractCompleteness.unknown, 0);
  assert.equal(summary.coverageSemantics.observedInstanceCoverageIsContractCompleteness, false);
  assert.equal(Object.hasOwn(summary, 'schemaFieldCoverageRatio'), false);
  assert.equal(Object.hasOwn(summary, 'totalApplicableSchemaFields'), false);
  assert.equal(summary.schemaCoverage.enterpriseGate.status, 'not-evaluated');
  assert.equal(summary.artifacts[0].schemaCoverage.enterpriseGate.status, 'passed');
  assert.equal(summary.artifacts[1].schemaCoverage.enterpriseGate.status, 'not-evaluated');
  assert.equal(summary.sourceCoverage.browser.metricLabel, 'browser-e2e-source-coverage');
  assert.equal(summary.sourceCoverage.browser.summary.lines.pct, 80);
  assert.equal(summary.sourceCoverage.browser.denominator.metrics.lines, 100);
  assert.equal(summary.sourceCoverage.vitest.metricLabel, 'vitest-unit-source-coverage');
  assert.equal(summary.sourceCoverage.vitest.summary.lines.pct, 90);
  assert.equal(summary.sourceCoverage.compatibleUnion.status, 'unavailable');
  assert.equal(summary.sourceCoverage.compatibleUnion.summary, null);
  assert.equal(Object.hasOwn(summary, 'combinedSourceLineCoverageRatio'), false);
  assert.equal(summary.incompleteEvidence.length, 1);
});

test('excludes disabled optional operations from execution denominators', () => {
  const run = {
    artifact: 'optional-capability-api',
    status: 'passed',
    workflow: { status: 'complete', complete: true, reasons: [] },
    coverage: {
      declaredOperations: 3,
      apiOperationsPageApplicableOperations: 2,
      apiOperationsPageSubmittedOperations: 1,
      apiOperationsPage2xxSuccesses: 1,
      apiOperationsPageTerminalResults: 2,
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ artifacts: [] }, [run]);

  assert.equal(summary.apiOperationsPageSubmissionCoverageRatio, 0.5);
  assert.equal(summary.apiOperationsPage2xxSuccessRatio, 0.5);
  assert.equal(summary.apiOperationsPageTerminalResultRatio, 1);
});

test('fails the aggregate schema enterprise gate when any artifact gate fails', () => {
  const run = {
    artifact: 'schema-shortfall-api',
    status: 'failed',
    workflow: { status: 'complete', complete: true, reasons: [] },
    coverage: {
      schemaFields: {
        observedInstanceCoverage: { denominator: 4, covered: 4, notCovered: 0, absentObservations: 2 },
        contractCompleteness: { denominator: 6, covered: 4, uncovered: 2, unknown: 0 },
      },
      schemaFieldGate: {
        metricLabel: 'artifact-schema-contract-enterprise-gate',
        status: 'failed',
        evaluated: true,
        passed: false,
        failures: [{ reasonCode: 'optional-field-coverage-below-threshold' }],
      },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ artifacts: [{ artifact: run.artifact }] }, [run]);

  assert.equal(summary.schemaCoverage.enterpriseGate.status, 'failed');
  assert.equal(summary.schemaCoverage.enterpriseGate.passed, false);
  assert.equal(summary.schemaCoverage.enterpriseGate.failedArtifacts, 1);
  assert.equal(summary.schemaCoverage.enterpriseGate.failures[0].artifact, run.artifact);
  assert.equal(summary.artifacts[0].schemaCoverage.enterpriseGate.passed, false);
});

test('aggregates browser and Vitest source gates independently and fails the aggregate gate', () => {
  const failedBrowserRun = {
    artifact: 'browser-shortfall',
    status: 'failed',
    workflow: { status: 'complete', complete: true, reasons: [] },
    coverage: {},
    sourceCoverage: {
      browser: sourceCoverageMetric('browser', { total: 100, covered: 60, passed: false }),
      vitest: sourceCoverageMetric('vitest', { total: 100, covered: 90 }),
      compatibleUnion: {
        metricLabel: 'compatible-instrumentation-union-source-coverage',
        status: 'unavailable',
        reasonCode: 'incompatible-source-coverage-instrumentation',
        summary: null,
      },
      coverageGate: {
        metricLabel: 'independent-source-coverage-gates',
        status: 'failed',
        passed: false,
        failures: [{ source: 'browser' }],
      },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ artifacts: [{ artifact: failedBrowserRun.artifact }] }, [failedBrowserRun]);

  assert.equal(summary.sourceCoverage.browser.coverageGate.status, 'failed');
  assert.equal(summary.sourceCoverage.browser.coverageGate.failedArtifacts, 1);
  assert.equal(summary.sourceCoverage.vitest.coverageGate.status, 'passed');
  assert.equal(summary.sourceCoverage.coverageGate.status, 'failed');
  assert.equal(summary.sourceCoverage.coverageGate.failedArtifacts, 1);
  assert.equal(summary.sourceCoverage.compatibleUnion.status, 'unavailable');
  assert.equal(summary.sourceCoverage.compatibleUnion.summary, null);
  assert.equal(summary.artifacts[0].sourceCoverage.browser.coverageGate.passed, false);
});

test('aggregates operation-error attribution with independent event-class and gate labels', () => {
  const run = {
    artifact: 'error-evidence-api',
    status: 'failed',
    workflow: { status: 'complete', complete: true, reasons: [] },
    coverage: {},
    operationErrorAttributionReportFile: '/evidence/operation-error-attribution.json',
    operationErrorAttribution: {
      counts: {
        'frontend-console': 2,
        'page-error': 1,
        'request-failure': 3,
        'http-response': 4,
        attributedExpectedNegative: 1,
        attributedPostDelete: 1,
        unmatchedAuthenticated: 1,
        ambiguousAuthenticated: 1,
      },
      enterpriseGate: {
        metricLabel: 'authenticated-target-http-error-attribution',
        status: 'failed',
      },
    },
  };

  const summary = applyFormCrudSummaryCompletionPolicy({ artifacts: [{ artifact: run.artifact }] }, [run]);

  assert.deepEqual(summary.operationErrorAttribution.eventClassCounts, {
    'frontend-console': 2,
    'page-error': 1,
    'request-failure': 3,
    'http-response': 4,
  });
  assert.equal(summary.operationErrorAttribution.attributedExpectedNegative, 1);
  assert.equal(summary.operationErrorAttribution.attributedPostDelete, 1);
  assert.equal(summary.operationErrorAttribution.unmatchedAuthenticatedHttp, 1);
  assert.equal(summary.operationErrorAttribution.ambiguousAuthenticatedHttp, 1);
  assert.equal(summary.operationErrorAttribution.enterpriseGate.status, 'failed');
  assert.equal(summary.artifacts[0].operationErrorAttribution.enterpriseGate.status, 'failed');
  assert.equal(summary.artifacts[0].operationErrorAttributionReportFile, '/evidence/operation-error-attribution.json');
});
