import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertionForOperationErrorEvent,
  buildOperationErrorAttributionReport,
  classifyOperationErrorEvent,
  matchAuthenticatedHttpError,
  normalizeOperationErrorPath,
} from './operation-error-attribution.mjs';

const expectedNegativeAssertion = {
  assertionType: 'expected-negative',
  operationId: 'createWidget',
  method: 'POST',
  path: '/api/widgets',
  status: 422,
  authenticated: true,
  target: true,
  correlation: { requestId: 'validation-request' },
  evidenceRef: '/evidence/assertions.json#/validation',
};

const validationEvent = {
  type: 'http-response',
  authenticated: true,
  method: 'post',
  url: 'https://localhost:4200//api/widgets/?source=form#result',
  status: 422,
  requestId: 'validation-request',
  evidenceRef: '/evidence/http-events.json#/0',
};

test('classifies each supported console and runtime event separately', () => {
  for (const classification of ['frontend-console', 'page-error', 'request-failure', 'http-response']) {
    assert.equal(classifyOperationErrorEvent({ type: classification }), classification);
  }
  assert.throws(() => classifyOperationErrorEvent({ type: 'console-or-page-error' }), /event classification/);
});

test('normalizes absolute and relative paths without query, fragment, duplicate, or trailing slashes', () => {
  assert.equal(normalizeOperationErrorPath('https://localhost:4200//api/widgets/?source=form#result'), '/api/widgets');
  assert.equal(normalizeOperationErrorPath('/api/widgets/'), '/api/widgets');
  assert.equal(normalizeOperationErrorPath('/'), '/');
});

test('attributes an authenticated expected-negative response only through exact assertion metadata', () => {
  const result = matchAuthenticatedHttpError(validationEvent, [expectedNegativeAssertion]);

  assert.equal(result.attribution, 'matched');
  assert.equal(result.assertionType, 'expected-negative');
  assert.equal(result.operationId, 'createWidget');
  assert.equal(result.assertionIndex, 0);
  assert.deepEqual(result.evidenceReferences, ['/evidence/http-events.json#/0', '/evidence/assertions.json#/validation']);
});

test('builds an explicit assertion from the exact captured HTTP event correlation', () => {
  assert.deepEqual(
    assertionForOperationErrorEvent(validationEvent, {
      assertionType: 'expected-negative',
      evidenceRef: '/evidence/assertions.json#/captured-validation',
      operationId: 'createWidget',
    }),
    {
      assertionType: 'expected-negative',
      operationId: 'createWidget',
      method: 'POST',
      path: '/api/widgets',
      status: 422,
      authenticated: true,
      target: true,
      correlation: { requestId: 'validation-request' },
      evidenceRef: '/evidence/assertions.json#/captured-validation',
    },
  );
});

test('attributes post-delete absence through explicit evidence correlation', () => {
  const event = {
    type: 'http-response',
    authenticated: true,
    method: 'GET',
    path: '/api/widgets/123?readback=true',
    status: 404,
    evidenceRef: '/evidence/http-events.json#/1',
    correlation: { evidenceRef: '/evidence/delete-readback.json#/123' },
  };
  const assertion = {
    assertionType: 'post-delete',
    operationId: 'readWidget',
    method: 'get',
    path: '/api/widgets/123/',
    status: 404,
    authenticated: true,
    target: true,
    correlation: { evidenceRef: '/evidence/delete-readback.json#/123' },
    evidenceRef: '/evidence/assertions.json#/post-delete-123',
  };

  const result = matchAuthenticatedHttpError(event, [assertion]);

  assert.equal(result.attribution, 'matched');
  assert.equal(result.assertionType, 'post-delete');
  assert.deepEqual(result.evidenceReferences, ['/evidence/http-events.json#/1', '/evidence/assertions.json#/post-delete-123']);
});

test('attributes an authenticated 5xx only when that exact status is asserted', () => {
  const assertion = {
    ...expectedNegativeAssertion,
    status: 503,
    evidenceRef: '/evidence/assertions.json#/expected-503',
  };
  const result = matchAuthenticatedHttpError({ ...validationEvent, status: 503 }, [assertion]);

  assert.equal(result.attribution, 'matched');
  assert.equal(result.assertionIndex, 0);
});

test('requires explicit expected-negative and post-delete assertion metadata', () => {
  assert.throws(
    () => matchAuthenticatedHttpError(validationEvent, [{ ...expectedNegativeAssertion, assertionType: undefined }]),
    /assertionType/,
  );
  assert.throws(
    () =>
      matchAuthenticatedHttpError(validationEvent, [
        { ...expectedNegativeAssertion, assertionType: 'post-delete', correlation: undefined },
      ]),
    /correlation/,
  );
  assert.throws(
    () => matchAuthenticatedHttpError(validationEvent, [{ ...expectedNegativeAssertion, evidenceRef: undefined }]),
    /evidenceRef/,
  );
  assert.throws(
    () => matchAuthenticatedHttpError(validationEvent, [{ ...expectedNegativeAssertion, operationId: undefined }]),
    /operationId/,
  );
  assert.throws(
    () =>
      assertionForOperationErrorEvent(validationEvent, {
        assertionType: 'expected-negative',
        evidenceRef: '/evidence/assertions.json#/missing-operation',
      }),
    /operationId/,
  );
});

test('rejects an error response when no explicit assertion exists', () => {
  assert.deepEqual(matchAuthenticatedHttpError(validationEvent), {
    attribution: 'unmatched',
    reasonCode: 'no-explicit-assertion',
    candidateAssertionIndexes: [],
    evidenceReferences: [],
  });
});

test('rejects wrong method, path, status, and request correlation independently', async t => {
  const cases = [
    ['method', { ...validationEvent, method: 'PUT' }, 'method-mismatch'],
    ['path', { ...validationEvent, url: '/api/other' }, 'path-mismatch'],
    ['status', { ...validationEvent, status: 400 }, 'status-mismatch'],
    ['correlation', { ...validationEvent, requestId: 'another-request' }, 'correlation-mismatch'],
  ];

  for (const [name, event, reasonCode] of cases) {
    await t.test(name, () => {
      const result = matchAuthenticatedHttpError(event, [expectedNegativeAssertion]);
      assert.equal(result.attribution, 'unmatched');
      assert.equal(result.reasonCode, reasonCode);
    });
  }
});

test('rejects unauthenticated, non-target, and non-error HTTP responses instead of ignoring their statuses', () => {
  assert.equal(
    matchAuthenticatedHttpError({ ...validationEvent, authenticated: false }, [expectedNegativeAssertion]).reasonCode,
    'unauthenticated-http-error',
  );
  assert.equal(
    matchAuthenticatedHttpError({ ...validationEvent, target: false }, [expectedNegativeAssertion]).reasonCode,
    'non-target-http-error',
  );
  assert.equal(matchAuthenticatedHttpError({ ...validationEvent, status: 302 }, [expectedNegativeAssertion]).reasonCode, 'not-http-error');
});

test('rejects ambiguous assertion matches', () => {
  const result = matchAuthenticatedHttpError(validationEvent, [
    expectedNegativeAssertion,
    { ...expectedNegativeAssertion, evidenceRef: '/evidence/assertions.json#/duplicate' },
  ]);

  assert.equal(result.attribution, 'unmatched');
  assert.equal(result.reasonCode, 'ambiguous-assertion');
  assert.deepEqual(result.candidateAssertionIndexes, [0, 1]);
});

test('reports separate counts, evidence, unmatched events, and a passing gate without unmatched authenticated errors', () => {
  const report = buildOperationErrorAttributionReport({
    events: [
      { type: 'frontend-console', authenticated: false, evidenceRef: '/evidence/console.json#/0' },
      { type: 'page-error', authenticated: false, evidenceRef: '/evidence/page-errors.json#/0' },
      { type: 'request-failure', authenticated: false, evidenceRef: '/evidence/request-failures.json#/0' },
      validationEvent,
      { type: 'http-response', authenticated: true, method: 'GET', path: '/api/widgets', status: 204 },
    ],
    assertions: [expectedNegativeAssertion],
  });

  assert.deepEqual(report.counts, {
    total: 5,
    'frontend-console': 1,
    'page-error': 1,
    'request-failure': 1,
    'http-response': 2,
    attributed: 1,
    attributedExpectedNegative: 1,
    attributedPostDelete: 0,
    unmatched: 3,
    ambiguous: 0,
    unmatchedAuthenticated: 0,
    ambiguousAuthenticated: 0,
  });
  assert.deepEqual(
    report.unmatchedEvents.map(entry => entry.classification),
    ['frontend-console', 'page-error', 'request-failure'],
  );
  assert.deepEqual(report.evidenceReferences, [
    '/evidence/console.json#/0',
    '/evidence/page-errors.json#/0',
    '/evidence/request-failures.json#/0',
    '/evidence/http-events.json#/0',
    '/evidence/assertions.json#/validation',
  ]);
  assert.deepEqual(report.enterpriseGate, {
    metricLabel: 'authenticated-target-http-error-attribution',
    status: 'passed',
    unmatchedAuthenticatedEvents: 0,
    ambiguousAuthenticatedEvents: 0,
    unmatchedAuthenticatedHttpErrors: 0,
    ambiguousAuthenticatedHttpErrors: 0,
  });
});

test('fails the enterprise gate for every unmatched or ambiguous authenticated operation-error event', async t => {
  const unauthenticatedReport = buildOperationErrorAttributionReport({
    events: [{ ...validationEvent, authenticated: false }],
    assertions: [expectedNegativeAssertion],
  });
  assert.equal(unauthenticatedReport.enterpriseGate.status, 'passed');
  assert.equal(unauthenticatedReport.counts.unmatchedAuthenticated, 0);

  const wrongStatusReport = buildOperationErrorAttributionReport({
    events: [{ ...validationEvent, status: 500 }],
    assertions: [expectedNegativeAssertion],
  });
  assert.equal(wrongStatusReport.enterpriseGate.status, 'failed');
  assert.equal(wrongStatusReport.counts.unmatchedAuthenticated, 1);
  assert.equal(wrongStatusReport.unmatchedEvents[0].reasonCode, 'status-mismatch');

  const nonTargetReport = buildOperationErrorAttributionReport({
    events: [{ ...validationEvent, target: false }],
    assertions: [expectedNegativeAssertion],
  });
  assert.equal(nonTargetReport.enterpriseGate.status, 'failed');
  assert.equal(nonTargetReport.unmatchedEvents[0].reasonCode, 'non-target-http-error');

  for (const classification of ['frontend-console', 'page-error', 'request-failure']) {
    await t.test(classification, () => {
      const report = buildOperationErrorAttributionReport({
        events: [
          {
            type: classification,
            authenticated: true,
            target: true,
            method: 'GET',
            path: '/api/widgets/123',
            evidenceRef: `/evidence/${classification}.json#/1`,
          },
        ],
      });
      assert.equal(report.enterpriseGate.status, 'failed');
      assert.equal(report.counts.unmatchedAuthenticated, 1);
      assert.equal(report.unmatchedEvents[0].reasonCode, 'no-explicit-assertion');
    });
  }

  const ambiguousReport = buildOperationErrorAttributionReport({
    events: [validationEvent],
    assertions: [expectedNegativeAssertion, { ...expectedNegativeAssertion, evidenceRef: '/evidence/assertions.json#/duplicate' }],
  });
  assert.equal(ambiguousReport.enterpriseGate.status, 'failed');
  assert.equal(ambiguousReport.counts.unmatched, 0);
  assert.equal(ambiguousReport.counts.ambiguous, 1);
  assert.equal(ambiguousReport.counts.ambiguousAuthenticated, 1);
  assert.equal(ambiguousReport.ambiguousEvents[0].reasonCode, 'ambiguous-assertion');
});

test('passes expected runtime and post-delete events only with complete operation attribution', () => {
  const runtimeEvent = {
    classification: 'request-failure',
    authenticated: true,
    target: true,
    method: 'PATCH',
    url: 'https://localhost:4200/api/widgets/123?source=form',
    requestId: 'runtime-request',
    evidenceRef: '/evidence/request-failures.json#/0',
  };
  const runtimeAssertion = assertionForOperationErrorEvent(runtimeEvent, {
    assertionType: 'expected-negative',
    operationId: 'updateWidget',
    evidenceRef: '/evidence/assertions.json#/runtime',
  });
  const postDeleteEvent = {
    classification: 'http-response',
    authenticated: true,
    target: true,
    method: 'GET',
    path: '/api/widgets/123',
    status: 404,
    requestId: 'post-delete-request',
    evidenceRef: '/evidence/http-events.json#/post-delete',
  };
  const postDeleteAssertion = assertionForOperationErrorEvent(postDeleteEvent, {
    assertionType: 'post-delete',
    operationId: 'readWidget',
    evidenceRef: '/evidence/assertions.json#/post-delete',
  });

  const report = buildOperationErrorAttributionReport({
    events: [runtimeEvent, postDeleteEvent],
    assertions: [runtimeAssertion, postDeleteAssertion],
  });

  assert.equal(report.enterpriseGate.status, 'passed');
  assert.equal(report.counts.attributed, 2);
  assert.equal(report.counts.attributedExpectedNegative, 1);
  assert.equal(report.counts.attributedPostDelete, 1);
  assert.equal(report.attributedEvents[0].assertion.operationId, 'updateWidget');
  assert.equal(report.attributedEvents[0].assertion.classification, 'request-failure');
});
