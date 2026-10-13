import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOperationErrorAttributionReport } from './operation-error-attribution.mjs';
import {
  captureResponseBodyForAction,
  captureResponseBodySnapshotForAction,
  captureResponseForAction,
  captureSuccessfulDeleteReadbackEvidence,
  captureSuccessfulResponseJsonForAction,
  capturedResponseBodyText,
  createPlaywrightOperationErrorCapture,
  parseCapturedResponseJson,
  parseSuccessfulResponseJson,
} from './playwright-response-capture.mjs';

test('captures normalized Playwright runtime metadata and exact expected-negative assertions', () => {
  let authenticated = true;
  const capture = createPlaywrightOperationErrorCapture({
    targetOrigin: 'https://localhost:4200',
    authenticated: () => authenticated,
    evidenceFile: '/evidence/operation-errors.json',
  });
  const request = {
    method: () => 'POST',
    url: () => 'https://localhost:4200/api/widgets?source=form',
  };
  const response = {
    status: () => 422,
    url: request.url,
    request: () => request,
  };

  capture.captureRequest(request);
  const event = capture.captureResponse(response);
  const assertion = capture.expectResponse(response, 'expected-negative', { operationId: 'createWidget' });

  assert.deepEqual(event, {
    classification: 'http-response',
    method: 'POST',
    url: 'https://localhost:4200/api/widgets?source=form',
    path: '/api/widgets',
    status: 422,
    authenticated: true,
    target: true,
    authContext: { authenticated: true, target: true },
    requestId: 'browser-request-1',
    correlation: { requestId: 'browser-request-1' },
    evidenceRef: '/evidence/operation-errors.json#/source/events/0',
    capturedAtIso: event.capturedAtIso,
  });
  assert.deepEqual(assertion, {
    assertionType: 'expected-negative',
    method: 'POST',
    path: '/api/widgets',
    status: 422,
    authenticated: true,
    target: true,
    correlation: { requestId: 'browser-request-1' },
    evidenceRef: '/evidence/operation-errors.json#/source/assertions/0',
    operationId: 'createWidget',
  });
  const consoleEvent = capture.captureConsole({
    type: () => 'error',
    text: () => 'Failed to load resource: the server responded with a status of 422',
    location: () => ({ url: request.url() }),
  });
  capture.correlateConsoleHttpErrors();
  assert.deepEqual(consoleEvent.correlation, { requestId: 'browser-request-1' });
  assert.equal(consoleEvent.relatedHttpEvidenceRef, event.evidenceRef);
  assert.equal(consoleEvent.method, 'POST');
  assert.equal(consoleEvent.status, 422);

  authenticated = false;
  const externalRequest = {
    method: () => 'GET',
    url: () => 'https://cdn.example.invalid/missing.js',
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  };
  const failure = capture.captureRequestFailure(externalRequest);
  assert.equal(failure.authenticated, false);
  assert.equal(failure.target, false);
  assert.equal(failure.classification, 'request-failure');
  assert.equal(failure.path, '/missing.js');
});

test('requires operation identity for capture assertions and attributes correlated console errors', () => {
  const capture = createPlaywrightOperationErrorCapture({
    targetOrigin: 'https://localhost:4200',
    authenticated: () => true,
    evidenceFile: '/evidence/operation-errors.json',
  });
  const request = {
    method: () => 'POST',
    url: () => 'https://localhost:4200/api/widgets',
  };
  const response = {
    status: () => 422,
    url: request.url,
    request: () => request,
  };

  capture.captureResponse(response);
  assert.throws(() => capture.expectResponse(response, 'expected-negative'), /operationId/);
  capture.expectResponse(response, 'expected-negative', { operationId: 'createWidget' });
  capture.captureConsole({
    type: () => 'error',
    text: () => 'Failed to load resource: the server responded with a status of 422',
    location: () => ({ url: request.url() }),
  });
  capture.correlateConsoleHttpErrors();

  const report = buildOperationErrorAttributionReport({
    events: capture.events,
    assertions: capture.assertions,
  });
  assert.equal(report.enterpriseGate.status, 'passed');
  assert.equal(report.counts.attributed, 2);
  assert.equal(report.counts.unmatchedAuthenticated, 0);
});

test('captures console and page errors as independent event classes', () => {
  const capture = createPlaywrightOperationErrorCapture({
    targetOrigin: 'https://localhost:4200',
    authenticated: () => true,
  });
  const consoleEvent = capture.captureConsole({
    type: () => 'error',
    text: () => 'console failure',
    location: () => ({ url: 'https://localhost:4200/form-crud' }),
  });
  const pageEvent = capture.capturePageError(new Error('page failure'), 'https://localhost:4200/form-crud');

  assert.equal(consoleEvent.classification, 'frontend-console');
  assert.equal(pageEvent.classification, 'page-error');
  assert.equal(capture.events.length, 2);
});

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
  assert.deepEqual(parseCapturedResponseJson(captured, 'configuration save'), { saved: true });
});

async function captureBodyUnavailableAfterNavigation(navigationFallback, responseStatus = 200, bodyLifecycle = undefined) {
  const failure = new Error('Protocol error (Network.getResponseBody): No data found for resource with given identifier');
  let navigatedAway = false;
  let frameNavigationListener;
  let responsePredicate;
  let resolveResponse;
  let requestListener;
  const mainFrame = {};
  const request = { timing: () => ({ startTime: Date.now() + 1 }) };
  const response = {
    body: async () => {
      bodyLifecycle?.push('body-read-started');
      await new Promise(resolve => setImmediate(resolve));
      if (navigatedAway) {
        bodyLifecycle?.push('body-read-rejected');
        throw failure;
      }
      return Buffer.from('unreachable');
    },
    request: () => request,
    status: () => responseStatus,
  };
  const page = {
    mainFrame: () => mainFrame,
    on: (event, listener) => {
      if (event === 'request') requestListener = listener;
      if (event === 'framenavigated') frameNavigationListener = listener;
    },
    off: () => {},
    waitForResponse: predicate => {
      responsePredicate = predicate;
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    },
  };

  const predicate = () => true;
  const action = async () => {
    requestListener(request);
    if (responsePredicate(response)) resolveResponse(response);
    navigatedAway = true;
    bodyLifecycle?.push('main-frame-navigated');
    frameNavigationListener(mainFrame);
  };
  const options = { timeout: 100, label: 'deletion' };
  if (navigationFallback) {
    return captureSuccessfulResponseJsonForAction(page, predicate, action, options, navigationFallback);
  }
  return captureResponseBodySnapshotForAction(page, predicate, action, options);
}

test('retains the navigation fallback when an eagerly started body read later loses Chromium data', async () => {
  const bodyLifecycle = [];

  const capture = await captureBodyUnavailableAfterNavigation(undefined, 200, bodyLifecycle);

  assert.deepEqual(bodyLifecycle, ['body-read-started', 'main-frame-navigated', 'body-read-rejected']);
  assert.equal(capture.bodyUnavailableAfterNavigation, true);
  assert.match(capture.bodyError.message, /Network\.getResponseBody.*No data found/);
});

test('uses the caller authenticated GET readback when navigation discards a successful response body', async () => {
  const readbackRequests = [];
  const captured = await captureBodyUnavailableAfterNavigation(async () => {
    readbackRequests.push({ method: 'GET', authorization: 'Bearer fixture-target-token' });
    return [{ pickerId: 'restored' }];
  });

  assert.deepEqual(readbackRequests, [{ method: 'GET', authorization: 'Bearer fixture-target-token' }]);
  assert.deepEqual(captured.body, [{ pickerId: 'restored' }]);
});

test('propagates failed readback when navigation makes a successful response body unavailable', async () => {
  const readbackFailure = new Error('authoritative GET failed: HTTP 500');

  await assert.rejects(
    captureBodyUnavailableAfterNavigation(async () => {
      throw readbackFailure;
    }),
    error => error === readbackFailure,
  );
});

test('captures authenticated absence evidence for a successful delete whose body was lost to navigation', async () => {
  const capture = await captureBodyUnavailableAfterNavigation();
  let readbackCalls = 0;

  const evidence = await captureSuccessfulDeleteReadbackEvidence(capture, {
    url: '/api/widgets/123',
    readback: async () => {
      readbackCalls += 1;
      return { status: 404 };
    },
  });

  assert.equal(readbackCalls, 1);
  assert.deepEqual(evidence, {
    method: 'GET',
    url: '/api/widgets/123',
    status: 404,
    expectedStatusCodes: [404, 410],
    verified: true,
  });
});

test('preserves post-delete request correlation in authenticated absence evidence', async () => {
  const capture = await captureBodyUnavailableAfterNavigation();

  const evidence = await captureSuccessfulDeleteReadbackEvidence(capture, {
    url: '/api/widgets/123',
    readback: async () => ({
      status: 404,
      authenticated: true,
      target: true,
      requestId: 'browser-request-7',
      evidenceRef: '/evidence/operation-errors.json#/source/events/6',
    }),
  });

  assert.equal(evidence.requestId, 'browser-request-7');
  assert.equal(evidence.evidenceRef, '/evidence/operation-errors.json#/source/events/6');
  assert.equal(evidence.verified, true);
});

test('fails successful delete evidence when authenticated readback does not prove absence', async () => {
  const capture = await captureBodyUnavailableAfterNavigation();

  await assert.rejects(
    captureSuccessfulDeleteReadbackEvidence(capture, {
      url: '/api/widgets/123',
      readback: async () => ({ status: 200 }),
    }),
    error =>
      error.message === 'Authenticated delete readback did not prove deletion: HTTP 200' &&
      error.deleteReadbackEvidence?.verified === false &&
      error.deleteReadbackEvidence?.status === 200,
  );
});

test('does not use authenticated delete readback for an unsuccessful delete response', async () => {
  const capture = await captureBodyUnavailableAfterNavigation();
  capture.response.status = () => 500;
  let readbackCalls = 0;

  const evidence = await captureSuccessfulDeleteReadbackEvidence(capture, {
    url: '/api/widgets/123',
    readback: async () => {
      readbackCalls += 1;
      return { status: 404 };
    },
  });

  assert.equal(evidence, undefined);
  assert.equal(readbackCalls, 0);
});

test('does not use readback for an unrelated response-body capture failure', async () => {
  let readbackCalls = 0;
  const failure = new Error('Protocol error (Network.getResponseBody): No data found for resource with given identifier');

  await assert.rejects(
    parseSuccessfulResponseJson({ response: { status: () => 200 }, bodyError: failure }, 'configuration save', async () => {
      readbackCalls += 1;
      return [];
    }),
    error => error.cause === failure && /configuration save response body/.test(error.message),
  );

  assert.equal(readbackCalls, 0);
});

test('keeps strict response-body capture failures as harness errors', async () => {
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

test('preserves non-JSON response bodies as text', () => {
  const text = '<html><body>not JSON</body></html>';

  assert.equal(capturedResponseBodyText({ body: Buffer.from(text) }, 'HTML response'), text);
});

test('reports an available malformed mutation body without using the fallback or exposing its contents', async () => {
  const malformed = '{"accessToken":"confidential"';
  let fallbackCalls = 0;

  await assert.rejects(
    parseSuccessfulResponseJson({ response: { status: () => 200 }, body: Buffer.from(malformed) }, 'configuration save', async () => {
      fallbackCalls += 1;
      return [];
    }),
    error =>
      error.cause instanceof SyntaxError &&
      error.message === 'Unable to parse configuration save response body as JSON' &&
      !error.message.includes('confidential'),
  );
  assert.equal(fallbackCalls, 0);
});

test('rejects a non-2xx response without using the authenticated readback fallback', async () => {
  let fallbackCalls = 0;

  await assert.rejects(
    captureBodyUnavailableAfterNavigation(async () => {
      fallbackCalls += 1;
      return [];
    }, 500),
    /deletion failed: HTTP 500/,
  );

  assert.equal(fallbackCalls, 0);
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
