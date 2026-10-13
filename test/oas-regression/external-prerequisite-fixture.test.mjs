import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
  isSuccessfulExternalPrerequisiteCleanupState,
  proveExternalPrerequisiteResource,
  resolveExternalPrerequisiteProviderCommand,
  runExternalPrerequisiteProvider,
  sanitizeExternalPrerequisiteEvidence,
  validateExternalPrerequisiteProfile,
} from './external-prerequisite-fixture.mjs';
import { normalizeExternalPrerequisiteRecord } from './external-prerequisite-records.mjs';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'external-prerequisite-fixture-'));
const providersDirectory = path.join(testRoot, 'providers');
fs.mkdirSync(providersDirectory);

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

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

function fixture(provider = 'providers/provider.mjs', overrides = {}) {
  return {
    id: 'widget-fixture',
    provider: { command: [provider], configuration: {} },
    resources: [resource()],
    ...overrides,
  };
}

function profile(fixtureOverrides = {}) {
  return {
    version: 1,
    fixtures: [fixture('providers/provider.mjs', fixtureOverrides)],
  };
}

function writeProvider(name, source) {
  const providerPath = path.join(providersDirectory, name);
  fs.writeFileSync(providerPath, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return path.relative(testRoot, providerPath);
}

function providerResultSource({ protocolVersion = EXTERNAL_PREREQUISITE_PROTOCOL_VERSION, stateExpression } = {}) {
  return `
import fs from 'node:fs';
const request = JSON.parse(fs.readFileSync(3, 'utf8'));
const secrets = Object.values(request.secrets);
if (
  process.argv.slice(2).some(value => secrets.some(secret => value.includes(secret))) ||
  Object.values(process.env).some(value => secrets.some(secret => value.includes(secret)))
) {
  process.exit(9);
}
process.stdout.write(JSON.stringify({
  protocolVersion: ${JSON.stringify(protocolVersion)},
  fixtureId: request.fixtureId,
  state: ${stateExpression ?? "request.action === 'cleanup' ? 'already-absent' : 'provisioned'"},
  resources: request.resources,
}));
`;
}

function openApi(serverUrl = '/api') {
  return {
    openapi: '3.1.0',
    servers: [{ url: serverUrl }],
    paths: {
      '/widgets/{widgetId}': {
        get: {
          operationId: 'getWidget',
          parameters: [{ name: 'widgetId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Widget',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
        patch: {
          operationId: 'patchWidget',
          responses: { 204: { description: 'Updated' } },
        },
      },
    },
  };
}

test('strictly validates declarations and rejects unknown or ambiguous input', () => {
  assert.deepEqual(validateExternalPrerequisiteProfile(profile()), profile());

  const unknownProperty = profile();
  unknownProperty.fixtures[0].resources[0].fabricated = true;
  assert.throws(() => validateExternalPrerequisiteProfile(unknownProperty), /unknown properties: fabricated/);

  const missingIdentityPointer = profile();
  missingIdentityPointer.fixtures[0].resources[0].canonicalRead.pathParameters.widgetId = '/missing';
  assert.throws(() => validateExternalPrerequisiteProfile(missingIdentityPointer), /must point to a scalar identity value/);

  const duplicateResource = profile({
    resources: [resource(), resource()],
  });
  assert.throws(() => validateExternalPrerequisiteProfile(duplicateResource), /duplicate ids/);

  const duplicateSelector = profile({
    resources: [
      resource({
        enabledOperations: [
          { method: 'PATCH', path: '/widgets/{widgetId}' },
          { method: 'PATCH', path: '/widgets/{widgetId}', required: false },
        ],
      }),
    ],
  });
  assert.throws(() => validateExternalPrerequisiteProfile(duplicateSelector), /ambiguous duplicates/);

  const malformedSelector = profile();
  malformedSelector.fixtures[0].resources[0].enabledOperations[0].required = 'sometimes';
  assert.throws(() => validateExternalPrerequisiteProfile(malformedSelector), /required must be boolean/);

  const duplicateFixtures = profile();
  duplicateFixtures.fixtures.push(structuredClone(duplicateFixtures.fixtures[0]));
  assert.throws(() => validateExternalPrerequisiteProfile(duplicateFixtures), /duplicate ids/);
});

test('rejects provider traversal and symlinks that resolve outside the repository root', () => {
  assert.throws(
    () => resolveExternalPrerequisiteProviderCommand(testRoot, ['../outside-provider.mjs']),
    /bounded repository-safe literal argument/,
  );

  const outsideProvider = path.join(os.tmpdir(), `outside-provider-${process.pid}.mjs`);
  fs.writeFileSync(outsideProvider, '#!/usr/bin/env node\n', { mode: 0o700 });
  const symlink = path.join(providersDirectory, 'outside-link.mjs');
  fs.symlinkSync(outsideProvider, symlink);
  try {
    assert.throws(
      () => resolveExternalPrerequisiteProviderCommand(testRoot, [path.relative(testRoot, symlink)]),
      /outside the repository root/,
    );
  } finally {
    fs.rmSync(outsideProvider, { force: true });
  }
});

test('uses literal argv without a shell and sends secrets only over the protocol pipe', async () => {
  const provider = writeProvider('provider ; touch shell-expanded.mjs', providerResultSource());
  const declaredFixture = fixture(provider);
  const result = await runExternalPrerequisiteProvider({
    repositoryRoot: testRoot,
    fixture: declaredFixture,
    secrets: { apiKey: 'pipe-only-secret-value' },
  });

  assert.equal(result.state, 'provisioned');
  assert.equal(Object.hasOwn(result, 'proof'), false);
  assert.equal(normalizeExternalPrerequisiteRecord(result), undefined);
  assert.deepEqual(result.resources, [{ id: 'widget', identity: { widgetId: 'widget-1' } }]);
});

test('rejects timeout, malformed, oversized, unknown-version, and undeclared provider output', async t => {
  await t.test('timeout', async () => {
    const provider = writeProvider(
      'timeout.mjs',
      `
import fs from 'node:fs';
fs.readFileSync(3, 'utf8');
setTimeout(() => {}, 10_000);
`,
    );
    await assert.rejects(
      runExternalPrerequisiteProvider({
        repositoryRoot: testRoot,
        fixture: fixture(provider),
        timeoutMs: 20,
      }),
      error => error.code === 'provider-timeout',
    );
  });

  await t.test('malformed JSON', async () => {
    const provider = writeProvider('malformed.mjs', "process.stdout.write('not-json');\n");
    await assert.rejects(
      runExternalPrerequisiteProvider({ repositoryRoot: testRoot, fixture: fixture(provider) }),
      error => error.code === 'provider-result-malformed',
    );
  });

  await t.test('oversized stdout', async () => {
    const provider = writeProvider('oversized.mjs', "process.stdout.write('x'.repeat(4096));\n");
    await assert.rejects(
      runExternalPrerequisiteProvider({
        repositoryRoot: testRoot,
        fixture: fixture(provider),
        maxOutputBytes: 1024,
      }),
      error => error.code === 'provider-stdout-too-large',
    );
  });

  await t.test('unknown protocol version', async () => {
    const provider = writeProvider('unknown-version.mjs', providerResultSource({ protocolVersion: 'external-prerequisite-fixture/v99' }));
    await assert.rejects(
      runExternalPrerequisiteProvider({ repositoryRoot: testRoot, fixture: fixture(provider) }),
      error => error.code === 'provider-protocol-version-mismatch',
    );
  });

  await t.test('undeclared resource', async () => {
    const provider = writeProvider(
      'unknown-resource.mjs',
      `
import fs from 'node:fs';
const request = JSON.parse(fs.readFileSync(3, 'utf8'));
process.stdout.write(JSON.stringify({
  protocolVersion: ${JSON.stringify(EXTERNAL_PREREQUISITE_PROTOCOL_VERSION)},
  fixtureId: request.fixtureId,
  state: 'provisioned',
  resources: [{ id: 'undeclared', identity: { widgetId: 'widget-1' } }],
}));
`,
    );
    await assert.rejects(
      runExternalPrerequisiteProvider({ repositoryRoot: testRoot, fixture: fixture(provider) }),
      error => error.code === 'provider-resource-set-mismatch',
    );
  });
});

test('redacts diagnostics and never reflects provider stderr secrets', async () => {
  const secret = 'stderr-secret-value';
  const provider = writeProvider(
    'stderr-secret.mjs',
    `
process.stderr.write('Bearer ${secret} at https://user:password@example.invalid/private');
process.exitCode = 1;
`,
  );

  await assert.rejects(
    runExternalPrerequisiteProvider({
      repositoryRoot: testRoot,
      fixture: fixture(provider),
      secrets: { token: secret },
    }),
    error => {
      const serialized = JSON.stringify({ message: error.message, evidence: error.evidence });
      assert.equal(serialized.includes(secret), false);
      assert.equal(serialized.includes('example.invalid'), false);
      return error.code === 'provider-exit-failed';
    },
  );

  const redacted = sanitizeExternalPrerequisiteEvidence(
    {
      authorization: `Bearer ${secret}`,
      detail: `request https://user:password@example.invalid/private used ${secret}`,
    },
    [secret],
  );
  assert.deepEqual(redacted, {
    authorization: '[REDACTED]',
    detail: 'request [REDACTED] used [REDACTED]',
  });
});

test('accepts cleaned and already-absent as cleanup-only success states', async () => {
  const priorResult = {
    protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
    fixtureId: 'widget-fixture',
    state: 'provisioned',
    resources: [{ id: 'widget', identity: { widgetId: 'widget-1' } }],
  };
  const alreadyAbsentProvider = writeProvider('already-absent.mjs', providerResultSource());
  const alreadyAbsent = await runExternalPrerequisiteProvider({
    repositoryRoot: testRoot,
    fixture: fixture(alreadyAbsentProvider),
    action: 'cleanup',
    priorResult,
    secrets: { password: 'cleanup-secret' },
  });
  assert.equal(alreadyAbsent.state, 'already-absent');
  assert.equal(isSuccessfulExternalPrerequisiteCleanupState(alreadyAbsent.state), true);

  const cleanedProvider = writeProvider(
    'cleaned.mjs',
    providerResultSource({ stateExpression: "request.action === 'cleanup' ? 'cleaned' : 'provisioned'" }),
  );
  const cleaned = await runExternalPrerequisiteProvider({
    repositoryRoot: testRoot,
    fixture: fixture(cleanedProvider),
    action: 'cleanup',
    priorResult,
    secrets: { password: 'cleanup-secret' },
  });
  assert.equal(cleaned.state, 'cleaned');
  assert.equal(isSuccessfulExternalPrerequisiteCleanupState(cleaned.state), true);
  assert.equal(isSuccessfulExternalPrerequisiteCleanupState('provisioned'), false);
});

test('proves identity and state with an authenticated same-origin canonical GET', async () => {
  let observed;
  const proof = await proveExternalPrerequisiteResource({
    fixtureId: 'widget-fixture',
    resource: resource(),
    openApi: openApi(),
    baseUrl: 'https://app.example/base',
    authentication: { headers: { authorization: 'Bearer canonical-proof-secret' } },
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return new Response(JSON.stringify({ widgetId: 'widget-1', state: 'READY' }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    },
  });

  assert.equal(observed.url, 'https://app.example/api/widgets/widget-1');
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.redirect, 'manual');
  assert.equal(observed.options.headers.authorization, 'Bearer canonical-proof-secret');
  assert.equal(proof.proof, 'passed');
  assert.deepEqual(proof.identity, { widgetId: 'widget-1' });
  const serializedEvidence = JSON.stringify(proof.evidence);
  assert.equal(serializedEvidence.includes('canonical-proof-secret'), false);
  assert.equal(serializedEvidence.includes('https://'), false);
});

test('treats same-origin, status, JSON, identity, and assertion failures as non-success', async t => {
  const proof = options =>
    proveExternalPrerequisiteResource({
      fixtureId: 'widget-fixture',
      resource: resource(),
      openApi: openApi(),
      baseUrl: 'https://app.example',
      ...options,
    });

  await t.test('cross-origin OAS server', async () => {
    const result = await proof({
      openApi: openApi('https://other.example/api'),
      fetchImpl: async () => assert.fail('cross-origin proof must not issue a request'),
    });
    assert.equal(result.proof, 'failed');
    assert.equal(result.evidence.reasonCode, 'canonical-read-resolution-failed');
  });

  await t.test('unexpected status', async () => {
    const result = await proof({
      fetchImpl: async () =>
        new Response(JSON.stringify({ widgetId: 'widget-1', state: 'READY' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    });
    assert.equal(result.proof, 'failed');
    assert.equal(result.evidence.reasonCode, 'canonical-read-status-failed');
  });

  await t.test('non-JSON response', async () => {
    const result = await proof({
      fetchImpl: async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    });
    assert.equal(result.proof, 'failed');
    assert.equal(result.evidence.reasonCode, 'canonical-read-content-type-failed');
  });

  await t.test('identity mismatch', async () => {
    const result = await proof({
      fetchImpl: async () =>
        new Response(JSON.stringify({ widgetId: 'other-widget', state: 'READY' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    assert.equal(result.proof, 'failed');
    assert.equal(result.evidence.reasonCode, 'canonical-read-identity-failed');
  });

  await t.test('state assertion mismatch', async () => {
    const result = await proof({
      fetchImpl: async () =>
        new Response(JSON.stringify({ widgetId: 'widget-1', state: 'PENDING' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    assert.equal(result.proof, 'failed');
    assert.equal(result.evidence.reasonCode, 'canonical-read-assertion-failed');
  });
});
