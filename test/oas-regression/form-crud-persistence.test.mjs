import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPersistenceReadOutcome,
  identityRecordsAfterCollectionReplacement,
  persistenceReadCapability,
  persistenceReadIdentity,
  persistenceReadPathResolution,
  persistenceReadTarget,
  semanticIdentityResolution,
} from './form-crud-persistence.mjs';
import { semanticIdentityValue } from './operation-identity.mjs';
import { patchPayloadFromResourceState } from './operation-payload.mjs';

function pathParameter(name) {
  return { name, location: 'path', required: true };
}

test('reports bulk collection replacement read-back as unavailable', () => {
  const write = { method: 'PUT', path: '/widgets' };
  const operations = [
    write,
    { method: 'GET', path: '/widgets' },
    { method: 'GET', path: '/widgets/{widgetId}', parameters: [pathParameter('widgetId')] },
  ];

  assert.deepEqual(
    persistenceReadCapability(write, operations, {
      requestBody: [{ widgetId: 'first' }, { widgetId: 'second' }],
    }),
    {
      available: false,
      reasonCode: 'bulk-write-readback-unsupported',
      reason: 'the write request represents multiple resources and has no single-resource persistence read-back',
    },
  );
});

test('reports singleton replacement without an item-scoped path as unavailable', () => {
  const write = { method: 'PUT', path: '/settings' };
  const operations = [write, { method: 'GET', path: '/settings' }];

  const capability = persistenceReadCapability(write, operations, {
    requestBody: { enabled: true },
  });

  assert.equal(capability.available, false);
  assert.equal(capability.reasonCode, 'write-operation-not-item-scoped');
});

test('rejects a nested create Location when only collection GET is declared', () => {
  const write = {
    method: 'POST',
    path: '/parents/{parentId}/children',
    parameters: [pathParameter('parentId')],
  };
  const operations = [
    write,
    { method: 'GET', path: '/parents/{parentId}', parameters: [pathParameter('parentId')] },
    { method: 'GET', path: '/parents/{parentId}/children', parameters: [pathParameter('parentId')] },
  ];

  const capability = persistenceReadCapability(write, operations, {
    location: '/api/parents/parent-one/children/child-one',
    requestBody: { name: 'child' },
  });

  assert.equal(capability.available, false);
  assert.equal(capability.reasonCode, 'location-not-readable-by-contract');
});

test('rejects a create Location when the contract declares no item GET', () => {
  const write = { method: 'POST', path: '/subscriptions' };
  const operations = [write, { method: 'DELETE', path: '/subscriptions/{subscriptionId}', parameters: [pathParameter('subscriptionId')] }];

  const capability = persistenceReadCapability(write, operations, {
    location: '/api/subscriptions/subscription-one',
    requestBody: { callback: 'https://example.invalid/callback' },
  });

  assert.equal(capability.available, false);
  assert.equal(capability.reasonCode, 'location-not-readable-by-contract');
});

test('ignores a Location that does not match an otherwise compatible item GET', () => {
  const write = { method: 'POST', path: '/widgets' };
  const read = { method: 'GET', path: '/widgets/{widgetId}', parameters: [pathParameter('widgetId')] };

  const capability = persistenceReadCapability(write, [write, read], {
    location: '/api/jobs/job-one',
    requestBody: { name: 'widget' },
  });

  assert.equal(capability.available, true);
  assert.equal(capability.readOperation, read);
  assert.equal(capability.location, undefined);
  assert.equal(capability.ignoredLocation.reasonCode, 'location-incompatible-with-contract');
});

test('reports a command write without a compatible item GET as unavailable', () => {
  const write = { method: 'POST', path: '/widgets/{widgetId}/commands/archive', parameters: [pathParameter('widgetId')] };

  const capability = persistenceReadCapability(write, [write], {
    requestBody: { reason: 'obsolete' },
  });

  assert.equal(capability.available, false);
  assert.equal(capability.reasonCode, 'compatible-item-get-unavailable');
});

test('keeps a real compatible item write mismatch as an unexpected failure', () => {
  const write = { method: 'PATCH', path: '/widgets/{widgetId}', parameters: [pathParameter('widgetId')] };
  const read = { method: 'GET', path: '/widgets/{id}', parameters: [pathParameter('id')] };

  const capability = persistenceReadCapability(write, [write, read], {
    requestBody: { name: 'expected-name' },
  });
  const outcome = classifyPersistenceReadOutcome(200, {
    checked: true,
    matched: false,
  });

  assert.equal(capability.available, true);
  assert.equal(capability.readOperation, read);
  assert.deepEqual(outcome, {
    classification: 'unexpected-failure',
    reasonCode: 'persisted-resource-mismatch',
  });
});

test('accepts a successful body-backed write when submitted writable fields match', () => {
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: true,
      },
      {
        writeResponseBodyAvailable: true,
        readbackIdentityVerified: false,
      },
    ),
    { classification: 'success' },
  );
});

test('accepts an empty or unavailable accepted write only when authenticated readback identity and writable fields match', () => {
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: true,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: true,
      },
    ),
    { classification: 'success' },
  );
});

test('rejects an identity-verified empty accepted write when a persisted writable field mismatches', () => {
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: false,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: true,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    },
  );
});

test('requires stable readback identity when an accepted write response is empty', () => {
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: true,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: false,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-identity-unverified',
    },
  );
});

test('keeps an exact Location target ahead of a duplicate semantic candidate and preserves target mismatches', () => {
  const write = { method: 'POST', path: '/bookings' };
  const parameter = pathParameter('bookingReference');
  const read = { method: 'GET', path: '/bookings/{bookingReference}', parameters: [parameter], tag: 'Booking' };
  const semanticRecords = [
    { responseBody: { carrierBookingRequestReference: 'duplicate-reference' } },
    { responseBody: { carrierBookingRequestReference: 'duplicate-reference' } },
  ];
  const semanticResolution = semanticIdentityResolution(read, parameter, [semanticRecords[1]], {
    origins: ['response'],
    candidateRecords: semanticRecords,
  });
  const capability = persistenceReadCapability(write, [write, read], {
    location: '/api/bookings/created-booking',
    requestBody: { displayName: 'created display name' },
  });
  const target = persistenceReadTarget(capability, {
    resolvedPath: '/api/bookings/duplicate-reference',
    resolutions: [
      {
        parameter: parameter.name,
        value: semanticResolution.value,
        source: 'response-semantic-field',
        semanticIdentityCandidateCount: semanticResolution.candidateCount,
        semanticIdentityUnambiguous: semanticResolution.unambiguous,
      },
    ],
  });

  assert.deepEqual(target, {
    available: true,
    path: '/api/bookings/created-booking',
    identityEvidence: [{ source: 'location-header', value: '/api/bookings/created-booking' }],
    readbackPathVerified: true,
  });
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: false,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: false,
        readbackPathVerified: target.readbackPathVerified,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    },
  );
});

test('accepts a bodyless write after its authenticated Location GET matches writable fields', () => {
  const write = { method: 'POST', path: '/pets' };
  const read = { method: 'GET', path: '/pets/{petId}', parameters: [pathParameter('petId')] };
  const capability = persistenceReadCapability(write, [write, read], {
    location: 'http://localhost:4201/api/pets/1003',
    requestBody: { name: 'sample', type: 'dog' },
  });
  const target = persistenceReadTarget(capability);
  const readbackIdentity = persistenceReadIdentity(read, target.path, {
    name: 'sample',
    type: 'dog',
  });

  assert.equal(target.path, '/api/pets/1003');
  assert.equal(target.readbackPathVerified, true);
  assert.deepEqual(readbackIdentity, { verified: false, evidence: [] });
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: true,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: readbackIdentity.verified,
        readbackPathVerified: target.readbackPathVerified,
      },
    ),
    { classification: 'success' },
  );
});

test('does not read back through an ambiguous semantic identity without an exact resource path', () => {
  const parameter = pathParameter('documentReference');
  const read = {
    method: 'GET',
    path: '/shipping-instructions/{documentReference}',
    parameters: [parameter],
    tag: 'Shipping Instructions',
  };
  const records = [
    { responseBody: { shippingInstructionsReference: 'duplicate-reference' } },
    { responseBody: { shippingInstructionsReference: 'duplicate-reference' } },
  ];
  const resolution = semanticIdentityResolution(read, parameter, [records[1]], {
    origins: ['response'],
    candidateRecords: records,
  });

  assert.deepEqual(
    persistenceReadTarget(
      { readOperation: read, matchKind: 'created-item' },
      {
        resolvedPath: '/api/shipping-instructions/duplicate-reference',
        resolutions: [
          {
            parameter: parameter.name,
            value: resolution.value,
            source: 'response-semantic-field',
            semanticIdentityCandidateCount: resolution.candidateCount,
            semanticIdentityUnambiguous: resolution.unambiguous,
          },
        ],
      },
    ),
    {
      available: false,
      reasonCode: 'read-path-identity-ambiguous',
      reason: 'semantic identity for path parameter documentReference matched 2 candidates',
    },
  );
});

test('accepts a bodyless item update after its authenticated same-path GET matches writable fields', () => {
  const write = { method: 'PATCH', path: '/owners/{ownerId}', parameters: [pathParameter('ownerId')] };
  const read = { method: 'GET', path: '/owners/{ownerId}', parameters: [pathParameter('ownerId')] };
  const capability = persistenceReadCapability(write, [write, read], {
    requestBody: { firstName: 'updated' },
  });
  const target = persistenceReadTarget(capability, {
    responseUrl: 'http://localhost:4201/api/owners/1053',
  });

  assert.equal(target.path, '/api/owners/1053');
  assert.equal(target.readbackPathVerified, true);
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: true,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: false,
        readbackPathVerified: target.readbackPathVerified,
      },
    ),
    { classification: 'success' },
  );
});

test('does not accept identity-only readback evidence for an empty accepted write', () => {
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: false,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: true,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-fields-unverified',
    },
  );
});

test('rejects an identity-verified accepted write when persisted fields mismatch', () => {
  const readOperation = {
    method: 'GET',
    path: '/resources/{resourceReference}',
    parameters: [pathParameter('resourceReference')],
    tag: 'Resources',
  };
  const updateOperation = {
    method: 'PUT',
    path: readOperation.path,
    parameters: readOperation.parameters,
    requestBodyFields: [
      { name: 'resourceReference', path: ['resourceReference'], type: 'string', required: true },
      { name: 'creationMode', path: ['creationMode'], type: 'string', required: true },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
    ],
  };
  const acceptedRecord = {
    source: 'api-operations',
    operation: { method: 'POST' },
    status: 202,
    requestBody: {
      creationMode: 'fixture-mode',
      displayName: 'fixture display name',
    },
    responseBody: {
      resourceReference: 'persisted-resource',
    },
  };
  const generatedUpdate = {
    resourceReference: 'fixture-resource',
    creationMode: 'fixture-mode',
    displayName: 'updated display name',
  };
  const persistedResponseBody = {
    resourceReference: 'persisted-resource',
    creationMode: 'server-mode',
    displayName: 'persisted display name',
  };

  assert.deepEqual(patchPayloadFromResourceState(updateOperation, generatedUpdate, [acceptedRecord]), generatedUpdate);

  const readbackIdentity = persistenceReadIdentity(readOperation, '/api/resources/persisted-resource', persistedResponseBody);
  assert.deepEqual(readbackIdentity, {
    verified: true,
    evidence: [
      {
        parameter: 'resourceReference',
        expected: 'persisted-resource',
        actual: 'persisted-resource',
      },
    ],
  });
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      200,
      {
        checked: true,
        matched: false,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: readbackIdentity.verified,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    },
  );

  acceptedRecord.persistenceVerified = true;
  acceptedRecord.persistedResponseBody = persistedResponseBody;
  acceptedRecord.createdByApiOperations = true;
  assert.deepEqual(patchPayloadFromResourceState(updateOperation, generatedUpdate, [acceptedRecord]), {
    resourceReference: 'persisted-resource',
    creationMode: 'server-mode',
    displayName: 'updated display name',
  });
  assert.deepEqual(
    classifyPersistenceReadOutcome(
      503,
      {
        checked: true,
        matched: false,
      },
      {
        writeResponseBodyAvailable: false,
        readbackIdentityVerified: true,
      },
    ),
    {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    },
  );
});

test('does not let stable accepted-readback identity override writable field mismatches', () => {
  const cases = [
    {
      operation: {
        method: 'GET',
        path: '/bookings/{bookingReference}',
        parameters: [pathParameter('bookingReference')],
        tag: 'Booking',
      },
      targetPath: '/api/bookings/created-booking',
      responseBody: {
        bookingChannelReference: 'channel-booking',
        carrierBookingRequestReference: 'created-booking',
      },
    },
    {
      operation: {
        method: 'GET',
        path: '/shipping-instructions/{documentReference}',
        parameters: [pathParameter('documentReference')],
        tag: 'Shipping Instructions',
      },
      targetPath: '/api/shipping-instructions/created-instructions',
      responseBody: {
        transportDocumentReference: 'related-document',
        shippingInstructionsReference: 'created-instructions',
      },
    },
  ];

  for (const { operation, targetPath, responseBody } of cases) {
    const readbackIdentity = persistenceReadIdentity(operation, targetPath, responseBody);
    assert.equal(readbackIdentity.verified, true);
    assert.equal(readbackIdentity.evidence[0].actual, targetPath.split('/').at(-1));
    assert.deepEqual(
      classifyPersistenceReadOutcome(
        200,
        {
          checked: true,
          matched: false,
        },
        {
          writeResponseBodyAvailable: false,
          readbackIdentityVerified: readbackIdentity.verified,
        },
      ),
      {
        classification: 'unexpected-failure',
        reasonCode: 'persisted-resource-mismatch',
      },
    );
  }
});

test('reuses a verified read path identity for dependent writes', () => {
  const cases = [
    {
      operation: {
        method: 'PUT',
        path: '/bookings/{bookingReference}',
        parameters: [pathParameter('bookingReference')],
      },
      parameter: pathParameter('bookingReference'),
      verifiedPersistenceReadPath: '/api/bookings/created-booking',
      expected: 'created-booking',
    },
    {
      operation: {
        method: 'PUT',
        path: '/shipping-instructions/{documentReference}',
        parameters: [pathParameter('documentReference')],
      },
      parameter: pathParameter('documentReference'),
      verifiedPersistenceReadPath: '/api/shipping-instructions/created-instructions',
      expected: 'created-instructions',
    },
    {
      operation: {
        method: 'PATCH',
        path: '/configurations/{pickerId}',
        parameters: [pathParameter('pickerId')],
      },
      parameter: pathParameter('pickerId'),
      verifiedPersistenceReadPath: '/api/configurations/37',
      expected: '37',
    },
  ];

  for (const { operation, parameter, verifiedPersistenceReadPath, expected } of cases) {
    assert.deepEqual(persistenceReadPathResolution(operation, parameter, [{ verifiedPersistenceReadPath }]), {
      value: expected,
      source: 'verified-persistence-read-path',
    });
  }
});

test('retains a verified item path when no collection replacement occurred', () => {
  const operation = {
    method: 'DELETE',
    path: '/widgets/{widgetId}',
    parameters: [pathParameter('widgetId')],
  };
  const records = [
    {
      status: 201,
      operation: { method: 'POST', path: '/widgets' },
      verifiedPersistenceReadPath: '/api/widgets/1004',
    },
  ];

  const identityRecords = identityRecordsAfterCollectionReplacement(operation, records);

  assert.deepEqual(persistenceReadPathResolution(operation, pathParameter('widgetId'), identityRecords), {
    value: '1004',
    source: 'verified-persistence-read-path',
  });
});

test('invalidates an earlier item path and re-resolves semantic identity after collection replacement', () => {
  const parameter = pathParameter('widgetId');
  const operation = {
    method: 'DELETE',
    path: '/widgets/{widgetId}',
    parameters: [parameter],
    tag: 'Widgets',
  };
  const replacement = {
    status: 200,
    operation: { method: 'PUT', path: '/widgets' },
    requestBody: [{ widgetId: 'stable-widget', label: 'replacement' }],
    responseBody: [{ id: 1005, widgetId: 'stable-widget', label: 'replacement' }],
  };
  const staleCreate = {
    status: 201,
    operation: { method: 'POST', path: '/widgets' },
    responseBody: { id: 1004, widgetId: 'stable-widget' },
    verifiedPersistenceReadPath: '/api/widgets/1004',
  };

  const identityRecords = identityRecordsAfterCollectionReplacement(operation, [replacement, staleCreate]);

  assert.deepEqual(identityRecords, [replacement]);
  assert.equal(persistenceReadPathResolution(operation, parameter, identityRecords), undefined);
  assert.equal(semanticIdentityValue(operation, parameter, identityRecords), 'stable-widget');
});

test('leaves dependent identity unresolved when replacement exposes no compatible semantic identity', () => {
  const parameter = pathParameter('widgetId');
  const operation = {
    method: 'DELETE',
    path: '/widgets/{widgetId}',
    parameters: [parameter],
    tag: 'Widgets',
  };
  const replacement = {
    status: 200,
    operation: { method: 'PUT', path: '/widgets' },
    requestBody: [{ label: 'replacement' }],
    responseBody: [{ databaseId: 1005, label: 'replacement' }],
  };
  const staleCreate = {
    status: 201,
    operation: { method: 'POST', path: '/widgets' },
    verifiedPersistenceReadPath: '/api/widgets/1004',
  };

  const identityRecords = identityRecordsAfterCollectionReplacement(operation, [replacement, staleCreate]);

  assert.equal(persistenceReadPathResolution(operation, parameter, identityRecords), undefined);
  assert.equal(semanticIdentityValue(operation, parameter, identityRecords), undefined);
});

test('scopes replacement barriers by generic contract path shape rather than artifact fields', () => {
  const parameter = pathParameter('assetCode');
  const operation = {
    method: 'PATCH',
    path: '/accounts/{tenant}/assets/{assetCode}',
    parameters: [pathParameter('tenant'), parameter],
    tag: 'Account Assets',
  };
  const unrelatedReplacement = {
    status: 200,
    operation: { method: 'PUT', path: '/accounts/{accountId}/users' },
    requestBody: [{ userCode: 'user-one' }],
  };
  const relevantReplacement = {
    status: 204,
    operation: { method: 'PUT', path: '/accounts/{accountId}/assets' },
    requestBody: [{ assetCode: 'asset-one' }],
  };
  const staleCreate = {
    status: 201,
    operation: { method: 'POST', path: '/accounts/{accountId}/assets' },
    verifiedPersistenceReadPath: '/api/accounts/account-one/assets/41',
  };

  const identityRecords = identityRecordsAfterCollectionReplacement(operation, [unrelatedReplacement, relevantReplacement, staleCreate]);

  assert.deepEqual(identityRecords, [unrelatedReplacement, relevantReplacement]);
  assert.equal(persistenceReadPathResolution(operation, parameter, identityRecords), undefined);
  assert.equal(semanticIdentityValue(operation, parameter, identityRecords), 'asset-one');

  const unrelatedOnly = identityRecordsAfterCollectionReplacement(operation, [unrelatedReplacement, staleCreate]);
  assert.deepEqual(persistenceReadPathResolution(operation, parameter, unrelatedOnly), {
    value: '41',
    source: 'verified-persistence-read-path',
  });
});
