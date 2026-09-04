#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

const [, , summaryPath, openApiPath, outputPath, basePath = '/api'] = process.argv;
const lockRequestExampleSchemas = process.env.EVOMASTER_LOCK_REQUEST_EXAMPLE_SCHEMAS !== 'false';

if (!summaryPath || !openApiPath || !outputPath) {
  console.error('Usage: evomaster-openapi-smoke-examples.mjs <smoke-summary.json> <openapi.yaml> <output-openapi.yaml> [base-path]');
  process.exit(2);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePathPart(value) {
  return `/${String(value ?? '')
    .split('/')
    .filter(Boolean)
    .join('/')}`;
}

function prefixedPath(rawPath) {
  const normalizedPath = normalizePathPart(rawPath);
  const normalizedBase = normalizePathPart(basePath);
  if (normalizedBase === '/') return normalizedPath;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) return normalizedPath;
  return `${normalizedBase}${normalizedPath}`;
}

function pathSegments(value) {
  return normalizePathPart(value).split('/').filter(Boolean);
}

function pathMatches(templatePath, concretePath) {
  const templateSegments = pathSegments(templatePath);
  const concreteSegments = pathSegments(concretePath);
  return (
    templateSegments.length === concreteSegments.length &&
    templateSegments.every((segment, index) => (segment.startsWith('{') && segment.endsWith('}')) || segment === concreteSegments[index])
  );
}

function pathParameterValues(templatePath, concretePath) {
  const values = new Map();
  const templateSegments = pathSegments(templatePath);
  const concreteSegments = pathSegments(concretePath);
  templateSegments.forEach((segment, index) => {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      values.set(segment.slice(1, -1), decodeURIComponent(concreteSegments[index] ?? ''));
    }
  });
  return values;
}

function findPathEntry(openApi, method, concretePath) {
  const paths = openApi.paths ?? {};
  const exact = paths[concretePath]?.[method];
  if (exact) return { templatePath: concretePath, pathItem: paths[concretePath], operation: exact };
  for (const [templatePath, pathItem] of Object.entries(paths)) {
    if (pathMatches(templatePath, concretePath) && pathItem?.[method]) {
      return { templatePath, pathItem, operation: pathItem[method] };
    }
  }
  return undefined;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

function deepCopy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function schemaFromExample(value) {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      minItems: value.length,
      maxItems: value.length,
      items: value.length > 0 ? schemaFromExample(value[0]) : {},
    };
  }
  if (value && typeof value === 'object') {
    const properties = {};
    for (const [property, propertyValue] of Object.entries(value)) {
      properties[property] = schemaFromExample(propertyValue);
    }
    return {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(properties),
      properties,
    };
  }
  if (value === null) {
    return { nullable: true };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', enum: [value] };
  }
  if (typeof value === 'number') {
    return { type: Number.isInteger(value) ? 'integer' : 'number', minimum: value, maximum: value };
  }
  return { type: 'string', enum: [String(value)] };
}

function rewriteNumericEnumsForEvoMaster(node) {
  if (Array.isArray(node)) {
    return node.reduce((count, item) => count + rewriteNumericEnumsForEvoMaster(item), 0);
  }
  if (!node || typeof node !== 'object') return 0;

  let count = 0;
  const type = nonNullableType(node);
  if ((type === 'number' || type === 'integer') && Array.isArray(node.enum)) {
    const numericValues = node.enum
      .map(value => (typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN))
      .filter(Number.isFinite);
    delete node.enum;
    if (numericValues.length > 0) {
      node.minimum ??= Math.min(...numericValues);
      node.maximum ??= Math.max(...numericValues);
    }
    count += 1;
  }

  for (const value of Object.values(node)) {
    count += rewriteNumericEnumsForEvoMaster(value);
  }
  return count;
}

function uniqueArray(existing, incoming) {
  return [...new Set([...ensureArray(existing), ...ensureArray(incoming)].map(String))];
}

function refSchemaName(value) {
  const ref = String(value ?? '');
  return ref.startsWith('#/components/schemas/') ?
      decodeURIComponent(ref.split('/').pop().replace(/~1/g, '/').replace(/~0/g, '~'))
    : undefined;
}

function mergePropertySchema(existingValue, incomingValue) {
  if (
    existingValue &&
    incomingValue &&
    typeof existingValue === 'object' &&
    typeof incomingValue === 'object' &&
    !Array.isArray(existingValue) &&
    !Array.isArray(incomingValue)
  ) {
    const merged = deepCopy(existingValue);
    mergeSchema(merged, incomingValue);
    return merged;
  }
  return deepCopy(incomingValue);
}

function mergeSchemaEntry(target, key, value) {
  if (key === 'required' || key === 'enum') {
    target[key] = uniqueArray(target[key], value);
    return;
  }
  if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
    const mergedProperties = { ...(target.properties ?? {}) };
    for (const [propertyName, propertySchema] of Object.entries(value)) {
      mergedProperties[propertyName] = mergePropertySchema(mergedProperties[propertyName], propertySchema);
    }
    target.properties = mergedProperties;
    return;
  }
  target[key] = deepCopy(value);
}

function mergeSchema(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    mergeSchemaEntry(target, key, value);
  }
}

function flattenAllOfSchema(schema, schemas, seenRefs = new Set()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const refName = refSchemaName(schema.$ref);
  if (refName) {
    if (seenRefs.has(refName) || !schemas[refName]) return {};
    seenRefs.add(refName);
    const flattened = flattenAllOfSchema(schemas[refName], schemas, seenRefs);
    seenRefs.delete(refName);
    return flattened;
  }

  const flattened = {};
  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) {
      mergeSchema(flattened, flattenAllOfSchema(item, schemas, seenRefs));
    }
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'allOf') {
      mergeSchemaEntry(flattened, key, value);
    }
  }
  flattened.type ??= 'object';
  return flattened;
}

function mergeComposedChoiceSchema(schema, schemas) {
  const choices = [];
  if (Array.isArray(schema.oneOf)) choices.push(...schema.oneOf);
  if (Array.isArray(schema.anyOf)) choices.push(...schema.anyOf);
  delete schema.oneOf;
  delete schema.anyOf;
  if (!choices.length) return;

  const merged = {};
  for (const choice of choices) {
    mergeSchema(merged, flattenAllOfSchema(choice, schemas));
  }
  delete merged.required;
  for (const [key, value] of Object.entries(merged)) {
    mergeSchemaEntry(schema, key, value);
  }
  schema.type ??= 'object';
}

function normalizeComposedSchemasForEvoMaster(node, schemas) {
  if (Array.isArray(node)) {
    node.forEach(item => normalizeComposedSchemasForEvoMaster(item, schemas));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.allOf)) {
    const flattened = flattenAllOfSchema(node, schemas);
    Object.keys(node).forEach(key => delete node[key]);
    Object.assign(node, flattened);
  }
  mergeComposedChoiceSchema(node, schemas);
  delete node.discriminator;
  Object.values(node).forEach(value => normalizeComposedSchemasForEvoMaster(value, schemas));
}

const unsupportedEvoMasterStringFormats = new Set([
  'uuid',
  'email',
  'idn-email',
  'uri',
  'url',
  'uri-reference',
  'iri',
  'iri-reference',
  'hostname',
  'idn-hostname',
  'byte',
  'base64',
  'binary',
  'password',
]);

function nonNullableType(schema) {
  const type = schema?.type;
  if (Array.isArray(type)) return type.map(String).find(value => value !== 'null') ?? 'object';
  return typeof type === 'string' ? type : undefined;
}

function isOpenApiParameter(node) {
  return (
    node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeof node.name === 'string' &&
    node.schema &&
    ['path', 'query', 'header', 'cookie'].includes(node.in)
  );
}

function stripUnsupportedFormatsAndPatterns(node, stats, preservePatterns = false) {
  if (Array.isArray(node)) {
    node.forEach(item => stripUnsupportedFormatsAndPatterns(item, stats, preservePatterns));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (unsupportedEvoMasterStringFormats.has(String(node.format ?? ''))) {
    delete node.format;
    stats.unsupportedFormatsStripped += 1;
  }
  if (!preservePatterns && Object.hasOwn(node, 'pattern')) {
    delete node.pattern;
    stats.schemaPatternsStripped += 1;
  }
  const operationParameter = isOpenApiParameter(node);
  for (const [key, value] of Object.entries(node)) {
    stripUnsupportedFormatsAndPatterns(value, stats, preservePatterns || (operationParameter && key === 'schema'));
  }
}

function isFreeFormObjectSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  if (nonNullableType(schema) !== 'object') return false;
  if (schema.$ref || schema.properties || schema.items || schema.allOf || schema.oneOf || schema.anyOf) return false;
  return schema.additionalProperties === undefined || schema.additionalProperties === true;
}

function replaceWithBoundedObjectSchema(schema) {
  const { description } = schema;
  Object.keys(schema).forEach(key => delete schema[key]);
  schema.type = 'object';
  if (description !== undefined) schema.description = description;
  schema.additionalProperties = false;
  schema.properties = { value: { type: 'string' } };
}

function boundFreeFormObjectSchemas(node, stats) {
  if (Array.isArray(node)) {
    node.forEach(item => boundFreeFormObjectSchemas(item, stats));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (isFreeFormObjectSchema(node)) {
    replaceWithBoundedObjectSchema(node);
    stats.freeFormObjectSchemasBounded += 1;
  }
  Object.values(node).forEach(value => boundFreeFormObjectSchemas(value, stats));
}

function resolveOpenApiPointer(openApi, ref) {
  let current = openApi;
  for (const segment of String(ref).slice(2).split('/')) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return current;
}

function resolveOpenApiRefMap(value, openApi) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    const resolved = resolveOpenApiPointer(openApi, value.$ref);
    return resolved && typeof resolved === 'object' && !Array.isArray(resolved) ? deepCopy(resolved) : deepCopy(value);
  }
  return deepCopy(value);
}

function compactSchemaFor(referenced, schemas = {}, seenRefs = new Set()) {
  if (referenced && typeof referenced === 'object' && !Array.isArray(referenced)) {
    const refName = refSchemaName(referenced.$ref);
    if (refName) {
      const resolved = schemas[refName];
      if (resolved && !seenRefs.has(refName)) {
        const nextSeenRefs = new Set(seenRefs);
        nextSeenRefs.add(refName);
        return compactSchemaFor(resolved, schemas, nextSeenRefs);
      }
    }
    const type = nonNullableType(referenced);
    if (type === 'array') {
      return {
        type: 'array',
        maxItems: 1,
        items:
          referenced.items && typeof referenced.items === 'object' ?
            compactSchemaFor(referenced.items, schemas, seenRefs)
          : { type: 'string' },
      };
    }
    if (['string', 'integer', 'number', 'boolean'].includes(type)) {
      const compact = { type };
      for (const keyword of ['format', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'enum', 'nullable']) {
        if (referenced[keyword] !== undefined) compact[keyword] = deepCopy(referenced[keyword]);
      }
      return compact;
    }
    if (type === 'object' || referenced.properties) {
      const properties = {};
      for (const [property, propertySchema] of Object.entries(referenced.properties ?? {})) {
        properties[property] = compactSchemaFor(propertySchema, schemas, seenRefs);
      }
      return {
        type: 'object',
        additionalProperties: false,
        ...(referenced.required ? { required: deepCopy(referenced.required) } : {}),
        ...(Object.keys(properties).length > 0 ? { properties } : { properties: { value: { type: 'string' } } }),
      };
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: 'string' },
    },
  };
}

function boundedSchemaCopy(rawSchema, schemas, maxDepth, depth = 0, seenRefs = new Set(), stats) {
  if (Array.isArray(rawSchema)) {
    return rawSchema.map(item => boundedSchemaCopy(item, schemas, maxDepth, depth, seenRefs, stats));
  }
  if (!rawSchema || typeof rawSchema !== 'object') return deepCopy(rawSchema);

  const refName = refSchemaName(rawSchema.$ref);
  if (refName) {
    const referenced = schemas[refName];
    if (depth >= maxDepth || seenRefs.has(refName) || !referenced) {
      if (stats) stats.schemaRefsCompacted += 1;
      return compactSchemaFor(referenced ?? rawSchema, schemas, new Set(seenRefs));
    }
    seenRefs.add(refName);
    const copied = boundedSchemaCopy(referenced, schemas, maxDepth, depth + 1, seenRefs, stats);
    seenRefs.delete(refName);
    if (stats) stats.schemaRefsInlined += 1;
    return copied;
  }

  const copy = {};
  for (const [key, value] of Object.entries(rawSchema)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      copy.properties = Object.fromEntries(
        Object.entries(value).map(([propertyName, propertySchema]) => [
          propertyName,
          boundedSchemaCopy(propertySchema, schemas, maxDepth, depth + 1, seenRefs, stats),
        ]),
      );
    } else if ((key === 'items' || key === 'additionalProperties') && value && typeof value === 'object' && !Array.isArray(value)) {
      copy[key] = boundedSchemaCopy(value, schemas, maxDepth, depth + 1, seenRefs, stats);
    } else if (['oneOf', 'anyOf', 'allOf'].includes(key) && Array.isArray(value)) {
      copy[key] = boundedSchemaCopy(value, schemas, maxDepth, depth + 1, seenRefs, stats);
    } else {
      copy[key] = deepCopy(value);
    }
  }
  if (isFreeFormObjectSchema(copy)) {
    replaceWithBoundedObjectSchema(copy);
    if (stats) stats.freeFormObjectSchemasBounded += 1;
  }
  return copy;
}

function inlineContentSchemas(container, schemas, maxDepth, stats) {
  const content = container?.content;
  if (!content || typeof content !== 'object') return;
  for (const mediaType of Object.values(content)) {
    if (!mediaType || typeof mediaType !== 'object' || !mediaType.schema) continue;
    mediaType.schema = boundedSchemaCopy(mediaType.schema, schemas, maxDepth, 0, new Set(), stats);
    stats.operationSchemasInlined += 1;
  }
}

function inlineOperationSchemasForEvoMaster(openApi, schemas, stats) {
  const maxDepth = Number.parseInt(process.env.EVOMASTER_SCHEMA_INLINE_MAX_DEPTH ?? '7', 10);
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      if (operation.requestBody) {
        const requestBody = resolveOpenApiRefMap(operation.requestBody, openApi);
        if (requestBody) {
          operation.requestBody = requestBody;
          inlineContentSchemas(requestBody, schemas, maxDepth, stats);
        }
      }
      if (operation.responses && typeof operation.responses === 'object') {
        for (const [status, rawResponse] of Object.entries(operation.responses)) {
          const response = resolveOpenApiRefMap(rawResponse, openApi);
          if (!response) continue;
          operation.responses[status] = response;
          inlineContentSchemas(response, schemas, maxDepth, stats);
        }
      }
    }
  }
}

function requestJsonMediaType(operation) {
  const content = operation.requestBody?.content;
  if (!content || typeof content !== 'object') return undefined;
  if (content['application/json']) return content['application/json'];
  return Object.entries(content).find(([mediaType, value]) => mediaType.includes('json') && value?.schema)?.[1];
}

function applyPathPrefix(openApi) {
  const normalizedBase = normalizePathPart(basePath);
  if (normalizedBase === '/' || !openApi.paths || typeof openApi.paths !== 'object') return 0;
  const entries = Object.entries(openApi.paths);
  if (!entries.length || entries.every(([pathKey]) => pathKey === normalizedBase || pathKey.startsWith(`${normalizedBase}/`))) return 0;
  const prefixed = {};
  for (const [pathKey, pathItem] of entries) {
    prefixed[prefixedPath(pathKey)] = pathItem;
  }
  openApi.paths = prefixed;
  openApi.servers = [{ url: '/' }];
  return entries.length;
}

function parameterKey(parameter) {
  return `${String(parameter?.in ?? '')}:${String(parameter?.name ?? '')}`;
}

function movePathItemParametersToOperations(openApi) {
  let count = 0;
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    const pathParameters = ensureArray(pathItem.parameters);
    if (!pathParameters.length) continue;
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      const operationParameters = ensureArray(operation.parameters);
      const existingKeys = new Set(operationParameters.map(parameterKey));
      const moved = pathParameters.filter(parameter => !existingKeys.has(parameterKey(parameter))).map(parameter => deepCopy(parameter));
      if (!moved.length) continue;
      operation.parameters = [...moved, ...operationParameters];
      count += moved.length;
    }
    delete pathItem.parameters;
  }
  return count;
}

function parameterContainers(pathItem, operation) {
  return [pathItem, operation].filter(container => container && typeof container === 'object' && Array.isArray(container.parameters));
}

function pathParameterSchemas(container, openApi) {
  return ensureArray(container?.parameters)
    .map(parameter => resolveOpenApiRefMap(parameter, openApi))
    .filter(Boolean);
}

function addParameterExamples(pathItem, operation, values, openApi) {
  let count = 0;
  for (const container of parameterContainers(pathItem, operation)) {
    for (let index = 0; index < container.parameters.length; index += 1) {
      let parameter = container.parameters[index];
      if (!parameter || typeof parameter !== 'object') continue;
      if (parameter.$ref) {
        parameter = resolveOpenApiRefMap(parameter, openApi);
        container.parameters[index] = parameter;
      }
      const name = String(parameter.name ?? '');
      if (parameter.in !== 'path' || !values.has(name)) continue;
      const value = values.get(name);
      parameter.example = value;
      ensureObject(parameter, 'schema');
      count += 1;
    }
  }
  return count;
}

function propagatePathParameterExamples(openApi) {
  let count = 0;
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const examplesByName = new Map();
    for (const container of [
      pathItem,
      ...['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].map(method => pathItem[method]),
    ]) {
      for (const parameter of pathParameterSchemas(container, openApi)) {
        if (parameter.in === 'path' && parameter.example !== undefined) {
          examplesByName.set(parameter.name, parameter.example);
        }
      }
    }
    if (!examplesByName.size) continue;

    for (const container of [
      pathItem,
      ...['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].map(method => pathItem[method]),
    ]) {
      if (!container || typeof container !== 'object' || !Array.isArray(container.parameters)) continue;
      for (let index = 0; index < container.parameters.length; index += 1) {
        let parameter = container.parameters[index];
        if (!parameter || typeof parameter !== 'object') continue;
        if (parameter.$ref) {
          parameter = resolveOpenApiRefMap(parameter, openApi);
          container.parameters[index] = parameter;
        }
        if (parameter.in !== 'path' || parameter.example !== undefined || !examplesByName.has(parameter.name)) continue;
        parameter.example = examplesByName.get(parameter.name);
        ensureObject(parameter, 'schema');
        count += 1;
      }
    }
  }
  return count;
}

function addRequestExample(operation, result) {
  if (!result.requestFile) return false;
  const mediaType = requestJsonMediaType(operation);
  if (!mediaType) return false;
  const payload = readJson(result.requestFile);
  const examples = ensureObject(mediaType, 'examples');
  examples.smokeSuccess = {
    summary: 'Successful smoke-test request',
    value: payload,
  };
  if (lockRequestExampleSchemas) {
    mediaType.schema = schemaFromExample(payload);
  } else {
    const { schema } = mediaType;
    if (schema && typeof schema === 'object') {
      schema.example = payload;
    }
  }
  return true;
}

function ensureComponentSchemas(openApi) {
  const components = ensureObject(openApi, 'components');
  return ensureObject(components, 'schemas');
}

function ensureProblemDetailsSchema(openApi) {
  const schemaName = 'JHipsterProblemDetails';
  const schemas = ensureComponentSchemas(openApi);
  if (!schemas[schemaName]) {
    schemas[schemaName] = {
      type: 'object',
      additionalProperties: true,
      properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer', format: 'int32' },
        detail: { type: 'string' },
        instance: { type: 'string' },
        message: { type: 'string' },
        path: { type: 'string' },
      },
    };
  }
  return schemaName;
}

function addProblemResponse(responses, status, description, problemSchemaName) {
  const rawResponse = responses[status];
  const response = rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse) && !rawResponse.$ref ? rawResponse : {};
  delete response.$ref;
  response.description ??= description;
  const content = ensureObject(response, 'content');
  const problemContent = { schema: { $ref: `#/components/schemas/${problemSchemaName}` } };
  content['application/problem+json'] = problemContent;
  content['application/json'] ??= problemContent;
  responses[status] = response;
}

function addNoContentResponse(responses, status, description) {
  responses[status] = { description };
}

function augmentJHipsterErrorResponses(openApi) {
  const problemSchemaName = ensureProblemDetailsSchema(openApi);
  let count = 0;
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;
      const responses = ensureObject(operation, 'responses');
      addProblemResponse(responses, '400', 'Bad Request', problemSchemaName);
      addNoContentResponse(responses, '401', 'Unauthorized');
      addNoContentResponse(responses, '403', 'Forbidden');
      addProblemResponse(responses, '404', 'Not Found', problemSchemaName);
      addProblemResponse(responses, '406', 'Not Acceptable', problemSchemaName);
      addProblemResponse(responses, '409', 'Conflict', problemSchemaName);
      addProblemResponse(responses, '415', 'Unsupported Media Type', problemSchemaName);
      addProblemResponse(responses, '501', 'Not Implemented', problemSchemaName);
      count += 1;
    }
  }
  return count;
}

function removeResponseContentWithoutSchemas(openApi) {
  let count = 0;
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      const responses = operation?.responses;
      if (!responses || typeof responses !== 'object') continue;
      for (const response of Object.values(responses)) {
        if (!response || typeof response !== 'object' || !response.content || typeof response.content !== 'object') continue;
        const mediaTypesWithSchema = Object.fromEntries(
          Object.entries(response.content).filter(([, mediaType]) => mediaType && typeof mediaType === 'object' && mediaType.schema),
        );
        if (Object.keys(mediaTypesWithSchema).length === 0) {
          delete response.content;
          count += 1;
        } else if (Object.keys(mediaTypesWithSchema).length !== Object.keys(response.content).length) {
          response.content = mediaTypesWithSchema;
          count += 1;
        }
      }
    }
  }
  return count;
}

const summary = readJson(summaryPath);
const openApi = parse(fs.readFileSync(openApiPath, 'utf8'));
const stats = {
  operationCount: 0,
  requestBodyExamples: 0,
  pathParameterExamples: 0,
  pathScopedParametersMoved: 0,
  prefixedPathCount: 0,
  problemResponsesAugmented: 0,
  responseContentWithoutSchemaRemoved: 0,
  unsupportedFormatsStripped: 0,
  schemaPatternsStripped: 0,
  freeFormObjectSchemasBounded: 0,
  operationSchemasInlined: 0,
  schemaRefsInlined: 0,
  schemaRefsCompacted: 0,
  requestExampleSchemasLocked: 0,
  pathParameterExamplesPropagated: 0,
  numericEnumsRewrittenForEvoMaster: 0,
  skippedResults: 0,
};

if (!openApi || typeof openApi !== 'object') {
  throw new Error(`Invalid OpenAPI document: ${openApiPath}`);
}

stats.prefixedPathCount = applyPathPrefix(openApi);
stats.pathScopedParametersMoved = movePathItemParametersToOperations(openApi);
stats.responseContentWithoutSchemaRemoved = removeResponseContentWithoutSchemas(openApi);
stats.problemResponsesAugmented = augmentJHipsterErrorResponses(openApi);
normalizeComposedSchemasForEvoMaster(openApi, openApi.components?.schemas ?? {});
stripUnsupportedFormatsAndPatterns(openApi, stats);
boundFreeFormObjectSchemas(openApi, stats);
inlineOperationSchemasForEvoMaster(openApi, openApi.components?.schemas ?? {}, stats);
stripUnsupportedFormatsAndPatterns(openApi, stats);

for (const result of summary.results ?? []) {
  if (!result || result.status < 200 || result.status >= 300 || !result.method || !result.path) continue;
  const method = String(result.method).toLowerCase();
  const matched = findPathEntry(openApi, method, prefixedPath(result.path));
  if (!matched) {
    stats.skippedResults += 1;
    continue;
  }
  stats.operationCount += 1;
  stats.pathParameterExamples += addParameterExamples(
    matched.pathItem,
    matched.operation,
    pathParameterValues(matched.templatePath, prefixedPath(result.path)),
    openApi,
  );
  if (addRequestExample(matched.operation, result)) {
    stats.requestBodyExamples += 1;
    if (lockRequestExampleSchemas) {
      stats.requestExampleSchemasLocked += 1;
    }
  }
}

stats.pathParameterExamplesPropagated = propagatePathParameterExamples(openApi);
stats.numericEnumsRewrittenForEvoMaster = rewriteNumericEnumsForEvoMaster(openApi);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, stringify(openApi));
console.log(JSON.stringify({ openApiFile: outputPath, ...stats }));
