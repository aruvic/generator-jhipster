import { isDeepStrictEqual } from 'node:util';

import { isEventLikeOperation, semanticIdentityValue } from './operation-identity.mjs';

function normalizedPayloadName(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

function isObjectPayload(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clonePayload(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function isConfirmedResourceStateRecord(record) {
  if (isEventLikeOperation(record?.operation)) return false;
  if (record?.persistenceVerified === false) return false;
  if (record?.status !== undefined && (record.status < 200 || record.status >= 300)) return false;
  return record?.status !== 202 || record.persistenceVerified === true;
}

function fillMissingPayload(target, source) {
  if (!isObjectPayload(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = clonePayload(value);
    } else if (isObjectPayload(target[key]) && isObjectPayload(value)) {
      fillMissingPayload(target[key], value);
    }
  }
  return target;
}

function requestBodyRoot(fields) {
  if (fields.length === 1 && fields[0]?.path?.length === 0) return fields[0];
  return { name: 'body', path: [], type: 'object', required: true, fields };
}

function structuredRequestValue(value, field, coerceJsonText) {
  if (coerceJsonText && typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (field?.type === 'array') return Array.isArray(value) ? value : undefined;
  return isObjectPayload(value) ? value : undefined;
}

function isTopLevelIdentifierField(field) {
  return field?.path?.length === 1 && /^(?:id|.*(?:[_-]id|Id|ID))$/.test(String(field.name ?? ''));
}

function projectRequestValue(value, field, { coerceJsonText = false, omitTopLevelIdentifiers = false } = {}) {
  if (value === undefined || field?.readOnly || (omitTopLevelIdentifiers && isTopLevelIdentifierField(field))) return undefined;
  if (value === null) return clonePayload(value);
  if (field?.type === 'array') {
    value = structuredRequestValue(value, field, coerceJsonText);
    if (!value) return undefined;
    if (!field.items) return clonePayload(value);
    return value
      .map(item => projectRequestValue(item, field.items, { coerceJsonText, omitTopLevelIdentifiers }))
      .filter(item => item !== undefined);
  }
  if (field?.type !== 'object') return clonePayload(value);
  value = structuredRequestValue(value, field, coerceJsonText);
  if (!value) return undefined;
  if (!field.fields?.length) return clonePayload(value);

  const output = {};
  for (const child of field.fields) {
    const projected = projectRequestValue(value[child.name], child, { coerceJsonText, omitTopLevelIdentifiers });
    if (projected !== undefined) output[child.name] = projected;
  }
  return output;
}

function requestPayloadFrom(value, fields, options) {
  return projectRequestValue(value, requestBodyRoot(fields), options);
}

function stableRequestValue(value, field) {
  if (value === undefined || field?.readOnly) return undefined;
  if (field?.type === 'object' && field.fields?.length && isObjectPayload(value)) {
    const output = {};
    for (const child of field.fields) {
      const projected = stableRequestValue(value[child.name], child);
      if (projected !== undefined) output[child.name] = projected;
    }
    return Object.keys(output).length > 0 ? output : undefined;
  }
  if (field?.required || field?.writeOnly || field?.discriminatorValues?.length) return projectRequestValue(value, field);
  return undefined;
}

function stableRequestPayloadFrom(value, fields) {
  return stableRequestValue(value, requestBodyRoot(fields));
}

function patchCandidates(current, desired, field, path = [], output = []) {
  if (current === undefined || desired === undefined || field?.readOnly) return output;
  if (field?.type === 'object' && field.fields?.length && isObjectPayload(desired)) {
    for (const child of field.fields) {
      patchCandidates(current?.[child.name], desired[child.name], child, [...path, child.name], output);
    }
    return output;
  }
  if (!isDeepStrictEqual(current, desired)) output.push({ field, path, value: desired });
  return output;
}

function fieldContainsDiscriminator(field) {
  if (field?.discriminatorValues?.length) return true;
  if (field?.type === 'array') return fieldContainsDiscriminator(field.items);
  return field?.type === 'object' && field.fields?.some(fieldContainsDiscriminator);
}

function alternatePatchValue(value, field) {
  const enumValue = field?.enumValues?.find(candidate => !isDeepStrictEqual(candidate, value));
  if (enumValue !== undefined) return enumValue;
  if (field?.type === 'boolean' && typeof value === 'boolean') return !value;
  if (['integer', 'number'].includes(field?.type) && typeof value === 'number' && Number.isFinite(value)) {
    const incremented = field.maximum === undefined ? value + 1 : Math.min(value + 1, field.maximum);
    if (incremented !== value) return incremented;
    const decremented = field.minimum === undefined ? value - 1 : Math.max(value - 1, field.minimum);
    if (decremented !== value) return decremented;
  }
  if (field?.type === 'string' && typeof value === 'string' && !field.pattern && !field.format) {
    const maximumLength = Number.isFinite(field.maxLength) ? field.maxLength : value.length + 1;
    if (value.length < maximumLength) return `${value}x`;
    if (value.length > 0) return `${value.slice(0, -1)}${value.endsWith('x') ? 'y' : 'x'}`;
  }
  if (field?.type === 'array' && Array.isArray(value) && value.length > (field.minItems ?? 0)) return value.slice(0, -1);
  return undefined;
}

function optionalPatchCandidates(current, field, path = [], output = []) {
  if (current === undefined || field?.readOnly) return output;
  if (field?.type === 'object' && field.fields?.length && isObjectPayload(current)) {
    for (const child of field.fields) {
      optionalPatchCandidates(current[child.name], child, [...path, child.name], output);
    }
    return output;
  }
  if (field?.required === true) return output;
  const value = alternatePatchValue(current, field);
  if (value !== undefined) output.push({ field, path, value });
  return output;
}

function setPayloadValue(target, path, value) {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (!isObjectPayload(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[path.at(-1)] = clonePayload(value);
}

function normalizedPathSegments(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  let pathValue = text.split(/[?#]/, 1)[0];
  try {
    if (/^(?:[A-Za-z][A-Za-z\d+.-]*:)?\/\//.test(text)) pathValue = new URL(text, 'http://harness.invalid').pathname;
  } catch {
    return [];
  }
  return pathValue
    .replace(/^\/api(?=\/|$)/, '')
    .split('/')
    .filter(Boolean);
}

function concretePathParameterValue(operation, parameter, pathValue) {
  const templateSegments = normalizedPathSegments(operation?.path);
  const concreteSegments = normalizedPathSegments(pathValue);
  if (templateSegments.length === 0 || templateSegments.length !== concreteSegments.length) return undefined;

  let value;
  for (const [index, segment] of templateSegments.entries()) {
    const match = /^\{([^}]+)\}$/.exec(segment);
    if (!match) {
      if (segment !== concreteSegments[index]) return undefined;
      continue;
    }
    if (match[1] !== parameter.name) continue;
    try {
      value = decodeURIComponent(concreteSegments[index]);
    } catch {
      return undefined;
    }
  }
  return value;
}

function responseLocation(record) {
  const headers = record?.responseHeaders;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get('location') ?? undefined;
  return headers.location ?? headers.Location;
}

function recordIdentityValue(operation, parameter, record) {
  for (const pathValue of [record?.verifiedPersistenceReadPath, record?.responseUrl, responseLocation(record)]) {
    const value = concretePathParameterValue(operation, parameter, pathValue);
    if (value !== undefined && value !== '') return String(value);
  }
  if (record?.persistedResponseBody !== undefined) {
    const value = semanticIdentityValue(operation, parameter, [{ ...record, responseBody: record.persistedResponseBody }], {
      origins: ['response'],
    });
    if (value !== undefined && value !== '') return String(value);
  }
  const responseValue = semanticIdentityValue(operation, parameter, [record], { origins: ['response'] });
  if (responseValue !== undefined && responseValue !== '') return String(responseValue);
  const requestValue = semanticIdentityValue(operation, parameter, [record], { origins: ['request'] });
  return requestValue === undefined || requestValue === '' ? undefined : String(requestValue);
}

function scopedResourceStateRecords(operation, records, { pathParameterValues = {} } = {}) {
  const confirmed = records.filter(isConfirmedResourceStateRecord);
  const parameters = (operation?.parameters ?? []).filter(parameter => parameter.location === 'path');
  if (parameters.length === 0) return confirmed;

  const expectedValues = new Map();
  for (const parameter of parameters) {
    const value = pathParameterValues[parameter.name] ?? pathParameterValues[`path:${parameter.name}`];
    if (value !== undefined && value !== '') expectedValues.set(parameter.name, String(value));
  }
  if (expectedValues.size === 0) {
    const reference = confirmed.find(record =>
      parameters.some(parameter => recordIdentityValue(operation, parameter, record) !== undefined),
    );
    if (!reference) return confirmed;
    for (const parameter of parameters) {
      const value = recordIdentityValue(operation, parameter, reference);
      if (value !== undefined) expectedValues.set(parameter.name, value);
    }
  }
  if (expectedValues.size === 0) return confirmed;

  return confirmed.filter(record =>
    [...expectedValues].every(([parameterName, expectedValue]) => {
      const parameter = parameters.find(candidate => candidate.name === parameterName);
      return recordIdentityValue(operation, parameter, record) === expectedValue;
    }),
  );
}

function resourceStatePriority(record) {
  if (record?.persistedResponseBody !== undefined) return 3;
  if (record?.responseBodySource === 'rendered-ui') return 0;
  if (record?.responseBodySource === 'network') return 2;
  return 1;
}

function successfulResourceState(operation, records, fields, options) {
  const state = {};
  const scopedRecords = scopedResourceStateRecords(operation, records, options)
    .map((record, index) => ({ index, record }))
    .sort((left, right) => resourceStatePriority(right.record) - resourceStatePriority(left.record) || left.index - right.index)
    .map(({ record }) => record);
  for (const record of scopedRecords) {
    const responseState = record?.persistedResponseBody ?? record?.responseBody;
    fillMissingPayload(
      state,
      requestPayloadFrom(responseState, fields, {
        coerceJsonText: record?.responseBodySource === 'rendered-ui',
      }),
    );
    fillMissingPayload(
      state,
      Object.keys(state).length > 0 ?
        stableRequestPayloadFrom(record?.requestBody, fields)
      : requestPayloadFrom(record?.requestBody, fields),
    );
  }
  return state;
}

export function patchPayloadFromResourceState(operation, generatedPayload, records = [], options = {}) {
  const fields = operation?.requestBodyFields ?? [];
  const method = String(operation?.method ?? '').toUpperCase();
  if (!['PATCH', 'PUT'].includes(method) || !isObjectPayload(generatedPayload) || fields.length === 0) {
    return generatedPayload;
  }

  const projectionOptions = { omitTopLevelIdentifiers: method === 'PATCH' };
  const desiredPayload = requestPayloadFrom(generatedPayload, fields, projectionOptions);
  const retainedPayload = requestPayloadFrom(successfulResourceState(operation, records, fields, options), fields, projectionOptions);
  if (!isObjectPayload(retainedPayload) || Object.keys(retainedPayload).length === 0) return desiredPayload;

  const pathParameters = new Set(
    (operation.parameters ?? []).filter(parameter => parameter.location === 'path').map(parameter => normalizedPayloadName(parameter.name)),
  );
  const isMutableCandidate = candidate =>
    candidate.field?.required !== true &&
    !fieldContainsDiscriminator(candidate.field) &&
    !pathParameters.has(normalizedPayloadName(candidate.path.at(-1)));
  const rootField = requestBodyRoot(fields);
  const mutations = patchCandidates(retainedPayload, desiredPayload, rootField).filter(isMutableCandidate);
  if (mutations.length === 0) {
    const fallbackMutation = optionalPatchCandidates(retainedPayload, rootField).find(isMutableCandidate);
    if (fallbackMutation) mutations.push(fallbackMutation);
  }
  for (const mutation of mutations) setPayloadValue(retainedPayload, mutation.path, mutation.value);
  return retainedPayload;
}

export function operationPayloadNames(operation) {
  return [
    ...new Set(
      [operation?.id, operation?.operationId, `${operation?.method ?? ''}-${operation?.operationId ?? ''}`]
        .filter(Boolean)
        .map(normalizedPayloadName),
    ),
  ].sort((left, right) => right.length - left.length);
}

export function payloadFileMatchScore(file, operation) {
  const stem = normalizedPayloadName(file.replace(/\.json$/i, '')).replace(/^\d+/, '');
  const names = operationPayloadNames(operation);
  if (names.includes(stem)) return 1_000_000 + stem.length;

  return names.reduce((best, name) => {
    if (!name) return best;
    if (stem.endsWith(name)) return Math.max(best, 10_000 + name.length - (stem.length - name.length));
    if (name.endsWith(stem)) return Math.max(best, 1_000 + stem.length - (name.length - stem.length));
    if (stem.includes(name)) return Math.max(best, 100 + name.length - (stem.length - name.length));
    if (name.includes(stem)) return Math.max(best, 10 + stem.length - (name.length - stem.length));
    return best;
  }, 0);
}

export function selectPayloadFile(files, operation) {
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => ({ file, score: payloadFileMatchScore(file, operation) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))[0]?.file;
}
