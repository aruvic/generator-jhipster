import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findReferencePickerConfig,
  findReferencePickerConfigBySemanticKey,
  requireReferencePickerConfig,
  requireReferencePickerIdentityMapping,
} from './reference-picker-admin-state.mjs';

const requested = {
  id: 'browser-generated-id',
  formId: 'update-shipment',
  targetApiId: 'list-locations',
  sourcePath: 'shipment.placeOfReceipt',
  collectionPath: '/locations',
};

test('tracks a normalized, deduplicated picker by its returned identity instead of list size or position', () => {
  const saveResponse = [
    { pickerId: 'prepopulated', formId: 'other-form', targetApiId: 'other-api', sourcePath: 'other', collectionPath: '/other' },
    { pickerId: 'normalized-id', ...requested, id: undefined },
  ];
  const returned = findReferencePickerConfigBySemanticKey(saveResponse, requested);

  assert.equal(returned?.pickerId, 'normalized-id');

  const reloaded = [
    { pickerId: 'server-default', formId: 'default-form', targetApiId: 'default-api', sourcePath: 'default', collectionPath: '/default' },
    { ...returned, id: 'normalized-id' },
  ];
  assert.equal(requireReferencePickerConfig(reloaded, returned, 'restored after reload').pickerId, 'normalized-id');

  const afterDelete = [
    { pickerId: 'server-default', formId: 'default-form', targetApiId: 'default-api', sourcePath: 'default', collectionPath: '/default' },
    { pickerId: 'replacement', ...requested },
  ];
  assert.equal(findReferencePickerConfig(afterDelete, returned), undefined);
});

test('fails persistence when the saved identity is missing even if the same semantic key remains', () => {
  const returned = { pickerId: 'saved-id', ...requested, id: undefined };
  const reloaded = [{ pickerId: 'different-id', ...requested, id: undefined }];

  assert.throws(
    () => requireReferencePickerConfig(reloaded, returned, 'restored after reload'),
    /identity saved-id was not restored after reload/,
  );
});

test('proves the source compatibility id maps to the external pickerId', () => {
  assert.deepEqual(requireReferencePickerIdentityMapping({ id: 'mapped-id' }, { pickerId: 'mapped-id' }, { id: 'mapped-id' }), {
    sourceId: 'mapped-id',
    externalPickerId: 'mapped-id',
    sourceReadbackId: 'mapped-id',
  });

  assert.throws(
    () => requireReferencePickerIdentityMapping({ id: 'source-id' }, { pickerId: 'different-external-id' }, { id: 'source-id' }),
    /source id did not map to the persisted external pickerId/,
  );
});
