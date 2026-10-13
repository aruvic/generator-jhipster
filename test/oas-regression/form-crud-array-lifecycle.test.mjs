import assert from 'node:assert/strict';
import test from 'node:test';

import {
  directOptionalArrayItems,
  exerciseOptionalArrayAddition,
  newlyMaterializedOptionalArrayItems,
  valueAtRenderedArrayPath,
} from './form-crud-array-lifecycle.mjs';

test('scopes optional-array item lifecycle to direct items', () => {
  const directItems = {};
  const array = {
    locator(selector) {
      assert.equal(selector, ':scope > [data-cy="formCrudArrayItem"]');
      return directItems;
    },
  };

  assert.equal(directOptionalArrayItems(array), directItems);
});

test('scopes optional-array re-expansion to items materialized by successful additions', () => {
  const materializedItems = {};
  const root = {
    locator(selector) {
      assert.equal(selector, '[data-form-crud-optional-array-item="true"]');
      return materializedItems;
    },
  };

  assert.equal(newlyMaterializedOptionalArrayItems(root), materializedItems);
});

test('resolves nested array path markers through the rendered instances', () => {
  const references = [{ id: 'reference' }];
  const model = {
    requestedEquipments: [{ commodities: [{ references }] }],
  };

  assert.equal(valueAtRenderedArrayPath(model, ['requestedEquipments', '[]', 'commodities', '[]', 'references']), references);
});

function optionalArrayLocator(itemCounts) {
  const interactions = [];
  const markedItems = [];
  const items = {
    async count() {
      return itemCounts.shift();
    },
    nth(index) {
      return {
        async evaluate(callback) {
          callback({
            setAttribute(name, value) {
              markedItems.push({ index, name, value });
            },
          });
        },
      };
    },
  };
  return {
    interactions,
    markedItems,
    locator: {
      locator(selector) {
        assert.equal(selector, ':scope > [data-cy="formCrudArrayItem"]');
        return items;
      },
      getByRole(role, options) {
        assert.equal(role, 'button');
        assert.deepEqual(options, { name: 'Add', exact: true });
        return {
          first() {
            return {
              async click() {
                interactions.push('add');
              },
            };
          },
        };
      },
    },
  };
}

test('restores an invalid optional-array addition without resolving a nested Remove button', async () => {
  const array = optionalArrayLocator([2, 3, 2]);
  const states = [
    { valid: true, model: { items: [{ id: 1 }, { id: 2 }] } },
    { valid: false, model: { items: [{ id: 1 }, { id: 2 }, {}] } },
  ];

  const outcome = await exerciseOptionalArrayAddition(
    array.locator,
    async () => states.shift(),
    async () => {
      array.interactions.push('restore');
      return { valid: true, model: { items: [{ id: 1 }, { id: 2 }] } };
    },
    state => state.model.items,
  );

  assert.deepEqual(array.interactions, ['add', 'restore']);
  assert.deepEqual(array.markedItems, []);
  assert.deepEqual(outcome, {
    status: 'rolled-back',
    before: 2,
    after: 3,
    restored: 2,
    modelBefore: 2,
    modelAfter: 3,
    modelRestored: 2,
    state: { valid: true, model: { items: [{ id: 1 }, { id: 2 }] } },
  });
});

test('keeps a valid optional-array addition', async () => {
  const array = optionalArrayLocator([1, 2]);
  const states = [
    { valid: true, model: { items: [{ id: 1 }] } },
    { valid: true, model: { items: [{ id: 1 }, {}] } },
  ];

  const outcome = await exerciseOptionalArrayAddition(
    array.locator,
    async () => states.shift(),
    async () => assert.fail('valid additions must not be restored'),
    state => state.model.items,
  );

  assert.deepEqual(array.interactions, ['add']);
  assert.deepEqual(array.markedItems, [{ index: 1, name: 'data-form-crud-optional-array-item', value: 'true' }]);
  assert.deepEqual(outcome, {
    status: 'added',
    before: 1,
    after: 2,
    modelBefore: 1,
    modelAfter: 2,
    state: { valid: true, model: { items: [{ id: 1 }, {}] } },
  });
});

test('accepts a valid model lifecycle when direct optional-array item count is unchanged', async () => {
  const array = optionalArrayLocator([1, 1]);
  const valuePath = ['requestedEquipments', '[]', 'commodities', '[]', 'references'];
  const states = [
    {
      valid: true,
      model: { requestedEquipments: [{ commodities: [{ references: [{ id: 1 }] }] }] },
    },
    {
      valid: true,
      model: { requestedEquipments: [{ commodities: [{ references: [{ id: 1 }, {}] }] }] },
    },
  ];

  const outcome = await exerciseOptionalArrayAddition(
    array.locator,
    async () => states.shift(),
    async () => assert.fail('valid additions must not be restored'),
    state => valueAtRenderedArrayPath(state.model, valuePath),
  );

  assert.deepEqual(array.interactions, ['add']);
  assert.deepEqual(array.markedItems, []);
  assert.deepEqual(outcome, {
    status: 'added',
    before: 1,
    after: 1,
    modelBefore: 1,
    modelAfter: 2,
    state: {
      valid: true,
      model: { requestedEquipments: [{ commodities: [{ references: [{ id: 1 }, {}] }] }] },
    },
  });
});

test('accepts valid model restoration when direct optional-array item count is unchanged', async () => {
  const array = optionalArrayLocator([0, 0, 0]);
  const states = [
    { valid: true, model: { items: [] } },
    { valid: false, model: { items: [{}] } },
  ];

  const outcome = await exerciseOptionalArrayAddition(
    array.locator,
    async () => states.shift(),
    async () => {
      array.interactions.push('restore');
      return { valid: true, model: { items: [] } };
    },
    state => state.model.items,
  );

  assert.deepEqual(array.interactions, ['add', 'restore']);
  assert.deepEqual(outcome, {
    status: 'rolled-back',
    before: 0,
    after: 0,
    restored: 0,
    modelBefore: 0,
    modelAfter: 1,
    modelRestored: 0,
    state: { valid: true, model: { items: [] } },
  });
});

test('fails a real Add that changes neither direct items nor the form model', async () => {
  const array = optionalArrayLocator([1, 1]);
  const states = [
    { valid: true, model: { items: [{ id: 1 }] } },
    { valid: true, model: { items: [{ id: 1 }] } },
  ];

  const outcome = await exerciseOptionalArrayAddition(
    array.locator,
    async () => states.shift(),
    async () => assert.fail('unobserved additions must fail without an assumed rollback'),
    state => state.model.items,
  );

  assert.deepEqual(array.interactions, ['add']);
  assert.deepEqual(outcome, {
    status: 'add-not-observed',
    before: 1,
    after: 1,
    modelBefore: 1,
    modelAfter: 1,
    state: { valid: true, model: { items: [{ id: 1 }] } },
  });
});
