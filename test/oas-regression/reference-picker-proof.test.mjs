#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReferencePickerProofReport, summarizeReferencePickerProofReports } from './reference-picker-proof.mjs';

function fixture() {
  const picker = {
    label: 'Configured relationship',
    formId: 'patch-source-resource',
    configPath: '/api/reference-pickers',
    targetApiId: '',
    sourcePath: 'relationships',
    targetBaseUrl: 'http://localhost:18082',
    collectionPath: '/api/target-resources',
    displayFields: ['id', 'name'],
    copyFields: [
      { source: 'id', target: 'party.id' },
      { source: '@type', target: 'party.@referredType' },
      { source: 'relationshipType', target: '@type' },
      { source: 'relationshipRole', target: 'role' },
    ],
    mode: 'reference',
    multiple: true,
  };
  const topology = {
    source: {
      name: 'source-service',
      directory: '/work/source-app',
      baseUrl: 'http://localhost:18081',
      port: 18081,
      database: { host: '127.0.0.1', port: 15432, container: 'source-db', name: 'source_database' },
    },
    target: {
      name: 'target-service',
      directory: '/work/target-app',
      baseUrl: 'http://localhost:18082',
      port: 18082,
      database: { host: '127.0.0.1', port: 15433, container: 'target-db', name: 'target_database' },
    },
    ui: { baseUrl: 'http://localhost:14200', port: 14200 },
    configurationService: {
      name: 'picker-configuration-service',
      baseUrl: 'http://localhost:18085',
      port: 18085,
      collectionPath: '/api/reference-pickers',
    },
    picker,
  };
  const preconditions = {
    generatedApplicationCount: 2,
    source: { databaseContainerId: 'source-container-id', database: 'source_database' },
    target: { databaseContainerId: 'target-container-id', database: 'target_database' },
  };
  const workflow = {
    configuration: {
      save: {
        method: 'PUT',
        url: 'http://localhost:14200/api/reference-pickers',
        status: 200,
        authenticated: true,
        transport: {
          kind: 'ui-same-origin-proxy',
          baseUrl: 'http://localhost:14200',
          port: 14200,
        },
        compatibilityService: {
          name: 'source-service',
          port: 18081,
          url: 'http://localhost:18081/api/reference-pickers',
        },
        response: { id: 'picker-1', ...picker },
      },
      externalReadback: {
        method: 'GET',
        url: 'http://localhost:18085/api/reference-pickers',
        status: 200,
        authenticated: false,
        directService: true,
        service: { name: 'picker-configuration-service', port: 18085 },
        matchedConfiguration: { pickerId: 'picker-1', ...picker },
      },
      sourceReadback: {
        method: 'GET',
        url: 'http://localhost:18081/api/reference-pickers',
        status: 200,
        authenticated: true,
        directService: true,
        service: { name: 'source-service', port: 18081 },
        matchedConfiguration: { id: 'picker-1', ...picker },
      },
      identityMapping: { sourceId: 'picker-1', externalPickerId: 'picker-1', sourceReadbackId: 'picker-1' },
    },
    targetRequest: {
      method: 'GET',
      url: 'http://localhost:18082/api/target-resources',
      status: 200,
      authenticated: true,
      service: { name: 'target-service', port: 18082 },
      selectedIdentity: 'target-1',
      selectedIdentityFound: true,
      responseEvidence: [{ id: 'target-1' }],
    },
    sourceRequest: {
      method: 'PATCH',
      url: 'http://localhost:14200/api/source-resources/source-1',
      status: 200,
      authenticated: true,
      selectionMapped: true,
      service: { name: 'source-service', port: 18081 },
      reference: { party: { id: 'target-1' } },
    },
    sourceGet: {
      method: 'GET',
      url: 'http://localhost:18081/api/source-resources/source-1',
      status: 200,
      authenticated: true,
      directService: true,
      selectionPersisted: true,
      service: { name: 'source-service', port: 18081 },
      stableReference: { party: { id: 'target-1' } },
    },
  };
  return { topology, preconditions, workflow };
}

function failedReason(mutator) {
  const value = fixture();
  mutator(value);
  return buildReferencePickerProofReport(value);
}

test('builds an auditable passing report with separately labeled proof counts and gates', () => {
  const report = buildReferencePickerProofReport(fixture());

  assert.equal(report.status, 'passed', JSON.stringify(report.reasonCodes));
  assert.equal(report.topology.generatedApplicationCount, 2);
  assert.equal(report.topology.source.database.actualContainerId, 'source-container-id');
  assert.equal(report.topology.target.api.port, 18082);
  assert.equal(report.operations.configurationSave.url, 'http://localhost:14200/api/reference-pickers');
  assert.equal(report.operations.configurationExternalReadback.url, 'http://localhost:18085/api/reference-pickers');
  assert.equal(report.operations.configurationSourceReadback.url, 'http://localhost:18081/api/reference-pickers');
  assert.deepEqual(report.operations.configurationIdentityMapping, {
    sourceId: 'picker-1',
    externalPickerId: 'picker-1',
    sourceReadbackId: 'picker-1',
  });
  assert.equal(report.operations.targetFetch.authenticated, true);
  assert.deepEqual(report.counts, {
    requiredGates: 8,
    passedGates: 8,
    failedGates: 0,
    generatedApplications: 2,
    configurationPersistenceProofs: 1,
    independentAuthenticatedTargetFetches: 1,
    capturedSourcePatches: 1,
    persistedSourceSelections: 1,
  });
  assert.deepEqual(report.reasonCodes, []);
});

test('fails same-origin and same-service topologies', () => {
  const sameOrigin = failedReason(({ topology }) => {
    topology.target.baseUrl = topology.source.baseUrl;
    topology.target.port = topology.source.port;
    topology.picker.targetBaseUrl = topology.source.baseUrl;
  });
  assert.ok(sameOrigin.reasonCodes.includes('topology-source-target-origin-reused'));
  assert.ok(sameOrigin.reasonCodes.includes('topology-picker-target-not-cross-service'));

  const sameService = failedReason(({ topology }) => {
    topology.target.name = topology.source.name;
  });
  assert.ok(sameService.reasonCodes.includes('topology-service-identity-reused'));
});

test('fails application/UI/database port collisions', () => {
  const report = failedReason(({ topology }) => {
    topology.ui.port = topology.target.port;
  });

  assert.ok(report.reasonCodes.includes('topology-listener-port-collision'));
});

test('fails every non-isolated database identity', () => {
  const mutations = [
    value => {
      value.topology.target.database.container = value.topology.source.database.container;
    },
    value => {
      value.topology.target.database.name = value.topology.source.database.name;
    },
    value => {
      value.topology.target.database.host = value.topology.source.database.host;
      value.topology.target.database.port = value.topology.source.database.port;
    },
    value => {
      value.preconditions.target.databaseContainerId = value.preconditions.source.databaseContainerId;
    },
    value => {
      value.preconditions.target.database = value.preconditions.source.database;
    },
  ];

  for (const mutate of mutations) {
    const report = failedReason(mutate);
    assert.equal(report.gates.isolatedDatabases.status, 'failed');
  }
});

test('fails missing configuration save and external persistence evidence', () => {
  const missingSave = failedReason(({ workflow }) => {
    workflow.configuration.save = undefined;
  });
  assert.ok(missingSave.reasonCodes.includes('evidence-configuration-save-response-missing'));

  const missingExternalReadback = failedReason(({ workflow }) => {
    workflow.configuration.externalReadback = undefined;
  });
  assert.ok(missingExternalReadback.reasonCodes.includes('evidence-external-configuration-persistence-missing'));
  assert.ok(missingExternalReadback.reasonCodes.includes('evidence-external-configuration-persistence-mismatch'));
  assert.equal(missingExternalReadback.gates.configurationPersistence.status, 'failed');
});

test('fails mislabeled external evidence, missing source compatibility readback, and identity mapping drift', () => {
  const mislabeledExternal = failedReason(({ topology, workflow }) => {
    workflow.configuration.externalReadback.url = `${topology.source.baseUrl}/api/reference-pickers`;
    workflow.configuration.externalReadback.service = { name: topology.source.name, port: topology.source.port };
  });
  assert.ok(mislabeledExternal.reasonCodes.includes('evidence-external-configuration-persistence-missing'));

  const missingSourceReadback = failedReason(({ workflow }) => {
    workflow.configuration.sourceReadback = undefined;
  });
  assert.ok(missingSourceReadback.reasonCodes.includes('evidence-source-compatibility-readback-missing'));
  assert.ok(missingSourceReadback.reasonCodes.includes('evidence-source-compatibility-readback-mismatch'));

  const identityDrift = failedReason(({ workflow }) => {
    workflow.configuration.identityMapping.externalPickerId = 'different-picker';
  });
  assert.ok(identityDrift.reasonCodes.includes('evidence-configuration-identity-mapping-mismatch'));
});

test('fails a same-origin or unauthenticated target fetch and missing response selection', () => {
  const sameOrigin = failedReason(({ topology, workflow }) => {
    workflow.targetRequest.url = `${topology.source.baseUrl}/api/target-resources`;
    workflow.targetRequest.service = { name: topology.source.name, port: topology.source.port };
  });
  assert.ok(sameOrigin.reasonCodes.includes('evidence-target-fetch-not-independent-service'));

  const unauthenticated = failedReason(({ workflow }) => {
    workflow.targetRequest.authenticated = false;
    workflow.targetRequest.selectedIdentityFound = false;
  });
  assert.ok(unauthenticated.reasonCodes.includes('evidence-target-fetch-not-authenticated'));
  assert.ok(unauthenticated.reasonCodes.includes('evidence-target-response-selection-missing'));
});

test('fails when the selected source PATCH is absent or lacks mapped selection evidence', () => {
  const missing = failedReason(({ workflow }) => {
    workflow.sourceRequest = {};
  });
  assert.ok(missing.reasonCodes.includes('evidence-source-patch-missing'));

  const unmapped = failedReason(({ workflow }) => {
    workflow.sourceRequest.selectionMapped = false;
  });
  assert.ok(unmapped.reasonCodes.includes('evidence-source-patch-selection-missing'));
});

test('fails when independent authenticated source GET readback does not prove persistence', () => {
  const notIndependent = failedReason(({ workflow }) => {
    workflow.sourceGet.directService = false;
    workflow.sourceGet.authenticated = false;
  });
  assert.ok(notIndependent.reasonCodes.includes('evidence-source-readback-not-independent-authenticated'));

  const notPersisted = failedReason(({ workflow }) => {
    workflow.sourceGet.selectionPersisted = false;
  });
  assert.ok(notPersisted.reasonCodes.includes('evidence-source-readback-selection-not-persisted'));
});

test('summarizes proof gates separately and fails a required missing proof', () => {
  const passing = buildReferencePickerProofReport(fixture());
  const failing = failedReason(({ workflow }) => {
    workflow.targetRequest.authenticated = false;
  });
  const summary = summarizeReferencePickerProofReports([passing, failing], { required: true });

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.counts, {
    configured: 2,
    passed: 1,
    failed: 1,
    requiredGates: 16,
    passedGates: 15,
    failedGates: 1,
    configurationPersistenceProofs: 2,
    independentAuthenticatedTargetFetches: 1,
    capturedSourcePatches: 2,
    persistedSourceSelections: 2,
  });
  assert.deepEqual(summary.gateCounts.independentAuthenticatedTargetFetch, { passed: 1, failed: 1 });

  const missing = summarizeReferencePickerProofReports([], { required: true });
  assert.equal(missing.status, 'failed');
  assert.equal(missing.counts.failedGates, 1);
  assert.deepEqual(missing.enterpriseGate.reasonCodes, ['reference-picker-cross-service-proof-required-but-missing']);
});
