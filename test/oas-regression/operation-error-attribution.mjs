const EVENT_CLASSIFICATIONS = ['frontend-console', 'page-error', 'request-failure', 'http-response'];
const ASSERTION_TYPES = ['expected-negative', 'post-delete'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizedMethod(value) {
  return nonEmptyString(value) ? value.trim().toUpperCase() : undefined;
}

function isHttpErrorStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(nonEmptyString))];
}

function eventEvidenceReferences(event) {
  return uniqueStrings([event.evidenceRef, ...(Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [])]);
}

function eventCorrelationValue(event, key) {
  const directValue = event[key];
  if (nonEmptyString(directValue)) return directValue;
  const nestedValue = isRecord(event.correlation) ? event.correlation[key] : undefined;
  return nonEmptyString(nestedValue) ? nestedValue : undefined;
}

function evidenceCorrelationMatches(event, evidenceRef) {
  const correlatedEvidenceRef = isRecord(event.correlation) ? event.correlation.evidenceRef : undefined;
  return eventEvidenceReferences(event).includes(evidenceRef) || correlatedEvidenceRef === evidenceRef;
}

function correlationMatches(event, assertion) {
  return Object.entries(assertion.correlation).every(([key, expected]) => {
    if (key === 'evidenceRef') return evidenceCorrelationMatches(event, expected);
    return eventCorrelationValue(event, key) === expected;
  });
}

function normalizeAssertion(assertion, index) {
  const location = `assertions[${index}]`;
  if (!isRecord(assertion)) throw new Error(`${location} must be an assertion object`);
  if (!ASSERTION_TYPES.includes(assertion.assertionType)) {
    throw new Error(`${location}.assertionType must be expected-negative or post-delete`);
  }
  if (!nonEmptyString(assertion.operationId)) {
    throw new Error(`${location}.operationId must be a non-empty string`);
  }

  const method = normalizedMethod(assertion.method);
  if (!method) throw new Error(`${location}.method must be a non-empty string`);

  const path = normalizeOperationErrorPath(assertion.path ?? assertion.url);
  const classification = assertion.classification ?? (isHttpErrorStatus(assertion.status) ? 'http-response' : undefined);
  if (!EVENT_CLASSIFICATIONS.includes(classification)) {
    throw new Error(`${location} must contain an HTTP 4xx/5xx status or an explicit runtime classification`);
  }
  if (classification === 'http-response' && !isHttpErrorStatus(assertion.status)) {
    throw new Error(`${location}.status must be an explicit HTTP 4xx or 5xx status`);
  }
  if (assertion.status !== undefined && !isHttpErrorStatus(assertion.status)) {
    throw new Error(`${location}.status must be an explicit HTTP 4xx or 5xx status when provided`);
  }
  if (assertion.authenticated !== true || assertion.target !== true) {
    throw new Error(`${location} must explicitly require authenticated target operation-error evidence`);
  }
  if (!nonEmptyString(assertion.evidenceRef)) {
    throw new Error(`${location}.evidenceRef must be a non-empty string`);
  }
  if (!isRecord(assertion.correlation)) {
    throw new Error(`${location}.correlation must explicitly identify a request or evidence reference`);
  }

  const correlation = {};
  for (const key of ['requestId', 'evidenceRef']) {
    if (assertion.correlation[key] !== undefined) {
      if (!nonEmptyString(assertion.correlation[key])) {
        throw new Error(`${location}.correlation.${key} must be a non-empty string`);
      }
      correlation[key] = assertion.correlation[key];
    }
  }
  if (Object.keys(correlation).length === 0) {
    throw new Error(`${location}.correlation must explicitly identify a request or evidence reference`);
  }

  const normalizedAssertion = {
    assertionType: assertion.assertionType,
    operationId: assertion.operationId.trim(),
    method,
    path,
    ...(classification === 'http-response' ? {} : { classification }),
    ...(assertion.status === undefined ? {} : { status: assertion.status }),
    authenticated: true,
    target: true,
    correlation,
    evidenceRef: assertion.evidenceRef,
  };

  return {
    assertion: normalizedAssertion,
    assertionIndex: index,
    assertionType: assertion.assertionType,
    operationId: normalizedAssertion.operationId,
    classification,
    method,
    path,
    status: assertion.status,
    authenticated: true,
    target: true,
    evidenceRef: assertion.evidenceRef,
    correlation,
  };
}

function normalizeAssertions(assertions) {
  if (!Array.isArray(assertions)) throw new Error('assertions must be an array');
  return assertions.map(normalizeAssertion);
}

function unmatched(reasonCode, candidates = []) {
  return {
    attribution: 'unmatched',
    reasonCode,
    candidateAssertionIndexes: candidates.map(candidate => candidate.assertionIndex),
    evidenceReferences: uniqueStrings(candidates.map(candidate => candidate.evidenceRef)),
  };
}

function matchNormalizedOperationError(event, assertions) {
  const classification = classifyOperationErrorEvent(event);
  if (classification === 'http-response' && !isHttpErrorStatus(event.status)) return unmatched('not-http-error');
  if (event.target === false || event.authContext?.target === false) {
    return unmatched(classification === 'http-response' ? 'non-target-http-error' : 'non-target-runtime-error');
  }
  if (event.authenticated !== true) {
    return unmatched(classification === 'http-response' ? 'unauthenticated-http-error' : 'unauthenticated-runtime-error');
  }

  const method = normalizedMethod(event.method);
  if (classification === 'http-response' && !method) return unmatched('invalid-http-method');

  let path;
  try {
    path = normalizeOperationErrorPath(event.path ?? event.url);
  } catch {
    return unmatched('invalid-http-path');
  }

  if (assertions.length === 0) return unmatched('no-explicit-assertion');

  const methodMatches = method ? assertions.filter(assertion => assertion.method === method) : assertions;
  if (methodMatches.length === 0) return unmatched('method-mismatch', assertions);

  const pathMatches = methodMatches.filter(assertion => assertion.path === path);
  if (pathMatches.length === 0) return unmatched('path-mismatch', methodMatches);

  const expectationMatches = pathMatches.filter(assertion => {
    if (classification === 'http-response') {
      return assertion.classification === 'http-response' && assertion.status === event.status;
    }
    if (assertion.classification === classification) {
      return assertion.status === undefined || assertion.status === event.status;
    }
    return assertion.classification === 'http-response' && isHttpErrorStatus(event.status) && assertion.status === event.status;
  });
  if (expectationMatches.length === 0) {
    return unmatched(classification === 'http-response' ? 'status-mismatch' : 'classification-mismatch', pathMatches);
  }

  const correlationMatchesEvent = expectationMatches.filter(assertion => correlationMatches(event, assertion));
  if (correlationMatchesEvent.length === 0) return unmatched('correlation-mismatch', expectationMatches);
  if (correlationMatchesEvent.length > 1) return unmatched('ambiguous-assertion', correlationMatchesEvent);

  const [match] = correlationMatchesEvent;
  return {
    attribution: 'matched',
    assertionIndex: match.assertionIndex,
    assertionType: match.assertionType,
    operationId: match.operationId,
    assertion: match.assertion,
    evidenceReferences: uniqueStrings([...eventEvidenceReferences(event), match.evidenceRef]),
  };
}

export function classifyOperationErrorEvent(event) {
  if (!isRecord(event)) throw new Error('event must be an object');
  const classification = event.classification ?? event.eventType ?? event.type;
  if (!EVENT_CLASSIFICATIONS.includes(classification)) {
    throw new Error(`event classification must be one of: ${EVENT_CLASSIFICATIONS.join(', ')}`);
  }
  return classification;
}

export function normalizeOperationErrorPath(value) {
  if (!nonEmptyString(value)) throw new Error('path must be a non-empty string');
  const url = new URL(value.trim(), 'http://operation-error-attribution.invalid');
  const normalized = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

export function matchAuthenticatedHttpError(event, assertions = []) {
  if (classifyOperationErrorEvent(event) !== 'http-response') return unmatched('not-http-response');
  return matchNormalizedOperationError(event, normalizeAssertions(assertions));
}

export function assertionForOperationErrorEvent(event, { assertionType, evidenceRef, operationId, method }) {
  const classification = classifyOperationErrorEvent(event);
  if (classification === 'http-response' && !isHttpErrorStatus(event.status)) {
    throw new Error('HTTP response assertions can only be created for 4xx or 5xx events');
  }
  if (event.authenticated !== true || event.target === false || event.authContext?.target === false) {
    throw new Error('assertions can only be created for authenticated target operation-error events');
  }
  const requestId = eventCorrelationValue(event, 'requestId');
  const eventEvidenceRef = eventEvidenceReferences(event)[0];
  if (!requestId && !eventEvidenceRef) {
    throw new Error('asserted operation-error event must contain a requestId or evidenceRef correlation');
  }
  return normalizeAssertion(
    {
      assertionType,
      operationId,
      method: event.method ?? method,
      path: event.path ?? event.url,
      ...(classification === 'http-response' ? { status: event.status } : { classification }),
      ...(classification !== 'http-response' && isHttpErrorStatus(event.status) ? { status: event.status } : {}),
      authenticated: true,
      target: true,
      correlation: requestId ? { requestId } : { evidenceRef: eventEvidenceRef },
      evidenceRef,
    },
    0,
  ).assertion;
}

export function buildOperationErrorAttributionReport({ events, assertions = [] }) {
  if (!Array.isArray(events)) throw new Error('events must be an array');
  const normalizedAssertions = normalizeAssertions(assertions);
  const classifications = Object.fromEntries(EVENT_CLASSIFICATIONS.map(classification => [classification, []]));
  const counts = Object.fromEntries(EVENT_CLASSIFICATIONS.map(classification => [classification, 0]));
  const attributedEvents = [];
  const unmatchedEvents = [];
  const ambiguousEvents = [];
  const decisions = [];
  const reportEvidenceReferences = [];

  for (const [eventIndex, event] of events.entries()) {
    const classification = classifyOperationErrorEvent(event);
    if (classification === 'http-response' && (!Number.isInteger(event.status) || event.status < 100 || event.status > 599)) {
      throw new Error(`events[${eventIndex}].status must be a valid HTTP status`);
    }

    classifications[classification].push(event);
    counts[classification] += 1;
    reportEvidenceReferences.push(...eventEvidenceReferences(event));

    const eventIsError = classification !== 'http-response' || isHttpErrorStatus(event.status);
    if (!eventIsError) continue;

    const result = matchNormalizedOperationError(event, normalizedAssertions);
    reportEvidenceReferences.push(...result.evidenceReferences);

    if (result.attribution === 'matched') {
      const decision = { eventIndex, classification, event, ...result };
      attributedEvents.push(decision);
      decisions.push(decision);
    } else if (result.reasonCode === 'ambiguous-assertion') {
      const decision = {
        eventIndex,
        classification,
        authenticated: event.authenticated === true,
        target: event.target !== false && event.authContext?.target !== false,
        event,
        ...result,
      };
      ambiguousEvents.push(decision);
      decisions.push(decision);
    } else {
      const decision = {
        eventIndex,
        classification,
        authenticated: event.authenticated === true,
        target: event.target !== false && event.authContext?.target !== false,
        event,
        ...result,
      };
      unmatchedEvents.push(decision);
      decisions.push(decision);
    }
  }

  const isAuthenticatedError = entry => entry.authenticated;
  const isAuthenticatedHttpError = entry => entry.classification === 'http-response' && entry.authenticated;
  const unmatchedAuthenticatedEvents = unmatchedEvents.filter(isAuthenticatedError).length;
  const ambiguousAuthenticatedEvents = ambiguousEvents.filter(isAuthenticatedError).length;
  const unmatchedAuthenticatedHttpErrors = unmatchedEvents.filter(isAuthenticatedHttpError).length;
  const ambiguousAuthenticatedHttpErrors = ambiguousEvents.filter(isAuthenticatedHttpError).length;
  const failedAuthenticatedEvents = unmatchedAuthenticatedEvents + ambiguousAuthenticatedEvents;
  return {
    counts: {
      total: events.length,
      ...counts,
      attributed: attributedEvents.length,
      attributedExpectedNegative: attributedEvents.filter(entry => entry.assertionType === 'expected-negative').length,
      attributedPostDelete: attributedEvents.filter(entry => entry.assertionType === 'post-delete').length,
      unmatched: unmatchedEvents.length,
      ambiguous: ambiguousEvents.length,
      unmatchedAuthenticated: unmatchedAuthenticatedEvents,
      ambiguousAuthenticated: ambiguousAuthenticatedEvents,
    },
    classifications,
    attributedEvents,
    ambiguousEvents,
    decisions,
    evidenceReferences: uniqueStrings(reportEvidenceReferences),
    unmatchedEvents,
    enterpriseGate: {
      metricLabel: 'authenticated-target-http-error-attribution',
      status: failedAuthenticatedEvents > 0 ? 'failed' : 'passed',
      unmatchedAuthenticatedEvents,
      ambiguousAuthenticatedEvents,
      unmatchedAuthenticatedHttpErrors,
      ambiguousAuthenticatedHttpErrors,
    },
  };
}
