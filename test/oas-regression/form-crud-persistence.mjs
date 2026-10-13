import { semanticIdentityValue } from './operation-identity.mjs';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function pathname(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^(?:[A-Za-z][A-Za-z\d+.-]*:)?\/\//.test(text)) {
    try {
      return new URL(text, 'http://harness.invalid').pathname;
    } catch {
      return '';
    }
  }
  return text.split(/[?#]/, 1)[0];
}

function normalizedPath(value) {
  const pathValue = pathname(value)
    .replace(/^\/api(?=\/|$)/, '')
    .replace(/\/+$/, '');
  return pathValue || '/';
}

function pathSegments(value) {
  return normalizedPath(value).split('/').filter(Boolean);
}

function pathParameterName(segment) {
  const match = /^\{([^}]+)\}$/.exec(segment);
  return match?.[1];
}

function pathsHaveSameShape(left, right) {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  return (
    leftSegments.length === rightSegments.length &&
    leftSegments.every((segment, index) => {
      const rightSegment = rightSegments[index];
      const leftParameter = pathParameterName(segment);
      const rightParameter = pathParameterName(rightSegment);
      return leftParameter || rightParameter ? Boolean(leftParameter && rightParameter) : segment === rightSegment;
    })
  );
}

function createPathExtendsToItem(writePath, readPath) {
  const writeSegments = pathSegments(writePath);
  const readSegments = pathSegments(readPath);
  if (readSegments.length !== writeSegments.length + 1 || !pathParameterName(readSegments.at(-1))) return false;
  return pathsHaveSameShape(writeSegments.join('/'), readSegments.slice(0, -1).join('/'));
}

function isSuccessfulCollectionReplacementForOperation(record, operation) {
  const method = String(record?.operation?.method ?? '').toUpperCase();
  return (
    method === 'PUT' &&
    record?.status >= 200 &&
    record.status < 300 &&
    Array.isArray(record.requestBody) &&
    createPathExtendsToItem(record.operation.path, operation?.path)
  );
}

export function identityRecordsAfterCollectionReplacement(operation, records = []) {
  const replacementIndex = records.findIndex(record => isSuccessfulCollectionReplacementForOperation(record, operation));
  return replacementIndex < 0 ? [...records] : records.slice(0, replacementIndex + 1);
}

function templatePathParameterNames(operation) {
  return pathSegments(operation?.path).map(pathParameterName).filter(Boolean);
}

function declaresTemplatePathParameters(operation) {
  const declarations = new Set(
    (operation?.parameters ?? []).filter(parameter => parameter.location === 'path').map(parameter => parameter.name),
  );
  return templatePathParameterNames(operation).every(name => declarations.has(name));
}

function operationMatchesConcretePath(operation, pathValue) {
  const templateSegments = pathSegments(operation?.path);
  const concreteSegments = pathSegments(pathValue);
  return (
    templateSegments.length === concreteSegments.length &&
    templateSegments.every((segment, index) => pathParameterName(segment) || segment === concreteSegments[index])
  );
}

function compatibleReadKind(writeOperation, readOperation) {
  const method = String(writeOperation?.method ?? '').toUpperCase();
  if (method === 'POST' && createPathExtendsToItem(writeOperation.path, readOperation.path)) return 'created-item';
  if (
    ['PUT', 'PATCH'].includes(method) &&
    templatePathParameterNames(writeOperation).length > 0 &&
    pathsHaveSameShape(writeOperation.path, readOperation.path)
  ) {
    return 'same-item';
  }
  return undefined;
}

function unavailable(reasonCode, reason) {
  return { available: false, reasonCode, reason };
}

function concretePathParameterValue(operation, parameter, targetPath) {
  const templateSegments = pathSegments(operation?.path);
  const concreteSegments = pathSegments(targetPath);
  if (templateSegments.length !== concreteSegments.length) return undefined;

  let value;
  for (const [index, segment] of templateSegments.entries()) {
    const parameterName = pathParameterName(segment);
    if (!parameterName) {
      if (segment !== concreteSegments[index]) return undefined;
      continue;
    }
    if (parameterName !== parameter?.name) continue;
    try {
      value = decodeURIComponent(concreteSegments[index]);
    } catch {
      return undefined;
    }
  }
  return value;
}

export function concreteUrlPath(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  try {
    const url = new URL(text, 'http://harness.invalid');
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

export function semanticIdentityResolution(
  operation,
  parameter,
  records,
  { origins = ['response', 'request'], candidateRecords = records } = {},
) {
  const value = semanticIdentityValue(operation, parameter, records, { origins });
  if (!value) return undefined;

  const candidates = [...new Set([...(candidateRecords ?? []), ...records])];
  const candidateCount = candidates.filter(record => semanticIdentityValue(operation, parameter, [record], { origins }) === value).length;
  return {
    value,
    candidateCount,
    unambiguous: candidateCount === 1,
  };
}

export function persistenceReadCapability(writeOperation, declaredOperations, { location, requestBody } = {}) {
  const method = String(writeOperation?.method ?? '').toUpperCase();
  if (!WRITE_METHODS.has(method)) {
    return unavailable('unsupported-write-method', `${method || 'unknown'} is not a persistence write method`);
  }
  if (Array.isArray(requestBody)) {
    return unavailable(
      'bulk-write-readback-unsupported',
      'the write request represents multiple resources and has no single-resource persistence read-back',
    );
  }
  if (['PUT', 'PATCH'].includes(method) && templatePathParameterNames(writeOperation).length === 0) {
    return unavailable('write-operation-not-item-scoped', `${method} path does not identify a single resource for persistence read-back`);
  }

  const compatibleReads = (declaredOperations ?? [])
    .filter(operation => String(operation?.method ?? '').toUpperCase() === 'GET')
    .map(operation => ({ operation, matchKind: compatibleReadKind(writeOperation, operation) }))
    .filter(candidate => candidate.matchKind);
  const declaredReads = compatibleReads.filter(candidate => declaresTemplatePathParameters(candidate.operation));
  if (compatibleReads.length > 0 && declaredReads.length === 0) {
    return unavailable(
      'read-path-parameters-undeclared',
      'a compatible item GET exists but its path parameters are not declared by the contract',
    );
  }

  const locationRead = location && declaredReads.find(candidate => operationMatchesConcretePath(candidate.operation, location));
  if (locationRead) {
    return {
      available: true,
      readOperation: locationRead.operation,
      matchKind: locationRead.matchKind,
      location,
    };
  }
  if (declaredReads.length > 0) {
    return {
      available: true,
      readOperation: declaredReads[0].operation,
      matchKind: declaredReads[0].matchKind,
      ignoredLocation:
        location ?
          {
            reasonCode: 'location-incompatible-with-contract',
            reason: 'response Location does not match the compatible contract-declared item GET',
          }
        : undefined,
    };
  }
  if (location) {
    return unavailable('location-not-readable-by-contract', 'response Location does not match any compatible contract-declared item GET');
  }
  return unavailable('compatible-item-get-unavailable', 'the OpenAPI contract does not declare a compatible item GET');
}

export function persistenceReadTarget(capability, { responseUrl, resolvedPath, resolutions = [] } = {}) {
  if (capability?.location) {
    const path = concreteUrlPath(capability.location);
    if (path) {
      return {
        available: true,
        path,
        identityEvidence: [{ source: 'location-header', value: path }],
        readbackPathVerified: true,
      };
    }
  }

  if (capability?.matchKind === 'same-item') {
    const path = concreteUrlPath(responseUrl);
    if (path && operationMatchesConcretePath(capability.readOperation, path)) {
      return {
        available: true,
        path,
        identityEvidence: [{ source: 'write-resource-url', value: path }],
        readbackPathVerified: true,
      };
    }
  }

  const ambiguousResolution = resolutions.find(resolution => resolution.semanticIdentityUnambiguous === false);
  if (ambiguousResolution) {
    return unavailable(
      'read-path-identity-ambiguous',
      `semantic identity for path parameter ${ambiguousResolution.parameter} matched ${ambiguousResolution.semanticIdentityCandidateCount} candidates`,
    );
  }

  if (resolvedPath) {
    return {
      available: true,
      path: resolvedPath,
      identityEvidence: resolutions,
      readbackPathVerified: false,
    };
  }

  return unavailable(
    'read-path-parameters-unresolved',
    `compatible item GET ${capability?.readOperation?.path} has unresolved path parameters`,
  );
}

export function persistenceReadPathResolution(operation, parameter, records = []) {
  for (const record of records) {
    const value = concretePathParameterValue(operation, parameter, record?.verifiedPersistenceReadPath);
    if (value !== undefined && value !== '') {
      return { value, source: 'verified-persistence-read-path' };
    }
  }
  return undefined;
}

export function persistenceReadIdentity(readOperation, targetPath, responseBody) {
  const templateSegments = pathSegments(readOperation?.path);
  const concreteSegments = pathSegments(targetPath);
  if (templateSegments.length !== concreteSegments.length || responseBody === null || typeof responseBody !== 'object') {
    return { verified: false, evidence: [] };
  }

  const evidence = [];
  for (const [index, segment] of templateSegments.entries()) {
    const parameterName = pathParameterName(segment);
    if (!parameterName) {
      if (segment !== concreteSegments[index]) return { verified: false, evidence };
      continue;
    }
    const parameter = (readOperation.parameters ?? []).find(candidate => candidate.location === 'path' && candidate.name === parameterName);
    if (!parameter) return { verified: false, evidence };
    let expected;
    try {
      expected = decodeURIComponent(concreteSegments[index]);
    } catch {
      return { verified: false, evidence };
    }
    const actual = semanticIdentityValue(readOperation, parameter, [{ responseBody }], {
      origins: ['response'],
      expectedValue: expected,
    });
    if (!actual) continue;
    evidence.push({ parameter: parameterName, expected, actual });
    if (actual !== expected) return { verified: false, evidence };
  }
  return { verified: evidence.length > 0, evidence };
}

export function classifyPersistenceReadOutcome(
  httpStatus,
  roundTrip,
  { writeResponseBodyAvailable = true, readbackIdentityVerified = false, readbackPathVerified = false } = {},
) {
  const successfulRead = httpStatus >= 200 && httpStatus < 300;
  if (!successfulRead) {
    return {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    };
  }
  if (roundTrip?.checked !== true) {
    return {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-fields-unverified',
    };
  }
  if (roundTrip.matched !== true) {
    return {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-mismatch',
    };
  }
  if (!writeResponseBodyAvailable && !readbackIdentityVerified && !readbackPathVerified) {
    return {
      classification: 'unexpected-failure',
      reasonCode: 'persisted-resource-identity-unverified',
    };
  }
  return { classification: 'success' };
}
