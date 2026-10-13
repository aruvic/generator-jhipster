const directArrayItemSelector = ':scope > [data-cy="formCrudArrayItem"]';
const materializedOptionalArrayItemSelector = '[data-form-crud-optional-array-item="true"]';

export function directOptionalArrayItems(array) {
  return array.locator(directArrayItemSelector);
}

export function newlyMaterializedOptionalArrayItems(root) {
  return root.locator(materializedOptionalArrayItemSelector);
}

export function valueAtRenderedArrayPath(value, path) {
  return path.reduce((current, segment) => {
    if (segment === '[]') return Array.isArray(current) ? current[0] : undefined;
    return current?.[segment];
  }, value);
}

function observedArrayLength(state, readArrayValue) {
  const value = readArrayValue?.(state);
  if (value === undefined || value === null) return 0;
  return Array.isArray(value) ? value.length : undefined;
}

export async function exerciseOptionalArrayAddition(array, readFormState, restoreFormState, readArrayValue) {
  const items = directOptionalArrayItems(array);
  const before = await items.count();
  const beforeState = await readFormState();
  const modelBefore = observedArrayLength(beforeState, readArrayValue);
  await array.getByRole('button', { name: 'Add', exact: true }).first().click();
  const after = await items.count();
  const state = await readFormState();
  const modelAfter = observedArrayLength(state, readArrayValue);
  const directAdditionObserved = after === before + 1;
  const modelAdditionObserved = modelBefore !== undefined && modelAfter === modelBefore + 1;

  if (!directAdditionObserved && !modelAdditionObserved) {
    return { status: 'add-not-observed', before, after, modelBefore, modelAfter, state };
  }
  if (state.valid) {
    if (directAdditionObserved) {
      await items.nth(after - 1).evaluate(element => element.setAttribute('data-form-crud-optional-array-item', 'true'));
    }
    return { status: 'added', before, after, modelBefore, modelAfter, state };
  }

  const restoredState = await restoreFormState();
  const restored = await directOptionalArrayItems(array).count();
  const modelRestored = observedArrayLength(restoredState, readArrayValue);
  const directRestorationObserved = !directAdditionObserved || restored === before;
  const modelRestorationObserved = !modelAdditionObserved || modelRestored === modelBefore;
  return {
    status: directRestorationObserved && modelRestorationObserved && restoredState.valid ? 'rolled-back' : 'rollback-failed',
    before,
    after,
    restored,
    modelBefore,
    modelAfter,
    modelRestored,
    state: restoredState,
  };
}
