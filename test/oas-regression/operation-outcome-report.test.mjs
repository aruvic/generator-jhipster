import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOperationOutcomeReport, classifyOperationPrerequisite } from './operation-outcome-report.mjs';

const operations = [
  { operationId: 'updateRequired', method: 'PATCH', path: '/required/{id}' },
  { operationId: 'readEligible', method: 'GET', path: '/eligible/{id}' },
  { operationId: 'deleteOptional', method: 'DELETE', path: '/optional/{id}' },
  { operationId: 'readUnexecutable', method: 'GET', path: '/ordinary/{id}' },
];

const prerequisiteReport = {
  results: {
    eligible: [
      {
        method: 'GET',
        path: '/eligible/{id}',
        required: true,
        reasonCode: 'external-prerequisite-proven',
        evidencePaths: ['/evidence/verified-resources.json#/0'],
      },
    ],
    'blocked-prerequisite': [
      {
        method: 'PATCH',
        path: '/required/{id}',
        required: true,
        reasonCode: 'required-external-prerequisite-unproven',
        evidencePaths: ['/evidence/proof-results.json#/0'],
      },
    ],
    'disabled-optional': [
      {
        method: 'DELETE',
        path: '/optional/{id}',
        required: false,
        reasonCode: 'optional-external-prerequisite-unproven',
        evidencePaths: ['/evidence/proof-results.json#/1'],
      },
    ],
  },
};

test('aggregates prerequisite and execution outcomes without blending denominators', () => {
  const report = buildOperationOutcomeReport({
    operations,
    prerequisiteReport,
    outcomes: {
      'success-2xx': [{ operationId: 'readEligible' }],
      unexecutable: [{ operationId: 'readUnexecutable', reasonCode: 'missing-upstream-resource' }],
    },
  });

  assert.deepEqual(report.counts, {
    declared: 4,
    eligible: 2,
    blockedPrerequisite: 1,
    disabledOptional: 1,
    success2xx: 1,
    expectedNegative: 0,
    unexecutable: 1,
    harnessError: 0,
    unexpectedFailure: 0,
    missingResult: 0,
  });
  assert.deepEqual(report.denominators, {
    declared: 4,
    applicable: 3,
    executionEligible: 2,
    excludedDisabledOptional: 1,
  });
  assert.equal(report.enterpriseGate.status, 'failed');
  assert.equal(report.prerequisites['blocked-prerequisite'][0].evidencePaths[0], '/evidence/proof-results.json#/0');
  assert.equal(report.prerequisites['disabled-optional'][0].reasonCode, 'optional-external-prerequisite-unproven');
});

test('rejects exercise claims for blocked or disabled operations', () => {
  assert.throws(
    () =>
      buildOperationOutcomeReport({
        operations,
        prerequisiteReport,
        outcomes: {
          'success-2xx': [{ operationId: 'deleteOptional' }],
        },
      }),
    /cannot be exercised while disabled-optional/,
  );
});

test('preserves operation eligibility and denominators when no declaration exists', () => {
  const report = buildOperationOutcomeReport({
    operations: operations.slice(0, 2),
    outcomes: {
      'success-2xx': [{ operationId: 'updateRequired' }],
      'expected-negative': [{ operationId: 'readEligible', status: 404 }],
    },
  });

  assert.equal(classifyOperationPrerequisite(undefined, operations[0]).classification, 'eligible');
  assert.equal(report.counts.eligible, 2);
  assert.equal(report.counts.blockedPrerequisite, 0);
  assert.equal(report.counts.disabledOptional, 0);
  assert.equal(report.counts.success2xx, 1);
  assert.equal(report.counts.expectedNegative, 1);
  assert.equal(report.denominators.applicable, 2);
  assert.equal(report.denominators.executionEligible, 2);
  assert.equal(report.enterpriseGate.status, 'passed');
});

test('builds an independent operation-error attribution report and exposes its failing gate', () => {
  const report = buildOperationOutcomeReport({
    operations: operations.slice(0, 1),
    outcomes: {
      'unexpected-failure': [{ operationId: 'updateRequired', status: 500 }],
    },
    operationErrorEvidence: {
      events: [
        {
          classification: 'http-response',
          authenticated: true,
          target: true,
          method: 'PATCH',
          path: '/required/42',
          status: 500,
          requestId: 'request-42',
          evidenceRef: '/evidence/operation-errors.json#/source/events/0',
        },
      ],
      assertions: [],
    },
  });

  assert.equal(report.enterpriseGate.status, 'passed');
  assert.equal(report.operationErrorAttribution.enterpriseGate.status, 'failed');
  assert.equal(report.operationErrorAttribution.counts['http-response'], 1);
  assert.equal(report.operationErrorAttribution.counts.unmatchedAuthenticated, 1);
  assert.equal(report.operationErrorAttribution.unmatchedEvents[0].reasonCode, 'no-explicit-assertion');
});
