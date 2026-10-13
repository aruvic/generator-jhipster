import assert from 'node:assert/strict';
import { test } from 'node:test';

import { waitForFormCrudOperationReady } from './form-crud-gui-readiness.mjs';

function readinessPage(waitForFunction) {
  const calls = [];
  return {
    calls,
    locator(selector) {
      calls.push({ name: 'locator', selector });
      return {
        async waitFor(options) {
          calls.push({ name: 'locator.waitFor', options });
        },
      };
    },
    waitForFunction(predicate, argument, options) {
      calls.push({ name: 'waitForFunction', argument, options });
      return waitForFunction(predicate, argument, options);
    },
    async evaluate(callback) {
      calls.push({ name: 'evaluate' });
      return callback();
    },
  };
}

test('waits for the requested Form CRUD operation state before returning it', async () => {
  const previousWindow = globalThis.window;
  let state = { operationId: 'previous-operation' };
  globalThis.window = { __formsDebug: { formCrud: () => state } };
  let predicate;
  let argument;
  let release;
  const page = readinessPage((candidate, value) => {
    predicate = candidate;
    argument = value;
    return new Promise(resolve => {
      release = resolve;
    });
  });

  try {
    let settled = false;
    const readiness = waitForFormCrudOperationReady(page, 'get-list-orders', 30_000).then(value => {
      settled = true;
      return value;
    });
    await Promise.resolve();

    assert.equal(predicate(argument), false);
    assert.equal(settled, false);
    state = { operationId: 'get-list-orders', rows: [] };
    assert.equal(predicate(argument), true);
    release();

    assert.deepEqual(await readiness, state);
    assert.deepEqual(page.calls, [
      { name: 'locator', selector: '[data-cy="formCrud"]' },
      { name: 'locator.waitFor', options: { state: 'visible', timeout: 30_000 } },
      { name: 'waitForFunction', argument: 'get-list-orders', options: { timeout: 30_000 } },
      { name: 'evaluate' },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('preserves the readiness timeout failure when the requested operation never renders', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { __formsDebug: { formCrud: () => ({ operationId: 'previous-operation' }) } };
  const timeoutError = new Error('Form CRUD operation readiness timed out after 30000ms');
  const page = readinessPage((predicate, operationId, options) => {
    assert.equal(predicate(operationId), false);
    assert.deepEqual(options, { timeout: 30_000 });
    return Promise.reject(timeoutError);
  });

  try {
    await assert.rejects(waitForFormCrudOperationReady(page, 'get-list-orders', 30_000), timeoutError);
    assert.equal(
      page.calls.some(call => call.name === 'evaluate'),
      false,
    );
  } finally {
    globalThis.window = previousWindow;
  }
});
