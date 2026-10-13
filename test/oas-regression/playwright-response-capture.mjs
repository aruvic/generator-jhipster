import { assertionForOperationErrorEvent, normalizeOperationErrorPath } from './operation-error-attribution.mjs';

function requestUrl(request) {
  return typeof request?.url === 'function' ? request.url() : undefined;
}

function requestMethod(request) {
  return typeof request?.method === 'function' ? request.method().toUpperCase() : undefined;
}

function eventLocation(url) {
  if (!url) return {};
  return { url, path: normalizeOperationErrorPath(url) };
}

function comparableUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${normalizeOperationErrorPath(url.href)}${url.search}`;
  } catch {
    return undefined;
  }
}

function operationErrorEventMetadata({ authenticated, target, requestId, evidenceRef }) {
  return {
    authenticated,
    target,
    authContext: { authenticated, target },
    ...(requestId ? { requestId, correlation: { requestId } } : {}),
    evidenceRef,
    capturedAtIso: new Date().toISOString(),
  };
}

export function createPlaywrightOperationErrorCapture({
  targetOrigin,
  authenticated = () => false,
  evidenceFile = 'operation-error-attribution.json',
}) {
  const normalizedTargetOrigin = new URL(targetOrigin).origin;
  const events = [];
  const assertions = [];
  const requestIds = new WeakMap();
  const responseEvents = new WeakMap();
  const eventsByRequestId = new Map();
  let requestSequence = 0;

  const targetForUrl = url => {
    try {
      return new URL(url, normalizedTargetOrigin).origin === normalizedTargetOrigin;
    } catch {
      return false;
    }
  };
  const requestIdFor = request => {
    let requestId = requestIds.get(request);
    if (!requestId) {
      requestSequence += 1;
      requestId = `browser-request-${requestSequence}`;
      requestIds.set(request, requestId);
    }
    return requestId;
  };
  const addEvent = event => {
    events.push(event);
    if (event.requestId) eventsByRequestId.set(event.requestId, event);
    return event;
  };
  const metadataFor = (url, requestId) =>
    operationErrorEventMetadata({
      authenticated: authenticated() === true,
      target: targetForUrl(url),
      requestId,
      evidenceRef: `${evidenceFile}#/source/events/${events.length}`,
    });

  return {
    events,
    assertions,
    captureRequest(request) {
      return requestIdFor(request);
    },
    captureConsole(message) {
      const location = typeof message.location === 'function' ? message.location() : {};
      const url = location?.url;
      return addEvent({
        classification: 'frontend-console',
        severity: message.type(),
        message: message.text(),
        ...eventLocation(url),
        ...metadataFor(url ?? normalizedTargetOrigin),
      });
    },
    capturePageError(error, url) {
      return addEvent({
        classification: 'page-error',
        message: error.message,
        stack: error.stack,
        ...eventLocation(url),
        ...metadataFor(url ?? normalizedTargetOrigin),
      });
    },
    captureRequestFailure(request) {
      const url = requestUrl(request);
      const requestId = requestIdFor(request);
      return addEvent({
        classification: 'request-failure',
        method: requestMethod(request),
        ...eventLocation(url),
        failure: typeof request.failure === 'function' ? request.failure()?.errorText : undefined,
        ...metadataFor(url, requestId),
      });
    },
    captureResponse(response) {
      const status = response.status();
      if (status < 400 || status > 599) return undefined;
      const request = response.request();
      const url = response.url();
      const requestId = requestIdFor(request);
      const event = addEvent({
        classification: 'http-response',
        method: requestMethod(request),
        ...eventLocation(url),
        status,
        ...metadataFor(url, requestId),
      });
      responseEvents.set(response, event);
      return event;
    },
    correlateConsoleHttpErrors() {
      for (const event of events.filter(candidate => candidate.classification === 'frontend-console')) {
        const statusMatch = event.message?.match(/status(?: of)?\s+([45]\d\d)/i);
        const url = comparableUrl(event.url);
        if (!statusMatch || !url) continue;
        const status = Number(statusMatch[1]);
        const candidates = events.filter(
          candidate =>
            candidate.classification === 'http-response' &&
            candidate.status === status &&
            comparableUrl(candidate.url) === url &&
            candidate.requestId,
        );
        if (candidates.length !== 1) continue;
        const [httpEvent] = candidates;
        event.method = httpEvent.method;
        event.status = httpEvent.status;
        event.correlation = { requestId: httpEvent.requestId };
        event.relatedHttpEvidenceRef = httpEvent.evidenceRef;
        event.evidenceRefs = [...new Set([...(event.evidenceRefs ?? []), httpEvent.evidenceRef])];
      }
    },
    eventForResponse(response) {
      return responseEvents.get(response);
    },
    expectEvent(event, assertionType, metadata = {}) {
      if (!events.includes(event)) throw new Error(`No captured operation-error event exists for asserted ${assertionType} event`);
      const assertion = assertionForOperationErrorEvent(event, {
        assertionType,
        evidenceRef: `${evidenceFile}#/source/assertions/${assertions.length}`,
        ...metadata,
      });
      assertions.push(assertion);
      return assertion;
    },
    expectResponse(response, assertionType, metadata = {}) {
      const event = responseEvents.get(response);
      if (!event) throw new Error(`No captured HTTP error event exists for asserted ${assertionType} response`);
      return this.expectEvent(event, assertionType, metadata);
    },
    expectRequest(requestId, assertionType, metadata = {}) {
      const event = eventsByRequestId.get(requestId);
      if (!event) throw new Error(`No captured operation-error event exists for request ${requestId}`);
      return this.expectEvent(event, assertionType, metadata);
    },
  };
}

export async function captureResponseForAction(page, predicate, action, { timeout, label }) {
  const actionRequests = new Set();
  let actionStarted = false;
  let actionStartedAt = Number.POSITIVE_INFINITY;
  const rememberActionRequest = request => {
    if (actionStarted) actionRequests.add(request);
  };
  page.on('request', rememberActionRequest);
  const responsePromise = page.waitForResponse(
    response => {
      const request = response.request();
      const requestStart = Number(request.timing?.()?.startTime);
      return actionRequests.has(request) && (!Number.isFinite(requestStart) || requestStart >= actionStartedAt) && predicate(response);
    },
    { timeout },
  );
  try {
    actionStartedAt = Date.now();
    actionStarted = true;
    const [response] = await Promise.all([responsePromise, action()]);
    return response;
  } catch (error) {
    throw new Error(`Unable to capture ${label} response while performing the browser action: ${error.message}`, { cause: error });
  } finally {
    page.off('request', rememberActionRequest);
  }
}

export async function captureResponseBodySnapshotForAction(page, predicate, action, options) {
  let bodyResultPromise;
  let mainFrameNavigated = false;
  const mainFrame = typeof page.mainFrame === 'function' ? page.mainFrame() : undefined;
  const rememberMainFrameNavigation = frame => {
    if (mainFrame === undefined || frame === mainFrame) mainFrameNavigated = true;
  };
  page.on('framenavigated', rememberMainFrameNavigation);
  try {
    const response = await captureResponseForAction(
      page,
      candidate => {
        if (!predicate(candidate)) return false;
        // Playwright waits for request completion before issuing Network.getResponseBody, so navigation can still
        // invalidate Chromium's resource while this eagerly started body promise is pending.
        try {
          bodyResultPromise = Promise.resolve(candidate.body()).then(
            body => ({ body }),
            bodyError => ({ bodyError }),
          );
        } catch (error) {
          bodyResultPromise = Promise.resolve({ bodyError: error });
        }
        return true;
      },
      action,
      options,
    );
    const bodyResult = await bodyResultPromise;
    const bodyUnavailableAfterNavigation = mainFrameNavigated && isPlaywrightResponseBodyUnavailable(bodyResult.bodyError);

    return { response, ...bodyResult, bodyUnavailableAfterNavigation };
  } finally {
    page.off('framenavigated', rememberMainFrameNavigation);
  }
}

export async function captureResponseBodyForAction(page, predicate, action, options) {
  const capture = await captureResponseBodySnapshotForAction(page, predicate, action, options);
  if (capture.bodyError) throw responseBodyCaptureError(capture.bodyError, options.label);
  return capture;
}

export async function captureSuccessfulResponseJsonForAction(page, predicate, action, options, navigationFallback) {
  const capture = await captureResponseBodySnapshotForAction(page, predicate, action, options);
  return {
    response: capture.response,
    body: await parseSuccessfulResponseJson(capture, options.label, navigationFallback),
  };
}

function responseBodyCaptureError(error, label) {
  return new Error(`Unable to read ${label} response body while performing the browser action: ${error.message}`, { cause: error });
}

function isPlaywrightResponseBodyUnavailable(error) {
  const message = String(error?.message ?? error ?? '');
  return message.includes('Network.getResponseBody') && message.includes('No data found');
}

export function responseBodyUnavailableAfterNavigation(capture) {
  if (!isPlaywrightResponseBodyUnavailable(capture?.bodyError)) return false;
  const message = String(capture.bodyError.message ?? capture.bodyError);
  return capture.bodyUnavailableAfterNavigation === true || message.includes('navigated away');
}

export function capturedResponseBodyText(capture, label) {
  if (capture.bodyError) {
    throw responseBodyCaptureError(capture.bodyError, label);
  }
  return capture.body.toString('utf8');
}

export function parseCapturedResponseJson(capture, label) {
  const text = capturedResponseBodyText(capture, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Unable to parse ${label} response body as JSON`, { cause: error });
  }
}

export async function parseSuccessfulResponseJson(capture, label, navigationFallback) {
  const status = capture.response.status();
  if (status < 200 || status >= 300) {
    throw new Error(`${label} failed: HTTP ${status}`);
  }
  if (responseBodyUnavailableAfterNavigation(capture)) {
    return navigationFallback();
  }
  return parseCapturedResponseJson(capture, label);
}

export async function captureSuccessfulDeleteReadbackEvidence(capture, { url, readback, expectedStatusCodes = [404, 410] }) {
  const responseStatus = capture?.response?.status();
  if (responseStatus < 200 || responseStatus >= 300 || !responseBodyUnavailableAfterNavigation(capture)) return undefined;

  const evidence = {
    method: 'GET',
    url,
    expectedStatusCodes,
    verified: false,
  };
  let readbackResponse;
  try {
    readbackResponse = await readback();
  } catch (error) {
    evidence.error = error.message;
    const verificationError = new Error(`Authenticated delete readback failed: ${error.message}`, { cause: error });
    verificationError.deleteReadbackEvidence = evidence;
    throw verificationError;
  }

  evidence.status = readbackResponse?.status;
  for (const property of ['authenticated', 'target', 'requestId', 'evidenceRef']) {
    if (readbackResponse?.[property] !== undefined) evidence[property] = readbackResponse[property];
  }
  evidence.verified = expectedStatusCodes.includes(readbackResponse?.status);
  if (!evidence.verified) {
    const verificationError = new Error(
      `Authenticated delete readback did not prove deletion: HTTP ${readbackResponse?.status ?? 'unknown'}`,
    );
    verificationError.deleteReadbackEvidence = evidence;
    throw verificationError;
  }
  return evidence;
}
