#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMappedReference, assertPersistedReference } from './reference-picker-mapping.mjs';

const picker = {
  multiple: true,
  copyFields: [
    { source: 'id', target: 'party.id' },
    { source: 'name', target: 'party.name' },
    { source: '@type', target: 'party.@referredType' },
    { source: 'relationshipType', target: '@type' },
    { source: 'relationshipRole', target: 'role' },
  ],
};
const selectedItem = {
  id: 1001,
  href: 'http://target.example/api/parties/1001',
  name: 'Selected party',
  '@type': 'Individual',
  relationshipType: 'RelatedPartyRef',
  relationshipRole: 'supplier',
};
const requestReference = {
  party: {
    id: 1001,
    href: 'http://target.example/api/parties/1001',
    name: 'Selected party',
    '@referredType': 'Individual',
  },
  '@type': 'RelatedPartyRef',
  role: 'supplier',
};
const targetSelection = {
  identityPath: 'id',
  identity: 1001,
  collectionUrl: 'http://target.example/api/parties',
};

test('requires every configured copy mapping before persistence', () => {
  assert.deepEqual(assertMappedReference([requestReference], selectedItem, picker, 'PATCH'), requestReference);
  assert.throws(
    () => assertMappedReference([{ ...requestReference, role: 'customer' }], selectedItem, picker, 'PATCH'),
    /every configured copy mapping/,
  );
});

test('accepts canonicalized reference metadata while preserving identity and relationship mappings', () => {
  const persistedReference = {
    party: {
      id: 1051,
      href: 'http://target.example/api/parties/1001',
      name: 'Canonical party name',
      '@referredType': 'Individual',
      '@type': 'PartyRef',
    },
    '@type': 'RelatedPartyRef',
    role: 'supplier',
  };

  const result = assertPersistedReference([persistedReference], requestReference, picker, targetSelection, 'Persisted GET');

  assert.deepEqual(result.reference, persistedReference);
  assert.deepEqual(
    result.mappingEvidence.map(({ target, contract, classification, requiredOnReadback, preserved, proven }) => ({
      target,
      contract,
      classification,
      requiredOnReadback,
      preserved,
      proven,
    })),
    [
      {
        target: 'party.id',
        contract: 'identity',
        classification: 'configured-copy',
        requiredOnReadback: true,
        preserved: false,
        proven: true,
      },
      {
        target: 'party.href',
        contract: 'reference-href',
        classification: 'automatic-resolver',
        requiredOnReadback: true,
        preserved: true,
        proven: true,
      },
      {
        target: 'party.name',
        contract: 'reference-metadata',
        classification: 'configured-copy',
        requiredOnReadback: false,
        preserved: false,
        proven: false,
      },
      {
        target: 'party.@referredType',
        contract: 'reference-referred-type',
        classification: 'configured-copy',
        requiredOnReadback: true,
        preserved: true,
        proven: true,
      },
      {
        target: '@type',
        contract: 'relationship-type',
        classification: 'configured-copy',
        requiredOnReadback: true,
        preserved: true,
        proven: true,
      },
      {
        target: 'role',
        contract: 'relationship-role',
        classification: 'configured-copy',
        requiredOnReadback: true,
        preserved: true,
        proven: true,
      },
    ],
  );
  assert.equal(
    result.mappingEvidence.find(({ contract }) => contract === 'reference-href').expectedValue,
    'http://target.example/api/parties/1001',
  );
});

test('rejects a lost or mismatched automatic href on readback', () => {
  const changedReferences = [
    [
      { ...requestReference, party: { ...requestReference.party, href: undefined } },
      /did not preserve the exact target reference href http:\/\/target\.example\/api\/parties\/1001/,
    ],
    [
      { ...requestReference, party: { ...requestReference.party, href: 'http://source.example/api/parties/1001' } },
      /did not preserve the exact target reference href http:\/\/target\.example\/api\/parties\/1001/,
    ],
    [
      { ...requestReference, party: { ...requestReference.party, href: 'http://target.example/api/organizations/1001' } },
      /did not preserve the exact target reference href http:\/\/target\.example\/api\/parties\/1001/,
    ],
    [
      { ...requestReference, party: { ...requestReference.party, href: 'http://target.example/api/parties/1002' } },
      /did not preserve the exact target reference href http:\/\/target\.example\/api\/parties\/1001/,
    ],
  ];

  for (const [changedReference, expectedError] of changedReferences) {
    assert.throws(
      () => assertPersistedReference([changedReference], requestReference, picker, targetSelection, 'Persisted GET'),
      expectedError,
    );
  }
});

test('rejects lost configured identity or relationship contracts on readback', () => {
  const changedReferences = [
    [{ ...requestReference, party: { ...requestReference.party, id: undefined } }, /changed stable identity\/relationship mappings: party\.id/],
    [
      { ...requestReference, party: { ...requestReference.party, '@referredType': 'Organization' } },
      /changed stable identity\/relationship mappings: party\.@referredType/,
    ],
    [{ ...requestReference, '@type': 'CustomerRef' }, /changed stable identity\/relationship mappings: @type/],
    [{ ...requestReference, role: 'customer' }, /changed stable identity\/relationship mappings: role/],
  ];

  for (const [changedReference, expectedError] of changedReferences) {
    assert.throws(
      () => assertPersistedReference([changedReference], requestReference, picker, targetSelection, 'Persisted GET'),
      expectedError,
    );
  }
});

test('requires configured mappings for identity and explicit reference and relationship contracts', () => {
  for (const contract of [
    ['party.id', 'target identity path'],
    ['party.@referredType', 'reference-referred-type'],
    ['@type', 'relationship-type'],
    ['role', 'relationship-role'],
  ]) {
    const pickerWithoutContract = {
      ...picker,
      copyFields: picker.copyFields.filter(mapping => mapping.target !== contract[0]),
    };
    assert.throws(
      () => assertPersistedReference([requestReference], requestReference, pickerWithoutContract, targetSelection, 'Persisted GET'),
      new RegExp(
        contract[0] === 'party.id'
          ? `do not map ${contract[1]}`
          : `do not prove required ${contract[1]} contract`,
      ),
    );
  }
});

test('classifies an explicitly configured href separately while retaining exact target-route proof', () => {
  const pickerWithConfiguredHref = {
    ...picker,
    copyFields: [
      picker.copyFields[0],
      { source: 'href', target: 'party.href' },
      ...picker.copyFields.slice(1),
    ],
  };

  const result = assertPersistedReference(
    [requestReference],
    requestReference,
    pickerWithConfiguredHref,
    targetSelection,
    'Persisted GET',
  );

  assert.equal(result.mappingEvidence.find(({ contract }) => contract === 'reference-href').classification, 'configured-copy');
});
