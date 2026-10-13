import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyEventCandidateRead, correlatedEventIdentityCandidate } from './form-crud-event-identity.mjs';
import { identityRecordsForResolution } from './form-crud-gui-identity.mjs';
import { persistenceReadPathResolution } from './form-crud-persistence.mjs';
import { isConfirmedResourceStateRecord } from './operation-payload.mjs';

function pathParameter(name) {
  return { name, location: 'path', required: true };
}

const shippingInstructionsRead = {
  id: 'get-shipping-instructions',
  operationId: 'getShippingInstructions',
  method: 'GET',
  path: '/v3/shipping-instructions/{documentReference}',
  tag: 'Shipping Instructions',
  parameters: [pathParameter('documentReference')],
};
const transportDocumentRead = {
  id: 'get-transport-document',
  operationId: 'getTransportDocument',
  method: 'GET',
  path: '/v3/transport-documents/{transportDocumentReference}',
  tag: 'Transport Document',
  parameters: [pathParameter('transportDocumentReference')],
};
const transportDocumentPatch = {
  id: 'patch-transport-document',
  operationId: 'patchTransportDocument',
  method: 'PATCH',
  path: transportDocumentRead.path,
  tag: transportDocumentRead.tag,
  parameters: transportDocumentRead.parameters,
};
const declaredOperations = [shippingInstructionsRead, transportDocumentRead, transportDocumentPatch];

function predecessorRecord(source = 'api-operations') {
  return {
    source,
    status: 202,
    persistenceVerified: true,
    operation: {
      id: 'post-shipping-instructions',
      method: 'POST',
      path: '/v3/shipping-instructions',
      tag: 'Shipping Instructions',
    },
    persistedResponseBody: {
      shippingInstructionsReference: 'SI-001',
      shippingInstructionsStatus: 'RECEIVED',
    },
  };
}

function notificationRecord(overrides = {}) {
  return {
    source: 'api-operations',
    status: 204,
    operation: {
      id: 'post-transport-document-notifications',
      operationId: 'transportDocumentNotification',
      method: 'POST',
      path: '/v3/transport-document-notifications',
      tag: 'Notifications',
    },
    requestBody: {
      shippingInstructionsReference: 'SI-001',
      transportDocumentReference: 'TD-001',
      transportDocumentStatus: 'DRAFT',
    },
    ...overrides,
  };
}

test('discovers a cross-tag event identity candidate only through a correlated predecessor', () => {
  const event = notificationRecord();
  const candidate = correlatedEventIdentityCandidate(transportDocumentRead, [predecessorRecord(), event], declaredOperations);

  assert.equal(isConfirmedResourceStateRecord(event), false);
  assert.equal(candidate.readOperation, transportDocumentRead);
  assert.equal(candidate.path, '/v3/transport-documents/TD-001');
  assert.deepEqual(candidate.resolutions, [
    {
      parameter: 'transportDocumentReference',
      value: 'TD-001',
      source: 'event-request-semantic-candidate',
    },
  ]);
  assert.equal(candidate.evidence.predecessor.value, 'SI-001');
});

test('keeps persistence-verified event records out of ordinary identity resolution', () => {
  const event = notificationRecord({
    persistenceVerified: true,
    createdByApiOperations: true,
    persistedResponseBody: {
      transportDocumentReference: 'TD-001',
      transportDocumentStatus: 'DRAFT',
    },
  });

  assert.equal(isConfirmedResourceStateRecord(event), false);
  assert.deepEqual(identityRecordsForResolution(transportDocumentPatch, [event], { createdByApiOperations: true }), []);
});

test('keeps a 204 event followed by canonical 404 externally preconditioned and blocks mutation', () => {
  const candidate = correlatedEventIdentityCandidate(
    transportDocumentPatch,
    [predecessorRecord(), notificationRecord()],
    declaredOperations,
  );
  const outcome = classifyEventCandidateRead(candidate, {
    status: 404,
    url: 'http://localhost/api/v3/transport-documents/TD-001',
    headers: { 'content-type': 'application/problem+json' },
    body: { title: 'Resource not found' },
  });

  assert.equal(outcome.usable, false);
  assert.equal(outcome.blocksDependentMutation, true);
  assert.equal(outcome.classification, 'externally-preconditioned');
  assert.equal(outcome.reasonCode, 'event-did-not-materialize-resource');
  assert.equal(outcome.evidence.canonicalRead.status, 404);
  assert.equal(outcome.evidence.canonicalRead.url, 'http://localhost/api/v3/transport-documents/TD-001');
  assert.equal(outcome.resourceRecord, undefined);
});

test('requires a verified canonical GET before promoting an event identity candidate', () => {
  const event = notificationRecord({ persistenceVerified: true, createdByApiOperations: true });
  const candidate = correlatedEventIdentityCandidate(transportDocumentPatch, [predecessorRecord(), event], declaredOperations);

  assert.equal(isConfirmedResourceStateRecord(event), false);
  assert.deepEqual(identityRecordsForResolution(transportDocumentPatch, [event], { createdByApiOperations: true }), []);
  assert.equal(candidate.resourceRecord, undefined);

  const outcome = classifyEventCandidateRead(candidate, {
    status: 200,
    url: 'http://localhost/api/v3/transport-documents/TD-001',
    headers: { etag: '"version-1"' },
    body: {
      transportDocumentReference: 'TD-001',
      transportDocumentStatus: 'DRAFT',
    },
  });

  assert.equal(outcome.usable, true);
  assert.equal(outcome.blocksDependentMutation, false);
  assert.equal(isConfirmedResourceStateRecord(outcome.resourceRecord), true);
  const records = identityRecordsForResolution(transportDocumentPatch, [outcome.resourceRecord], {
    createdByApiOperations: true,
  });
  assert.deepEqual(persistenceReadPathResolution(transportDocumentPatch, transportDocumentPatch.parameters[0], records), {
    value: 'TD-001',
    source: 'verified-persistence-read-path',
  });
});

test('does not leak a cross-event identity without same-source semantic predecessor correlation', () => {
  const unrelatedEvent = notificationRecord({
    requestBody: {
      shippingInstructionsReference: 'SI-OTHER',
      transportDocumentReference: 'TD-LEAK',
    },
  });

  assert.equal(
    correlatedEventIdentityCandidate(transportDocumentRead, [predecessorRecord(), unrelatedEvent], declaredOperations),
    undefined,
  );
  assert.equal(
    correlatedEventIdentityCandidate(transportDocumentRead, [predecessorRecord('form-crud'), notificationRecord()], declaredOperations),
    undefined,
  );
});
