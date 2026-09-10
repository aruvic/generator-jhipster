function normalizePath(pathValue) {
  return (pathValue ?? []).map(segment => (/^\d+$/.test(String(segment)) ? '[]' : String(segment)));
}

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

function collectFields(fields, direction, parentPath = [], output = [], seen = new Set()) {
  for (const field of fields ?? []) {
    const path = fieldPath(field, parentPath);
    const pointer = field.pointer || `/${path.join('/')}`;
    const key = `${direction}:${pointer}`;
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
      });
    }
    if (field.fields?.length) collectFields(field.fields, direction, path, output, seen);
    if (field.items?.fields?.length) collectFields(field.items.fields, direction, [...path, '[]'], output, seen);
    if (field.additionalProperties) {
      collectFields([field.additionalProperties], direction, [...path, '{}'], output, seen);
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

function fieldCoverage(field, records) {
  if (field.direction === 'request' && field.readOnly) {
    return { ...field, status: 'excluded', reasonCode: 'read-only' };
  }
  if (field.direction === 'response' && field.writeOnly) {
    return { ...field, status: 'excluded', reasonCode: 'write-only' };
  }
  if (records.length === 0) {
    return { ...field, status: 'unavailable', reasonCode: 'no-successful-exchange' };
  }
  const bodyKey = field.direction === 'request' ? 'requestBody' : 'responseBody';
  const bodies = records.map(record => record[bodyKey]).filter(body => body !== undefined);
  if (bodies.length === 0) {
    return {
      ...field,
      status: 'unavailable',
      reasonCode: field.direction === 'request' ? 'request-body-unavailable' : 'response-body-unavailable',
    };
  }
  const values = bodies.flatMap(body => valuesAtPath(body, field.path));
  if (values.length > 0) {
    return { ...field, status: 'covered', observedNull: values.some(value => value === null) };
  }
  if (
    field.direction === 'response' &&
    field.path.includes('[]') &&
    !bodies.some(body => hasConcreteArrayInstancesAtPath(body, field.path))
  ) {
    return { ...field, status: 'unavailable', reasonCode: 'no-response-instance' };
  }
  if (!bodies.some(body => hasConcreteParentAtPath(body, field.path))) {
    return { ...field, status: 'unavailable', reasonCode: 'no-concrete-parent-instance' };
  }
  return { ...field, status: 'not-covered' };
}

function summarize(entries) {
  const counts = status => entries.filter(entry => entry.status === status).length;
  const applicable = entries.filter(entry => ['covered', 'not-covered'].includes(entry.status));
  const facets = {};
  for (const facet of new Set(entries.flatMap(entry => entry.facets))) {
    const facetEntries = entries.filter(entry => entry.facets.includes(facet));
    const facetApplicable = facetEntries.filter(entry => ['covered', 'not-covered'].includes(entry.status));
    facets[facet] = {
      total: facetEntries.length,
      applicable: facetApplicable.length,
      covered: facetApplicable.filter(entry => entry.status === 'covered').length,
      unavailable: facetEntries.filter(entry => entry.status === 'unavailable').length,
      excluded: facetEntries.filter(entry => entry.status === 'excluded').length,
    };
  }
  return {
    total: entries.length,
    applicable: applicable.length,
    covered: counts('covered'),
    notCovered: counts('not-covered'),
    unavailable: counts('unavailable'),
    excluded: counts('excluded'),
    coverageRatio: applicable.length === 0 ? null : counts('covered') / applicable.length,
    facets,
  };
}

export function buildOperationSchemaCoverage(operations, executionRecords) {
  const entries = [];
  for (const operation of operations ?? []) {
    const successfulRecords = (executionRecords ?? []).filter(
      record => record.operation?.id === operation.id && record.status >= 200 && record.status < 300,
    );
    for (const direction of ['request', 'response']) {
      const fields = collectFields(direction === 'request' ? operation.requestBodyFields : operation.responseBodyFields, direction);
      for (const field of fields) {
        entries.push({
          operationId: operation.id,
          method: operation.method,
          ...fieldCoverage(field, successfulRecords),
        });
      }
    }
  }
  return {
    ...summarize(entries),
    entries,
  };
}

export function evaluateOperationSchemaCoverage(report, { optionalMinimum = 0.5, workflowComplete = true, incompleteReasons = [] } = {}) {
  const applicable = (report?.entries ?? []).filter(entry => ['covered', 'not-covered'].includes(entry.status));
  const uncoveredRequired = applicable.filter(entry => entry.required && entry.status !== 'covered');
  const optional = applicable.filter(entry => !entry.required);
  const coveredOptional = optional.filter(entry => entry.status === 'covered');
  const optionalCoverageRatio = optional.length === 0 ? null : coveredOptional.length / optional.length;
  const failures = [
    ...uncoveredRequired.map(entry => ({
      operationId: entry.operationId,
      direction: entry.direction,
      pointer: entry.pointer,
      reasonCode: 'required-field-not-covered',
    })),
  ];
  if (optionalCoverageRatio !== null && optionalCoverageRatio < optionalMinimum) {
    failures.push({
      reasonCode: 'optional-field-coverage-below-threshold',
      actual: optionalCoverageRatio,
      minimum: optionalMinimum,
    });
  }
  if (!workflowComplete) {
    return {
      status: 'not-evaluated',
      evaluated: false,
      passed: null,
      reasonCode: 'incomplete-workflow-evidence',
      incompleteReasons,
      optionalCoverageRatio,
      optionalMinimum,
      failures: [],
      observedShortfalls: failures,
    };
  }
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    evaluated: true,
    passed: failures.length === 0,
    incompleteReasons: [],
    optionalCoverageRatio,
    optionalMinimum,
    failures,
  };
}
