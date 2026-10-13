import { persistenceReadIdentity } from './form-crud-persistence.mjs';
import { isEventLikeOperation, semanticIdentityCandidate, semanticIdentityValue } from './operation-identity.mjs';
import { isConfirmedResourceStateRecord } from './operation-payload.mjs';

function normalizedPathSegments(value) {
  return String(value ?? '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/api(?=\/|$)/, '')
    .split(/[?#]/, 1)[0]
    .split('/')
    .filter(Boolean);
}

function pathParameterName(segment) {
  return /^\{([^}]+)\}$/.exec(segment)?.[1];
}

function pathParameters(operation) {
  return (operation?.parameters ?? []).filter(parameter => parameter.location === 'path' && parameter.required);
}

function staticPathPrefix(operation) {
  const segments = normalizedPathSegments(operation?.path);
  const parameterIndex = segments.findIndex(pathParameterName);
  return segments.slice(0, parameterIndex < 0 ? segments.length : parameterIndex).join('/');
}

function normalizedTag(operation) {
  return String(operation?.tag ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

function recordMatchesReadResource(record, readOperation) {
  return (
    staticPathPrefix(record?.operation) === staticPathPrefix(readOperation) ||
    (normalizedTag(record?.operation) && normalizedTag(record.operation) === normalizedTag(readOperation))
  );
}

function readIsCanonicalForOperation(readOperation, operation) {
  if (String(readOperation?.method).toUpperCase() !== 'GET' || pathParameters(readOperation).length === 0) return false;
  const readSegments = normalizedPathSegments(readOperation.path);
  const operationSegments = normalizedPathSegments(operation?.path);
  if (readSegments.length > operationSegments.length) return false;
  return readSegments.every((segment, index) => {
    const operationSegment = operationSegments[index];
    const readParameter = pathParameterName(segment);
    const operationParameter = pathParameterName(operationSegment);
    return readParameter || operationParameter ? Boolean(readParameter && operationParameter) : segment === operationSegment;
  });
}

function canonicalReadOperations(operation, declaredOperations) {
  const operationSegments = normalizedPathSegments(operation?.path);
  return (declaredOperations ?? [])
    .filter(candidate => readIsCanonicalForOperation(candidate, operation))
    .sort((left, right) => {
      const leftSegments = normalizedPathSegments(left.path);
      const rightSegments = normalizedPathSegments(right.path);
      return (
        Number(rightSegments.length === operationSegments.length) - Number(leftSegments.length === operationSegments.length) ||
        rightSegments.length - leftSegments.length ||
        String(left.id ?? left.operationId ?? left.path).localeCompare(String(right.id ?? right.operationId ?? right.path))
      );
    });
}

function responseStateRecord(record) {
  return record?.persistedResponseBody === undefined ? record : { ...record, responseBody: record.persistedResponseBody };
}

function predecessorCorrelations(eventRecord, priorRecords, declaredOperations) {
  const correlations = [];
  for (const predecessor of priorRecords) {
    if (
      predecessor?.source !== eventRecord.source ||
      isEventLikeOperation(predecessor?.operation) ||
      !isConfirmedResourceStateRecord(predecessor)
    ) {
      continue;
    }
    const predecessorState = responseStateRecord(predecessor);
    for (const readOperation of (declaredOperations ?? []).filter(
      candidate =>
        String(candidate?.method).toUpperCase() === 'GET' &&
        pathParameters(candidate).length > 0 &&
        recordMatchesReadResource(predecessor, candidate),
    )) {
      for (const parameter of pathParameters(readOperation)) {
        const predecessorIdentity = semanticIdentityCandidate(readOperation, parameter, [predecessorState], {
          origins: ['response', 'request'],
        });
        if (!predecessorIdentity) continue;
        const eventIdentity = semanticIdentityCandidate(readOperation, parameter, [eventRecord], {
          origins: ['request'],
          field: predecessorIdentity.field,
        });
        if (eventIdentity?.value !== predecessorIdentity.value) continue;
        correlations.push({
          operationId: predecessor.operation?.id ?? predecessor.operation?.operationId,
          path: predecessor.operation?.path,
          parameter: parameter.name,
          value: predecessorIdentity.value,
        });
      }
    }
  }
  return correlations;
}

function resolvedCandidatePath(readOperation, resolutions) {
  let resolvedPath = readOperation.path;
  for (const resolution of resolutions) {
    resolvedPath = resolvedPath.replace(`{${resolution.parameter}}`, encodeURIComponent(resolution.value));
  }
  return resolvedPath.includes('{') ? undefined : resolvedPath;
}

export function correlatedEventIdentityCandidate(operation, records, declaredOperations, { source = 'api-operations' } = {}) {
  if (isEventLikeOperation(operation)) return undefined;
  const reads = canonicalReadOperations(operation, declaredOperations);
  if (reads.length === 0) return undefined;

  const matches = [];
  for (const [recordIndex, record] of (records ?? []).entries()) {
    if (
      record?.source !== source ||
      record.status < 200 ||
      record.status >= 300 ||
      !isEventLikeOperation(record.operation) ||
      record.requestBody === null ||
      typeof record.requestBody !== 'object'
    ) {
      continue;
    }
    const correlations = predecessorCorrelations(record, records.slice(0, recordIndex), declaredOperations);
    if (correlations.length === 0) continue;

    for (const readOperation of reads) {
      const resolutions = [];
      for (const parameter of pathParameters(readOperation)) {
        const value = semanticIdentityValue(readOperation, parameter, [record], { origins: ['request'] });
        if (!value) break;
        resolutions.push({
          parameter: parameter.name,
          value,
          source: 'event-request-semantic-candidate',
        });
      }
      if (resolutions.length !== pathParameters(readOperation).length) continue;
      const path = resolvedCandidatePath(readOperation, resolutions);
      if (!path) continue;
      matches.push({
        sourceRecord: record,
        readOperation,
        path,
        resolutions,
        evidence: {
          source: {
            operationId: record.operation?.id ?? record.operation?.operationId,
            method: record.operation?.method,
            path: record.operation?.path,
            status: record.status,
            executionSource: record.source,
          },
          predecessor: correlations[0],
          candidate: {
            path,
            parameters: resolutions.map(({ parameter, value }) => ({ parameter, value })),
          },
        },
      });
      break;
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}

export function classifyEventCandidateRead(candidate, response) {
  const url = response?.url ?? candidate.path;
  const status = response?.status;
  const evidence = {
    ...candidate.evidence,
    canonicalRead: {
      operationId: candidate.readOperation?.id ?? candidate.readOperation?.operationId,
      method: 'GET',
      path: candidate.readOperation?.path,
      url,
      status,
      headers: response?.headers ?? {},
    },
  };
  if (!(status >= 200 && status < 300)) {
    return {
      usable: false,
      blocksDependentMutation: true,
      externallyPreconditioned: true,
      classification: 'externally-preconditioned',
      reasonCode: 'event-did-not-materialize-resource',
      reason: `event identity candidate was not reachable through canonical GET ${url}: HTTP ${status ?? 'unknown'}`,
      evidence,
    };
  }

  const identity = persistenceReadIdentity(candidate.readOperation, candidate.path, response.body);
  if (!identity.verified) {
    return {
      usable: false,
      blocksDependentMutation: true,
      externallyPreconditioned: false,
      classification: 'unexpected-failure',
      reasonCode: 'canonical-resource-identity-mismatch',
      reason: `canonical GET ${url} did not return the candidate resource identity`,
      evidence: {
        ...evidence,
        readbackIdentityEvidence: identity.evidence,
      },
    };
  }

  return {
    usable: true,
    blocksDependentMutation: false,
    externallyPreconditioned: false,
    classification: 'success',
    evidence: {
      ...evidence,
      readbackIdentityEvidence: identity.evidence,
    },
    resourceRecord: {
      operation: candidate.readOperation,
      source: candidate.sourceRecord.source,
      status,
      responseBody: response.body,
      persistedResponseBody: response.body,
      responseBodySource: 'authenticated-event-candidate-readback',
      responseHeaders: response.headers ?? {},
      responseUrl: url,
      persistenceVerified: true,
      verifiedPersistenceReadPath: candidate.path,
      createdByApiOperations: true,
      eventIdentityCandidateEvidence: evidence,
    },
  };
}
