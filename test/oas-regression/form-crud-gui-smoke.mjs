#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { semanticIdentityValue } from './operation-identity.mjs';
import { selectPayloadFile } from './operation-payload.mjs';
import { classifyOperationPreparationFailure, classifyOperationResponse } from './operation-response.mjs';

function loadPlaywright() {
  const candidates = [
    process.env.FORM_CRUD_GUI_PLAYWRIGHT_ROOT,
    process.env.PLAYWRIGHT_ROOT,
    process.cwd(),
    '/tmp/playwright-tests',
  ].filter(Boolean);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const requireFromCandidate = createRequire(path.join(candidate, 'package.json'));
      try {
        return requireFromCandidate('playwright');
      } catch {
        return requireFromCandidate('@playwright/test');
      }
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(
    [
      'Playwright is required for Form CRUD GUI tests.',
      'Install it locally and point FORM_CRUD_GUI_PLAYWRIGHT_ROOT at that install, for example:',
      'npm install --prefix /tmp/playwright-tests @playwright/test',
      ...errors,
    ].join('\n'),
  );
}

function loadV8Coverage(appDir) {
  const candidates = [
    appDir,
    process.env.FORM_CRUD_GUI_PLAYWRIGHT_ROOT,
    process.env.PLAYWRIGHT_ROOT,
    process.cwd(),
    '/tmp/playwright-tests',
  ].filter(Boolean);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const requireFromCandidate = createRequire(path.join(candidate, 'package.json'));
      return requireFromCandidate('@bcoe/v8-coverage');
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(
    [
      'Istanbul/V8 conversion dependencies are required for Form CRUD GUI source coverage.',
      'The generated Angular application normally provides them through its test toolchain.',
      ...errors,
    ].join('\n'),
  );
}

if (process.argv[2] === '--check-dependencies') {
  loadPlaywright();
  process.exit(0);
}

const [artifactName, webBaseUrl, outputDir] = process.argv.slice(2);

if (!artifactName || !webBaseUrl || !outputDir) {
  console.error('Usage: form-crud-gui-smoke.mjs <artifact-name> <web-base-url> <output-dir>');
  process.exit(2);
}

fs.mkdirSync(outputDir, { recursive: true });

function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function compactResponse(response) {
  return {
    status: response.status(),
    url: response.url(),
    method: response.request().method(),
  };
}

function slug(value) {
  return (
    String(value || 'step')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'step'
  );
}

function flattenResources(groups = []) {
  const resources = [];
  for (const group of groups) {
    for (const resource of group.resources ?? []) resources.push({ group: group.label, resource });
    for (const child of group.childGroups ?? []) {
      for (const resource of child.resources ?? []) resources.push({ group: `${group.label} / ${child.label}`, resource });
    }
  }
  return resources;
}

function normalizeName(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

function singularName(value) {
  const normalized = normalizeName(value);
  if (normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('ys')) return normalized.slice(0, -1);
  if (normalized.endsWith('s') && normalized.length > 1) return normalized.slice(0, -1);
  return normalized;
}

function pathLeaf(value) {
  return (
    String(value ?? '')
      .split('/')
      .filter(Boolean)
      .pop() ?? ''
  );
}

function schemaPath(field) {
  return Array.isArray(field?.path) && field.path.length ? field.path.join('.') : field?.name;
}

function flattenFields(fields = []) {
  const output = [];
  for (const field of fields ?? []) {
    output.push(field);
    if (field?.fields?.length) output.push(...flattenFields(field.fields));
    if (field?.items?.fields?.length) output.push(...flattenFields(field.items.fields));
  }
  return output;
}

function fieldPathSet(fields = []) {
  return new Set(
    flattenFields(fields)
      .map(field => schemaPath(field))
      .filter(Boolean),
  );
}

function targetCopyFieldsForPath(fields = [], sourcePath) {
  const paths = fieldPathSet(fields);
  const schemaFields = ['id', 'tmfId', 'href', 'name'].filter(
    name => paths.has(`${sourcePath}.${name}`) || paths.has(`${sourcePath}.0.${name}`),
  );
  const configuredFields = [...new Set(['tmfId', 'href', 'name', ...schemaFields])];
  return configuredFields.map(name => ({ source: name, target: name }));
}

function fieldChildNames(field) {
  const target = field?.type === 'array' ? field.items : field;
  return new Set((target?.fields ?? []).map(candidate => normalizeName(candidate.name)));
}

function fieldChildFields(field) {
  const target = field?.type === 'array' ? field.items : field;
  return target?.fields ?? [];
}

function fieldLooksCompactReferenceLike(field) {
  const childFields = fieldChildFields(field);
  const nestedFieldCount = childFields.filter(candidate => ['object', 'array'].includes(candidate.type)).length;
  return childFields.length > 0 && childFields.length <= 12 && nestedFieldCount <= 2;
}

function fieldLooksReferenceLike(field) {
  const fieldName = normalizeName(schemaPath(field) ?? field?.name);
  const names = fieldChildNames(field);
  const hasSchemaReferenceSignal = names.has('referredtype') || names.has('@referredtype');
  const hasNameReferenceSignal = /(?:ref|reference|relationship|related)/.test(fieldName);
  const hasSupportingReferenceSignal = /supporting/.test(fieldName) && fieldLooksCompactReferenceLike(field);
  return hasNameReferenceSignal || hasSchemaReferenceSignal || hasSupportingReferenceSignal;
}

function isReferenceCandidateField(field) {
  const names = fieldChildNames(field);
  return fieldLooksReferenceLike(field) && names.has('href') && ['tmfid', 'id', 'name'].some(name => names.has(name));
}

function schemaPathSegments(pathValue) {
  return String(pathValue ?? '')
    .split('.')
    .filter(Boolean);
}

function isPracticalReferencePickerPath(pathValue) {
  const segments = schemaPathSegments(pathValue);
  const numericCount = segments.filter(segment => /^\d+$/.test(segment)).length;
  const nonIndexSegments = segments
    .filter(segment => !/^\d+$/.test(segment))
    .map(normalizeName)
    .filter(Boolean);
  const repeatedSegment = nonIndexSegments.some((segment, index) => nonIndexSegments.indexOf(segment) !== index);
  return segments.length === 1 && numericCount === 0 && !repeatedSegment;
}

function referencePickerPathScore(pathValue) {
  const segments = schemaPathSegments(pathValue);
  const numericCount = segments.filter(segment => /^\d+$/.test(segment)).length;
  return segments.length + numericCount * 3;
}

function schemaComplexity(fields = []) {
  return flattenFields(fields).length;
}

function referencePickerScenarios(resources) {
  const scenarios = [];
  for (const sourceEntry of resources) {
    const sourceResource = sourceEntry.resource;
    if (!sourceResource?.listOperation || !sourceResource?.updateOperation || !sourceResource?.createOperation) continue;
    const candidateFields = flattenFields(sourceResource.updateOperation.requestBodyFields ?? []).filter(
      field => field.type === 'array' && isReferenceCandidateField(field),
    );

    for (const field of candidateFields) {
      const sourcePath = schemaPath(field);
      if (!sourcePath) continue;
      if (!isPracticalReferencePickerPath(sourcePath)) continue;
      const sourceLeaf = singularName(sourcePath.split('.').filter(Boolean).pop());
      const targetEntry = resources.find(entry => {
        const targetResource = entry.resource;
        if (!targetResource?.listOperation || !targetResource?.createOperation) return false;
        const targetLeaf = singularName(pathLeaf(targetResource.listOperation.path));
        return (
          sourceLeaf && targetLeaf && (sourceLeaf === targetLeaf || sourceLeaf.includes(targetLeaf) || targetLeaf.includes(sourceLeaf))
        );
      });
      if (!targetEntry) continue;
      scenarios.push({ sourceEntry, targetEntry, field, sourcePath });
    }
  }
  return scenarios.sort((left, right) => {
    const leftPathScore = referencePickerPathScore(left.sourcePath);
    const rightPathScore = referencePickerPathScore(right.sourcePath);
    if (leftPathScore !== rightPathScore) return leftPathScore - rightPathScore;
    const leftTargetComplexity = schemaComplexity(left.targetEntry.resource.createOperation?.requestBodyFields);
    const rightTargetComplexity = schemaComplexity(right.targetEntry.resource.createOperation?.requestBodyFields);
    if (leftTargetComplexity !== rightTargetComplexity) return leftTargetComplexity - rightTargetComplexity;
    const leftSourceComplexity = schemaComplexity(left.sourceEntry.resource.createOperation?.requestBodyFields);
    const rightSourceComplexity = schemaComplexity(right.sourceEntry.resource.createOperation?.requestBodyFields);
    return leftSourceComplexity - rightSourceComplexity;
  });
}

function findPayloadForOperation(operation) {
  const payloadDir = path.resolve(outputDir, '..', 'payloads');
  if (!fs.existsSync(payloadDir)) return undefined;
  const file = selectPayloadFile(fs.readdirSync(payloadDir), operation);
  if (!file) return undefined;
  return JSON.parse(fs.readFileSync(path.join(payloadDir, file), 'utf8'));
}

function apiPath(operationPath) {
  const pathValue = String(operationPath ?? '');
  if (pathValue.startsWith('/api/')) return pathValue;
  return `/api/${pathValue.replace(/^\/+/, '')}`;
}

function operationById(operationId) {
  return declaredOperations.find(operation => operation.id === operationId);
}

function operationPathPattern(operation) {
  const escaped = apiPath(operation.path)
    .split(/(\{[^}]+\})/)
    .map(part => (part.startsWith('{') && part.endsWith('}') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${escaped}/?$`);
}

function responseMatchesOperation(response, operation) {
  if (!operation || response.request().method() !== operation.method) return false;
  try {
    return operationPathPattern(operation).test(new URL(response.url()).pathname);
  } catch {
    return false;
  }
}

function recordOperationResponse(operation, response) {
  if (!operation || !response) return;
  submittedOperationIds.add(operation.id);
  if (response.status() >= 200 && response.status() < 300) {
    successfulOperationIds.add(operation.id);
  }
}

function parseJsonText(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizedOperationPath(value) {
  const pathValue = String(value ?? '')
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/api(?=\/|$)/, '')
    .replace(/\/+$/, '');
  return pathValue || '/';
}

function operationStaticPrefix(operation) {
  const segments = normalizedOperationPath(operation?.path).split('/').filter(Boolean);
  const firstParameterIndex = segments.findIndex(segment => /^\{[^}]+\}$/.test(segment));
  const staticSegments = firstParameterIndex >= 0 ? segments.slice(0, firstParameterIndex) : segments;
  return `/${staticSegments.join('/')}`;
}

function operationPathParameters(operation) {
  return (operation?.parameters ?? []).filter(parameter => parameter.location === 'path' && parameter.required);
}

function concretePathParameterFromUrl(operation, parameter, rawUrl) {
  try {
    const templateSegments = normalizedOperationPath(operation.path).split('/').filter(Boolean);
    const actualSegments = normalizedOperationPath(new URL(rawUrl).pathname).split('/').filter(Boolean);
    if (templateSegments.length !== actualSegments.length) return undefined;
    const parameterIndex = templateSegments.findIndex(segment => segment === `{${parameter.name}}`);
    return parameterIndex >= 0 ? decodeURIComponent(actualSegments[parameterIndex]) : undefined;
  } catch {
    return undefined;
  }
}

function scalarValuesForKeys(source, normalizedKeys, output = [], depth = 0) {
  if (source === undefined || source === null || depth > 12) return output;
  if (Array.isArray(source)) {
    for (const item of source) scalarValuesForKeys(item, normalizedKeys, output, depth + 1);
    return output;
  }
  if (typeof source !== 'object') return output;
  for (const [key, value] of Object.entries(source)) {
    if (
      normalizedKeys.has(normalizeName(key)) &&
      value !== undefined &&
      value !== null &&
      ['string', 'number', 'boolean'].includes(typeof value)
    ) {
      output.push(String(value));
    }
    if (value && typeof value === 'object') scalarValuesForKeys(value, normalizedKeys, output, depth + 1);
  }
  return output;
}

function hrefIdentityValues(source, output = [], depth = 0) {
  if (source === undefined || source === null || depth > 12) return output;
  if (Array.isArray(source)) {
    for (const item of source) hrefIdentityValues(item, output, depth + 1);
    return output;
  }
  if (typeof source !== 'object') return output;
  for (const [key, value] of Object.entries(source)) {
    if (normalizeName(key) === 'href' && typeof value === 'string') {
      const segment = value.split(/[/?#]/).filter(Boolean).at(-1);
      if (segment) output.push(decodeURIComponent(segment));
    }
    if (value && typeof value === 'object') hrefIdentityValues(value, output, depth + 1);
  }
  return output;
}

function pathParameterKeyCandidates(parameter) {
  const parameterName = normalizeName(parameter.name);
  const candidates = new Set([parameterName]);
  if (/(?:id|identifier|reference|ref|uuid)$/.test(parameterName)) {
    candidates.add('id');
    candidates.add('tmfid');
    candidates.add('uuid');
  }
  return candidates;
}

function relevantExecutionRecords(operation, { createdByApiOperations = false } = {}) {
  const prefix = operationStaticPrefix(operation);
  return operationExecutionRecords
    .filter(record => {
      if (createdByApiOperations && !record.createdByApiOperations) return false;
      return (
        operationStaticPrefix(record.operation) === prefix ||
        (record.operation?.tag && operation?.tag && normalizeName(record.operation.tag) === normalizeName(operation.tag))
      );
    })
    .toReversed();
}

function pathParameterValue(operation, parameter, options = {}) {
  const records = relevantExecutionRecords(operation, options)
    .filter(record => record.status >= 200 && record.status < 300)
    .sort((left, right) => Number(right.createdByApiOperations) - Number(left.createdByApiOperations));
  const keyCandidates = pathParameterKeyCandidates(parameter);
  const exactResponseValues = [];
  for (const record of records) {
    scalarValuesForKeys(record.responseBody, new Set([normalizeName(parameter.name)]), exactResponseValues);
  }
  const exactResponse = [...new Set(exactResponseValues.map(value => String(value).trim()).filter(Boolean))][0];
  if (exactResponse) return exactResponse;

  const semanticResponse = semanticIdentityValue(operation, parameter, records, { origins: ['response'] });
  if (semanticResponse) return semanticResponse;

  const values = [];
  for (const record of records) {
    const concrete = concretePathParameterFromUrl(record.operation, parameter, record.responseUrl);
    if (concrete) values.push(concrete);
    const location = record.responseHeaders?.location;
    if (location) {
      const locationSegment = location.split(/[/?#]/).filter(Boolean).at(-1);
      if (locationSegment) values.push(decodeURIComponent(locationSegment));
    }
  }
  const locationOrUrlIdentity = [...new Set(values.map(value => String(value).trim()).filter(Boolean))][0];
  if (locationOrUrlIdentity) return locationOrUrlIdentity;

  const exactRequestValues = [];
  for (const record of records) {
    scalarValuesForKeys(record.requestBody, new Set([normalizeName(parameter.name)]), exactRequestValues);
  }
  const exactRequest = [...new Set(exactRequestValues.map(value => String(value).trim()).filter(Boolean))][0];
  if (exactRequest) return exactRequest;

  const semanticRequest = semanticIdentityValue(operation, parameter, records, { origins: ['request'] });
  if (semanticRequest) return semanticRequest;

  for (const record of records) {
    scalarValuesForKeys(record.responseBody, keyCandidates, values);
    scalarValuesForKeys(record.requestBody, keyCandidates, values);
    if ([...keyCandidates].some(candidate => ['id', 'tmfid', 'uuid'].includes(candidate))) {
      scalarValuesForKeys(record.responseBody, new Set(['id', 'tmfid', 'uuid']), values);
      scalarValuesForKeys(record.requestBody, new Set(['id', 'tmfid', 'uuid']), values);
      hrefIdentityValues(record.responseBody, values);
    }
  }
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))][0];
}

function schemaFieldExample(field, depth = 0) {
  if (!field || depth > 12) return undefined;
  if (field.example !== undefined) return structuredClone(field.example);
  if (field.defaultValue !== undefined) return structuredClone(field.defaultValue);
  if (field.discriminatorValues?.length) return field.discriminatorValues[0];
  if (field.enumValues?.length) return field.enumValues[0];
  if (field.type === 'object') {
    const output = {};
    for (const child of field.fields ?? []) {
      if (child.readOnly) continue;
      const value = schemaFieldExample(child, depth + 1);
      if (value !== undefined) output[child.name] = value;
    }
    if (Object.keys(output).length === 0 && field.additionalProperties) {
      const value = schemaFieldExample(field.additionalProperties, depth + 1);
      if (value !== undefined) output.key = value;
    }
    return output;
  }
  if (field.type === 'array') {
    const item = schemaFieldExample(field.items, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') {
    const minimum = Number(field.minimum);
    return Number.isFinite(minimum) ? minimum : 1;
  }
  if (field.format === 'date') return '2026-01-01';
  if (field.format === 'date-time') return '2026-01-01T00:00:00Z';
  if (field.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (field.format === 'email') return 'test@example.invalid';
  if (field.format === 'uri' || field.format === 'url') return 'https://example.invalid/resource';
  return 'test-value';
}

function sanitizeRequestValue(value, field, depth = 0) {
  if (!field || field.readOnly || depth > 16) return undefined;
  if (value === undefined) return field.required ? schemaFieldExample(field, depth + 1) : undefined;
  if (value === null || typeof value !== 'object') return structuredClone(value);

  if (field.type === 'array') {
    if (!Array.isArray(value)) return schemaFieldExample(field, depth + 1);
    return value.map(item => sanitizeRequestValue(item, field.items, depth + 1)).filter(item => item !== undefined);
  }

  if (field.type !== 'object' || Array.isArray(value)) return structuredClone(value);
  const fields = field.fields ?? [];
  if (fields.length === 0 && !field.additionalProperties) return structuredClone(value);

  const output = {};
  const declaredNames = new Set(fields.map(child => child.name));
  for (const child of fields) {
    if (child.readOnly) continue;
    const sanitized = sanitizeRequestValue(value[child.name], child, depth + 1);
    if (sanitized !== undefined) output[child.name] = sanitized;
  }
  if (field.additionalProperties) {
    for (const [key, childValue] of Object.entries(value)) {
      if (declaredNames.has(key)) continue;
      const sanitized = sanitizeRequestValue(childValue, field.additionalProperties, depth + 1);
      if (sanitized !== undefined) output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeRequestBody(value, fields = []) {
  if (value === undefined) return undefined;
  if (fields.length === 1 && fields[0]?.path?.length === 0) {
    return sanitizeRequestValue(value, fields[0]);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return structuredClone(value);
  const rootField = {
    name: 'body',
    path: [],
    required: true,
    nullable: false,
    type: 'object',
    fields,
  };
  return sanitizeRequestValue(value, rootField);
}

function synthesizedOperationBody(operation) {
  if (operation.requestBodyExample !== undefined && operation.requestBodyExample !== null) {
    return sanitizeRequestBody(operation.requestBodyExample, operation.requestBodyFields ?? []);
  }
  const fields = operation.requestBodyFields ?? [];
  if (fields.length === 1 && fields[0].path?.length === 0) return schemaFieldExample(fields[0]);
  const output = {};
  for (const field of fields) {
    if (field.readOnly) continue;
    const value = schemaFieldExample(field);
    if (value !== undefined) output[field.name] = value;
  }
  return Object.keys(output).length ? output : undefined;
}

function uniqueCreateBody(operation, body) {
  if (operation.method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  const itemParameterNames = new Set(
    declaredOperations
      .filter(
        candidate => operationStaticPrefix(candidate) === operationStaticPrefix(operation) && operationPathParameters(candidate).length > 0,
      )
      .flatMap(candidate => operationPathParameters(candidate).map(parameter => parameter.name)),
  );
  if (itemParameterNames.size === 0) return body;
  const output = structuredClone(body);
  const fields = objectSchemaFields(operation.requestBodyFields ?? []);
  for (const parameterName of itemParameterNames) {
    const field = fields.find(candidate => candidate.name === parameterName);
    const current = output[parameterName];
    if (
      typeof current !== 'string' ||
      !field ||
      field.readOnly ||
      field.enumValues?.length ||
      field.discriminatorValues?.length ||
      field.pattern ||
      field.format === 'uuid'
    ) {
      continue;
    }
    const suffix = `-gui-${slug(operation.id).slice(0, 24)}`;
    const maximumLength = Number(field.maxLength);
    const candidate = `${current}${suffix}`;
    output[parameterName] = Number.isFinite(maximumLength) && maximumLength > 0 ? candidate.slice(0, maximumLength) : candidate;
  }
  return output;
}

function bodyForApiOperation(operation) {
  const fixture = findPayloadForOperation(operation);
  const generated = uniqueCreateBody(
    operation,
    sanitizeRequestBody(fixture ?? synthesizedOperationBody(operation), operation.requestBodyFields ?? []),
  );
  if (operation.method !== 'PUT' || operationPathParameters(operation).length > 0 || !Array.isArray(generated)) return generated;
  const matchingCollection = relevantExecutionRecords(operation).find(
    record =>
      record.operation.method === 'GET' &&
      normalizedOperationPath(record.operation.path) === normalizedOperationPath(operation.path) &&
      Array.isArray(record.responseBody),
  );
  return matchingCollection ? sanitizeRequestBody(matchingCollection.responseBody, operation.requestBodyFields ?? []) : generated;
}

function objectSchemaFields(fields = []) {
  if (fields.length === 1 && fields[0]?.path?.length === 0 && fields[0].type === 'object') {
    return fields[0].fields ?? [];
  }
  return fields.filter(field => (field.path?.length ?? 0) <= 1);
}

function expectedResponseSubset(value, schema, depth = 0) {
  if (value === undefined || depth > 16) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const itemSchema =
      Array.isArray(schema) ?
        schema.length === 1 && schema[0]?.path?.length === 0 && schema[0].type === 'array' ?
          schema[0].items
        : undefined
      : schema?.items;
    return value.map(item => expectedResponseSubset(item, itemSchema, depth + 1));
  }

  const fields = Array.isArray(schema) ? objectSchemaFields(schema) : (schema?.fields ?? []);
  const output = {};
  for (const [key, childValue] of Object.entries(value)) {
    const field = fields.find(candidate => candidate.name === key);
    if (!field || field.readOnly || field.writeOnly) continue;
    const expected = expectedResponseSubset(childValue, field, depth + 1);
    if (expected !== undefined) output[key] = expected;
  }
  return output;
}

function operationRoundTripResult(record, responseBody = record.responseBody, responseFields = record.operation.responseBodyFields) {
  if (
    record.requestBody === undefined ||
    responseBody === undefined ||
    responseBody === null ||
    typeof responseBody !== 'object' ||
    typeof record.requestBody !== 'object'
  ) {
    return { checked: false };
  }
  const expected = expectedResponseSubset(record.requestBody, responseFields);
  if (
    expected === undefined ||
    (Array.isArray(expected) && expected.length === 0) ||
    (!Array.isArray(expected) && typeof expected === 'object' && Object.keys(expected).length === 0)
  ) {
    return { checked: false };
  }
  return {
    checked: true,
    matched: jsonContains(responseBody, expected, responseFields, {
      operation: record.operation,
      rootActual: responseBody,
      rootSchema: responseFields,
    }),
    expected,
    actual: responseBody,
  };
}

function waitForOperationResponse(pageValue, operation, expectedMethods = undefined, responseTimeoutMs = apiTimeoutMs) {
  if (operation) {
    return pageValue
      .waitForResponse(response => responseMatchesOperation(response, operation), { timeout: responseTimeoutMs })
      .catch(() => undefined);
  }
  const methods = new Set((expectedMethods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map(method => method.toUpperCase()));
  return pageValue
    .waitForResponse(response => methods.has(response.request().method()) && response.url().includes('/api/'), {
      timeout: responseTimeoutMs,
    })
    .catch(() => undefined);
}

function valueAtPath(source, pathValue) {
  return String(pathValue ?? '')
    .split('.')
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === undefined || current === null) return undefined;
      return current[segment];
    }, source);
}

function sharedIdentityFields(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return [];
  return ['id', 'tmfId', 'href', 'name'].filter(
    field => left[field] !== undefined && right[field] !== undefined && left[field] === right[field],
  );
}

function copiedConfiguredFields(candidate, selectedItem, config) {
  if (!candidate || !selectedItem || typeof candidate !== 'object' || typeof selectedItem !== 'object') return [];
  return (config.copyFields ?? [])
    .filter(mapping => typeof mapping?.source === 'string' && typeof mapping?.target === 'string')
    .filter(mapping => {
      const sourceValue = valueAtPath(selectedItem, mapping.source);
      if (sourceValue === undefined || sourceValue === null || typeof sourceValue === 'object') return false;
      return valueAtPath(candidate, mapping.target) === sourceValue;
    })
    .map(mapping => mapping.target);
}

function configuredCopyFieldSubset(value, config) {
  const items = Array.isArray(value) ? value : [value];
  const copiedItems = items
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => {
      const output = {};
      for (const mapping of config.copyFields ?? []) {
        if (typeof mapping?.target !== 'string') continue;
        const copiedValue = valueAtPath(item, mapping.target);
        if (copiedValue !== undefined && copiedValue !== null && typeof copiedValue !== 'object') output[mapping.target] = copiedValue;
      }
      return output;
    })
    .filter(item => Object.keys(item).length > 0);
  return Array.isArray(value) ? copiedItems : copiedItems[0];
}

function formlyFieldKey(field) {
  if (field?.key === undefined || field?.key === null) return '';
  return String(field.key);
}

function isIdentityLikeLeaf(leaf) {
  const normalized = normalizeName(leaf);
  return ['id', 'tmfid', 'type', 'basetype', 'schemalocation', 'referredtype'].includes(normalized) || normalized.endsWith('id');
}

function flattenEditablePrimitiveFields(fields = [], prefix = '') {
  const output = [];
  for (const field of fields ?? []) {
    const key = formlyFieldKey(field);
    const pathValue =
      key ?
        prefix ? `${prefix}.${key}`
        : key
      : prefix;
    if (field?.fieldGroup?.length) {
      output.push(...flattenEditablePrimitiveFields(field.fieldGroup, pathValue));
      continue;
    }
    if (!key || field?.fieldArray || field?.type === 'form-crud-repeat') continue;
    const props = field.props ?? {};
    if (props.disabled) continue;
    if (props.pattern || props.options?.length) continue;
    if (!['input', 'textarea'].includes(String(field.type ?? 'input'))) continue;
    const inputType = String(props.type ?? 'text').toLowerCase();
    if (!['text', 'search', 'email', 'url', 'tel'].includes(inputType)) continue;
    const leaf = key.split('.').filter(Boolean).pop() ?? key;
    if (isIdentityLikeLeaf(leaf)) continue;
    output.push({ path: pathValue, leaf, props });
  }
  return output;
}

function existingDetailFieldCandidates(fields = [], model = undefined) {
  return flattenEditablePrimitiveFields(fields).filter(field => {
    if (!field?.path) return false;
    const pathSegments = field.path.split('.').filter(Boolean);
    const numericIndex = pathSegments.findIndex(segment => /^\d+$/.test(segment));
    if (numericIndex >= 0) return false;
    return valueAtPath(model, field.path) !== undefined;
  });
}

function preferredEditablePrimitiveField(fields = [], model = undefined) {
  const candidates = existingDetailFieldCandidates(fields, model);
  const priority = ['name', 'description', 'lifecycleStatus', 'version', 'href'];
  for (const preferred of priority) {
    const candidate = candidates.find(field => normalizeName(field.leaf) === normalizeName(preferred));
    if (candidate) return candidate;
  }
  return candidates[0];
}

function generatedFieldValue(field, stepName) {
  const leaf = normalizeName(field?.leaf);
  const base = leaf === 'href' ? `/api/gui-smoke/${Date.now()}` : `GUI ${slug(stepName)} ${Date.now()}`;
  const maxLength = Number(field?.props?.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && base.length > maxLength) return base.slice(0, maxLength);
  return base;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function schemaFields(schema) {
  return Array.isArray(schema) ? objectSchemaFields(schema) : (schema?.fields ?? []);
}

function schemaArrayItems(schema) {
  if (!Array.isArray(schema)) return schema?.items;
  if (schema.length === 1 && schema[0]?.path?.length === 0 && schema[0].type === 'array') return schema[0].items;
  return undefined;
}

function equivalentSchemaPrimitive(actual, expected, schema) {
  if (schema?.format === 'date-time' && typeof actual === 'string' && typeof expected === 'string') {
    const actualTimestamp = Date.parse(actual);
    const expectedTimestamp = Date.parse(expected);
    if (Number.isFinite(actualTimestamp) && Number.isFinite(expectedTimestamp)) return actualTimestamp === expectedTimestamp;
  }
  return actual === expected;
}

function canonicalTmfHrefMatches(actual, expected, context) {
  if (
    context.path.length !== 1 ||
    normalizeName(context.path[0]) !== 'href' ||
    typeof actual !== 'string' ||
    typeof expected !== 'string'
  ) {
    return false;
  }
  const { rootActual } = context;
  if (!rootActual || typeof rootActual !== 'object' || Array.isArray(rootActual)) return false;
  const rootFieldNames = new Set(schemaFields(context.rootSchema).map(field => normalizeName(field.name)));
  const hasTmfMetadata =
    (Object.hasOwn(rootActual, '@type') || rootFieldNames.has('type')) &&
    (Object.hasOwn(rootActual, 'tmfId') || rootFieldNames.has('tmfid')) &&
    (Object.hasOwn(rootActual, 'href') || rootFieldNames.has('href'));
  if (!hasTmfMetadata) return false;

  const operationPrefix = operationStaticPrefix(context.operation);
  const actualPath = normalizedOperationPath(actual);
  if (actualPath === operationPrefix || !actualPath.startsWith(`${operationPrefix}/`)) return false;
  const actualIdentity = actualPath.split('/').filter(Boolean).at(-1);
  const responseIdentities = [rootActual.id, rootActual.tmfId]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value));
  return Boolean(actualIdentity && responseIdentities.includes(decodeURIComponent(actualIdentity)));
}

function jsonContains(actual, expected, schema, context = {}) {
  const comparisonContext = {
    operation: context.operation,
    rootActual: context.rootActual ?? actual,
    rootSchema: context.rootSchema ?? schema,
    path: context.path ?? [],
  };
  if (expected === undefined) return true;
  if (expected === null || typeof expected !== 'object') {
    return equivalentSchemaPrimitive(actual, expected, schema) || canonicalTmfHrefMatches(actual, expected, comparisonContext);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    const itemSchema = schemaArrayItems(schema);
    return expected.every(expectedItem =>
      actual.some(actualItem =>
        jsonContains(actualItem, expectedItem, itemSchema, {
          ...comparisonContext,
          path: [...comparisonContext.path, '[]'],
        }),
      ),
    );
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const fields = schemaFields(schema);
  return Object.entries(expected).every(([key, value]) =>
    jsonContains(
      actual[key],
      value,
      fields.find(field => field.name === key),
      {
        ...comparisonContext,
        path: [...comparisonContext.path, key],
      },
    ),
  );
}

function mutationMatches(actual, expectedMutation) {
  if (expectedMutation?.match === 'subset') {
    return jsonContains(actual, expectedMutation.value);
  }
  return jsonEqual(actual, expectedMutation?.value);
}

function primitiveLeaves(value) {
  if (value === null || value === undefined) return [];
  if (['string', 'number', 'boolean'].includes(typeof value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(item => primitiveLeaves(item));
  if (typeof value === 'object') return Object.values(value).flatMap(item => primitiveLeaves(item));
  return [];
}

function renderedValueCandidates(value) {
  const values = primitiveLeaves(value)
    .map(item => item.trim())
    .filter(item => item.length > 0);
  return [...new Set(values)].slice(0, 8);
}

async function renderedDetailControlValues(page) {
  return page
    .locator('[data-cy="formCrudDetails"] input, [data-cy="formCrudDetails"] textarea, [data-cy="formCrudDetails"] select')
    .evaluateAll(elements =>
      elements
        .flatMap(element => {
          if (element instanceof HTMLSelectElement) {
            const selected = Array.from(element.selectedOptions).map(option => option.textContent?.trim() ?? '');
            return [element.value, ...selected];
          }
          if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
            return [element.checked ? element.value || 'true' : 'false'];
          }
          return ['value' in element ? String(element.value ?? '') : ''];
        })
        .map(value => value.trim())
        .filter(Boolean),
    )
    .catch(() => []);
}

function mutationRendered(controlValues, expectedMutation) {
  const rendered = new Set(controlValues.map(value => String(value)));
  const candidates = renderedValueCandidates(expectedMutation?.value);
  if (candidates.length === 0) return true;
  return candidates.some(value => rendered.has(value));
}

function expectedConfiguredCopyFields(selectedItem, config) {
  if (!selectedItem || typeof selectedItem !== 'object') return [];
  return (config.copyFields ?? [])
    .filter(mapping => typeof mapping?.source === 'string' && typeof mapping?.target === 'string')
    .filter(mapping => {
      const sourceValue = valueAtPath(selectedItem, mapping.source);
      return sourceValue !== undefined && sourceValue !== null && typeof sourceValue !== 'object';
    })
    .map(mapping => mapping.target);
}

function parseLimit(value) {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'unlimited') return Number.POSITIVE_INFINITY;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
}

function limitEntries(entries, limit) {
  return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
}

async function locatorCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function expandAccordions(locator, maxCount = 100) {
  const buttons = locator.locator('button.accordion-button');
  let clicked = 0;
  let observed = 0;
  await buttons
    .first()
    .waitFor({ state: 'attached', timeout: optionalTimeoutMs })
    .catch(() => {});
  for (let pass = 0; pass < 8 && clicked < maxCount; pass += 1) {
    const count = await locatorCount(buttons);
    observed = Math.max(observed, count);
    let changed = false;
    for (let index = 0; index < count && clicked < maxCount; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const collapsed = await button
        .evaluate(element => element.getAttribute('aria-expanded') === 'false' || element.classList.contains('collapsed'))
        .catch(() => false);
      if (!collapsed) continue;
      await button.click();
      clicked += 1;
      changed = true;
      await button.page().waitForTimeout(50);
    }
    if (!changed) break;
  }
  return observed;
}

const username = process.env.FORM_CRUD_GUI_USERNAME ?? 'admin';
const password = process.env.FORM_CRUD_GUI_PASSWORD ?? 'admin';
const appDir = path.resolve(process.env.FORM_CRUD_GUI_APP_DIR ?? process.cwd());
const timeoutMs = Number(process.env.FORM_CRUD_GUI_TIMEOUT_MS ?? '30000');
const apiTimeoutMs = Number(process.env.FORM_CRUD_GUI_API_TIMEOUT_MS ?? String(Math.min(timeoutMs, 30000)));
const settleTimeoutMs = Number(process.env.FORM_CRUD_GUI_SETTLE_TIMEOUT_MS ?? String(Math.min(timeoutMs, 3000)));
const optionalTimeoutMs = Number(process.env.FORM_CRUD_GUI_OPTIONAL_TIMEOUT_MS ?? String(Math.min(timeoutMs, 5000)));
const headless = (process.env.FORM_CRUD_GUI_HEADLESS ?? 'true') !== 'false';
const failOnConsoleError = (process.env.FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR ?? 'true') !== 'false';
const failOnHttp4xx = (process.env.FORM_CRUD_GUI_FAIL_ON_HTTP_4XX ?? 'false') === 'true';
const maxListResources = parseLimit(process.env.FORM_CRUD_GUI_MAX_LIST_RESOURCES ?? 'all');
const maxCreateResources = parseLimit(process.env.FORM_CRUD_GUI_MAX_CREATE_RESOURCES ?? 'all');
const maxReferencePickerScenarios = parseLimit(process.env.FORM_CRUD_GUI_MAX_REFERENCE_PICKER_SCENARIOS ?? 'all');
const referencePickerSourceOperationId = (process.env.FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_OPERATION_ID ?? '').trim();
const referencePickerSourcePath = (process.env.FORM_CRUD_GUI_REFERENCE_PICKER_SOURCE_PATH ?? '').trim();
const exerciseCreate = (process.env.FORM_CRUD_GUI_EXERCISE_CREATE ?? 'true') !== 'false';
const exerciseUpdate = (process.env.FORM_CRUD_GUI_EXERCISE_UPDATE ?? 'true') !== 'false';
const exerciseDelete = (process.env.FORM_CRUD_GUI_EXERCISE_DELETE ?? 'true') !== 'false';
const exerciseApiOperations = (process.env.FORM_CRUD_GUI_API_OPERATIONS_EXECUTION_ENABLED ?? 'true') !== 'false';
const requireAllApiOperations2xx = (process.env.FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_2XX ?? 'false') === 'true';
const requireAllApiOperationsAccounted = (process.env.FORM_CRUD_GUI_API_OPERATIONS_REQUIRE_ALL_ACCOUNTED ?? 'true') !== 'false';
const requireAllAvailableResourceWorkflows = (process.env.FORM_CRUD_GUI_REQUIRE_ALL_AVAILABLE_RESOURCE_WORKFLOWS ?? 'true') !== 'false';
const failOnInvalidCreateForm = (process.env.FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM ?? 'true') !== 'false';
const failOnCreateHttpError = (process.env.FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR ?? 'true') !== 'false';
const screenshotFullPage = (process.env.FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS ?? 'true') !== 'false';
const sourceCoverageEnabled = (process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED ?? 'true') !== 'false';
const sourceCoveragePrefixes = [
  'src/main/webapp/app/form-crud/',
  'src/main/webapp/app/admin/form-crud-reference-pickers/',
  'src/main/webapp/app/openapi-operations/',
];
const sourceCoverageChunkNames = [
  ...new Set(sourceCoveragePrefixes.map(prefix => prefix.split('/').filter(Boolean).at(-1)).filter(Boolean)),
];
const sourceCoverageMaxScriptBytes = Number(process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_SCRIPT_BYTES ?? 64 * 1024 * 1024);
const sourceCoverageMaxUnknownScriptBytes = Number(process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_MAX_UNKNOWN_SCRIPT_BYTES ?? 2 * 1024 * 1024);
const sourceCoverageMergeJest = (process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_MERGE_JEST ?? 'false') === 'true';
const sourceCoverageWorkerHeapMb = Number(process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_WORKER_HEAP_MB ?? 1024);
const sourceCoverageNavigationsPerSegment = Math.max(1, Number(process.env.FORM_CRUD_GUI_SOURCE_COVERAGE_NAVIGATIONS_PER_SEGMENT ?? 3));
const sourceCoverageWorker = fileURLToPath(new URL('./form-crud-source-coverage.mjs', import.meta.url));

const result = {
  artifact: artifactName,
  webBaseUrl,
  startIso: new Date().toISOString(),
  endIso: null,
  durationMs: 0,
  status: 'running',
  console: [],
  pageErrors: [],
  failedResponses: [],
  apiExchanges: [],
  screenshots: [],
  steps: [],
  coverage: {
    discoveredResources: 0,
    plannedCreateResources: 0,
    plannedListResources: 0,
    exercisedCreateResources: 0,
    successfulCreateResources: 0,
    exercisedListResources: 0,
    exercisedDetailResources: 0,
    plannedUpdateResources: 0,
    exercisedUpdateResources: 0,
    successfulUpdateResources: 0,
    plannedDeleteResources: 0,
    exercisedDeleteResources: 0,
    successfulDeleteResources: 0,
    plannedReferencePickerScenarios: 0,
    exercisedReferencePickerSaves: 0,
    successfulReferencePickerSaves: 0,
    declaredOperations: 0,
    renderedOperations: 0,
    submittedOperations: 0,
    successfulOperations: 0,
    declaredOperationIds: [],
    renderedOperationIds: [],
    submittedOperationIds: [],
    successfulOperationIds: [],
    missingRenderedOperationIds: [],
    apiOperationsPageRenderedOperations: 0,
    apiOperationsPageSubmittedOperations: 0,
    apiOperationsPageSuccessfulOperations: 0,
    apiOperationsPageRenderedOperationIds: [],
    apiOperationsPageSubmittedOperationIds: [],
    apiOperationsPageSuccessfulOperationIds: [],
    apiOperationsPageDeclaredResponseOperations: 0,
    apiOperationsPageDeclaredResponseOperationIds: [],
    apiOperationsPageContractCoveredOperations: 0,
    apiOperationsPageContractCoveredOperationIds: [],
    apiOperationsPageAccountedOperations: 0,
    apiOperationsPageAccountedOperationIds: [],
    missingApiOperationsPageAccountedOperationIds: [],
    missingApiOperationsPageRenderedOperationIds: [],
    missingApiOperationsPageSubmittedOperationIds: [],
    missingApiOperationsPageSuccessfulOperationIds: [],
    apiOperationsPageUnexecutableOperations: 0,
    apiOperationsPageUnexecutableOperationIds: [],
    apiOperationsPageFailedOperations: 0,
    apiOperationsPageFailedOperationIds: [],
    apiOperationsPageRoundTripChecks: 0,
    apiOperationsPageSuccessfulRoundTripChecks: 0,
    structuredObjectOperations: 0,
    structuredArrayOperations: 0,
    objectStringControlFailures: 0,
    responsiveViewportsChecked: 0,
  },
  sourceCoverage: {
    enabled: sourceCoverageEnabled,
    scope: sourceCoveragePrefixes,
    excludedGeneratedFiles: ['src/main/webapp/app/openapi-operations/openapi-operations.model.ts'],
    maxScriptBytes: sourceCoverageMaxScriptBytes,
    maxUnknownScriptBytes: sourceCoverageMaxUnknownScriptBytes,
    navigationsPerSegment: sourceCoverageNavigationsPerSegment,
  },
};

const started = Date.now();
let browser;
let page;
let browserCoverageStarted = false;
let sourceCoverageFunctionFileIndex = 0;
let sourceCoverageNavigationLabels = [];
let screenshotIndex = 0;
let apiExchangeIndex = 0;
let reportWritten = false;
let declaredOperations = [];
const sourceCoverageScripts = [];
const sourceCoverageSources = new Map();
const sourceCoverageSegments = [];
const renderedOperationIds = new Set();
const submittedOperationIds = new Set();
const successfulOperationIds = new Set();
const apiOperationsPageRenderedOperationIds = new Set();
const apiOperationsPageSubmittedOperationIds = new Set();
const apiOperationsPageSuccessfulOperationIds = new Set();
const apiOperationsPageDeclaredResponseOperationIds = new Set();
const apiOperationsPageContractCoveredOperationIds = new Set();
const apiOperationsPageUnexecutableOperations = [];
const apiOperationsPageFailedOperations = [];
const operationExecutionRecords = [];
const structuredObjectOperationIds = new Set();
const structuredArrayOperationIds = new Set();

function writeResultReport() {
  if (reportWritten) return;
  const declaredIds = declaredOperations.map(operation => operation.id);
  result.coverage.declaredOperations = declaredIds.length;
  result.coverage.renderedOperations = renderedOperationIds.size;
  result.coverage.submittedOperations = submittedOperationIds.size;
  result.coverage.successfulOperations = successfulOperationIds.size;
  result.coverage.declaredOperationIds = declaredIds;
  result.coverage.renderedOperationIds = [...renderedOperationIds].sort();
  result.coverage.submittedOperationIds = [...submittedOperationIds].sort();
  result.coverage.successfulOperationIds = [...successfulOperationIds].sort();
  result.coverage.missingRenderedOperationIds = declaredIds.filter(operationId => !renderedOperationIds.has(operationId));
  result.coverage.apiOperationsPageRenderedOperations = apiOperationsPageRenderedOperationIds.size;
  result.coverage.apiOperationsPageSubmittedOperations = apiOperationsPageSubmittedOperationIds.size;
  result.coverage.apiOperationsPageSuccessfulOperations = apiOperationsPageSuccessfulOperationIds.size;
  result.coverage.apiOperationsPageRenderedOperationIds = [...apiOperationsPageRenderedOperationIds].sort();
  result.coverage.apiOperationsPageSubmittedOperationIds = [...apiOperationsPageSubmittedOperationIds].sort();
  result.coverage.apiOperationsPageSuccessfulOperationIds = [...apiOperationsPageSuccessfulOperationIds].sort();
  result.coverage.apiOperationsPageDeclaredResponseOperations = apiOperationsPageDeclaredResponseOperationIds.size;
  result.coverage.apiOperationsPageDeclaredResponseOperationIds = [...apiOperationsPageDeclaredResponseOperationIds].sort();
  result.coverage.apiOperationsPageContractCoveredOperations = apiOperationsPageContractCoveredOperationIds.size;
  result.coverage.apiOperationsPageContractCoveredOperationIds = [...apiOperationsPageContractCoveredOperationIds].sort();
  result.coverage.missingApiOperationsPageRenderedOperationIds = declaredIds.filter(
    operationId => !apiOperationsPageRenderedOperationIds.has(operationId),
  );
  result.coverage.missingApiOperationsPageSubmittedOperationIds = declaredIds.filter(
    operationId => !apiOperationsPageSubmittedOperationIds.has(operationId),
  );
  result.coverage.missingApiOperationsPageSuccessfulOperationIds = declaredIds.filter(
    operationId => !apiOperationsPageSuccessfulOperationIds.has(operationId),
  );
  result.coverage.apiOperationsPageUnexecutableOperations = apiOperationsPageUnexecutableOperations.length;
  result.coverage.apiOperationsPageUnexecutableOperationIds = apiOperationsPageUnexecutableOperations.map(entry => entry.operationId);
  const accountedIds = new Set([
    ...apiOperationsPageContractCoveredOperationIds,
    ...apiOperationsPageUnexecutableOperations.map(entry => entry.operationId),
  ]);
  result.coverage.apiOperationsPageAccountedOperations = accountedIds.size;
  result.coverage.apiOperationsPageAccountedOperationIds = [...accountedIds].sort();
  result.coverage.missingApiOperationsPageAccountedOperationIds = declaredIds.filter(operationId => !accountedIds.has(operationId));
  result.coverage.apiOperationsPageFailedOperations = apiOperationsPageFailedOperations.length;
  result.coverage.apiOperationsPageFailedOperationIds = apiOperationsPageFailedOperations.map(entry => entry.operationId);
  result.coverage.structuredObjectOperations = structuredObjectOperationIds.size;
  result.coverage.structuredArrayOperations = structuredArrayOperationIds.size;
  result.endIso = new Date().toISOString();
  result.durationMs = Date.now() - started;
  fs.writeFileSync(path.join(outputDir, 'form-crud-gui-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
  reportWritten = true;
}

function coverageScriptNameMatchesScope(scriptUrl) {
  try {
    const filename = path.posix.basename(new URL(scriptUrl).pathname);
    return sourceCoverageChunkNames.some(name => filename === `${name}.js` || filename.startsWith(`${name}-`));
  } catch {
    return false;
  }
}

function mergeRepeatedCoverageEntries(entries, v8Coverage) {
  const groups = new Map();
  for (const [index, entry] of entries.entries()) {
    if (!sameWebOrigin(entry.url)) continue;
    const sourceLength = entry.source?.length ?? 0;
    const namedScopedChunk = coverageScriptNameMatchesScope(entry.url);
    if (sourceLength > sourceCoverageMaxScriptBytes || (!namedScopedChunk && sourceLength > sourceCoverageMaxUnknownScriptBytes)) {
      continue;
    }
    const key = `${entry.url}\0${sourceLength}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        url: entry.url,
        source: entry.source,
        sourceLength,
        occurrences: 0,
        coverages: [],
      };
      groups.set(key, group);
    }
    group.occurrences += 1;
    group.coverages.push({
      scriptId: String(index),
      url: entry.url,
      functions: entry.functions,
    });
    if (group.source !== entry.source) entry.source = '';
  }
  entries.length = 0;
  return [...groups.values()].map(group => {
    const merged = v8Coverage.mergeScriptCovs(group.coverages);
    return {
      url: group.url,
      source: group.source,
      sourceLength: group.sourceLength,
      occurrences: group.occurrences,
      functions: merged?.functions ?? [],
    };
  });
}

function sameWebOrigin(scriptUrl) {
  try {
    return new URL(scriptUrl).origin === new URL(webBaseUrl).origin;
  } catch {
    return false;
  }
}

function sourceCoverageSegmentName(label) {
  return String(label ?? 'segment')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function startSourceCoverageSegment() {
  if (!sourceCoverageEnabled || !page || browserCoverageStarted) return;
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
  browserCoverageStarted = true;
  sourceCoverageNavigationLabels = [];
}

async function persistSourceCoverageSegment(entries, label, navigationLabels) {
  const scriptEntryCount = entries.length;
  const mergedEntries = mergeRepeatedCoverageEntries(entries, loadV8Coverage(appDir));
  const sourceCoverageDir = path.join(outputDir, 'source-coverage');
  const rawCoverageDir = path.join(sourceCoverageDir, 'raw');
  const sourceDirectory = path.join(rawCoverageDir, 'sources');
  const functionsDirectory = path.join(rawCoverageDir, 'functions');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(functionsDirectory, { recursive: true });

  const segment = {
    label,
    navigations: navigationLabels,
    scriptEntries: scriptEntryCount,
    retainedScripts: mergedEntries.length,
    retainedSourceBytes: 0,
  };
  for (const entry of mergedEntries) {
    const sourceHash = createHash('sha256').update(entry.source).digest('hex');
    let sourceFile = sourceCoverageSources.get(sourceHash);
    if (!sourceFile) {
      sourceFile = path.join(sourceDirectory, `${sourceHash}.js`);
      fs.writeFileSync(sourceFile, entry.source);
      sourceCoverageSources.set(sourceHash, sourceFile);
      segment.retainedSourceBytes += entry.sourceLength;
    }
    sourceCoverageFunctionFileIndex += 1;
    const functionsFile = path.join(
      functionsDirectory,
      `${String(sourceCoverageFunctionFileIndex).padStart(4, '0')}-${sourceCoverageSegmentName(label)}.json`,
    );
    fs.writeFileSync(functionsFile, `${JSON.stringify(entry.functions)}\n`);
    sourceCoverageScripts.push({
      url: entry.url,
      sourceFile,
      functionsFile,
      sourceLength: entry.sourceLength,
      functionCount: entry.functions.length,
      occurrences: entry.occurrences,
      segment: label,
    });
    entry.source = '';
    entry.functions = [];
  }
  mergedEntries.length = 0;
  sourceCoverageSegments.push(segment);
}

async function flushSourceCoverageSegment(label) {
  if (!sourceCoverageEnabled || !page || !browserCoverageStarted) return;
  const entries = await page.coverage.stopJSCoverage();
  browserCoverageStarted = false;
  const navigationLabels = sourceCoverageNavigationLabels;
  sourceCoverageNavigationLabels = [];
  await persistSourceCoverageSegment(entries, label, navigationLabels);
}

async function navigateWithSourceCoverage(targetPage, url, options) {
  let routeLabel = url;
  try {
    routeLabel = new URL(url).pathname;
  } catch {
    // Keep the supplied URL as a diagnostic label.
  }
  if (browserCoverageStarted && sourceCoverageNavigationLabels.length >= sourceCoverageNavigationsPerSegment) {
    await flushSourceCoverageSegment(`routes-${sourceCoverageSegments.length + 1}`);
  }
  await startSourceCoverageSegment();
  sourceCoverageNavigationLabels.push(routeLabel);
  return targetPage.goto(url, options);
}

async function collectSourceCoverage() {
  if (!sourceCoverageEnabled || !page) return;
  await flushSourceCoverageSegment('final');
  const sourceCoverageDir = path.join(outputDir, 'source-coverage');
  const workerResultFile = path.join(sourceCoverageDir, 'worker-result.json');
  const workerLogFile = path.join(sourceCoverageDir, 'worker.log');
  const manifestFile = path.join(sourceCoverageDir, 'worker-manifest.json');
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify(
      {
        appDir,
        outputDirectory: sourceCoverageDir,
        resultFile: workerResultFile,
        scope: sourceCoveragePrefixes,
        excludedGeneratedFiles: ['src/main/webapp/app/openapi-operations/openapi-operations.model.ts'],
        scripts: sourceCoverageScripts,
        mergeJest: sourceCoverageMergeJest,
        jestCoverageFile: path.join(appDir, 'target', 'test-results', 'coverage-final.json'),
      },
      null,
      2,
    )}\n`,
  );
  const worker = spawnSync(process.execPath, [`--max-old-space-size=${sourceCoverageWorkerHeapMb}`, sourceCoverageWorker, manifestFile], {
    cwd: appDir,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  fs.writeFileSync(workerLogFile, `${worker.stdout ?? ''}${worker.stderr ?? ''}`);
  if (worker.status !== 0 || !fs.existsSync(workerResultFile)) {
    throw new Error(`Playwright source coverage worker failed with exit code ${worker.status ?? 'unknown'}; see ${workerLogFile}`);
  }
  const workerReport = JSON.parse(fs.readFileSync(workerResultFile, 'utf8'));
  result.sourceCoverage = {
    enabled: true,
    scope: sourceCoveragePrefixes,
    excludedGeneratedFiles: ['src/main/webapp/app/openapi-operations/openapi-operations.model.ts'],
    maxScriptBytes: sourceCoverageMaxScriptBytes,
    maxUnknownScriptBytes: sourceCoverageMaxUnknownScriptBytes,
    workerHeapMb: sourceCoverageWorkerHeapMb,
    navigationsPerSegment: sourceCoverageNavigationsPerSegment,
    segments: sourceCoverageSegments,
    uniqueSourceCount: sourceCoverageSources.size,
    ...workerReport,
    outputDirectory: sourceCoverageDir,
  };
}

async function handleTermination(signal) {
  result.status = 'interrupted';
  result.error = { message: `Received ${signal}` };
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    writeResultReport();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }
}

process.once('SIGINT', () => {
  void handleTermination('SIGINT');
});
process.once('SIGTERM', () => {
  void handleTermination('SIGTERM');
});

async function screenshot(page, name, fullPage = screenshotFullPage) {
  const file = path.join(outputDir, `${String(++screenshotIndex).padStart(2, '0')}-${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage });
  result.screenshots.push(file);
  return file;
}

function formlyStructureStats(fields = []) {
  const stats = { objects: 0, arrays: 0 };
  for (const field of fields ?? []) {
    const wrappers = Array.isArray(field?.wrappers) ? field.wrappers : [];
    if (wrappers.includes('form-crud-accordion')) stats.objects += 1;
    const arrayField = field?.fieldArray;
    if (field?.type === 'form-crud-repeat' || arrayField) stats.arrays += 1;
    if (Array.isArray(field?.fieldGroup)) {
      const child = formlyStructureStats(field.fieldGroup);
      stats.objects += child.objects;
      stats.arrays += child.arrays;
    }
    if (arrayField && !Array.isArray(arrayField) && typeof arrayField === 'object' && Array.isArray(arrayField.fieldGroup)) {
      const child = formlyStructureStats(arrayField.fieldGroup);
      stats.objects += child.objects;
      stats.arrays += child.arrays;
    }
  }
  return stats;
}

async function assertStructuredOperationForm(page, operation, state) {
  const stats = formlyStructureStats(state.fields ?? []);
  if (stats.objects > 0) structuredObjectOperationIds.add(operation.id);
  if (stats.arrays > 0) structuredArrayOperationIds.add(operation.id);

  const form = page.locator('[data-cy="formCrudOperationForm"]').first();
  const objectStringControls = await form
    .locator('input, textarea, select')
    .evaluateAll(elements =>
      elements.map(element => ('value' in element ? String(element.value ?? '') : '')).filter(value => value === '[object Object]'),
    );
  if (objectStringControls.length > 0) {
    result.coverage.objectStringControlFailures += objectStringControls.length;
    throw new Error(`Form CRUD operation ${operation.id} rendered an object value in a scalar control`);
  }

  if (stats.objects > 0) {
    const renderedAccordions = await locatorCount(form.locator('[data-cy^="formCrudAccordion-"]'));
    if (renderedAccordions === 0) {
      throw new Error(`Form CRUD operation ${operation.id} did not render its structured object sections as accordions`);
    }
  }
}

async function exerciseResponsiveLayout(page) {
  const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
  ];
  try {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('[data-cy="formCrudResourcePanel"]');
        const main = document.querySelector('[data-cy="formCrud"] main');
        const panelRect = panel?.getBoundingClientRect();
        const mainRect = main?.getBoundingClientRect();
        return {
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panelHeight: panelRect?.height ?? 0,
          mainTop: mainRect?.top ?? Number.POSITIVE_INFINITY,
          mainWidth: mainRect?.width ?? 0,
        };
      });
      if (layout.horizontalOverflow > 2) {
        throw new Error(`Form CRUD ${viewport.name} layout overflows horizontally by ${layout.horizontalOverflow}px`);
      }
      if (layout.mainTop >= viewport.height || layout.mainWidth <= 0) {
        throw new Error(`Form CRUD main content is outside the ${viewport.name} viewport`);
      }
      if (viewport.name === 'tablet' && layout.panelHeight > viewport.height * 0.5) {
        throw new Error(`Form CRUD resource panel consumes too much of the ${viewport.name} viewport`);
      }
      await screenshot(page, `form-crud-${viewport.name}-viewport`, false);
      result.coverage.responsiveViewportsChecked += 1;
      result.steps.push({ name: `responsive-layout-${viewport.name}`, status: 'ok', viewport, layout });
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function debugState(page) {
  await page.waitForFunction(() => Boolean(window.__formsDebug?.formCrud), undefined, { timeout: apiTimeoutMs });
  return page.evaluate(() => window.__formsDebug.formCrud());
}

async function gotoOperation(page, operationId) {
  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, `/form-crud/${operationId}`), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  return debugState(page);
}

async function submitCurrentOperation(page, stepName, expectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE'], operation = undefined) {
  const submitButton = page.locator('[data-cy="formCrudSubmit"]').first();
  if ((await locatorCount(submitButton)) === 0 || !(await submitButton.isVisible()) || !(await submitButton.isEnabled())) {
    result.steps.push({ name: stepName, status: 'skipped', reason: 'submit button unavailable or disabled' });
    return false;
  }
  const currentState = await debugState(page);
  const submittedOperation = operation ?? operationById(currentState.operationId);
  const apiResponsePromise = waitForOperationResponse(page, submittedOperation, expectedMethods);
  await submitButton.click();
  const apiResponse = await apiResponsePromise;
  recordOperationResponse(submittedOperation, apiResponse);
  await recordApiExchange(stepName, apiResponse, submittedOperation);
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, stepName);
  result.steps.push({ name: stepName, status: 'submitted', apiExchange: apiResponse ? compactResponse(apiResponse) : undefined });
  return true;
}

async function recordApiExchange(stepName, response, operation = undefined, source = 'form-crud') {
  if (!response) return undefined;
  const request = response.request();
  const matchedOperation =
    operation ??
    declaredOperations.find(candidate => candidate.method === request.method() && responseMatchesOperation(response, candidate));
  const fileBase = `${String(++apiExchangeIndex).padStart(2, '0')}-${slug(stepName)}`;
  const requestFile = path.join(outputDir, `${fileBase}-request.txt`);
  const responseFile = path.join(outputDir, `${fileBase}-response.txt`);
  const requestText = request.postData() ?? '';
  let responseText;
  const exchange = {
    step: stepName,
    operationId: matchedOperation?.id,
    source,
    method: request.method(),
    url: response.url(),
    status: response.status(),
    requestFile: path.basename(requestFile),
    responseFile: path.basename(responseFile),
  };
  fs.writeFileSync(requestFile, requestText, 'utf8');
  try {
    responseText = await response.text();
    fs.writeFileSync(responseFile, responseText, 'utf8');
  } catch (error) {
    responseText = undefined;
    fs.writeFileSync(responseFile, `Failed to read response body: ${error.message}`, 'utf8');
  }
  result.apiExchanges.push(exchange);
  if (matchedOperation) {
    operationExecutionRecords.push({
      operation: matchedOperation,
      source,
      status: response.status(),
      requestBody: parseJsonText(requestText),
      responseBody: parseJsonText(responseText),
      responseHeaders: response.headers(),
      responseUrl: response.url(),
      createdByApiOperations:
        source === 'api-operations' && matchedOperation.method === 'POST' && response.status() >= 200 && response.status() < 300,
    });
  }
  return exchange;
}

async function saveVisibleDetail(page, stepName, required = false, expectedMutation = undefined, operation = undefined) {
  if (!exerciseUpdate) {
    result.steps.push({ name: stepName, status: 'skipped', reason: 'detail update exercise disabled' });
    return false;
  }
  const saveButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudSaveButton"]').first();
  if ((await locatorCount(saveButton)) === 0 || !(await saveButton.isVisible())) {
    result.steps.push({ name: stepName, status: required ? 'failed' : 'skipped', reason: 'detail save button unavailable' });
    if (required) throw new Error(`Detail save button is unavailable for ${stepName}`);
    return false;
  }
  const state = await debugState(page);
  if (state.responseDetailValid === false) {
    result.steps.push({
      name: stepName,
      status: required ? 'failed' : 'skipped',
      reason: 'detail form is invalid',
      invalidControls: state.responseDetailInvalidControls,
      responseDetailModel: state.responseDetailModel,
    });
    if (required) throw new Error(`Detail form is invalid for ${stepName}`);
    return false;
  }
  result.coverage.exercisedUpdateResources += 1;
  const updateResponse = waitForOperationResponse(page, operation, ['PATCH', 'PUT']);
  await saveButton.click();
  const response = await updateResponse;
  recordOperationResponse(operation, response);
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, stepName);
  const statusText = await page
    .locator('[data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const status = response?.status() ?? (statusMatch ? Number(statusMatch[1]) : undefined);
  const ok = status !== undefined && status >= 200 && status < 300;
  if (response) await recordApiExchange(stepName, response, operation);
  result.steps.push({
    name: stepName,
    status: ok ? 'ok' : 'failed',
    httpStatus: status,
    text: statusText?.trim() ?? '',
    responseDetailModel: ok ? undefined : state.responseDetailModel,
  });
  if (!ok) throw new Error(`Detail save ${stepName} did not return HTTP 2xx: ${statusText?.trim() || status || 'no status shown'}`);
  result.coverage.successfulUpdateResources += 1;
  const after = await debugState(page);
  if (!after.responseDetailModel || typeof after.responseDetailModel !== 'object') {
    throw new Error(`Detail save ${stepName} did not repopulate the detail form model`);
  }
  if (expectedMutation) {
    const savedValue = valueAtPath(after.responseDetailModel, expectedMutation.path);
    if (!mutationMatches(savedValue, expectedMutation)) {
      result.steps.push({
        name: `${stepName}-mutation-retained`,
        status: 'failed',
        path: expectedMutation.path,
        expected: expectedMutation.value,
        actual: savedValue,
      });
      throw new Error(`Detail save ${stepName} did not retain changed value at ${expectedMutation.path}`);
    }
    result.steps.push({
      name: `${stepName}-mutation-retained`,
      status: 'ok',
      path: expectedMutation.path,
      value: savedValue,
    });
    if (expectedMutation.verifyRendered !== false) {
      const controlValues = await renderedDetailControlValues(page);
      if (!mutationRendered(controlValues, expectedMutation)) {
        result.steps.push({
          name: `${stepName}-mutation-rendered`,
          status: 'failed',
          path: expectedMutation.path,
          expectedCandidates: renderedValueCandidates(expectedMutation.value),
          renderedControlValues: controlValues.slice(0, 20),
        });
        throw new Error(`Detail save ${stepName} did not render changed value at ${expectedMutation.path}`);
      }
      result.steps.push({
        name: `${stepName}-mutation-rendered`,
        status: 'ok',
        path: expectedMutation.path,
      });
    }
    if (response && expectedMutation.verifyReload !== false) {
      const reload = await authenticatedFetch(page, response.url(), { method: 'GET' });
      if (reload.status >= 200 && reload.status < 300 && reload.body && typeof reload.body === 'object' && !Array.isArray(reload.body)) {
        const reloadedValue = valueAtPath(reload.body, expectedMutation.path);
        if (!mutationMatches(reloadedValue, expectedMutation)) {
          result.steps.push({
            name: `${stepName}-mutation-reloaded`,
            status: 'failed',
            path: expectedMutation.path,
            expected: expectedMutation.value,
            actual: reloadedValue,
            httpStatus: reload.status,
          });
          throw new Error(`Detail save ${stepName} did not persist changed value at ${expectedMutation.path}`);
        }
        result.steps.push({
          name: `${stepName}-mutation-reloaded`,
          status: 'ok',
          path: expectedMutation.path,
          httpStatus: reload.status,
        });
      } else {
        result.steps.push({
          name: `${stepName}-mutation-reloaded`,
          status: 'skipped',
          path: expectedMutation.path,
          httpStatus: reload.status,
          reason: 'detail GET was unavailable or did not return an object body',
        });
      }
    }
  }
  return true;
}

async function setResponseDetailValue(page, pathValue, value) {
  return page.evaluate(
    ({ path, nextValue }) => {
      const setter = window.__formsDebug?.setFormCrudResponseDetailValue;
      return typeof setter === 'function' ? setter(path, nextValue) : false;
    },
    { path: pathValue, nextValue: value },
  );
}

async function mutateEditablePrimitiveDetailField(page, stepName) {
  const state = await debugState(page);
  const field = preferredEditablePrimitiveField(state.responseDetailFields ?? [], state.responseDetailModel);
  if (!field) {
    result.steps.push({ name: `${stepName}-mutation`, status: 'skipped', reason: 'no safe writable primitive detail field' });
    return undefined;
  }
  const value = generatedFieldValue(field, stepName);
  const changed = await setResponseDetailValue(page, field.path, value);
  const after = await debugState(page);
  if (!changed || after.responseDetailValid === false) {
    result.steps.push({
      name: `${stepName}-mutation`,
      status: 'skipped',
      reason: changed ? 'mutation made detail form invalid' : 'debug setter unavailable',
      path: field.path,
      invalidControls: after.responseDetailInvalidControls,
      responseDetailModel: after.responseDetailModel,
    });
    return undefined;
  }
  result.steps.push({ name: `${stepName}-mutation`, status: 'ok', path: field.path, value });
  return { path: field.path, value };
}

async function clearResponseDetailArrayPath(page, pathValue, stepName) {
  const before = await debugState(page);
  const currentValue = valueAtPath(before.responseDetailModel, pathValue);
  if (!Array.isArray(currentValue) || currentValue.length === 0) {
    result.steps.push({
      name: `${stepName}-clear-array`,
      status: 'skipped',
      path: pathValue,
      reason: 'array is already empty or unavailable',
    });
    return undefined;
  }
  const changed = await setResponseDetailValue(page, pathValue, []);
  const after = await debugState(page);
  if (!changed || after.responseDetailValid === false) {
    result.steps.push({
      name: `${stepName}-clear-array`,
      status: 'skipped',
      path: pathValue,
      reason: changed ? 'clearing array made detail form invalid' : 'debug setter unavailable',
      invalidControls: after.responseDetailInvalidControls,
      responseDetailModel: after.responseDetailModel,
    });
    return undefined;
  }
  result.steps.push({ name: `${stepName}-clear-array`, status: 'ok', path: pathValue, beforeCount: currentValue.length });
  return { path: pathValue, value: [] };
}

async function apiRequest(page, operation, body) {
  return page.evaluate(
    async ({ method, pathValue, requestBody }) => {
      const rawToken = sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken') ?? '';
      let token = rawToken;
      try {
        token = JSON.parse(rawToken);
      } catch {
        // Stored as a plain string in some generated applications.
      }
      const headers = { Accept: 'application/json' };
      if (requestBody !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(pathValue, {
        method,
        headers,
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { method: operation.method, pathValue: apiPath(operation.path), requestBody: body },
  );
}

async function authenticatedFetch(page, pathValue, options = {}) {
  return page.evaluate(
    async ({ requestPath, requestOptions }) => {
      const rawToken = sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken') ?? '';
      let token = rawToken;
      try {
        token = JSON.parse(rawToken);
      } catch {
        // Stored as a plain string in some generated applications.
      }
      const headers = {
        Accept: 'application/json',
        ...(requestOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(requestOptions.headers ?? {}),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(requestPath, {
        ...requestOptions,
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { requestPath: pathValue, requestOptions: options },
  );
}

async function configureReferencePickerViaAdmin(page, config) {
  const resourcePath = '/api/form-crud-reference-pickers';
  const clearResponse = await authenticatedFetch(page, resourcePath, { method: 'PUT', body: [] });
  if (clearResponse.status < 200 || clearResponse.status >= 300) {
    throw new Error(`Unable to clear reference picker configuration before GUI setup: HTTP ${clearResponse.status}`);
  }

  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, '/admin/form-crud-reference-pickers'), {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('[data-cy="formCrudReferencePickers"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-empty');

  await page.locator('[data-cy="formCrudReferencePickersAdd"]').click();
  const configPanel = page.locator('[data-cy="formCrudReferencePickerConfig"]').last();
  await configPanel.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await configPanel.locator('[data-cy="formCrudReferencePickerLabel"]').fill(config.label ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerFormId"]').selectOption(config.formId ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerSourcePath"]').fill(config.sourcePath);
  await configPanel.locator('[data-cy="formCrudReferencePickerTargetApiId"]').selectOption(config.targetApiId ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerCollectionPath"]').fill(config.collectionPath);
  await configPanel.locator('[data-cy="formCrudReferencePickerBaseUrl"]').fill(config.targetBaseUrl ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerSearchParam"]').fill(config.searchParam ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerDisplayFields"]').fill((config.displayFields ?? []).join(', '));
  await configPanel
    .locator('[data-cy="formCrudReferencePickerCopyFields"]')
    .fill((config.copyFields ?? []).map(mapping => `${mapping.source}:${mapping.target}`).join(', '));
  await configPanel.locator('select[id^="mode-"]').selectOption(config.mode ?? 'reference');
  const multipleCheckbox = configPanel.locator('input[id^="multiple-"]');
  if ((await multipleCheckbox.isChecked()) !== (config.multiple !== false)) {
    await multipleCheckbox.click();
  }

  const saveResponse = page.waitForResponse(response => response.url().includes(resourcePath) && response.request().method() === 'PUT', {
    timeout: apiTimeoutMs,
  });
  await page.locator('[data-cy="formCrudReferencePickersSave"]').click();
  const response = await saveResponse;
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`Reference picker admin save failed: HTTP ${response.status()}`);
  }
  let requestedConfig;
  try {
    const requestedBody = JSON.parse(response.request().postData() ?? '[]');
    requestedConfig =
      Array.isArray(requestedBody) ?
        requestedBody.find(
          candidate =>
            candidate?.formId === config.formId &&
            candidate?.targetApiId === config.targetApiId &&
            candidate?.sourcePath === config.sourcePath &&
            candidate?.collectionPath === config.collectionPath,
        )
      : undefined;
  } catch {
    requestedConfig = undefined;
  }
  await page.locator('[data-cy="formCrudReferencePickersSuccess"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-saved');

  const persisted = await authenticatedFetch(page, resourcePath, { method: 'GET' });
  const saved =
    Array.isArray(persisted.body) ?
      persisted.body.find(
        candidate =>
          candidate?.formId === config.formId &&
          candidate?.targetApiId === config.targetApiId &&
          candidate?.sourcePath === config.sourcePath &&
          candidate?.collectionPath === config.collectionPath,
      )
    : undefined;
  if (!saved) {
    throw new Error('Reference picker configuration was not returned by the backend after admin save');
  }
  const requestedIdentity = requestedConfig?.id ?? requestedConfig?.pickerId;
  const savedIdentity = saved.id ?? saved.pickerId;
  if (requestedIdentity && savedIdentity !== requestedIdentity) {
    throw new Error(
      `Reference picker configuration identity was not preserved after admin save: expected ${requestedIdentity}, got ${savedIdentity}`,
    );
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrudReferencePickerConfig"]').first().waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-reloaded');
  result.steps.push({ name: 'reference-picker-admin-save-load', status: 'ok', sourcePath: config.sourcePath });
}

async function seedOperationFromGeneratedForm(page, operation, stepName) {
  await gotoOperation(page, operation.id);
  const state = await debugState(page);
  if (!state.valid) {
    result.steps.push({
      name: stepName,
      status: 'skipped',
      reason: 'generated form defaults are invalid',
      fieldCount: state.fields?.length ?? 0,
    });
    return undefined;
  }
  const submitted = await submitCurrentOperation(page, stepName, ['POST', 'PUT', 'PATCH', 'DELETE'], operation);
  if (!submitted) return undefined;
  const statusText = await page
    .locator('[data-cy="formCrudStatus"], [data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  result.steps.push({
    name: `${stepName}-status`,
    status: status !== undefined && status >= 200 && status < 300 ? 'ok' : 'failed',
    source: 'generated-form-defaults',
    httpStatus: status,
    text: statusText?.trim() ?? '',
  });
  return status !== undefined && status >= 200 && status < 300 ? { status } : undefined;
}

async function seedOperation(page, operation, stepName) {
  const payload = findPayloadForOperation(operation);
  if (!payload) {
    return seedOperationFromGeneratedForm(page, operation, stepName);
  }
  const response = await apiRequest(page, operation, payload);
  result.steps.push({
    name: stepName,
    status: response.status >= 200 && response.status < 300 ? 'ok' : 'failed',
    source: 'payload-fixture',
    httpStatus: response.status,
  });
  return response.status >= 200 && response.status < 300 ? response.body : undefined;
}

async function exercisePanel(page) {
  await screenshot(page, 'form-crud-initial');
  const panel = page.locator('[data-cy="formCrudResourcePanel"]').first();
  const toggle = page.locator('[data-cy="formCrudTogglePanel"]').first();
  if ((await locatorCount(panel)) === 0 || (await locatorCount(toggle)) === 0) return;
  await toggle.click();
  await page
    .locator('[data-cy="formCrudResourcePanel"]')
    .waitFor({ state: 'detached', timeout: optionalTimeoutMs })
    .catch(() => undefined);
  await screenshot(page, 'form-crud-panel-collapsed');
  await toggle.click();
  await panel.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  result.steps.push({ name: 'resource-panel-collapse-expand', status: 'ok' });
}

async function exerciseOperationRendering(page, operations) {
  result.steps.push({ name: 'operation-render-coverage', status: 'planned', count: operations.length });
  for (const operation of operations) {
    const state = await gotoOperation(page, operation.id);
    if (state.operationId !== operation.id) {
      throw new Error(`Form CRUD route selected ${state.operationId} instead of ${operation.id}`);
    }
    const submitButton = page.locator('[data-cy="formCrudSubmit"]').first();
    if ((await locatorCount(submitButton)) === 0 || !(await submitButton.isVisible())) {
      throw new Error(`Form CRUD operation ${operation.id} did not render a submit control`);
    }
    await assertStructuredOperationForm(page, operation, state);
    renderedOperationIds.add(operation.id);
  }
  result.steps.push({ name: 'operation-render-coverage', status: 'ok', count: renderedOperationIds.size });
}

function requiredOpenApiParameterValue(parameter) {
  const configured = parameter.example ?? parameter.defaultValue ?? parameter.enumValues?.[0];
  if (configured !== undefined && configured !== null && String(configured) !== '') return String(configured);
  if (parameter.format === 'date') return '2026-01-01';
  if (parameter.format === 'date-time') return '2026-01-01T00:00';
  if (parameter.type === 'integer' || parameter.type === 'number') return '1';
  if (parameter.type === 'boolean') return 'true';
  return 'test-value';
}

async function selectOpenApiOperation(page, select, operation) {
  await select.selectOption(operation.id);
  await page.waitForFunction(
    operationId => document.querySelector('[data-cy="openapiOperationSelect"]')?.value === operationId,
    operation.id,
    { timeout: optionalTimeoutMs },
  );
  for (const parameter of operation.parameters ?? []) {
    const dataCy = `openapi-param-${parameter.location}-${parameter.name}`;
    const control = page.locator(`[data-cy=${JSON.stringify(dataCy)}]`).first();
    if ((await locatorCount(control)) === 0) {
      throw new Error(`API Operations page did not render ${parameter.location} parameter ${parameter.name} for ${operation.id}`);
    }
  }
  if (operation.requestContentType) {
    const body = page.locator('[data-cy="openapiRequestBody"]').first();
    if ((await locatorCount(body)) === 0 || !(await body.isVisible())) {
      throw new Error(`API Operations page did not render the request body for ${operation.id}`);
    }
  }
  const submit = page.locator('[data-cy="openapiOperationSubmit"]').first();
  if ((await locatorCount(submit)) === 0 || !(await submit.isVisible())) {
    throw new Error(`API Operations page did not render the submit control for ${operation.id}`);
  }
  apiOperationsPageRenderedOperationIds.add(operation.id);
}

async function exerciseOpenApiOperationsPage(page, operations) {
  result.steps.push({ name: 'api-operations-page-render-coverage', status: 'planned', count: operations.length });
  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, '/openapi-operations'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="openapiOperations"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  const select = page.locator('[data-cy="openapiOperationSelect"]').first();
  const optionCount = await locatorCount(select.locator('option'));
  if (optionCount !== operations.length) {
    throw new Error(`API Operations page rendered ${optionCount} operation options; expected ${operations.length}`);
  }
  for (const operation of operations) {
    await selectOpenApiOperation(page, select, operation);
  }
  result.steps.push({
    name: 'api-operations-page-render-coverage',
    status: 'ok',
    count: apiOperationsPageRenderedOperationIds.size,
  });
  await screenshot(page, 'api-operations-all-rendered');

  const safeGet = operations.find(
    operation =>
      operation.method === 'GET' && !(operation.parameters ?? []).some(parameter => parameter.location === 'path' && parameter.required),
  );
  if (!safeGet) {
    result.steps.push({
      name: 'api-operations-page-safe-get',
      status: 'skipped',
      reason: 'no GET operation without required path parameters',
    });
    return;
  }
  await selectOpenApiOperation(page, select, safeGet);
  for (const parameter of safeGet.parameters ?? []) {
    if (!parameter.required) continue;
    const dataCy = `openapi-param-${parameter.location}-${parameter.name}`;
    const control = page.locator(`[data-cy=${JSON.stringify(dataCy)}]`).first();
    if ((await control.inputValue()) !== '') continue;
    const value = requiredOpenApiParameterValue(parameter);
    if (parameter.enumValues?.length) {
      await control.selectOption(value);
    } else {
      await control.fill(value);
    }
  }
  const submit = page.locator('[data-cy="openapiOperationSubmit"]').first();
  if (!(await submit.isEnabled())) {
    throw new Error(`API Operations safe GET ${safeGet.id} remained invalid after required parameters were populated`);
  }
  const responsePromise = waitForOperationResponse(page, safeGet, ['GET']);
  await submit.click();
  const response = await responsePromise;
  const status = response?.status();
  apiOperationsPageSubmittedOperationIds.add(safeGet.id);
  recordOperationResponse(safeGet, response);
  if (response) await recordApiExchange(`api-operations-${safeGet.id}`, response, safeGet, 'api-operations');
  if (status === undefined || status < 200 || status >= 300) {
    throw new Error(`API Operations safe GET ${safeGet.id} did not return HTTP 2xx; received ${status ?? 'no response'}`);
  }
  apiOperationsPageSuccessfulOperationIds.add(safeGet.id);
  await page.locator('[data-cy="openapiOperationStatus"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, `api-operations-${safeGet.id}`);
  result.steps.push({ name: 'api-operations-page-safe-get', status: 'ok', operationId: safeGet.id, httpStatus: status });
}

function apiOperationExecutionPriority(operation) {
  const hasPathParameters = operationPathParameters(operation).length > 0;
  if (operation.method === 'POST') return hasPathParameters ? 1 : 0;
  if (operation.method === 'GET') return hasPathParameters ? 3 : 2;
  if (operation.method === 'PATCH') return 4;
  if (operation.method === 'PUT') return hasPathParameters ? 4 : 5;
  if (operation.method === 'DELETE') return 6;
  return 5;
}

function parameterControlValue(parameter, value) {
  const normalized = String(value ?? '');
  if (parameter.format === 'date-time' && normalized) {
    const timestamp = Date.parse(normalized);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString().slice(0, 16);
  }
  if (parameter.format === 'date' && normalized.includes('T')) return normalized.slice(0, 10);
  return normalized;
}

function bodyWithResolvedPathParameters(operation, body, parameterValues) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const output = structuredClone(body);
  for (const parameter of operationPathParameters(operation)) {
    if (!Object.hasOwn(output, parameter.name)) continue;
    const resolved = parameterValues[`path:${parameter.name}`];
    if (resolved === undefined || resolved === '') continue;
    output[parameter.name] =
      parameter.type === 'integer' || parameter.type === 'number' ? Number(resolved)
      : parameter.type === 'boolean' ? resolved === 'true'
      : resolved;
  }
  return output;
}

async function fillOpenApiParameterControl(control, parameter, value) {
  const nextValue = parameterControlValue(parameter, value);
  const tagName = await control.evaluate(element => element.tagName.toLowerCase());
  if (tagName === 'select') {
    await control.selectOption(nextValue);
  } else {
    await control.fill(nextValue);
  }
}

async function prepareOpenApiOperation(page, select, operation) {
  await selectOpenApiOperation(page, select, operation);
  const parameterValues = {};
  for (const parameter of operation.parameters ?? []) {
    const dataCy = `openapi-param-${parameter.location}-${parameter.name}`;
    const control = page.locator(`[data-cy=${JSON.stringify(dataCy)}]`).first();
    let value = '';
    if (parameter.location === 'path') {
      value =
        pathParameterValue(operation, parameter, {
          createdByApiOperations: operation.method === 'DELETE',
        }) ?? '';
      if (!value && operation.method !== 'DELETE') {
        value = requiredOpenApiParameterValue(parameter);
      }
      if (!value) {
        return {
          executable: false,
          workflowBlocked: operation.method === 'DELETE',
          reason:
            operation.method === 'DELETE' ?
              `no identity created during the API Operations sweep for path parameter ${parameter.name}`
            : `unable to resolve path parameter ${parameter.name}`,
        };
      }
    } else if (parameter.required) {
      value = requiredOpenApiParameterValue(parameter);
    }
    await fillOpenApiParameterControl(control, parameter, value);
    parameterValues[`${parameter.location}:${parameter.name}`] = value;
  }

  let requestBody;
  if (operation.requestContentType) {
    requestBody = bodyWithResolvedPathParameters(operation, bodyForApiOperation(operation), parameterValues);
    const bodyControl = page.locator('[data-cy="openapiRequestBody"]').first();
    if (requestBody === undefined && operation.requestBodyRequired) {
      return { executable: false, reason: 'required request body could not be synthesized' };
    }
    const serialized =
      requestBody === undefined ? ''
      : typeof requestBody === 'string' && !operation.requestContentType.includes('json') ? requestBody
      : JSON.stringify(requestBody, null, 2);
    await bodyControl.fill(serialized);
  }

  const submit = page.locator('[data-cy="openapiOperationSubmit"]').first();
  if (!(await submit.isEnabled())) {
    return { executable: false, reason: 'operation form remains invalid after generated values were populated' };
  }
  return { executable: true, submit, parameterValues, requestBody };
}

function recordApiOperationsRoundTrip(
  stepName,
  record,
  responseBody = record.responseBody,
  responseFields = record.operation.responseBodyFields,
) {
  const roundTrip = operationRoundTripResult(record, responseBody, responseFields);
  if (!roundTrip.checked) return true;
  result.coverage.apiOperationsPageRoundTripChecks += 1;
  if (roundTrip.matched) {
    result.coverage.apiOperationsPageSuccessfulRoundTripChecks += 1;
    result.steps.push({ name: stepName, status: 'ok', operationId: record.operation.id });
    return true;
  }
  result.steps.push({
    name: stepName,
    status: 'failed',
    operationId: record.operation.id,
    expected: roundTrip.expected,
    actual: roundTrip.actual,
  });
  apiOperationsPageFailedOperations.push({
    operationId: record.operation.id,
    phase: 'round-trip',
    reason: 'response did not contain the writable request payload fields',
  });
  return false;
}

function verifyCreatedOperationDetailRoundTrips() {
  for (const createRecord of operationExecutionRecords.filter(
    record => record.createdByApiOperations && record.requestBody !== undefined,
  )) {
    const prefix = operationStaticPrefix(createRecord.operation);
    const detailRecord = operationExecutionRecords
      .filter(
        record =>
          record.source === 'api-operations' &&
          record.status >= 200 &&
          record.status < 300 &&
          record.operation.method === 'GET' &&
          operationPathParameters(record.operation).length > 0 &&
          operationStaticPrefix(record.operation) === prefix,
      )
      .at(-1);
    if (!detailRecord) continue;
    recordApiOperationsRoundTrip(
      `api-operations-${createRecord.operation.id}-persisted-detail`,
      createRecord,
      detailRecord.responseBody,
      detailRecord.operation.responseBodyFields,
    );
  }
}

async function exerciseAllOpenApiOperations(page, operations) {
  if (!exerciseApiOperations) {
    result.steps.push({ name: 'api-operations-page-execution-coverage', status: 'skipped', reason: 'execution disabled' });
    return;
  }
  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, '/openapi-operations'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="openapiOperations"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  const select = page.locator('[data-cy="openapiOperationSelect"]').first();
  const ordered = [...operations].sort((left, right) => {
    const priorityDifference = apiOperationExecutionPriority(left) - apiOperationExecutionPriority(right);
    return priorityDifference || left.path.localeCompare(right.path) || left.method.localeCompare(right.method);
  });
  result.steps.push({ name: 'api-operations-page-execution-coverage', status: 'planned', count: ordered.length });

  for (const operation of ordered) {
    const prepared = await prepareOpenApiOperation(page, select, operation);
    if (!prepared.executable) {
      const entry = { operationId: operation.id, method: operation.method, path: operation.path, reason: prepared.reason };
      const preparationClassification = classifyOperationPreparationFailure(prepared);
      if (preparationClassification === 'workflow-blocked') {
        apiOperationsPageUnexecutableOperations.push(entry);
        result.steps.push({ name: `api-operations-execute-${operation.id}`, status: 'unexecutable', ...entry });
      } else {
        apiOperationsPageFailedOperations.push(entry);
        result.steps.push({ name: `api-operations-execute-${operation.id}`, status: 'failed', ...entry });
      }
      continue;
    }

    const responsePromise = waitForOperationResponse(page, operation, [operation.method], Math.min(apiTimeoutMs, 15000));
    await prepared.submit.click();
    apiOperationsPageSubmittedOperationIds.add(operation.id);
    const response = await responsePromise;
    recordOperationResponse(operation, response);
    if (!response) {
      const entry = {
        operationId: operation.id,
        method: operation.method,
        path: operation.path,
        reason: 'no matching HTTP response was observed',
      };
      apiOperationsPageFailedOperations.push(entry);
      result.steps.push({ name: `api-operations-execute-${operation.id}`, status: 'failed', ...entry });
      continue;
    }

    const status = response.status();
    await recordApiExchange(`api-operations-execute-${operation.id}`, response, operation, 'api-operations');
    await page
      .locator('[data-cy="openapiOperationStatus"]')
      .waitFor({ state: 'visible', timeout: optionalTimeoutMs })
      .catch(() => undefined);
    const responseClassification = classifyOperationResponse(operation.responseStatusCodes, status);
    if (responseClassification === 'declared-response') {
      apiOperationsPageDeclaredResponseOperationIds.add(operation.id);
      apiOperationsPageContractCoveredOperationIds.add(operation.id);
      result.steps.push({
        name: `api-operations-execute-${operation.id}`,
        status: 'declared-response',
        method: operation.method,
        path: operation.path,
        httpStatus: status,
        declaredResponseStatusCodes: operation.responseStatusCodes,
        parameterValues: prepared.parameterValues,
      });
      continue;
    }
    if (responseClassification !== 'success') {
      const entry = {
        operationId: operation.id,
        method: operation.method,
        path: operation.path,
        status,
        reason:
          responseClassification === 'server-error' ?
            `HTTP ${status} server error`
          : `HTTP ${status} is not declared by the OpenAPI operation`,
      };
      apiOperationsPageFailedOperations.push(entry);
      result.steps.push({ name: `api-operations-execute-${operation.id}`, status: 'failed', ...entry });
      continue;
    }

    apiOperationsPageSuccessfulOperationIds.add(operation.id);
    apiOperationsPageContractCoveredOperationIds.add(operation.id);
    const executionRecord = operationExecutionRecords.at(-1);
    if (executionRecord?.operation.id === operation.id && ['POST', 'PUT', 'PATCH'].includes(operation.method)) {
      recordApiOperationsRoundTrip(`api-operations-${operation.id}-response-round-trip`, executionRecord);
    }
    result.steps.push({
      name: `api-operations-execute-${operation.id}`,
      status: 'ok',
      method: operation.method,
      path: operation.path,
      httpStatus: status,
      parameterValues: prepared.parameterValues,
    });
  }

  verifyCreatedOperationDetailRoundTrips();
  await screenshot(page, 'api-operations-execution-complete');
  const missing2xx = operations.filter(operation => !apiOperationsPageSuccessfulOperationIds.has(operation.id));
  const accountedIds = new Set([
    ...apiOperationsPageContractCoveredOperationIds,
    ...apiOperationsPageUnexecutableOperations.map(entry => entry.operationId),
  ]);
  const missingAccounted = operations.filter(operation => !accountedIds.has(operation.id));
  result.steps.push({
    name: 'api-operations-page-execution-coverage',
    status:
      apiOperationsPageFailedOperations.length || missingAccounted.length ? 'failed'
      : apiOperationsPageUnexecutableOperations.length ? 'ok-with-workflow-blocked'
      : 'ok',
    successful: apiOperationsPageSuccessfulOperationIds.size,
    declaredResponses: apiOperationsPageDeclaredResponseOperationIds.size,
    workflowBlocked: apiOperationsPageUnexecutableOperations.length,
    accounted: accountedIds.size,
    declared: operations.length,
    missing2xxOperationIds: missing2xx.map(operation => operation.id),
    missingAccountedOperationIds: missingAccounted.map(operation => operation.id),
  });
  if (requireAllApiOperations2xx && missing2xx.length) {
    throw new Error(
      `API Operations page did not complete every declared operation with HTTP 2xx: ${missing2xx.map(operation => operation.id).join(', ')}`,
    );
  }
  if (requireAllApiOperationsAccounted && (missingAccounted.length || apiOperationsPageFailedOperations.length)) {
    throw new Error(
      `API Operations contract coverage failed: ${[
        ...apiOperationsPageFailedOperations.map(entry => entry.operationId),
        ...missingAccounted.map(operation => operation.id),
      ].join(', ')}`,
    );
  }
}

async function exerciseListResource(page, entry) {
  const operation = entry.resource.listOperation;
  if (!operation) return;
  result.coverage.exercisedListResources += 1;
  await gotoOperation(page, operation.id);
  await screenshot(page, `list-${operation.id}-before-submit`);
  await submitCurrentOperation(page, `list-${operation.id}`, ['GET'], operation);

  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const rowCount = await locatorCount(rows);
  result.steps.push({ name: `list-${operation.id}-rows`, status: 'ok', count: rowCount });
  if (rowCount === 0) return;

  const firstRow = rows.first();
  const detailsButton = firstRow.locator('[data-cy="formCrudDetailsButton"]').first();
  if ((await locatorCount(detailsButton)) > 0) {
    const detailResponsePromise = waitForOperationResponse(page, entry.resource.detailOperation, ['GET']);
    await detailsButton.click();
    const detailResponse = await detailResponsePromise;
    recordOperationResponse(entry.resource.detailOperation, detailResponse);
    if (detailResponse) await recordApiExchange(`detail-${operation.id}`, detailResponse, entry.resource.detailOperation);
    await page.locator('[data-cy="formCrudDetails"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
    await screenshot(page, `detail-${operation.id}`);
    result.coverage.exercisedDetailResources += 1;
    result.steps.push({ name: `detail-${operation.id}`, status: 'ok' });

    const accordionCount = await expandAccordions(page.locator('[data-cy="formCrudDetails"]'), 12);
    if (accordionCount > 0) {
      await screenshot(page, `detail-${operation.id}-accordion-expanded`);
      result.steps.push({ name: `detail-accordions-${operation.id}`, status: 'ok', count: accordionCount });
    }

    const pickerButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudReferencePickerButton"]').first();
    if ((await locatorCount(pickerButton)) > 0 && (await pickerButton.isVisible())) {
      await pickerButton.click();
      const modal = page.locator('[data-cy="formCrudReferencePickerModal"]').first();
      await modal.waitFor({ state: 'visible', timeout: apiTimeoutMs });
      await screenshot(page, `reference-picker-${operation.id}`);
      const pickerRows = page.locator('[data-cy="formCrudReferencePickerRow"]');
      if ((await locatorCount(pickerRows)) > 0) {
        await pickerRows.first().locator('[data-cy="formCrudReferencePickerSelect"]').click();
        await modal.waitFor({ state: 'detached', timeout: apiTimeoutMs });
        await screenshot(page, `reference-picker-${operation.id}-selected`);
        result.steps.push({ name: `reference-picker-select-${operation.id}`, status: 'ok' });
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
        result.steps.push({ name: `reference-picker-select-${operation.id}`, status: 'skipped', reason: 'no rows' });
      }
    }

    if (entry.resource.updateOperation) {
      const mutation = await mutateEditablePrimitiveDetailField(page, `update-${entry.resource.updateOperation.id}`);
      await saveVisibleDetail(page, `update-${entry.resource.updateOperation.id}`, false, mutation, entry.resource.updateOperation);
    }
  }
}

async function listRowCount(page, operation, stepName) {
  await gotoOperation(page, operation.id);
  await submitCurrentOperation(page, stepName, ['GET'], operation);
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const count = await locatorCount(rows);
  result.steps.push({ name: `${stepName}-rows`, status: 'observed', count });
  return count;
}

async function ensureResourceRows(page, entry, stepName) {
  const listOperation = entry.resource?.listOperation;
  const createOperation = entry.resource?.createOperation;
  if (!listOperation) return false;
  if ((await listRowCount(page, listOperation, `${stepName}-list-before-seed`)) > 0) return true;
  if (!createOperation) return false;
  await seedOperation(page, createOperation, `${stepName}-seed-${createOperation.id}`);
  return (await listRowCount(page, listOperation, `${stepName}-list-after-seed`)) > 0;
}

async function exerciseReferencePickerScenarios(page, resources) {
  const discoveredScenarios = referencePickerScenarios(resources);
  const matchingScenarios = discoveredScenarios.filter(scenario => {
    const sourceOperation = scenario.sourceEntry.resource.updateOperation;
    return (
      (!referencePickerSourceOperationId ||
        sourceOperation.id === referencePickerSourceOperationId ||
        sourceOperation.operationId === referencePickerSourceOperationId) &&
      (!referencePickerSourcePath || scenario.sourcePath === referencePickerSourcePath)
    );
  });
  if ((referencePickerSourceOperationId || referencePickerSourcePath) && matchingScenarios.length === 0) {
    const availableScenarios = discoveredScenarios.map(scenario => {
      const sourceOperation = scenario.sourceEntry.resource.updateOperation;
      return `${sourceOperation.operationId ?? sourceOperation.id}:${scenario.sourcePath}`;
    });
    throw new Error(
      `No reference picker scenario matched source operation "${referencePickerSourceOperationId || '*'}" and path "${referencePickerSourcePath || '*'}"; available scenarios: ${availableScenarios.join(', ') || 'none'}`,
    );
  }
  const scenarios = limitEntries(matchingScenarios, maxReferencePickerScenarios);
  result.coverage.plannedReferencePickerScenarios = scenarios.length;
  result.steps.push({
    name: 'reference-picker-scenario-coverage',
    status: 'planned',
    count: scenarios.length,
    discoveredCount: discoveredScenarios.length,
    sourceOperationId: referencePickerSourceOperationId || undefined,
    sourcePath: referencePickerSourcePath || undefined,
  });
  if (!scenarios.length) {
    result.steps.push({
      name: 'reference-picker-scenario',
      status: 'skipped',
      reason: 'no compatible reference field and target resource discovered',
    });
    return;
  }

  for (let index = 0; index < scenarios.length; index += 1) {
    await exerciseReferencePickerScenario(page, scenarios[index], index);
  }
}

async function exerciseReferencePickerScenario(page, scenario, scenarioIndex = 0) {
  const { sourceEntry, targetEntry, sourcePath, field: sourceField } = scenario;
  const copyFields = targetCopyFieldsForPath(sourceEntry.resource.updateOperation.requestBodyFields ?? [], sourcePath);
  const config = {
    id: `gui-smoke-${Date.now()}-${scenarioIndex}`,
    label: `${sourceEntry.resource.label ?? sourceEntry.resource.listOperation.path} ${sourcePath}`,
    formId: sourceEntry.resource.updateOperation.id,
    targetApiId: targetEntry.resource.listOperation.id,
    sourcePath,
    collectionPath: targetEntry.resource.listOperation.path,
    displayFields: ['id', 'tmfId', 'href', 'name'],
    copyFields,
    mode: 'reference',
    multiple: true,
  };

  await configureReferencePickerViaAdmin(page, config);

  const targetReady = await ensureResourceRows(page, targetEntry, 'reference-picker-target');
  const sourceReady = await ensureResourceRows(page, sourceEntry, 'reference-picker-source');
  if (!targetReady || !sourceReady) {
    result.steps.push({
      name: 'reference-picker-select',
      status: 'skipped',
      reason: 'source or target list has no rows after seeding',
      targetReady,
      sourceReady,
    });
    return;
  }

  await gotoOperation(page, sourceEntry.resource.listOperation.id);
  await submitCurrentOperation(
    page,
    `reference-picker-list-${sourceEntry.resource.listOperation.id}`,
    ['GET'],
    sourceEntry.resource.listOperation,
  );
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  if ((await locatorCount(rows)) === 0) {
    result.steps.push({ name: 'reference-picker-select', status: 'skipped', reason: 'source list returned no rows after seeding' });
    return;
  }

  const detailResponsePromise = waitForOperationResponse(page, sourceEntry.resource.detailOperation, ['GET']);
  await rows.first().locator('[data-cy="formCrudDetailsButton"]').first().click();
  const detailResponse = await detailResponsePromise;
  recordOperationResponse(sourceEntry.resource.detailOperation, detailResponse);
  if (detailResponse) await recordApiExchange('reference-picker-detail', detailResponse, sourceEntry.resource.detailOperation);
  await page.locator('[data-cy="formCrudDetails"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await expandAccordions(page.locator('[data-cy="formCrudDetails"]'));
  await screenshot(page, 'reference-picker-detail-before-select');

  const before = await debugState(page);
  const pickerButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudReferencePickerButton"]').first();
  if ((await locatorCount(pickerButton)) === 0 || !(await pickerButton.isVisible())) {
    result.steps.push({
      name: 'reference-picker-select',
      status: 'failed',
      reason: 'configured picker button is not visible on the detail form',
    });
    throw new Error('Configured reference picker button is not visible on the detail form');
  }

  await pickerButton.click();
  const modal = page.locator('[data-cy="formCrudReferencePickerModal"]').first();
  await modal.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-modal');
  const pickerRows = page.locator('[data-cy="formCrudReferencePickerRow"]');
  if ((await locatorCount(pickerRows)) === 0) {
    result.steps.push({ name: 'reference-picker-select', status: 'failed', reason: 'target list returned no selectable rows' });
    throw new Error('Reference picker target list returned no selectable rows');
  }

  const selectedItem = await page.evaluate(() => window.__formsDebug.formCrud().referencePickerRows[0]?.item);
  await pickerRows.first().locator('[data-cy="formCrudReferencePickerSelect"]').click();
  await modal.waitFor({ state: 'detached', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-selected');
  const after = await debugState(page);
  const beforeValue = valueAtPath(before.responseDetailModel, sourcePath);
  const afterValue = valueAtPath(after.responseDetailModel, sourcePath);
  const changed = JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  const selectedValues = Array.isArray(afterValue) ? afterValue : [afterValue];
  const copied = selectedValues.some(candidate => sharedIdentityFields(candidate, selectedItem).length > 0);
  const expectedCopyFields = expectedConfiguredCopyFields(selectedItem, config);
  const copiedConfigured = selectedValues.flatMap(candidate => copiedConfiguredFields(candidate, selectedItem, config));
  const missingCopyFields = expectedCopyFields.filter(field => !copiedConfigured.includes(field));

  if (!changed || !copied || missingCopyFields.length) {
    result.steps.push({ name: 'reference-picker-select', status: 'failed', changed, copied, sourcePath, missingCopyFields });
    throw new Error(
      `Reference picker did not populate ${sourcePath} with selected configured fields: ${missingCopyFields.join(', ') || 'identity fields'}`,
    );
  }

  result.steps.push({
    name: 'reference-picker-select',
    status: 'ok',
    sourcePath,
    copiedFields: selectedValues.flatMap(candidate => sharedIdentityFields(candidate, selectedItem)),
    copiedConfiguredFields: copiedConfigured,
  });
  result.coverage.exercisedReferencePickerSaves += 1;
  const expectedPersistedValue = configuredCopyFieldSubset(afterValue, config) ?? afterValue;
  if (
    await saveVisibleDetail(
      page,
      'reference-picker-save-selected',
      true,
      { path: sourcePath, value: expectedPersistedValue, match: 'subset' },
      sourceEntry.resource.updateOperation,
    )
  ) {
    const saved = await debugState(page);
    const savedValue = valueAtPath(saved.responseDetailModel, sourcePath);
    const savedValues = Array.isArray(savedValue) ? savedValue : [savedValue];
    const savedCopiedConfigured = savedValues.flatMap(candidate => copiedConfiguredFields(candidate, selectedItem, config));
    const savedMissingCopyFields = expectedCopyFields.filter(field => !savedCopiedConfigured.includes(field));
    if (savedMissingCopyFields.length) {
      result.steps.push({
        name: 'reference-picker-save-retains-selection',
        status: 'failed',
        sourcePath,
        missingCopyFields: savedMissingCopyFields,
      });
      throw new Error(`Reference picker save did not retain ${sourcePath} configured fields: ${savedMissingCopyFields.join(', ')}`);
    }
    result.steps.push({
      name: 'reference-picker-save-retains-selection',
      status: 'ok',
      sourcePath,
      copiedConfiguredFields: savedCopiedConfigured,
    });
    result.coverage.successfulReferencePickerSaves += 1;
    if (!sourceField.required && !(Number(sourceField.minItems) > 0)) {
      const clearMutation = await clearResponseDetailArrayPath(page, sourcePath, 'reference-picker-clear-selection');
      if (
        clearMutation &&
        (await saveVisibleDetail(
          page,
          'reference-picker-save-cleared-selection',
          true,
          clearMutation,
          sourceEntry.resource.updateOperation,
        ))
      ) {
        result.steps.push({ name: 'reference-picker-clear-retained', status: 'ok', sourcePath });
      }
    }
  }
}

async function exerciseCreateResource(page, entry) {
  const operation = entry.resource.createOperation;
  if (!operation) return false;
  await gotoOperation(page, operation.id);
  await screenshot(page, `create-${operation.id}-initial`);

  const state = await debugState(page);
  result.steps.push({
    name: `create-${operation.id}-form-state`,
    status: 'observed',
    valid: state.valid,
    fieldCount: state.fields?.length ?? 0,
  });
  if (!state.valid) {
    result.steps.push({
      name: `create-${operation.id}-invalid-defaults`,
      status: failOnInvalidCreateForm ? 'failed' : 'observed',
      reason: 'generated form defaults are invalid',
      fieldCount: state.fields?.length ?? 0,
    });
    if (failOnInvalidCreateForm) {
      throw new Error(`Create form ${operation.id} is invalid with generated defaults`);
    }
    return false;
  }

  const submitted = await submitCurrentOperation(page, `create-${operation.id}`, ['POST', 'PUT', 'PATCH', 'DELETE'], operation);
  if (!submitted) return false;

  const statusText = await page
    .locator('[data-cy="formCrudStatus"], [data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  const ok = httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
  result.steps.push({
    name: `create-${operation.id}-status`,
    status: ok ? 'ok' : 'failed',
    httpStatus,
    text: statusText?.trim() ?? '',
  });
  if (!ok && failOnCreateHttpError) {
    throw new Error(`Create operation ${operation.id} did not return HTTP 2xx: ${statusText?.trim() || 'no status shown'}`);
  }
  if (ok) result.coverage.successfulCreateResources += 1;
  return ok;
}

async function exerciseDeleteCreatedItem(page, entry) {
  if (!exerciseDelete || !entry.resource.listOperation || !entry.resource.deleteOperation) return;
  await gotoOperation(page, entry.resource.listOperation.id);
  await submitCurrentOperation(page, `list-before-delete-${entry.resource.listOperation.id}`, ['GET'], entry.resource.listOperation);
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const rowCount = await locatorCount(rows);
  if (rowCount === 0) return;
  const deleteButton = rows.last().locator('[data-cy="formCrudDeleteButton"]').first();
  if ((await locatorCount(deleteButton)) === 0 || !(await deleteButton.isEnabled())) return;
  const deletedRowText = (
    await rows
      .last()
      .textContent()
      .catch(() => '')
  ).trim();
  result.coverage.exercisedDeleteResources += 1;
  const deleteResponse = waitForOperationResponse(page, entry.resource.deleteOperation, ['DELETE']);
  page.once('dialog', dialog => dialog.accept());
  await deleteButton.click();
  const response = await deleteResponse;
  recordOperationResponse(entry.resource.deleteOperation, response);
  if (response) await recordApiExchange(`delete-${entry.resource.listOperation.id}`, response, entry.resource.deleteOperation);
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, `delete-${entry.resource.listOperation.id}`);
  const refreshedRowCount = await locatorCount(rows);
  const remainingText = (await rows.allTextContents().catch(() => [])).join('\n');
  const status = response?.status();
  const removedFromView = refreshedRowCount < rowCount || !remainingText.includes(deletedRowText);
  const ok = status !== undefined && status >= 200 && status < 300 && removedFromView;
  result.steps.push({
    name: `delete-${entry.resource.listOperation.id}`,
    status: ok ? 'ok' : 'failed',
    httpStatus: status,
    beforeRows: rowCount,
    afterRows: refreshedRowCount,
    removedFromView,
  });
  if (!ok) throw new Error(`Delete ${entry.resource.deleteOperation.id} did not remove a visible row with HTTP 2xx`);
  result.coverage.successfulDeleteResources += 1;
}

try {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ headless });
  page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  let authenticated = false;
  page.on('console', message => {
    result.console.push({ type: message.type(), text: message.text(), authenticated });
  });
  page.on('pageerror', error => {
    result.pageErrors.push({ message: error.message, stack: error.stack });
  });
  page.on('response', response => {
    const status = response.status();
    if (authenticated && (status >= 500 || (failOnHttp4xx && status >= 400))) {
      result.failedResponses.push(compactResponse(response));
    }
  });

  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="username"], input[name="username"]').first().fill(username);
  await page.locator('[data-cy="password"], input[name="password"]').first().fill(password);
  await page.locator('[data-cy="submit"], button[type="submit"]').first().click();
  await page.waitForFunction(
    () => Boolean(sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken')),
    undefined,
    { timeout: timeoutMs },
  );
  await page
    .locator('#home-logged-message')
    .waitFor({ state: 'visible', timeout: optionalTimeoutMs })
    .catch(() => undefined);
  authenticated = true;
  await screenshot(page, 'login-complete');
  result.steps.push({ name: 'login', status: 'ok' });

  await navigateWithSourceCoverage(page, joinUrl(webBaseUrl, '/form-crud'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await exercisePanel(page);
  await exerciseResponsiveLayout(page);

  const initialState = await debugState(page);
  declaredOperations = Array.isArray(initialState.operations) ? initialState.operations : [];
  if (declaredOperations.length === 0) {
    throw new Error('Form CRUD debug metadata did not expose any OpenAPI operations');
  }
  const resources = flattenResources(initialState.resourceGroups);
  result.resourceCount = resources.length;
  result.coverage.discoveredResources = resources.length;
  result.steps.push({ name: 'discover-resources', status: 'ok', count: resources.length });
  await exerciseOperationRendering(page, declaredOperations);
  await exerciseOpenApiOperationsPage(page, declaredOperations);

  await exerciseReferencePickerScenarios(page, resources);

  const createdEntries = [];
  if (exerciseCreate) {
    const createEntries = limitEntries(
      resources.filter(candidate => candidate.resource.createOperation),
      maxCreateResources,
    );
    result.coverage.plannedCreateResources = createEntries.length;
    result.steps.push({ name: 'create-resource-coverage', status: 'planned', count: createEntries.length });
    for (const entry of createEntries) {
      result.coverage.exercisedCreateResources += 1;
      const createdCurrent = await exerciseCreateResource(page, entry);
      if (createdCurrent) {
        createdEntries.push(entry);
      }
    }
  }

  const listEntries = limitEntries(
    resources.filter(candidate => candidate.resource.listOperation),
    maxListResources,
  );
  result.coverage.plannedListResources = listEntries.length;
  result.coverage.plannedUpdateResources = exerciseUpdate ? listEntries.filter(candidate => candidate.resource.updateOperation).length : 0;
  result.steps.push({ name: 'list-resource-coverage', status: 'planned', count: listEntries.length });
  for (const entry of listEntries) {
    await exerciseListResource(page, entry);
  }

  await exerciseAllOpenApiOperations(page, declaredOperations);

  result.coverage.plannedDeleteResources =
    exerciseDelete ? createdEntries.filter(candidate => candidate.resource.listOperation && candidate.resource.deleteOperation).length : 0;
  for (const entry of createdEntries) {
    await exerciseDeleteCreatedItem(page, entry);
  }

  if (
    requireAllAvailableResourceWorkflows &&
    (result.coverage.successfulUpdateResources !== result.coverage.plannedUpdateResources ||
      result.coverage.successfulDeleteResources !== result.coverage.plannedDeleteResources)
  ) {
    throw new Error(
      `Form CRUD resource workflows incomplete: updates ${result.coverage.successfulUpdateResources}/${result.coverage.plannedUpdateResources}, deletes ${result.coverage.successfulDeleteResources}/${result.coverage.plannedDeleteResources}`,
    );
  }

  const consoleErrors = result.console.filter(
    entry =>
      entry.type === 'error' &&
      entry.authenticated &&
      !/Failed to load resource: the server responded with a status of [45]\d\d/i.test(entry.text),
  );
  if (result.pageErrors.length > 0) {
    throw new Error(`Browser page error(s): ${result.pageErrors.map(error => error.message).join('; ')}`);
  }
  if (result.failedResponses.length > 0) {
    throw new Error(
      `Failed HTTP response(s): ${result.failedResponses.map(response => `${response.method} ${response.url} ${response.status}`).join('; ')}`,
    );
  }
  if (failOnConsoleError && consoleErrors.length > 0) {
    throw new Error(`Browser console error(s): ${consoleErrors.map(entry => entry.text).join('; ')}`);
  }

  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  try {
    await collectSourceCoverage();
  } catch (coverageError) {
    result.sourceCoverage = {
      ...result.sourceCoverage,
      enabled: sourceCoverageEnabled,
      error: { message: coverageError.message, stack: coverageError.stack },
    };
    if (sourceCoverageEnabled) {
      result.status = 'failed';
      result.error ??= { message: coverageError.message, stack: coverageError.stack };
      process.exitCode = 1;
    }
  }
  if (browser) {
    await browser.close();
  }
  writeResultReport();
}
