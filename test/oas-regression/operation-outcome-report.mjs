import { buildOperationErrorAttributionReport } from './operation-error-attribution.mjs';

const PREREQUISITE_CLASSIFICATIONS = ['eligible', 'blocked-prerequisite', 'disabled-optional'];
const EXECUTION_CLASSIFICATIONS = ['success-2xx', 'expected-negative', 'unexecutable', 'harness-error', 'unexpected-failure'];

function operationId(operation) {
  return operation.operationId ?? operation.id;
}

function operationPath(operation) {
  return operation.pathTemplate ?? operation.path ?? operation.rawPath;
}

function operationMethod(operation) {
  return typeof operation.method === 'string' ? operation.method.toUpperCase() : undefined;
}

function normalizedOperation(operation, location) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error(`${location} must be an operation object`);
  }
  const method = operationMethod(operation);
  const path = operationPath(operation);
  const id = operationId(operation);
  if ((!method || !path) && !id) {
    throw new Error(`${location} must contain an operation id or method/path selector`);
  }
  return {
    operationId: id,
    method,
    path,
  };
}

function operationKey(operation) {
  if (operation.method && operation.path) return `selector:${operation.method} ${operation.path}`;
  return `id:${operation.operationId}`;
}

function resultKey(result, operationsById) {
  const normalized = normalizedOperation(result, 'operation result');
  if (normalized.method && normalized.path) return operationKey(normalized);
  const operation = operationsById.get(normalized.operationId);
  if (!operation) throw new Error(`Operation result references unknown operation id ${normalized.operationId}`);
  return operationKey(operation);
}

function prerequisiteEntries(report, classification) {
  return report?.results?.[classification] ?? [];
}

export function classifyOperationPrerequisite(report, operation) {
  const normalized = normalizedOperation(operation, 'operation');
  for (const classification of PREREQUISITE_CLASSIFICATIONS) {
    const match = prerequisiteEntries(report, classification).find(candidate => {
      const normalizedCandidate = normalizedOperation(candidate, `prerequisite result ${classification}`);
      if (normalizedCandidate.method && normalizedCandidate.path && normalized.method && normalized.path) {
        return normalizedCandidate.method === normalized.method && normalizedCandidate.path === normalized.path;
      }
      return normalizedCandidate.operationId !== undefined && normalizedCandidate.operationId === normalized.operationId;
    });
    if (match) return { ...match, classification };
  }
  return {
    ...normalized,
    classification: 'eligible',
    required: false,
    reasonCode: 'no-external-prerequisite-declared',
    evidencePaths: [],
  };
}

export function buildOperationOutcomeReport({ operations, prerequisiteReport, outcomes = {}, operationErrorEvidence }) {
  if (!Array.isArray(operations)) throw new Error('operations must be an array');
  const declared = operations.map((operation, index) => normalizedOperation(operation, `operations[${index}]`));
  const operationsByKey = new Map();
  const operationsById = new Map();
  for (const operation of declared) {
    const key = operationKey(operation);
    if (operationsByKey.has(key)) throw new Error(`operations contains duplicate operation ${key}`);
    operationsByKey.set(key, operation);
    if (operation.operationId !== undefined) {
      if (operationsById.has(operation.operationId)) {
        throw new Error(`operations contains duplicate operation id ${operation.operationId}`);
      }
      operationsById.set(operation.operationId, operation);
    }
  }

  const prerequisites = Object.fromEntries(PREREQUISITE_CLASSIFICATIONS.map(classification => [classification, []]));
  const prerequisiteByKey = new Map();
  for (const operation of declared) {
    const classification = classifyOperationPrerequisite(prerequisiteReport, operation);
    const entry = { ...operation, ...classification };
    const key = operationKey(operation);
    prerequisiteByKey.set(key, entry);
    prerequisites[classification.classification].push(entry);
  }

  const results = Object.fromEntries(EXECUTION_CLASSIFICATIONS.map(classification => [classification, []]));
  const executionByKey = new Map();
  for (const classification of EXECUTION_CLASSIFICATIONS) {
    const entries = outcomes[classification] ?? [];
    if (!Array.isArray(entries)) throw new Error(`outcomes.${classification} must be an array`);
    for (const result of entries) {
      const key = resultKey(result, operationsById);
      const operation = operationsByKey.get(key);
      if (!operation) throw new Error(`Operation result references unknown operation ${key}`);
      if (executionByKey.has(key)) throw new Error(`Operation ${key} has multiple execution outcomes`);
      const prerequisite = prerequisiteByKey.get(key);
      if (prerequisite.classification !== 'eligible') {
        throw new Error(`Operation ${key} cannot be exercised while ${prerequisite.classification}`);
      }
      executionByKey.set(key, classification);
      results[classification].push({ ...operation, ...result, classification });
    }
  }

  const missingResult = prerequisites.eligible.filter(operation => !executionByKey.has(operationKey(operation)));
  const blockedRequired = prerequisites['blocked-prerequisite'].filter(operation => operation.required !== false);
  const eligibleRequired = prerequisites.eligible.filter(operation => operation.required === true);
  const requiredCount = blockedRequired.length + eligibleRequired.length;
  const eligibleCount = prerequisites.eligible.length;
  const blockedCount = prerequisites['blocked-prerequisite'].length;
  const disabledCount = prerequisites['disabled-optional'].length;
  const applicable = eligibleCount + blockedCount;
  let gateReasonCode = 'no-required-external-prerequisites-declared';
  if (blockedRequired.length > 0) gateReasonCode = 'required-external-prerequisite-unproven';
  else if (requiredCount > 0) gateReasonCode = 'required-external-prerequisites-satisfied';

  const operationErrorAttribution =
    operationErrorEvidence === undefined ? undefined : buildOperationErrorAttributionReport(operationErrorEvidence);

  return {
    counts: {
      declared: declared.length,
      eligible: eligibleCount,
      blockedPrerequisite: blockedCount,
      disabledOptional: disabledCount,
      success2xx: results['success-2xx'].length,
      expectedNegative: results['expected-negative'].length,
      unexecutable: results.unexecutable.length,
      harnessError: results['harness-error'].length,
      unexpectedFailure: results['unexpected-failure'].length,
      missingResult: missingResult.length,
    },
    denominators: {
      declared: declared.length,
      applicable,
      executionEligible: eligibleCount,
      excludedDisabledOptional: disabledCount,
    },
    enterpriseGate: {
      applicable: requiredCount > 0,
      status: blockedRequired.length > 0 ? 'failed' : 'passed',
      blockedRequiredOperations: blockedRequired.length,
      reasonCode: gateReasonCode,
    },
    prerequisites,
    results,
    missingResult,
    ...(operationErrorAttribution ? { operationErrorAttribution } : {}),
  };
}
