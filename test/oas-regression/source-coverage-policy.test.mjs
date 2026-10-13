import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOURCE_COVERAGE_METRIC_LABELS,
  buildSourceCoverageMetricReport,
  classifyBrowserSourceCoverageEvidence,
  evaluateIndependentSourceCoverageGates,
  evaluateSourceCoverageThresholds,
} from './source-coverage-policy.mjs';

test('classifies mapped browser evidence independently from cross-source instrumentation compatibility', () => {
  assert.deepEqual(classifyBrowserSourceCoverageEvidence({ conversionErrorCount: 0, mappedFileCount: 2 }), {
    status: 'available',
  });
  assert.deepEqual(classifyBrowserSourceCoverageEvidence({ conversionErrorCount: 1, mappedFileCount: 2 }), {
    status: 'malformed',
    reasonCode: 'browser-source-map-conversion-failed',
  });
  assert.deepEqual(classifyBrowserSourceCoverageEvidence({ conversionErrorCount: 0, mappedFileCount: 0 }), {
    status: 'unavailable',
    reasonCode: 'browser-source-coverage-unavailable',
  });
});

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
  assert.equal(report.metricLabel, SOURCE_COVERAGE_METRIC_LABELS.browser);
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

test('fails a missed applicable GET workflow without evaluating partial source thresholds', () => {
  const report = evaluateSourceCoverageThresholds(
    [
      {
        id: 'openapi-operations',
        applicable: true,
        missingFiles: [],
        thresholds: { lines: 70 },
        summary: {
          get lines() {
            throw new Error('source thresholds must not be evaluated before workflow completeness');
          },
        },
      },
    ],
    {
      workflowComplete: false,
      incompleteReasons: [{ reasonCode: 'operation-render-coverage-incomplete', operationIds: ['get-orders'] }],
      declaredOperations: [{ operationId: 'get-orders', method: 'GET' }],
    },
  );

  assert.equal(report.status, 'failed');
  assert.equal(report.evaluated, false);
  assert.equal(report.passed, false);
  assert.equal(report.failures[0].reasonCode, 'incomplete-workflow-evidence');
  assert.deepEqual(report.failures[0].evidence, [{ reasonCode: 'operation-render-coverage-incomplete', operationIds: ['get-orders'] }]);
  assert.deepEqual(report.observedShortfalls, []);
  assert.equal(report.components[0].passed, null);
  assert.deepEqual(report.components[0].observedShortfalls, []);
});

test('fails a read-only API below browser thresholds without excluding generic source', () => {
  const report = evaluateSourceCoverageThresholds(
    [
      {
        id: 'form-crud',
        applicable: true,
        missingFiles: [],
        thresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
        summary: {
          lines: { pct: 89.14 },
          statements: { pct: 69.9 },
          functions: { pct: 86.84 },
          branches: { pct: 77.91 },
        },
        evidenceSource: 'browser',
      },
    ],
    {
      declaredOperations: [
        { operationId: 'get-point-to-point', method: 'GET' },
        { operationId: 'get-port-schedules', method: 'GET' },
      ],
    },
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.failures, [{ component: 'form-crud', metric: 'statements', actual: 69.9, minimum: 70 }]);
  assert.equal(report.components[0].evidenceSource, 'browser');
  assert.deepEqual(report.capabilityApplicability.excludedSourceRanges, []);
  assert.deepEqual(
    report.capabilityApplicability.nonApplicableCapabilities.map(capability => capability.id),
    ['create', 'update', 'delete'],
  );
  assert.deepEqual(report.capabilityApplicability.nonApplicableCapabilities[0].evidence, { declaredMethods: ['GET'] });
});

test('fails a CRUD-capable API whose browser source coverage remains below threshold', () => {
  const report = evaluateSourceCoverageThresholds(
    [
      {
        id: 'form-crud',
        applicable: true,
        missingFiles: [],
        thresholds: { lines: 70, statements: 70, functions: 60, branches: 55 },
        summary: {
          lines: { pct: 75 },
          statements: { pct: 69.9 },
          functions: { pct: 65 },
          branches: { pct: 60 },
        },
      },
    ],
    {
      declaredOperations: [
        { operationId: 'get-orders', method: 'GET' },
        { operationId: 'post-order', method: 'POST' },
        { operationId: 'patch-order', method: 'PATCH' },
        { operationId: 'delete-order', method: 'DELETE' },
      ],
    },
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.failures, [{ component: 'form-crud', metric: 'statements', actual: 69.9, minimum: 70 }]);
  assert.equal(
    report.capabilityApplicability.capabilities.every(capability => capability.applicable),
    true,
  );
});

test('reports browser and Vitest coverage with separate labels, evidence, denominators, thresholds, and gates', () => {
  const thresholds = { lines: 70, statements: 70, functions: 60, branches: 55 };
  const browserGate = evaluateSourceCoverageThresholds(
    [
      {
        id: 'form-crud',
        applicable: true,
        missingFiles: [],
        thresholds,
        summary: {
          lines: { pct: 80 },
          statements: { pct: 80 },
          functions: { pct: 70 },
          branches: { pct: 60 },
        },
      },
    ],
    { source: 'browser' },
  );
  const browser = buildSourceCoverageMetricReport({
    source: 'browser',
    status: 'available',
    summary: {
      files: 1,
      lines: { total: 10, covered: 8, pct: 80 },
      statements: { total: 10, covered: 8, pct: 80 },
      functions: { total: 10, covered: 7, pct: 70 },
      branches: { total: 10, covered: 6, pct: 60 },
    },
    evidenceFiles: { coverageMap: 'browser/coverage-final.json' },
    expectedFiles: ['src/main/webapp/app/form-crud/form-crud.ts'],
    instrumentedFiles: ['src/main/webapp/app/form-crud/form-crud.ts'],
    missingFiles: [],
    thresholds,
    coverageGate: browserGate,
  });
  const vitest = buildSourceCoverageMetricReport({
    source: 'vitest',
    status: 'available',
    summary: {
      files: 1,
      lines: { total: 20, covered: 18, pct: 90 },
      statements: { total: 20, covered: 18, pct: 90 },
      functions: { total: 10, covered: 8, pct: 80 },
      branches: { total: 10, covered: 7, pct: 70 },
    },
    evidenceFiles: { coverageMap: 'vitest/coverage-final.json' },
    expectedFiles: ['src/main/webapp/app/form-crud/form-crud.ts'],
    instrumentedFiles: ['src/main/webapp/app/form-crud/form-crud.ts'],
    missingFiles: [],
    thresholds,
    coverageGate: { metricLabel: SOURCE_COVERAGE_METRIC_LABELS.vitest, passed: true },
  });

  assert.equal(browser.metricLabel, 'browser-e2e-source-coverage');
  assert.equal(vitest.metricLabel, 'vitest-unit-source-coverage');
  assert.deepEqual(browser.evidenceFiles, { coverageMap: 'browser/coverage-final.json' });
  assert.deepEqual(vitest.evidenceFiles, { coverageMap: 'vitest/coverage-final.json' });
  assert.equal(browser.denominator.metrics.lines, 10);
  assert.equal(vitest.denominator.metrics.lines, 20);
  assert.deepEqual(browser.thresholds, thresholds);
  assert.equal(browser.coverageGate.passed, true);
});

test('fails the browser gate when browser source evidence is missing instead of using Vitest evidence', () => {
  const report = evaluateSourceCoverageThresholds([], {
    source: 'browser',
    evidenceStatus: 'unavailable',
    evidenceReasonCode: 'browser-source-coverage-unavailable',
    evidence: { vitestAvailable: true },
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.evaluated, false);
  assert.equal(report.passed, false);
  assert.equal(report.reasonCode, 'browser-source-coverage-unavailable');
  assert.deepEqual(report.failures[0].evidence, { vitestAvailable: true });
});

for (const [evidenceStatus, reasonCode] of [
  ['malformed', 'browser-source-map-conversion-failed'],
  ['incompatible', 'incompatible-source-coverage-instrumentation'],
]) {
  test(`fails the browser gate when browser source evidence is ${evidenceStatus}`, () => {
    const report = evaluateSourceCoverageThresholds([], {
      source: 'browser',
      evidenceStatus,
      evidenceReasonCode: reasonCode,
    });

    assert.equal(report.status, 'failed');
    assert.equal(report.evaluated, false);
    assert.equal(report.passed, false);
    assert.equal(report.reasonCode, reasonCode);
  });
}

test('fails an independently measured browser component below its browser threshold', () => {
  const report = evaluateSourceCoverageThresholds(
    [
      {
        id: 'reference-picker',
        applicable: true,
        missingFiles: [],
        thresholds: { lines: 75, statements: 70, functions: 60, branches: 55 },
        summary: {
          lines: { pct: 74.9 },
          statements: { pct: 80 },
          functions: { pct: 70 },
          branches: { pct: 65 },
        },
      },
    ],
    { source: 'browser' },
  );

  assert.equal(report.passed, false);
  assert.deepEqual(report.failures, [{ component: 'reference-picker', metric: 'lines', actual: 74.9, minimum: 75 }]);
});

test('rejects missing and vacuous source thresholds', () => {
  const report = evaluateSourceCoverageThresholds([
    {
      id: 'form-crud',
      applicable: true,
      missingFiles: [],
      thresholds: { lines: 0, statements: 70, functions: 60 },
      summary: {
        lines: { pct: 100 },
        statements: { pct: 100 },
        functions: { pct: 100 },
        branches: { pct: 100 },
      },
    },
  ]);

  assert.equal(report.passed, false);
  assert.deepEqual(
    report.failures.filter(failure => failure.reasonCode === 'invalid-source-coverage-threshold'),
    [
      {
        component: 'form-crud',
        metric: 'lines',
        actual: null,
        minimum: 0,
        reasonCode: 'invalid-source-coverage-threshold',
      },
      {
        component: 'form-crud',
        metric: 'branches',
        actual: null,
        minimum: null,
        reasonCode: 'invalid-source-coverage-threshold',
      },
    ],
  );
});

test('aggregates browser and Vitest gates independently', () => {
  const gate = evaluateIndependentSourceCoverageGates({
    browser: { coverageGate: { status: 'failed', passed: false } },
    vitest: { coverageGate: { status: 'passed', passed: true } },
  });

  assert.equal(gate.metricLabel, 'independent-source-coverage-gates');
  assert.equal(gate.status, 'failed');
  assert.equal(gate.passed, false);
  assert.deepEqual(
    gate.failures.map(failure => failure.source),
    ['browser'],
  );
  assert.deepEqual(Object.keys(gate.gates), ['browser', 'vitest']);
});
