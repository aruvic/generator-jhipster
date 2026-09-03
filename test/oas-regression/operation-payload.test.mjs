import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPayloadFile } from './operation-payload.mjs';

test('prefers an exact operation payload over an earlier overlapping operation name', () => {
  const files = ['005-post-cancelproductordercreateevent.json', '009-post-productordercreateevent.json'];

  assert.equal(
    selectPayloadFile(files, {
      id: 'post-product-order-create-event',
      operationId: 'productOrderCreateEvent',
      method: 'POST',
    }),
    '009-post-productordercreateevent.json',
  );
});

test('retains a bounded fallback for payload names with an added prefix', () => {
  assert.equal(
    selectPayloadFile(['003-post-create-resource.json'], {
      id: 'post-resource',
      operationId: 'createResource',
      method: 'POST',
    }),
    '003-post-create-resource.json',
  );
});
