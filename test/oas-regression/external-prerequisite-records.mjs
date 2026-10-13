import { EXTERNAL_PREREQUISITE_PROTOCOL_VERSION, sanitizeExternalPrerequisiteEvidence } from './external-prerequisite-fixture.mjs';
import { semanticIdentityValue } from './operation-identity.mjs';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const HTTP_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);
const SENSITIVE_KEY_PATTERN = /^(?:accessToken|apiKey|authorization|clientSecret|credential|idToken|password|refreshToken|secret|token)$/i;
const URL_PATTERN = /\b(?:https?|ftp):\/\//i;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertExactKeys(value, allowedKeys, location) {
  const unknownKeys = Object.keys(value).filter(key => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) throw new Error(`${location} contains unknown properties: ${unknownKeys.join(', ')}`);
}

function assertIdentifier(value, location) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${location} must be a stable identifier`);
  }
}

function assertPersistableJson(value, location, depth = 0) {
  if (depth > 20) throw new Error(`${location} exceeds the maximum nesting depth`);
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string') {
    if (URL_PATTERN.test(value)) throw new Error(`${location} must not contain URLs`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPersistableJson(item, `${location}[${index}]`, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error(`${location} contains a sensitive property`);
      assertPersistableJson(nestedValue, `${location}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`${location} must contain only JSON values`);
}

function normalizeSelector(selector, location) {
  if (!isPlainObject(selector)) throw new Error(`${location} must be an object`);
  assertExactKeys(selector, ['method', 'path', 'required'], location);
  if (typeof selector.method !== 'string' || !HTTP_METHODS.has(selector.method)) {
    throw new Error(`${location}.method must be an uppercase HTTP method`);
  }
  if (typeof selector.path !== 'string' || !selector.path.startsWith('/') || selector.path.includes('?') || selector.path.includes('#')) {
    throw new Error(`${location}.path must be an OAS path template`);
  }
  if (selector.required !== undefined && typeof selector.required !== 'boolean') {
    throw new Error(`${location}.required must be boolean`);
  }
  return { method: selector.method, path: selector.path, required: selector.required ?? true };
}

function normalizeProofEvidence(evidence) {
  if (!isPlainObject(evidence)) throw new Error('record.evidence must be an object');
  assertExactKeys(
    evidence,
    ['protocolVersion', 'operationId', 'method', 'pathTemplate', 'status', 'identity', 'assertions'],
    'record.evidence',
  );
  if (evidence.protocolVersion !== EXTERNAL_PREREQUISITE_PROTOCOL_VERSION) {
    throw new Error('record.evidence.protocolVersion is unsupported');
  }
  if (typeof evidence.operationId !== 'string' || evidence.operationId.length === 0) {
    throw new Error('record.evidence.operationId is required');
  }
  if (evidence.method !== 'GET') throw new Error('record.evidence.method must be GET');
  if (typeof evidence.pathTemplate !== 'string' || !evidence.pathTemplate.startsWith('/')) {
    throw new Error('record.evidence.pathTemplate must be an OAS path template');
  }
  if (!Number.isInteger(evidence.status) || evidence.status < 200 || evidence.status > 299) {
    throw new Error('record.evidence.status must be successful');
  }
  if (!Array.isArray(evidence.identity) || evidence.identity.length === 0) {
    throw new Error('record.evidence.identity must contain proof checks');
  }
  const identity = evidence.identity.map((check, index) => {
    if (!isPlainObject(check)) throw new Error(`record.evidence.identity[${index}] must be an object`);
    assertExactKeys(check, ['pointer', 'passed'], `record.evidence.identity[${index}]`);
    if (typeof check.pointer !== 'string' || !check.pointer.startsWith('/') || check.passed !== true) {
      throw new Error(`record.evidence.identity[${index}] must be a passed pointer check`);
    }
    return { pointer: check.pointer, passed: true };
  });
  if (!Array.isArray(evidence.assertions) || evidence.assertions.length === 0) {
    throw new Error('record.evidence.assertions must contain proof checks');
  }
  const assertions = evidence.assertions.map((check, index) => {
    if (!isPlainObject(check)) throw new Error(`record.evidence.assertions[${index}] must be an object`);
    assertExactKeys(check, ['pointer', 'operator', 'passed'], `record.evidence.assertions[${index}]`);
    if (
      typeof check.pointer !== 'string' ||
      !check.pointer.startsWith('/') ||
      typeof check.operator !== 'string' ||
      check.passed !== true
    ) {
      throw new Error(`record.evidence.assertions[${index}] must be a passed assertion check`);
    }
    return { pointer: check.pointer, operator: check.operator, passed: true };
  });
  return sanitizeExternalPrerequisiteEvidence({
    protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
    operationId: evidence.operationId,
    method: 'GET',
    pathTemplate: evidence.pathTemplate,
    status: evidence.status,
    identity,
    assertions,
  });
}

function requestedOperation(operation) {
  if (!isPlainObject(operation)) throw new Error('operation must be an object');
  const method = String(operation.method ?? '');
  const path = String(operation.path ?? '');
  if (!method || method !== method.toUpperCase() || !path.startsWith('/')) {
    throw new Error('operation must contain an uppercase method and OAS path template');
  }
  return { method, path };
}

export function externalPrerequisiteSelectorMatches(selector, operation) {
  const normalizedSelector = normalizeSelector(selector, 'selector');
  const normalizedOperation = requestedOperation(operation);
  return normalizedSelector.method === normalizedOperation.method && normalizedSelector.path === normalizedOperation.path;
}

export function normalizeExternalPrerequisiteRecord(record) {
  if (!isPlainObject(record) || record.proof !== 'passed') return undefined;
  assertExactKeys(record, ['fixtureId', 'resourceId', 'identity', 'enabledOperations', 'proof', 'evidence'], 'record');
  assertIdentifier(record.fixtureId, 'record.fixtureId');
  assertIdentifier(record.resourceId, 'record.resourceId');
  if (!isPlainObject(record.identity) || Object.keys(record.identity).length === 0) {
    throw new Error('record.identity must be a non-empty object');
  }
  assertPersistableJson(record.identity, 'record.identity');
  if (!Array.isArray(record.enabledOperations) || record.enabledOperations.length === 0) {
    throw new Error('record.enabledOperations must be a non-empty array');
  }
  const enabledOperations = record.enabledOperations.map((selector, index) =>
    normalizeSelector(selector, `record.enabledOperations[${index}]`),
  );
  return {
    fixtureId: record.fixtureId,
    resourceId: record.resourceId,
    identity: cloneJson(record.identity),
    enabledOperations,
    proof: 'passed',
    evidence: normalizeProofEvidence(record.evidence),
  };
}

export function promoteExternalPrerequisiteRecords(records, operation) {
  const normalizedOperation = requestedOperation(operation);
  const promoted = [];
  for (const record of records ?? []) {
    const normalized = normalizeExternalPrerequisiteRecord(record);
    if (!normalized) continue;
    const selector = normalized.enabledOperations.find(candidate => externalPrerequisiteSelectorMatches(candidate, normalizedOperation));
    if (!selector) continue;
    promoted.push({
      fixtureId: normalized.fixtureId,
      resourceId: normalized.resourceId,
      identity: cloneJson(normalized.identity),
      selector,
      evidence: normalized.evidence,
    });
  }
  return promoted;
}

export function externalPrerequisiteIdentityValue(records, operation, parameter) {
  const promoted = promoteExternalPrerequisiteRecords(records, operation);
  const values = promoted
    .map(record =>
      semanticIdentityValue(operation, parameter, [{ responseBody: record.identity }], {
        origins: ['response'],
      }),
    )
    .filter(value => value !== undefined);
  const uniqueValues = [...new Set(values)];
  return uniqueValues.length === 1 ? uniqueValues[0] : undefined;
}

export function classifyExternalPrerequisites(resources, records, operation) {
  const normalizedOperation = requestedOperation(operation);
  const promoted = promoteExternalPrerequisiteRecords(records, normalizedOperation);
  const promotedKeys = new Set(promoted.map(record => `${record.fixtureId}\0${record.resourceId}`));
  const matching = [];
  for (const resource of resources ?? []) {
    if (!isPlainObject(resource)) throw new Error('resources entries must be objects');
    const fixtureId = String(resource.fixtureId ?? '');
    const resourceId = String(resource.resourceId ?? resource.id ?? '');
    if (!fixtureId || !resourceId || !Array.isArray(resource.enabledOperations)) {
      throw new Error('resources entries require fixtureId, resourceId, and enabledOperations');
    }
    const selector = resource.enabledOperations
      .map((candidate, index) => normalizeSelector(candidate, `resource.enabledOperations[${index}]`))
      .find(candidate => externalPrerequisiteSelectorMatches(candidate, normalizedOperation));
    if (selector) matching.push({ fixtureId, resourceId, required: selector.required });
  }

  const count = required => {
    const candidates = matching.filter(resource => resource.required === required);
    const proven = candidates.filter(resource => promotedKeys.has(`${resource.fixtureId}\0${resource.resourceId}`));
    return {
      total: candidates.length,
      proven: proven.length,
      missing: candidates.length - proven.length,
    };
  };
  return {
    required: count(true),
    optional: count(false),
    promoted,
  };
}

function evidencePath(filePath, index) {
  if (typeof filePath !== 'string' || filePath.length === 0) return undefined;
  return index >= 0 ? `${filePath}#/${index}` : filePath;
}

function matchingProofIndex(proofResults, fixtureId, resourceId) {
  return (proofResults ?? []).findIndex(result => result?.fixtureId === fixtureId && result?.resourceId === resourceId);
}

function operationReportEntry(dependencies) {
  const first = dependencies[0];
  const missingRequired = dependencies.filter(dependency => dependency.required && dependency.proof !== 'passed');
  const proven = dependencies.filter(dependency => dependency.proof === 'passed');
  const required = dependencies.some(dependency => dependency.required);
  const evidencePaths = [...new Set(dependencies.map(dependency => dependency.evidencePath).filter(Boolean))];
  if (missingRequired.length > 0) {
    return {
      method: first.method,
      path: first.path,
      classification: 'blocked-prerequisite',
      required,
      reasonCode: 'required-external-prerequisite-unproven',
      evidencePaths,
      prerequisites: dependencies,
    };
  }
  if (proven.length > 0) {
    return {
      method: first.method,
      path: first.path,
      classification: 'eligible',
      required,
      reasonCode: 'external-prerequisite-proven',
      evidencePaths,
      prerequisites: dependencies,
    };
  }
  return {
    method: first.method,
    path: first.path,
    classification: 'disabled-optional',
    required: false,
    reasonCode: 'optional-external-prerequisite-unproven',
    evidencePaths,
    prerequisites: dependencies,
  };
}

export function buildExternalPrerequisiteOperationReport({
  resources,
  records,
  proofResults = [],
  proofEvidenceFile,
  verifiedResourcesFile,
}) {
  const verified = (records ?? []).map((record, index) => {
    const normalized = normalizeExternalPrerequisiteRecord(record);
    if (!normalized) throw new Error(`records[${index}] does not contain complete canonical proof`);
    return normalized;
  });
  const verifiedByKey = new Map(verified.map((record, index) => [`${record.fixtureId}\0${record.resourceId}`, { record, index }]));
  const dependenciesByOperation = new Map();

  for (const [resourceIndex, resource] of (resources ?? []).entries()) {
    if (!isPlainObject(resource)) throw new Error(`resources[${resourceIndex}] must be an object`);
    const fixtureId = String(resource.fixtureId ?? '');
    const resourceId = String(resource.resourceId ?? resource.id ?? '');
    if (!fixtureId || !resourceId || !Array.isArray(resource.enabledOperations)) {
      throw new Error(`resources[${resourceIndex}] requires fixtureId, resourceId, and enabledOperations`);
    }
    const verifiedResource = verifiedByKey.get(`${fixtureId}\0${resourceId}`);
    const proofIndex = matchingProofIndex(proofResults, fixtureId, resourceId);
    const failedProof = proofIndex >= 0 ? proofResults[proofIndex] : undefined;
    let proofReasonCode = 'canonical-proof-incomplete';
    if (verifiedResource) proofReasonCode = 'canonical-proof-verified';
    else if (typeof failedProof?.evidence?.reasonCode === 'string') proofReasonCode = failedProof.evidence.reasonCode;
    const proofEvidencePath =
      verifiedResource ? evidencePath(verifiedResourcesFile, verifiedResource.index) : evidencePath(proofEvidenceFile, proofIndex);
    for (const [selectorIndex, selectorValue] of resource.enabledOperations.entries()) {
      const selector = normalizeSelector(selectorValue, `resources[${resourceIndex}].enabledOperations[${selectorIndex}]`);
      const key = `${selector.method}\0${selector.path}`;
      const dependencies = dependenciesByOperation.get(key) ?? [];
      dependencies.push({
        fixtureId,
        resourceId,
        method: selector.method,
        path: selector.path,
        required: selector.required,
        proof: verifiedResource ? 'passed' : 'failed',
        reasonCode: proofReasonCode,
        evidencePath: proofEvidencePath,
      });
      dependenciesByOperation.set(key, dependencies);
    }
  }

  const entries = [...dependenciesByOperation.values()].map(operationReportEntry);
  const results = {
    eligible: entries.filter(entry => entry.classification === 'eligible'),
    'blocked-prerequisite': entries.filter(entry => entry.classification === 'blocked-prerequisite'),
    'disabled-optional': entries.filter(entry => entry.classification === 'disabled-optional'),
  };
  const requiredOperations = entries.filter(entry => entry.required);
  const blockedRequired = results['blocked-prerequisite'].filter(entry => entry.required);
  const applicable = results.eligible.length + results['blocked-prerequisite'].length;
  let gateReasonCode = 'no-required-external-prerequisites-declared';
  if (blockedRequired.length > 0) gateReasonCode = 'required-external-prerequisite-unproven';
  else if (requiredOperations.length > 0) gateReasonCode = 'required-external-prerequisites-satisfied';
  return {
    version: 1,
    counts: {
      declared: entries.length,
      required: requiredOperations.length,
      eligible: results.eligible.length,
      blockedPrerequisite: results['blocked-prerequisite'].length,
      disabledOptional: results['disabled-optional'].length,
    },
    denominators: {
      declared: entries.length,
      applicable,
      executionEligible: results.eligible.length,
      excludedDisabledOptional: results['disabled-optional'].length,
    },
    enterpriseGate: {
      applicable: requiredOperations.length > 0,
      status: blockedRequired.length > 0 ? 'failed' : 'passed',
      blockedRequiredOperations: blockedRequired.length,
      reasonCode: gateReasonCode,
    },
    results,
  };
}
