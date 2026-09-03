import assert from 'node:assert/strict';
import test from 'node:test';

import { identityTokens, semanticIdentityValue } from './operation-identity.mjs';

test('tokenizes camel-case resource identifiers and singularizes path resources', () => {
  assert.deepEqual(identityTokens('carrierBookingRequestReference'), ['carrier', 'booking', 'request', 'reference']);
  assert.deepEqual(identityTokens('shipping-instructions'), ['shipping', 'instruction']);
});

test('resolves a broad booking path reference from a specific create response', () => {
  const value = semanticIdentityValue(
    { path: '/v2/bookings/{bookingReference}', tag: 'Booking' },
    { name: 'bookingReference' },
    [
      {
        status: 202,
        createdByApiOperations: true,
        requestBody: { bookingReference: 'schema-example-that-was-not-created' },
        responseBody: {
          carrierBookingRequestReference: 'created-booking-reference',
          documentParties: { bookingAgent: { reference: 'nested-party-reference' } },
        },
      },
    ],
    { origins: ['response'] },
  );

  assert.equal(value, 'created-booking-reference');
});

test('uses resource context when a path parameter has a generic document name', () => {
  const value = semanticIdentityValue(
    { path: '/v3/shipping-instructions/{documentReference}', tag: 'Shipping Instructions' },
    { name: 'documentReference' },
    [
      {
        status: 202,
        createdByApiOperations: true,
        responseBody: { shippingInstructionsReference: 'created-shipping-instructions-reference' },
      },
    ],
    { origins: ['response'] },
  );

  assert.equal(value, 'created-shipping-instructions-reference');
});

test('does not borrow an identity from an unrelated resource', () => {
  const value = semanticIdentityValue(
    { path: '/v3/transport-documents/{transportDocumentReference}', tag: 'Transport Document' },
    { name: 'transportDocumentReference' },
    [
      {
        status: 202,
        createdByApiOperations: true,
        responseBody: { carrierBookingRequestReference: 'unrelated-reference' },
      },
    ],
    { origins: ['response'] },
  );

  assert.equal(value, undefined);
});

test('prefers a top-level resource identity over nested related identities', () => {
  const value = semanticIdentityValue(
    { path: '/resources/{resourceReference}', tag: 'Resources' },
    { name: 'resourceReference' },
    [
      {
        status: 201,
        createdByApiOperations: true,
        responseBody: {
          resourceReference: 'root-reference',
          related: { resourceReference: 'nested-reference' },
        },
      },
    ],
    { origins: ['response'] },
  );

  assert.equal(value, 'root-reference');
});
