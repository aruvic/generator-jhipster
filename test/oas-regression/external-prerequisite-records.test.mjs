import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExternalPrerequisites,
  externalPrerequisiteIdentityValue,
  externalPrerequisiteSelectorMatches,
  normalizeExternalPrerequisiteRecord,
  promoteExternalPrerequisiteRecords,
} from './external-prerequisite-records.mjs';

const proofEvidence = {
  protocolVersion: 'external-prerequisite-fixture/v1',
  operationId: 'getWidget',
  method: 'GET',
  pathTemplate: '/widgets/{widgetId}',
  status: 200,
  identity: [{ pointer: '/widgetId', passed: true }],
  assertions: [{ pointer: '/state', operator: 'equals', passed: true }],
};

function provenRecord(overrides = {}) {
  return {
    fixtureId: 'widget-fixture',
    resourceId: 'widget',
    identity: { widgetId: 'widget-1' },
    enabledOperations: [
      { method: 'PATCH', path: '/widgets/{widgetId}', required: true },
      { method: 'DELETE', path: '/widgets/{widgetId}', required: false },
    ],
    proof: 'passed',
    evidence: proofEvidence,
    ...overrides,
  };
}

test('matches enabled operations by exact method and path template only', () => {
  const selector = { method: 'PATCH', path: '/widgets/{widgetId}' };
  assert.equal(externalPrerequisiteSelectorMatches(selector, { method: 'PATCH', path: '/widgets/{widgetId}' }), true);
  assert.equal(externalPrerequisiteSelectorMatches(selector, { method: 'PUT', path: '/widgets/{widgetId}' }), false);
  assert.equal(externalPrerequisiteSelectorMatches(selector, { method: 'PATCH', path: '/widgets/widget-1' }), false);
  assert.equal(externalPrerequisiteSelectorMatches(selector, { method: 'PATCH', path: '/other/{widgetId}' }), false);
});

test('normalizes and promotes only independently proven records', () => {
  const failed = provenRecord({
    proof: 'failed',
    evidence: { reasonCode: 'canonical-read-identity-failed' },
  });
  const pending = provenRecord({ proof: 'pending', evidence: { providerState: 'provisioned' } });

  assert.equal(normalizeExternalPrerequisiteRecord(failed), undefined);
  assert.equal(normalizeExternalPrerequisiteRecord(pending), undefined);
  assert.throws(
    () =>
      normalizeExternalPrerequisiteRecord(
        provenRecord({
          evidence: { providerState: 'provisioned' },
        }),
      ),
    /unknown properties: providerState/,
  );

  const promoted = promoteExternalPrerequisiteRecords([failed, pending, provenRecord()], {
    method: 'PATCH',
    path: '/widgets/{widgetId}',
  });
  assert.equal(promoted.length, 1);
  assert.deepEqual(promoted[0].identity, { widgetId: 'widget-1' });
  assert.equal(promoted[0].selector.required, true);
  assert.equal(
    externalPrerequisiteIdentityValue([failed], { method: 'PATCH', path: '/widgets/{widgetId}', tag: 'Widgets' }, { name: 'widgetId' }),
    undefined,
  );
});

test('does not let a proven record unlock unrelated operations', () => {
  const records = [provenRecord()];
  assert.deepEqual(promoteExternalPrerequisiteRecords(records, { method: 'POST', path: '/widgets' }), []);
  assert.deepEqual(promoteExternalPrerequisiteRecords(records, { method: 'PATCH', path: '/widgets/widget-1' }), []);
  assert.deepEqual(promoteExternalPrerequisiteRecords(records, { method: 'PATCH', path: '/orders/{widgetId}' }), []);
});

test('resolves semantic path identity only for an exact enabled operation', () => {
  const records = [
    provenRecord({
      identity: { stableWidgetId: 'widget-1' },
    }),
  ];

  assert.equal(
    externalPrerequisiteIdentityValue(records, { method: 'PATCH', path: '/widgets/{widgetId}', tag: 'Widgets' }, { name: 'widgetId' }),
    'widget-1',
  );
  assert.equal(
    externalPrerequisiteIdentityValue(records, { method: 'PUT', path: '/widgets/{widgetId}', tag: 'Widgets' }, { name: 'widgetId' }),
    undefined,
  );
  assert.equal(
    externalPrerequisiteIdentityValue(
      [
        {
          protocolVersion: 'external-prerequisite-fixture/v1',
          fixtureId: 'widget-fixture',
          state: 'provisioned',
          resources: [{ id: 'widget', identity: { widgetId: 'provider-only' } }],
        },
      ],
      { method: 'PATCH', path: '/widgets/{widgetId}', tag: 'Widgets' },
      { name: 'widgetId' },
    ),
    undefined,
  );
});

test('classifies required and optional fixture counts without treating failures as proof', () => {
  const resources = [
    {
      fixtureId: 'widget-fixture',
      resourceId: 'widget',
      enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: true }],
    },
    {
      fixtureId: 'audit-fixture',
      resourceId: 'audit',
      enabledOperations: [{ method: 'PATCH', path: '/widgets/{widgetId}', required: false }],
    },
    {
      fixtureId: 'unrelated-fixture',
      resourceId: 'order',
      enabledOperations: [{ method: 'PATCH', path: '/orders/{orderId}', required: true }],
    },
  ];
  const records = [
    provenRecord(),
    provenRecord({
      fixtureId: 'audit-fixture',
      resourceId: 'audit',
      identity: { auditId: 'audit-1' },
      proof: 'failed',
    }),
  ];

  assert.deepEqual(
    classifyExternalPrerequisites(resources, records, {
      method: 'PATCH',
      path: '/widgets/{widgetId}',
    }),
    {
      required: { total: 1, proven: 1, missing: 0 },
      optional: { total: 1, proven: 0, missing: 1 },
      promoted: [
        {
          fixtureId: 'widget-fixture',
          resourceId: 'widget',
          identity: { widgetId: 'widget-1' },
          selector: { method: 'PATCH', path: '/widgets/{widgetId}', required: true },
          evidence: proofEvidence,
        },
      ],
    },
  );
});
