import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOperationPayloadProfile } from './operation-payload-profile.mjs';

const profiles = [
  {
    method: 'POST',
    path: '/resources',
    defaults: [{ pointer: '/items/0/reference', value: 'profile-reference' }],
  },
];

test('applies declarative operation defaults without replacing supplied values', () => {
  assert.deepEqual(applyOperationPayloadProfile({ items: [{}] }, 'post', '/resources', profiles), {
    items: [{ reference: 'profile-reference' }],
  });
  assert.deepEqual(applyOperationPayloadProfile({ items: [{ reference: 'supplied' }] }, 'POST', '/resources', profiles), {
    items: [{ reference: 'supplied' }],
  });
});

test('does not apply a profile to another operation', () => {
  assert.deepEqual(applyOperationPayloadProfile({ items: [] }, 'POST', '/other', profiles), { items: [] });
});
