import assert from 'node:assert/strict';
import test from 'node:test';

import { captureResponseBodyForAction, captureResponseForAction } from './playwright-response-capture.mjs';

test('arms the response listener before invoking the browser action', async () => {
  const events = [];
  let responsePredicate;
  let resolveResponse;
  let requestListener;
  const request = { timing: () => ({ startTime: Date.now() + 1 }) };
  const response = {
    status: () => 201,
    request: () => request,
  };
  const page = {
    on: (_event, listener) => {
      requestListener = listener;
    },
    off: () => {},
    waitForResponse: predicate => {
      events.push('listener');
      responsePredicate = predicate;
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    },
  };

  const captured = await captureResponseForAction(
    page,
    () => true,
    async () => {
      events.push('action');
      requestListener(request);
      if (responsePredicate(response)) resolveResponse(response);
    },
    { timeout: 100, label: 'create' },
  );

  assert.equal(captured, response);
  assert.deepEqual(events, ['listener', 'action']);
});

test('retains the response-capture failure as a harness error cause', async () => {
  const failure = new Error('timed out');
  const page = {
    on: () => {},
    off: () => {},
    waitForResponse: () => Promise.reject(failure),
  };

  await assert.rejects(
    captureResponseForAction(
      page,
      () => true,
      async () => {},
      { timeout: 100, label: 'update' },
    ),
    error => error.cause === failure && /update response/.test(error.message),
  );
});

test('starts reading the response body before the browser action can navigate away', async () => {
  let navigatedAway = false;
  let responsePredicate;
  let resolveResponse;
  let requestListener;
  const request = { timing: () => ({ startTime: Date.now() + 1 }) };
  const response = {
    body: async () => {
      if (navigatedAway) throw new Error('No data found for resource with given identifier');
      await new Promise(resolve => setImmediate(resolve));
      return Buffer.from('{"saved":true}');
    },
    request: () => request,
  };
  const page = {
    on: (_event, listener) => {
      requestListener = listener;
    },
    off: () => {},
    waitForResponse: predicate => {
      responsePredicate = predicate;
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    },
  };

  const captured = await captureResponseBodyForAction(
    page,
    () => true,
    async () => {
      requestListener(request);
      if (responsePredicate(response)) resolveResponse(response);
      navigatedAway = true;
    },
    { timeout: 100, label: 'configuration save' },
  );

  assert.equal(captured.response, response);
  assert.equal(captured.body.toString('utf8'), '{"saved":true}');
});

test('retains response-body capture failures as a harness error cause', async () => {
  const failure = new Error('No data found for resource with given identifier');
  let responsePredicate;
  let resolveResponse;
  let requestListener;
  const request = { timing: () => ({ startTime: Date.now() + 1 }) };
  const response = {
    body: () => Promise.reject(failure),
    request: () => request,
  };
  const page = {
    on: (_event, listener) => {
      requestListener = listener;
    },
    off: () => {},
    waitForResponse: predicate => {
      responsePredicate = predicate;
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    },
  };

  await assert.rejects(
    captureResponseBodyForAction(
      page,
      () => true,
      async () => {
        requestListener(request);
        if (responsePredicate(response)) resolveResponse(response);
      },
      { timeout: 100, label: 'configuration save' },
    ),
    error => error.cause === failure && /configuration save response body/.test(error.message),
  );
});

test('ignores matching responses for requests that started before the browser action', async () => {
  let responsePredicate;
  let resolveResponse;
  let requestListener;
  const staleRequest = { timing: () => ({ startTime: 1 }) };
  const actionRequest = { timing: () => ({ startTime: Date.now() + 1 }) };
  const staleResponse = { request: () => staleRequest };
  const actionResponse = {
    request: () => actionRequest,
  };
  const page = {
    on: (_event, listener) => {
      requestListener = listener;
      listener(staleRequest);
    },
    off: () => {},
    waitForResponse: predicate => {
      responsePredicate = predicate;
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    },
  };

  const captured = await captureResponseForAction(
    page,
    () => true,
    async () => {
      requestListener(staleRequest);
      assert.equal(responsePredicate(staleResponse), false);
      requestListener(actionRequest);
      assert.equal(responsePredicate(actionResponse), true);
      resolveResponse(actionResponse);
    },
    { timeout: 100, label: 'create' },
  );

  assert.equal(captured, actionResponse);
});
