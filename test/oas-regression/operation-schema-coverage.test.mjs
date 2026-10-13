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
  assert.equal(report.observedInstanceCoverage.metricLabel, 'full-contract-observed-instance-field-coverage');
  assert.equal(report.observedInstanceCoverage.enforcement, 'informational');
  assert.equal(report.observedInstanceCoverage.denominator, 7);
  assert.equal(report.observedInstanceCoverage.coverageRatio, 6 / 7);
  assert.equal(report.contractCompleteness.metricLabel, 'full-request-response-contract-completeness');
  assert.equal(report.contractCompleteness.enforcement, 'informational');
  assert.equal(report.contractCompleteness.denominator, 7);
  assert.equal(report.contractCompleteness.completenessRatio, 6 / 7);
  assert.equal(report.entries.find(entry => entry.direction === 'request' && entry.pointer === '/comment').observedNull, true);
  const gate = evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.7 });
  assert.equal(gate.metricLabel, 'artifact-reachable-request-field-gate');
  assert.equal(gate.status, 'passed');
  assert.equal(gate.evaluated, true);
  assert.equal(gate.passed, true);
  assert.equal(gate.optionalCoverageRatio, 0.75);
  assert.equal(gate.optionalMinimum, 0.7);
  assert.equal(gate.optionalFieldGate.metricLabel, 'optional-reachable-request-field-coverage-gate');
  assert.deepEqual(gate.failures, []);
});

test('keeps uninstantiated writable fields informational when no concrete request parent is reachable', () => {
  const report = buildOperationSchemaCoverage([operation], []);

  assert.equal(report.notCovered, 5);
  assert.equal(report.unavailable, 2);
  assert.equal(report.excluded, 2);
  assert.equal(report.applicable, 7);
  assert.equal(report.coverageRatio, 0);
  assert.equal(report.observedInstanceCoverage.denominator, 0);
  assert.equal(report.observedInstanceCoverage.coverageRatio, null);
  assert.equal(report.contractCompleteness.denominator, 7);
  assert.equal(report.contractCompleteness.uncovered, 5);
  assert.equal(report.contractCompleteness.unknown, 2);
  const requestEntries = report.entries.filter(entry => entry.direction === 'request' && !entry.readOnly);
  assert.ok(requestEntries.every(entry => entry.status === 'not-covered'));
  assert.ok(requestEntries.every(entry => entry.observation === 'absent'));

  const gate = evaluateOperationSchemaCoverage(report);
  assert.equal(gate.status, 'not-applicable-with-evidence');
  assert.equal(gate.evaluated, false);
  assert.equal(gate.passed, null);
  assert.equal(gate.reachableRequestFields.denominator, 0);
  assert.equal(gate.requiredWritable.denominator, 0);
  assert.equal(gate.optionalFieldGate.denominator, 0);
  assert.equal(gate.optionalFieldGate.coverageRatio, null);
});

test('reports an empty successful response array as unknown contract completeness, not observed coverage', () => {
  const collectionOperation = {
    id: 'list-resources',
    method: 'GET',
    responseBodyFields: [
      { name: 'id', path: ['0', 'id'], pointer: '/0/id', type: 'string', required: true },
      { name: 'name', path: ['0', 'name'], pointer: '/0/name', type: 'string', required: false },
    ],
  };
  const report = buildOperationSchemaCoverage([collectionOperation], [{ operation: collectionOperation, status: 200, responseBody: [] }]);

  assert.equal(report.applicable, 2);
  assert.equal(report.notCovered, 0);
  assert.equal(report.unavailable, 2);
  assert.equal(report.observedInstanceCoverage.denominator, 0);
  assert.equal(report.contractCompleteness.denominator, 2);
  assert.equal(report.contractCompleteness.unknown, 2);
  assert.ok(report.entries.every(entry => entry.reasonCode === 'no-response-instance'));
  const gate = evaluateOperationSchemaCoverage(report, { optionalMinimum: 1 });
  assert.equal(gate.status, 'not-applicable-with-evidence');
  assert.equal(gate.evaluated, false);
  assert.equal(gate.passed, null);
  assert.equal(gate.optionalCoverageRatio, null);
  assert.deepEqual(gate.failures, []);
});

test('does not gate on a response-only field missing from an observed array item', () => {
  const collectionOperation = {
    id: 'list-resources',
    method: 'GET',
    responseBodyFields: [{ name: 'id', path: ['0', 'id'], pointer: '/0/id', type: 'string', required: true }],
  };
  const report = buildOperationSchemaCoverage([collectionOperation], [{ operation: collectionOperation, status: 200, responseBody: [{}] }]);

  assert.equal(report.notCovered, 1);
  assert.equal(report.unavailable, 0);
  assert.equal(report.contractCompleteness.uncovered, 1);
  const gate = evaluateOperationSchemaCoverage(report);
  assert.equal(gate.status, 'not-applicable-with-evidence');
  assert.equal(gate.passed, null);
  assert.deepEqual(gate.failures, []);
});

test('fails a reachable required writable request field', () => {
  const requiredRequestOperation = {
    id: 'create-required',
    method: 'POST',
    requestBodyFields: [{ name: 'name', path: ['name'], pointer: '/name', type: 'string', required: true }],
    responseBodyFields: [{ name: 'id', path: ['id'], pointer: '/id', type: 'string', required: true }],
  };
  const report = buildOperationSchemaCoverage(
    [requiredRequestOperation],
    [{ operation: requiredRequestOperation, status: 201, requestBody: {}, responseBody: {} }],
  );
  const gate = evaluateOperationSchemaCoverage(report);

  assert.equal(gate.passed, false);
  assert.equal(gate.requiredWritable.denominator, 1);
  assert.equal(gate.requiredWritable.uncovered, 1);
  assert.deepEqual(gate.failures, [
    {
      operationId: 'create-required',
      direction: 'request',
      pointer: '/name',
      reasonCode: 'required-writable-field-not-covered',
    },
  ]);
});

test('excludes a polymorphic optional request branch only with explicit structural evidence', () => {
  const branchEvidence = {
    status: 'not-applicable-with-evidence',
    reasonCode: 'mutually-exclusive-schema-branch',
    evidence: {
      schemaKeyword: 'oneOf',
      selectedBranchPointer: '#/components/schemas/Pet/oneOf/0',
      excludedBranchPointer: '#/components/schemas/Pet/oneOf/1',
      discriminator: { path: ['kind'], value: 'cat' },
    },
  };
  const branchOperation = {
    id: 'create-pet',
    method: 'POST',
    requestBodyFields: [
      { name: 'kind', path: ['kind'], pointer: '/kind', type: 'string', required: true },
      {
        name: 'barkVolume',
        path: ['barkVolume'],
        pointer: '/barkVolume',
        type: 'integer',
        required: false,
        coverageApplicability: branchEvidence,
      },
    ],
  };
  const report = buildOperationSchemaCoverage(
    [branchOperation],
    [{ operation: branchOperation, status: 201, requestBody: { kind: 'cat' } }],
  );

  assert.equal(report.contractCompleteness.denominator, 1);
  assert.equal(report.contractCompleteness.covered, 1);
  assert.equal(report.contractCompleteness.notApplicableWithEvidence, 1);
  const excludedBranchEntry = report.entries.find(entry => entry.pointer === '/barkVolume');
  assert.equal(excludedBranchEntry.status, 'not-applicable-with-evidence');
  assert.equal(excludedBranchEntry.reasonCode, 'mutually-exclusive-schema-branch');
  assert.deepEqual(excludedBranchEntry.applicabilityEvidence, branchEvidence.evidence);
  const gate = evaluateOperationSchemaCoverage(report);
  assert.equal(gate.passed, true);
  assert.equal(gate.optionalFieldGate.status, 'not-applicable-with-evidence');
  assert.equal(gate.optionalFieldGate.evidence.structurallyNotApplicable, 1);

  const branchWithoutEvidence = structuredClone(branchOperation);
  branchWithoutEvidence.requestBodyFields[1].coverageApplicability.evidence.discriminator = undefined;
  const noStructuralEvidence = buildOperationSchemaCoverage(
    [branchWithoutEvidence],
    [{ operation: branchWithoutEvidence, status: 201, requestBody: { kind: 'cat' } }],
  );
  assert.equal(noStructuralEvidence.notApplicableWithEvidence, 0);
  assert.equal(noStructuralEvidence.entries.find(entry => entry.pointer === '/barkVolume').status, 'not-covered');
  const noStructuralEvidenceGate = evaluateOperationSchemaCoverage(noStructuralEvidence);
  assert.equal(noStructuralEvidenceGate.optionalFieldGate.denominator, 1);
  assert.equal(noStructuralEvidenceGate.optionalFieldGate.coverageRatio, 0);
  assert.equal(noStructuralEvidenceGate.passed, false);
});

test('keeps allOf and anyOf writable fields as obligations instead of assuming branch exclusion', () => {
  for (const schemaKeyword of ['allOf', 'anyOf']) {
    const composedOperation = {
      id: `create-${schemaKeyword}`,
      method: 'POST',
      requestBodyFields: [
        {
          name: `requiredBy${schemaKeyword}`,
          path: [`requiredBy${schemaKeyword}`],
          pointer: `/requiredBy${schemaKeyword}`,
          type: 'string',
          required: true,
          coverageApplicability: {
            status: 'not-applicable-with-evidence',
            reasonCode: 'mutually-exclusive-schema-branch',
            evidence: {
              schemaKeyword,
              selectedBranchPointer: `#/${schemaKeyword}/0`,
              excludedBranchPointer: `#/${schemaKeyword}/1`,
              discriminator: { path: ['kind'], value: 'first' },
            },
          },
        },
      ],
    };
    const report = buildOperationSchemaCoverage(
      [composedOperation],
      [{ operation: composedOperation, status: 201, requestBody: { kind: 'first' } }],
    );

    assert.equal(report.notApplicableWithEvidence, 0);
    assert.equal(report.entries[0].status, 'not-covered');
    assert.equal(evaluateOperationSchemaCoverage(report).failures[0].reasonCode, 'required-writable-field-not-covered');
  }
});

test('keeps a vacuous optional request denominator non-passing', () => {
  const requiredOnlyOperation = {
    id: 'create-required-only',
    method: 'POST',
    requestBodyFields: [{ name: 'name', path: ['name'], pointer: '/name', type: 'string', required: true }],
  };
  const report = buildOperationSchemaCoverage(
    [requiredOnlyOperation],
    [{ operation: requiredOnlyOperation, status: 201, requestBody: { name: 'created' } }],
  );
  const gate = evaluateOperationSchemaCoverage(report);

  assert.equal(gate.passed, true);
  assert.equal(gate.optionalFieldGate.status, 'not-applicable-with-evidence');
  assert.equal(gate.optionalFieldGate.evaluated, false);
  assert.equal(gate.optionalFieldGate.passed, null);
  assert.equal(gate.optionalFieldGate.coverageRatio, null);
  assert.equal(gate.optionalFieldGate.reasonCode, 'no-optional-writable-request-fields-declared');

  const emptyGate = evaluateOperationSchemaCoverage(buildOperationSchemaCoverage([], []));
  assert.equal(emptyGate.status, 'not-applicable-with-evidence');
  assert.equal(emptyGate.evaluated, false);
  assert.equal(emptyGate.passed, null);
});

test('rejects an optional-field coverage threshold that is not above fifty percent', () => {
  const report = buildOperationSchemaCoverage(
    [operation],
    [{ operation, status: 201, requestBody: { name: 'created' }, responseBody: { id: 'id', name: 'created' } }],
  );
  const gate = evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.5 });

  assert.equal(gate.passed, false);
  assert.equal(gate.optionalFieldGate.reasonCode, 'invalid-optional-field-coverage-minimum');
  assert.equal(gate.failures.at(-1).reasonCode, 'invalid-optional-field-coverage-minimum');
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
