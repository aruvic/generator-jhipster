#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReferencePickerTopology } from './reference-picker-topology.mjs';

function topology(overrides = {}) {
  const value = {
    outputDirectory: './output',
    timeoutSeconds: 120,
    source: {
      name: 'source',
      directory: './source-app',
      host: '127.0.0.1',
      publicHost: 'localhost',
      port: 18081,
      healthPath: '/management/health',
      startCommand: ['./mvnw', 'spring-boot:run'],
      database: {
        host: '127.0.0.1',
        port: 15432,
        container: 'picker-source-db',
        name: 'picker_source',
        user: 'picker_source',
        image: 'postgres:18',
      },
      seed: {
        method: 'POST',
        path: '/api/source-resources',
        body: { name: 'source' },
        expectedStatuses: [201],
      },
      identityPath: 'id',
    },
    target: {
      name: 'target',
      directory: './target-app',
      host: '127.0.0.1',
      publicHost: 'localhost',
      port: 18082,
      healthPath: '/management/health',
      startCommand: ['./mvnw', 'spring-boot:run'],
      database: {
        host: '127.0.0.1',
        port: 15433,
        container: 'picker-target-db',
        name: 'picker_target',
        user: 'picker_target',
        image: 'postgres:18',
      },
      seed: {
        method: 'POST',
        path: '/api/target-resources',
        body: { name: 'target' },
        expectedStatuses: [201],
      },
      identityPath: 'id',
    },
    ui: { host: '127.0.0.1', publicHost: 'localhost', port: 14200 },
    authentication: {
      loginPath: '/login',
      path: '/api/authenticate',
      username: 'admin',
      password: 'admin',
      tokenField: 'id_token',
    },
    picker: {
      label: 'Source target relationship',
      adminPath: '/admin/reference-pickers',
      configPath: '/api/reference-pickers',
      formPathTemplate: '/form-crud/{operationId}',
      formId: 'patch-source-resource',
      sourceListOperationId: 'get-source-resources',
      sourcePath: 'relationships',
      targetApiId: '',
      collectionPath: '/target-resources',
      displayFields: ['id', 'name'],
      copyFields: [
        { source: 'id', target: 'resource.id' },
        { source: 'name', target: 'resource.name' },
      ],
      mode: 'reference',
      multiple: true,
    },
    verification: {
      targetListPath: '/api/target-resources',
      sourceListPath: '/api/source-resources',
      sourceItemPathTemplate: '/api/source-resources/{id}',
      sourceSaveMethod: 'PATCH',
      sourceSaveStatuses: [200],
      sourceGetStatuses: [200],
    },
  };
  return Object.assign(value, overrides);
}

test('normalizes a distinct two-service topology and derives its cross-service target base URL', () => {
  const normalized = normalizeReferencePickerTopology(topology(), '/work/config/topology.json');

  assert.equal(normalized.source.directory, '/work/config/source-app');
  assert.equal(normalized.source.baseUrl, 'http://localhost:18081');
  assert.equal(normalized.target.baseUrl, 'http://localhost:18082');
  assert.equal(normalized.picker.targetBaseUrl, normalized.target.baseUrl);
  assert.equal(normalized.picker.targetApiId, '');
  assert.notEqual(new URL(normalized.picker.targetBaseUrl).origin, new URL(normalized.source.baseUrl).origin);
  assert.notEqual(normalized.source.database.container, normalized.target.database.container);
  assert.notEqual(normalized.source.database.name, normalized.target.database.name);
});

test('rejects conflicting application ports', () => {
  const value = topology();
  value.target.port = value.source.port;
  assert.throws(() => normalizeReferencePickerTopology(value), /source\.port and target\.port must be distinct/);
});

test('rejects a reused application or database listener port', () => {
  const value = topology();
  value.source.database.port = value.ui.port;
  assert.throws(() => normalizeReferencePickerTopology(value), /ui\.port and source\.database\.port must be distinct/);
});

test('requires two distinct generated application directories', () => {
  const value = topology();
  value.target.directory = value.source.directory;
  assert.throws(() => normalizeReferencePickerTopology(value), /source\.directory and target\.directory must be distinct/);
});

test('rejects shared database resources', () => {
  for (const property of ['container', 'name']) {
    const value = topology();
    value.target.database[property] = value.source.database[property];
    assert.throws(() => normalizeReferencePickerTopology(value), new RegExp(`database\\.${property}.*must be distinct`));
  }
});

test('rejects a target base URL outside the target application origin', () => {
  const otherOrigin = topology();
  otherOrigin.picker.targetBaseUrl = 'http://localhost:19000';
  assert.throws(() => normalizeReferencePickerTopology(otherOrigin), /configured target application origin/);
});

test('requires an explicit mapping and source item identity route', () => {
  const noMappings = topology();
  noMappings.picker.copyFields = [];
  assert.throws(() => normalizeReferencePickerTopology(noMappings), /picker\.copyFields must be a non-empty array/);

  const noIdentityPlaceholder = topology();
  noIdentityPlaceholder.verification.sourceItemPathTemplate = '/api/source-resources/current';
  assert.throws(() => normalizeReferencePickerTopology(noIdentityPlaceholder), /must contain "\{id\}"/);

  const noTargetListPath = topology();
  delete noTargetListPath.verification.targetListPath;
  assert.throws(() => normalizeReferencePickerTopology(noTargetListPath), /verification\.targetListPath/);
});
