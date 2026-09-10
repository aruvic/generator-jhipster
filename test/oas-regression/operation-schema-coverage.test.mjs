import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOperationSchemaCoverage, evaluateOperationSchemaCoverage } from './operation-schema-coverage.mjs';

const operation = {
  id: 'create-resource',
  method: 'POST',
  requestBodyFields: [
    { name: 'id', path: ['id'], pointer: '/id', type: 'string', required: true, readOnly: true },
    { name: 'name', path: ['name'], pointer: '/name', type: 'string', required: true, minLength: 1 },
    { name: 'state', path: ['state'], pointer: '/state', type: 'string', enumValues: ['ACTIVE'], required: false },
    {
      name: 'contacts',
      path: ['contacts'],
      pointer: '/contacts',
      type: 'array',
      required: false,
      minItems: 1,
      items: {
        type: 'object',
        fields: [{ name: 'email', path: ['contacts', '0', 'email'], pointer: '/contacts/items/email', type: 'string', format: 'email' }],
      },
    },
    { name: 'comment', path: ['comment'], pointer: '/comment', type: 'string', nullable: true },
  ],
  responseBodyFields: [
    { name: 'id', path: ['id'], pointer: '/id', type: 'string', required: true },
    { name: 'secret', path: ['secret'], pointer: '/secret', type: 'string', writeOnly: true },
    { name: 'name', path: ['name'], pointer: '/name', type: 'string', required: true },
  ],
};

test('reports required, optional, nested, constrained, nullable, and response field coverage', () => {
  const report = buildOperationSchemaCoverage(
    [operation],
    [
      {
        operation,
        status: 201,
        requestBody: { name: 'created', contacts: [{ email: 'test@example.invalid' }], comment: null },
        responseBody: { id: 'created-id', name: 'created' },
      },
    ],
  );

  assert.equal(report.covered, 6);
  assert.equal(report.notCovered, 1);
  assert.equal(report.excluded, 2);
  assert.equal(report.unavailable, 0);
  assert.equal(report.facets.required.covered, 3);
  assert.equal(report.facets.array.covered, 1);
  assert.equal(report.facets.format.covered, 1);
  assert.equal(report.facets.bounds.covered, 2);
  assert.equal(report.facets.nullable.covered, 1);
  assert.equal(report.entries.find(entry => entry.direction === 'request' && entry.pointer === '/comment').observedNull, true);
  assert.deepEqual(evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.7 }), {
    status: 'passed',
    evaluated: true,
    passed: true,
    incompleteReasons: [],
    optionalCoverageRatio: 0.75,
    optionalMinimum: 0.7,
    failures: [],
  });
});

test('does not penalize fields when no successful exchange or writable value exists', () => {
  const report = buildOperationSchemaCoverage([operation], []);

  assert.equal(report.notCovered, 0);
  assert.equal(report.unavailable, 7);
  assert.equal(report.excluded, 2);
  assert.equal(report.applicable, 0);
  assert.equal(report.coverageRatio, null);
  assert.equal(evaluateOperationSchemaCoverage(report).passed, true);
});

test('marks descendants unavailable when a successful response array is empty', () => {
  const collectionOperation = {
    id: 'list-resources',
    method: 'GET',
    responseBodyFields: [
      { name: 'id', path: ['0', 'id'], pointer: '/0/id', type: 'string', required: true },
      { name: 'name', path: ['0', 'name'], pointer: '/0/name', type: 'string', required: false },
    ],
  };
  const report = buildOperationSchemaCoverage(
    [collectionOperation],
    [{ operation: collectionOperation, status: 200, responseBody: [] }],
  );

  assert.equal(report.applicable, 0);
  assert.equal(report.notCovered, 0);
  assert.equal(report.unavailable, 2);
  assert.ok(report.entries.every(entry => entry.reasonCode === 'no-response-instance'));
  assert.deepEqual(evaluateOperationSchemaCoverage(report, { optionalMinimum: 1 }), {
    status: 'passed',
    evaluated: true,
    passed: true,
    incompleteReasons: [],
    optionalCoverageRatio: null,
    optionalMinimum: 1,
    failures: [],
  });
});

test('fails a required response field missing from an observed array item', () => {
  const collectionOperation = {
    id: 'list-resources',
    method: 'GET',
    responseBodyFields: [{ name: 'id', path: ['0', 'id'], pointer: '/0/id', type: 'string', required: true }],
  };
  const report = buildOperationSchemaCoverage(
    [collectionOperation],
    [{ operation: collectionOperation, status: 200, responseBody: [{}] }],
  );

  assert.equal(report.notCovered, 1);
  assert.equal(report.unavailable, 0);
  assert.deepEqual(evaluateOperationSchemaCoverage(report).failures, [
    {
      operationId: 'list-resources',
      direction: 'response',
      pointer: '/0/id',
      reasonCode: 'required-field-not-covered',
    },
  ]);
});

test('fails uncovered required fields and a meaningful optional-field floor', () => {
  const report = buildOperationSchemaCoverage(
    [operation],
    [{ operation, status: 201, requestBody: {}, responseBody: { id: 'created-id' } }],
  );
  const gate = evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.5 });

  assert.equal(gate.passed, false);
  assert.equal(gate.optionalCoverageRatio, 0);
  assert.equal(gate.failures.filter(failure => failure.reasonCode === 'required-field-not-covered').length, 2);
  assert.equal(gate.failures.at(-1).reasonCode, 'optional-field-coverage-below-threshold');
});

test('does not enforce schema coverage thresholds when required workflows stopped early', () => {
  const report = buildOperationSchemaCoverage([operation], []);
  const gate = evaluateOperationSchemaCoverage(report, {
    workflowComplete: false,
    incompleteReasons: [{ reasonCode: 'operation-terminal-coverage-incomplete' }],
  });

  assert.equal(gate.status, 'not-evaluated');
  assert.equal(gate.evaluated, false);
  assert.equal(gate.passed, null);
  assert.deepEqual(gate.failures, []);
  assert.deepEqual(gate.incompleteReasons, [{ reasonCode: 'operation-terminal-coverage-incomplete' }]);
});
