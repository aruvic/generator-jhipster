function normalizePath(pathValue) {
  return (pathValue ?? []).map(segment => (/^\d+$/.test(String(segment)) ? '[]' : String(segment)));
}

export const DEFAULT_OPTIONAL_FIELD_COVERAGE_MINIMUM = 0.75;

export const SCHEMA_COVERAGE_METRIC_LABELS = Object.freeze({
  observedInstanceCoverage: 'full-contract-observed-instance-field-coverage',
  contractCompleteness: 'full-request-response-contract-completeness',
  enterpriseGate: 'artifact-reachable-request-field-gate',
  optionalFieldGate: 'optional-reachable-request-field-coverage-gate',
});

function fieldPath(field, parentPath) {
  const declaredPath = normalizePath(field?.path);
  if (declaredPath.length > 0) return declaredPath;
  if (!field?.name || (parentPath.length === 0 && field.name === 'body')) return parentPath;
  return [...parentPath, field.name];
}

function fieldFacets(field) {
  const facets = [field.required ? 'required' : 'optional'];
  if (field.type === 'object') facets.push('nested-object');
  if (field.type === 'array') facets.push('array');
  if (field.enumValues?.length || field.discriminatorValues?.length) facets.push('enum');
  if (field.format) facets.push('format');
  if (
    [field.minimum, field.maximum, field.minLength, field.maxLength, field.minItems, field.maxItems, field.pattern].some(
      value => value !== undefined,
    )
  ) {
    facets.push('bounds');
  }
  if (field.nullable) facets.push('nullable');
  const children = field.type === 'array' ? field.items?.fields : field.fields;
  const childNames = new Set((children ?? []).map(child => String(child.name ?? '').toLowerCase()));
  if (
    /(?:ref|reference)$/i.test(field.name ?? '') ||
    (childNames.has('href') && ['id', 'tmfid', 'name'].some(name => childNames.has(name)))
  ) {
    facets.push('reference');
  }
  return facets;
}

function collectFields(fields, direction, parentPath = [], output = [], seen = new Set(), inheritedApplicability) {
  for (const field of fields ?? []) {
    const path = fieldPath(field, parentPath);
    const pointer = field.pointer || `/${path.join('/')}`;
    const key = `${direction}:${pointer}`;
    const coverageApplicability = field.coverageApplicability ?? inheritedApplicability;
    if (path.length > 0 && !seen.has(key)) {
      seen.add(key);
      output.push({
        direction,
        pointer,
        path,
        name: field.name,
        required: Boolean(field.required),
        readOnly: Boolean(field.readOnly),
        writeOnly: Boolean(field.writeOnly),
        facets: fieldFacets(field),
        ...(coverageApplicability ? { coverageApplicability } : {}),
      });
    }
    if (field.fields?.length) collectFields(field.fields, direction, path, output, seen, coverageApplicability);
    if (field.items?.fields?.length) {
      collectFields(field.items.fields, direction, [...path, '[]'], output, seen, coverageApplicability);
    }
    if (field.additionalProperties) {
      collectFields([field.additionalProperties], direction, [...path, '{}'], output, seen, coverageApplicability);
    }
  }
  return output;
}

function valuesAtPath(value, path, index = 0) {
  if (value === undefined) return [];
  if (index >= path.length) return [value];
  const segment = path[index];
  if (segment === '[]') {
    return Array.isArray(value) ? value.flatMap(item => valuesAtPath(item, path, index + 1)) : [];
  }
  if (segment === '{}') {
    return value && typeof value === 'object' && !Array.isArray(value) ?
        Object.values(value).flatMap(item => valuesAtPath(item, path, index + 1))
      : [];
  }
  if (!value || typeof value !== 'object') return [];
  return valuesAtPath(value[segment], path, index + 1);
}

function hasConcreteArrayInstancesAtPath(value, path) {
  for (let index = 0; index < path.length; index++) {
    if (path[index] !== '[]') continue;
    const instances = valuesAtPath(value, path.slice(0, index + 1));
    if (!instances.some(instance => instance !== null && typeof instance === 'object')) return false;
  }
  return true;
}

function hasConcreteParentAtPath(value, path) {
  const parents = valuesAtPath(value, path.slice(0, -1));
  return parents.some(parent => parent !== null && typeof parent === 'object' && !Array.isArray(parent));
}

function jsonValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function structuralNonApplicability(field, bodies) {
  const applicability = field.coverageApplicability;
  const evidence = applicability?.evidence;
  const discriminator = evidence?.discriminator;
  if (
    applicability?.status !== 'not-applicable-with-evidence' ||
    applicability.reasonCode !== 'mutually-exclusive-schema-branch' ||
    evidence?.schemaKeyword !== 'oneOf' ||
    typeof evidence.selectedBranchPointer !== 'string' ||
    typeof evidence.excludedBranchPointer !== 'string' ||
    evidence.selectedBranchPointer === evidence.excludedBranchPointer ||
    !Array.isArray(discriminator?.path) ||
    discriminator.path.length === 0 ||
    discriminator.value === undefined ||
    bodies.length === 0
  ) {
    return undefined;
  }
  const selectedBranchObserved = bodies.every(body => {
    const values = valuesAtPath(body, normalizePath(discriminator.path));
    return values.length > 0 && values.every(value => jsonValuesEqual(value, discriminator.value));
  });
  if (!selectedBranchObserved) return undefined;
  return {
    ...field,
    status: 'not-applicable-with-evidence',
    observation: 'not-applicable-with-evidence',
    reasonCode: applicability.reasonCode,
    applicabilityEvidence: evidence,
  };
}

function fieldCoverage(field, records) {
  if (field.direction === 'request' && field.readOnly) {
    return { ...field, status: 'excluded', observation: 'excluded', reasonCode: 'read-only' };
  }
  if (field.direction === 'response' && field.writeOnly) {
    return { ...field, status: 'excluded', observation: 'excluded', reasonCode: 'write-only' };
  }
  const bodyKey = field.direction === 'request' ? 'requestBody' : 'responseBody';
  const bodies = records.map(record => record[bodyKey]).filter(body => body !== undefined);
  if (bodies.length === 0) {
    if (field.direction === 'request') {
      return {
        ...field,
        status: 'not-covered',
        observation: 'absent',
        reasonCode: records.length === 0 ? 'no-request-exchange' : 'request-body-not-observed',
      };
    }
    return {
      ...field,
      status: 'unavailable',
      observation: 'absent',
      reasonCode: records.length === 0 ? 'no-successful-response-exchange' : 'response-body-not-observed',
    };
  }
  const values = bodies.flatMap(body => valuesAtPath(body, field.path));
  if (values.length > 0) {
    return {
      ...field,
      status: 'covered',
      observation: 'observed-value',
      observedNull: values.some(value => value === null),
    };
  }
  const notApplicable = structuralNonApplicability(field, bodies);
  if (notApplicable) return notApplicable;
  if (
    field.direction === 'response' &&
    field.path.includes('[]') &&
    !bodies.some(body => hasConcreteArrayInstancesAtPath(body, field.path))
  ) {
    return { ...field, status: 'unavailable', observation: 'absent', reasonCode: 'no-response-instance' };
  }
  if (!bodies.some(body => hasConcreteParentAtPath(body, field.path))) {
    if (field.direction === 'request') {
      return {
        ...field,
        status: 'not-covered',
        observation: 'absent',
        reasonCode: field.path.includes('[]') ? 'writable-array-item-not-instantiated' : 'writable-parent-not-instantiated',
      };
    }
    return { ...field, status: 'unavailable', observation: 'absent', reasonCode: 'no-concrete-response-parent-instance' };
  }
  return { ...field, status: 'not-covered', observation: 'observed-parent' };
}

function requestGateDisposition(entry) {
  if (entry.direction !== 'request') {
    return { evaluated: false, reasonCode: 'response-only-informational' };
  }
  if (entry.readOnly || entry.status === 'excluded') {
    return { evaluated: false, reasonCode: 'read-only-request-field' };
  }
  if (entry.status === 'not-applicable-with-evidence') {
    return {
      evaluated: false,
      reasonCode: 'structurally-excluded-request-branch',
      evidence: entry.applicabilityEvidence,
    };
  }
  if (entry.status === 'covered') {
    return { evaluated: true, reasonCode: 'concrete-request-value-observed' };
  }
  if (entry.observation === 'observed-parent') {
    return { evaluated: true, reasonCode: 'concrete-request-parent-observed' };
  }
  if (entry.coverageApplicability) {
    return { evaluated: true, reasonCode: 'conditional-request-field-without-exclusion-evidence' };
  }
  return { evaluated: false, reasonCode: 'concrete-request-parent-not-reachable' };
}

function withRequestGateDisposition(entry) {
  return {
    ...entry,
    requestGate: requestGateDisposition(entry),
  };
}

function observedInstanceCoverage(entries) {
  const observed = entries.filter(entry => ['observed-value', 'observed-parent'].includes(entry.observation));
  const covered = observed.filter(entry => entry.status === 'covered').length;
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.observedInstanceCoverage,
    scope: 'full-request-response-contract',
    enforcement: 'informational',
    denominator: observed.length,
    covered,
    notCovered: observed.length - covered,
    absentObservations: entries.filter(entry => entry.observation === 'absent').length,
    coverageRatio: observed.length === 0 ? null : covered / observed.length,
  };
}

function contractCompleteness(entries) {
  const obligations = entries.filter(entry => ['covered', 'not-covered', 'unavailable'].includes(entry.status));
  const covered = obligations.filter(entry => entry.status === 'covered').length;
  const uncovered = obligations.filter(entry => entry.status === 'not-covered').length;
  const unknown = obligations.filter(entry => entry.status === 'unavailable').length;
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.contractCompleteness,
    scope: 'full-request-response-contract',
    enforcement: 'informational',
    denominator: obligations.length,
    covered,
    uncovered,
    unknown,
    notApplicableWithEvidence: entries.filter(entry => entry.status === 'not-applicable-with-evidence').length,
    excluded: entries.filter(entry => entry.status === 'excluded').length,
    completenessRatio: obligations.length === 0 ? null : covered / obligations.length,
    complete: obligations.length > 0 && covered === obligations.length,
  };
}

function summarize(entries) {
  const counts = status => entries.filter(entry => entry.status === status).length;
  const contract = contractCompleteness(entries);
  const observed = observedInstanceCoverage(entries);
  const facets = {};
  for (const facet of new Set(entries.flatMap(entry => entry.facets))) {
    const facetEntries = entries.filter(entry => entry.facets.includes(facet));
    const facetContract = contractCompleteness(facetEntries);
    const facetObserved = observedInstanceCoverage(facetEntries);
    facets[facet] = {
      total: facetEntries.length,
      applicable: facetContract.denominator,
      covered: facetContract.covered,
      notCovered: facetContract.uncovered,
      unavailable: facetEntries.filter(entry => entry.status === 'unavailable').length,
      notApplicableWithEvidence: facetEntries.filter(entry => entry.status === 'not-applicable-with-evidence').length,
      excluded: facetEntries.filter(entry => entry.status === 'excluded').length,
      observedInstanceCoverage: facetObserved,
      contractCompleteness: facetContract,
    };
  }
  return {
    total: entries.length,
    applicable: contract.denominator,
    covered: counts('covered'),
    notCovered: counts('not-covered'),
    unavailable: counts('unavailable'),
    notApplicableWithEvidence: counts('not-applicable-with-evidence'),
    excluded: counts('excluded'),
    coverageRatio: contract.completenessRatio,
    observedInstanceCoverage: observed,
    contractCompleteness: contract,
    facets,
  };
}

export function buildOperationSchemaCoverage(operations, executionRecords) {
  const entries = [];
  for (const operation of operations ?? []) {
    const operationRecords = (executionRecords ?? []).filter(record => record.operation?.id === operation.id);
    const successfulRecords = operationRecords.filter(record => record.status >= 200 && record.status < 300);
    for (const direction of ['request', 'response']) {
      const fields = collectFields(direction === 'request' ? operation.requestBodyFields : operation.responseBodyFields, direction);
      for (const field of fields) {
        entries.push(
          withRequestGateDisposition({
            operationId: operation.id,
            method: operation.method,
            ...fieldCoverage(field, direction === 'request' ? operationRecords : successfulRecords),
          }),
        );
      }
    }
  }
  return {
    ...summarize(entries),
    entries,
  };
}

function evaluatedRequestEntries(entries) {
  return entries.filter(entry => (entry.requestGate ?? requestGateDisposition(entry)).evaluated);
}

function reachableRequestFieldSummary(entries) {
  const declaredWritable = entries.filter(entry => entry.direction === 'request' && !entry.readOnly);
  const evaluated = evaluatedRequestEntries(entries);
  const covered = evaluated.filter(entry => entry.status === 'covered');
  const exclusionCounts = {};
  for (const entry of declaredWritable.filter(entry => !(entry.requestGate ?? requestGateDisposition(entry)).evaluated)) {
    const { reasonCode } = entry.requestGate ?? requestGateDisposition(entry);
    exclusionCounts[reasonCode] = (exclusionCounts[reasonCode] ?? 0) + 1;
  }
  return {
    scope: 'reachable-writable-request-fields',
    enforcement: 'artifact-failure',
    declaredWritable: declaredWritable.length,
    denominator: evaluated.length,
    covered: covered.length,
    uncovered: evaluated.length - covered.length,
    exclusionCounts,
  };
}

function optionalFieldGate(entries, optionalMinimum) {
  const declared = entries.filter(entry => entry.direction === 'request' && !entry.readOnly && !entry.required);
  const obligations = evaluatedRequestEntries(declared);
  const coveredOptional = obligations.filter(entry => entry.status === 'covered');
  const optionalCoverageRatio = obligations.length === 0 ? null : coveredOptional.length / obligations.length;
  const thresholdValid = Number.isFinite(optionalMinimum) && optionalMinimum > 0.5 && optionalMinimum <= 1;
  if (!thresholdValid) {
    return {
      metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.optionalFieldGate,
      scope: 'reachable-optional-writable-request-fields',
      enforcement: 'artifact-failure',
      status: 'failed',
      evaluated: true,
      passed: false,
      reasonCode: 'invalid-optional-field-coverage-minimum',
      denominator: obligations.length,
      covered: coveredOptional.length,
      unknown: obligations.filter(entry => entry.status === 'unavailable').length,
      coverageRatio: optionalCoverageRatio,
      minimum: optionalMinimum,
    };
  }
  if (obligations.length === 0) {
    const structurallyNotApplicable = declared.filter(
      entry => (entry.requestGate ?? requestGateDisposition(entry)).reasonCode === 'structurally-excluded-request-branch',
    ).length;
    const notReachable = declared.filter(
      entry => (entry.requestGate ?? requestGateDisposition(entry)).reasonCode === 'concrete-request-parent-not-reachable',
    ).length;
    return {
      metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.optionalFieldGate,
      scope: 'reachable-optional-writable-request-fields',
      enforcement: 'artifact-failure',
      status: 'not-applicable-with-evidence',
      evaluated: false,
      passed: null,
      reasonCode: declared.length === 0 ? 'no-optional-writable-request-fields-declared' : 'no-reachable-optional-request-fields',
      evidence: {
        declaredOptionalWritableRequestFields: declared.length,
        structurallyNotApplicable,
        notReachable,
      },
      denominator: 0,
      covered: 0,
      unknown: 0,
      coverageRatio: null,
      minimum: optionalMinimum,
    };
  }
  const passed = optionalCoverageRatio >= optionalMinimum;
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.optionalFieldGate,
    scope: 'reachable-optional-writable-request-fields',
    enforcement: 'artifact-failure',
    status: passed ? 'passed' : 'failed',
    evaluated: true,
    passed,
    denominator: obligations.length,
    covered: coveredOptional.length,
    unknown: obligations.filter(entry => entry.status === 'unavailable').length,
    coverageRatio: optionalCoverageRatio,
    minimum: optionalMinimum,
  };
}

export function evaluateOperationSchemaCoverage(
  report,
  { optionalMinimum = DEFAULT_OPTIONAL_FIELD_COVERAGE_MINIMUM, workflowComplete = true, incompleteReasons = [] } = {},
) {
  const entries = report?.entries ?? [];
  const requestGate = reachableRequestFieldSummary(entries);
  const requiredWritable = evaluatedRequestEntries(entries).filter(entry => entry.required);
  const coveredRequiredWritable = requiredWritable.filter(entry => entry.status === 'covered');
  const uncoveredRequiredWritable = requiredWritable.filter(entry => entry.status !== 'covered');
  const optionalGate = optionalFieldGate(entries, optionalMinimum);
  const failures = [
    ...uncoveredRequiredWritable.map(entry => ({
      operationId: entry.operationId,
      direction: entry.direction,
      pointer: entry.pointer,
      reasonCode: 'required-writable-field-not-covered',
    })),
  ];
  if (optionalGate.status === 'failed') {
    failures.push({
      reasonCode: optionalGate.reasonCode ?? 'optional-field-coverage-below-threshold',
      actual: optionalGate.coverageRatio,
      minimum: optionalMinimum,
    });
  }
  const requestGateNotApplicable = requestGate.denominator === 0;
  const gateDetails = {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.enterpriseGate,
    scope: 'reachable-writable-request-fields',
    enforcement: 'artifact-failure',
    observedInstanceCoverage: report?.observedInstanceCoverage ?? observedInstanceCoverage(entries),
    contractCompleteness: report?.contractCompleteness ?? contractCompleteness(entries),
    reachableRequestFields: requestGate,
    requiredWritable: {
      denominator: requiredWritable.length,
      covered: coveredRequiredWritable.length,
      uncovered: requiredWritable.length - coveredRequiredWritable.length,
    },
    optionalFieldGate: optionalGate,
    optionalCoverageRatio: optionalGate.coverageRatio,
    optionalMinimum,
  };
  if (!workflowComplete) {
    return {
      ...gateDetails,
      status: 'not-evaluated',
      evaluated: false,
      passed: null,
      reasonCode: 'incomplete-workflow-evidence',
      incompleteReasons,
      failures: [],
      observedShortfalls: failures,
    };
  }
  if (requestGateNotApplicable) {
    return {
      ...gateDetails,
      status: 'not-applicable-with-evidence',
      evaluated: false,
      passed: null,
      reasonCode: 'no-reachable-writable-request-field-obligations',
      evidence: {
        declaredWritableRequestFields: requestGate.declaredWritable,
        exclusionCounts: requestGate.exclusionCounts,
      },
      incompleteReasons: [],
      failures: [],
    };
  }
  return {
    ...gateDetails,
    status: failures.length === 0 ? 'passed' : 'failed',
    evaluated: true,
    passed: failures.length === 0,
    incompleteReasons: [],
    failures,
  };
}
