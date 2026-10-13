import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  cleanupExternalPrerequisites,
  prepareExternalPrerequisites,
  selectExternalPrerequisiteFixtures,
} from './external-prerequisite-runtime.mjs';

const proofEvidence = {
  protocolVersion: 'external-prerequisite-fixture/v1',
  operationId: 'getWidget',
  method: 'GET',
  pathTemplate: '/widgets/{widgetId}',
  status: 200,
  identity: [{ pointer: '/widgetId', passed: true }],
  assertions: [{ pointer: '/state', operator: 'equals', passed: true }],
};

function resource(overrides = {}) {
  return {
    id: 'widget',
    identity: { widgetId: 'widget-1' },
    canonicalRead: {
      operationId: 'getWidget',
      pathParameters: { widgetId: '/widgetId' },
      expectedStatuses: [200],
      assertions: [{ pointer: '/state', operator: 'equals', value: 'READY' }],
    },
    enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: true }],
    ...overrides,
  };
}

function profile(resources = [resource()]) {
  return {
    version: 1,
    fixtures: [{ id: 'widget-fixture', provider: { command: ['providers/provider.mjs'], configuration: {} }, resources }],
  };
}

function openApi(methods = ['get', 'patch']) {
  return {
    openapi: '3.1.0',
    paths: {
      '/widgets/{widgetId}': Object.fromEntries(
        methods.map(method => [
          method,
          {
            operationId: method === 'get' ? 'getWidget' : `${method}Widget`,
            responses: { 200: { description: 'ok' } },
          },
        ]),
      ),
    },
  };
}

function testFiles(t, declaredProfile = profile()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'external-prerequisite-runtime-'));
  const profileFile = path.join(directory, 'profile.json');
  const outputDirectory = path.join(directory, 'evidence');
  fs.writeFileSync(profileFile, `${JSON.stringify(declaredProfile)}\n`);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, profileFile, outputDirectory };
}

function passedProof(overrides = {}) {
  return {
    fixtureId: 'widget-fixture',
    resourceId: 'widget',
    identity: { widgetId: 'widget-1' },
    enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: true }],
    proof: 'passed',
    evidence: proofEvidence,
    ...overrides,
  };
}

test('selects only resources and selectors declared by exact OAS method and path', () => {
  const selection = selectExternalPrerequisiteFixtures(
    profile([
      resource({
        enabledOperations: [
          { method: 'PATCH', path: '/widgets/{widgetId}', required: true },
          { method: 'DELETE', path: '/widgets/{widgetId}', required: false },
        ],
      }),
      resource({
        id: 'unrelated',
        identity: { widgetId: 'other' },
        enabledOperations: [{ method: 'PATCH', path: '/orders/{widgetId}', required: true }],
      }),
    ]),
    openApi(),
  );

  assert.equal(selection.fixtures.length, 1);
  assert.deepEqual(selection.fixtures[0].requiredResourceIds, ['widget']);
  assert.deepEqual(selection.fixtures[0].optionalResourceIds, []);
  assert.deepEqual(selection.fixtures[0].fixture.resources, [
    resource({
      enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: true }],
    }),
  ]);
});

test('preserves no-declaration behavior without provisioning or proof', async t => {
  const { directory, outputDirectory } = testFiles(t);
  let providerCalled = false;
  const result = await prepareExternalPrerequisites({
    profileFile: path.join(directory, 'missing-profile.json'),
    repositoryRoot: directory,
    outputDirectory,
    baseUrl: 'https://app.example/api',
    runProvider: async () => {
      providerCalled = true;
    },
    proveFixture: async () => assert.fail('proof must not run'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status.status, 'not-declared');
  assert.equal(result.status.enterpriseGate.status, 'passed');
  assert.deepEqual(result.status.operationReport.counts, {
    declared: 0,
    required: 0,
    eligible: 0,
    blockedPrerequisite: 0,
    disabledOptional: 0,
  });
  assert.equal(providerCalled, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'verified-resources.json'), 'utf8')), []);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(outputDirectory, 'operation-results.json'), 'utf8')),
    result.status.operationReport,
  );
});

test('persists only complete canonical proof as verified resources', async t => {
  const { directory, profileFile, outputDirectory } = testFiles(t);
  const phases = [];
  const result = await prepareExternalPrerequisites({
    profileFile,
    openApi: openApi(),
    repositoryRoot: directory,
    outputDirectory,
    baseUrl: 'https://app.example/api',
    authentication: { headers: { authorization: 'Bearer test-token' } },
    runProvider: async ({ action }) => {
      phases.push(action);
      return {
        protocolVersion: 'external-prerequisite-fixture/v1',
        fixtureId: 'widget-fixture',
        state: 'provisioned',
        resources: [{ id: 'widget', identity: { widgetId: 'widget-1' } }],
      };
    },
    proveFixture: async ({ authentication }) => {
      phases.push(authentication.headers.authorization);
      return [passedProof()];
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(phases, ['provision', 'Bearer test-token']);
  assert.deepEqual(result.status.counts, {
    declared: 1,
    required: 1,
    proven: 1,
    failed: 0,
    cleanupFailed: 0,
    disabledOptional: 0,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'verified-resources.json'), 'utf8')), [passedProof()]);
  assert.equal(
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'selected-fixtures.json'), 'utf8'))).includes('priorResult'),
    false,
  );
});

test('never promotes provider assertions and disables optional proof failures', async t => {
  const optionalProfile = profile([
    resource({
      enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: false }],
    }),
  ]);
  const { directory, profileFile, outputDirectory } = testFiles(t, optionalProfile);
  const secretsFile = path.join(directory, 'secrets.json');
  fs.writeFileSync(secretsFile, '{"token":"provider-secret"}\n');

  const result = await prepareExternalPrerequisites({
    profileFile,
    openApi: openApi(),
    repositoryRoot: directory,
    outputDirectory,
    baseUrl: 'https://app.example/api',
    secretsFile,
    runProvider: async () => {
      throw new Error('provider claimed proof with provider-secret');
    },
    proveFixture: async () => assert.fail('proof must not run after provisioning fails'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status.counts.proven, 0);
  assert.equal(result.status.counts.failed, 0);
  assert.equal(result.status.counts.disabledOptional, 1);
  assert.equal(result.status.operationReport.counts.disabledOptional, 1);
  assert.equal(result.status.operationReport.denominators.applicable, 0);
  assert.equal(result.status.operationReport.denominators.excludedDisabledOptional, 1);
  assert.equal(result.status.operationReport.enterpriseGate.status, 'passed');
  assert.equal(result.status.operationReport.results['disabled-optional'][0].reasonCode, 'optional-external-prerequisite-unproven');
  assert.match(result.status.operationReport.results['disabled-optional'][0].evidencePaths[0], /proof-results\.json#\/0$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDirectory, 'verified-resources.json'), 'utf8')), []);
  assert.equal(fs.readFileSync(path.join(outputDirectory, 'provision-results.json'), 'utf8').includes('provider-secret'), false);
});

test('counts unavailable provider secrets as a required provisioning failure', async t => {
  const { directory, profileFile, outputDirectory } = testFiles(t);
  const result = await prepareExternalPrerequisites({
    profileFile,
    openApi: openApi(),
    repositoryRoot: directory,
    outputDirectory,
    baseUrl: 'https://app.example/api',
    secretsFile: path.join(directory, 'missing-secrets.json'),
    runProvider: async () => assert.fail('provider must not run without configured secrets'),
    proveFixture: async () => assert.fail('proof must not run without provisioning'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status.counts.failed, 1);
  assert.equal(result.status.counts.proven, 0);
});

test('fails required incomplete proof and any cleanup failure', async t => {
  const { directory, profileFile, outputDirectory } = testFiles(t);
  const providerResult = {
    protocolVersion: 'external-prerequisite-fixture/v1',
    fixtureId: 'widget-fixture',
    state: 'provisioned',
    resources: [{ id: 'widget', identity: { widgetId: 'widget-1' } }],
  };
  const prepared = await prepareExternalPrerequisites({
    profileFile,
    openApi: openApi(),
    repositoryRoot: directory,
    outputDirectory,
    baseUrl: 'https://app.example/api',
    runProvider: async () => ({ ...providerResult, proof: 'passed' }),
    proveFixture: async () => [providerResult],
  });

  assert.equal(prepared.ok, false);
  assert.equal(prepared.status.counts.failed, 1);
  assert.equal(prepared.status.counts.proven, 0);
  assert.equal(prepared.status.enterpriseGate.status, 'failed');
  assert.equal(prepared.status.operationReport.counts.blockedPrerequisite, 1);
  assert.equal(prepared.status.operationReport.denominators.applicable, 1);
  assert.equal(prepared.status.operationReport.denominators.executionEligible, 0);
  assert.equal(prepared.status.operationReport.results['blocked-prerequisite'][0].reasonCode, 'required-external-prerequisite-unproven');
  assert.match(prepared.status.operationReport.results['blocked-prerequisite'][0].evidencePaths[0], /proof-results\.json#\/0$/);

  const cleaned = await cleanupExternalPrerequisites({
    repositoryRoot: directory,
    outputDirectory,
    runProvider: async () => {
      throw Object.assign(new Error('cleanup failed'), { code: 'provider-exit-failed' });
    },
  });
  assert.equal(cleaned.ok, false);
  assert.equal(cleaned.status.gate, 'failed');
  assert.equal(cleaned.status.counts.cleanupFailed, 1);
  assert.equal(cleaned.status.fixtures[0].cleanup, 'failed');
});
