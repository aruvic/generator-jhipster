#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const [, , summaryPath, outputPath, basePath = '/api', openApiPath] = process.argv;
if (!summaryPath || !outputPath) {
  console.error('Usage: evomaster-postman-seed.mjs <smoke-summary.json> <output.postman_collection.json> [base-path] [openapi.yaml]');
  process.exit(2);
}

const seedAuthorization =
  process.env.EVOMASTER_SEED_AUTHORIZATION ??
  (process.env.EVOMASTER_SEED_AUTH_TOKEN ? `Bearer ${process.env.EVOMASTER_SEED_AUTH_TOKEN}` : undefined);
const seedIncludeAuthorization = process.env.EVOMASTER_SEED_INCLUDE_AUTHORIZATION === 'true';
const seedIncludeStandardHeaders = process.env.EVOMASTER_SEED_INCLUDE_STANDARD_HEADERS === 'true';
const seedBodyMode = process.env.EVOMASTER_SEED_BODY_MODE ?? 'safe';
const OMIT_SEED_VALUE = Symbol('omitSeedValue');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOpenApi(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  return parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePathPart(value) {
  return `/${String(value ?? '').split('/').filter(Boolean).join('/')}`;
}

function prefixedPath(rawPath) {
  const normalizedPath = normalizePathPart(rawPath);
  const normalizedBase = normalizePathPart(basePath);
  if (normalizedBase === '/') return normalizedPath;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) return normalizedPath;
  return `${normalizedBase}${normalizedPath}`;
}

function postmanUrl(rawPath) {
  const parsed = new URL(prefixedPath(rawPath), 'http://localhost');
  return {
    raw: `${parsed.pathname}${parsed.search}`,
    path: parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment)),
    query: [...parsed.searchParams.entries()].map(([key, value]) => ({ key, value })),
  };
}

function pushHeader(headers, key, value) {
  if (value === undefined || value === null) return;
  if (headers.some(header => header.key.toLowerCase() === key.toLowerCase())) return;
  headers.push({ key, value: String(value) });
}

const openApi = readOpenApi(openApiPath);
const schemas = openApi?.components?.schemas ?? {};
const seedStats = {
  sanitizedBodies: 0,
  omittedBodies: 0,
  omittedNullableValues: 0,
  omittedEmptyBodies: 0,
  normalizedDateTimes: 0,
  normalizedTimes: 0,
  prunedFreeFormObjectValues: 0,
  skippedUnknownAdditionalProperties: 0,
};

function decodePointer(value) {
  return String(value ?? '')
    .replace(/~1/g, '/')
    .replace(/~0/g, '~');
}

function resolveOpenApiRef(value) {
  if (!value?.$ref || !String(value.$ref).startsWith('#/')) return value;
  return String(value.$ref)
    .slice(2)
    .split('/')
    .map(decodePointer)
    .reduce((current, segment) => current?.[segment], openApi);
}

function deref(schema, seen = new Set()) {
  if (!schema?.$ref) return schema;
  const schemaName = decodePointer(schema.$ref.split('/').pop());
  if (!schemaName || seen.has(schemaName)) return undefined;
  seen.add(schemaName);
  return deref(schemas[schemaName], seen);
}

function collectProperties(schema, seen = new Set()) {
  schema = deref(schema, seen) ?? {};
  const properties = { ...(schema.properties ?? {}) };
  for (const part of schema.allOf ?? []) {
    Object.assign(properties, collectProperties(part, seen));
  }
  return properties;
}

function isFreeFormObjectSchema(schema) {
  schema = deref(schema) ?? {};
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type;
  return (
    type === 'object' &&
    !schema.properties &&
    !schema.allOf &&
    !schema.oneOf &&
    !schema.anyOf &&
    !schema.items &&
    (schema.additionalProperties === undefined || schema.additionalProperties === true)
  );
}

function schemaType(schema) {
  schema = deref(schema) ?? {};
  return Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type;
}

function schemaAllowsNull(schema) {
  schema = deref(schema) ?? {};
  return schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'));
}

function chooseVariant(schema, value) {
  schema = deref(schema) ?? {};
  const variants = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(variants) || !variants.length) return undefined;
  const discriminatorName = schema.discriminator?.propertyName;
  const discriminatorValue = discriminatorName && value && typeof value === 'object' ? value[discriminatorName] : undefined;
  if (discriminatorValue !== undefined) {
    const mappedRef = schema.discriminator?.mapping?.[discriminatorValue];
    if (mappedRef) return { $ref: mappedRef };
  }
  return variants[0];
}

function normalizeFraction(value) {
  return String(value ?? '').padEnd(3, '0').slice(0, 3);
}

function normalizeDateTimeForEvoMaster(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return value;

  const [, date, time, fraction, zone] = match;
  if (!zone) {
    return fraction ? `${date}T${time}` : value.replace(' ', 'T');
  }

  if (zone === 'Z') {
    return `${date}T${time}.${normalizeFraction(fraction)}Z`;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function normalizeTimeForEvoMaster(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^(\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z)?$/);
  if (!match) return value;
  const [, time, fraction, zone] = match;
  if (!zone) return fraction ? time : value;
  return `${time}.${normalizeFraction(fraction)}Z`;
}

function sanitizeSeedPayload(value, schema) {
  schema = deref(schema) ?? {};
  if (seedBodyMode === 'none') return OMIT_SEED_VALUE;
  if (seedBodyMode === 'safe' && schemaAllowsNull(schema)) {
    seedStats.omittedNullableValues += 1;
    return OMIT_SEED_VALUE;
  }
  if (value === undefined || value === null) return value;
  if (schema.allOf?.length) {
    const merged = { ...schema, properties: collectProperties(schema) };
    delete merged.allOf;
    return sanitizeSeedPayload(value, merged);
  }
  const variant = chooseVariant(schema, value);
  if (variant) return sanitizeSeedPayload(value, variant);
  if (schema.format === 'date-time' || schema.format === 'datetime') {
    const normalized = normalizeDateTimeForEvoMaster(value);
    if (normalized !== value) seedStats.normalizedDateTimes += 1;
    return normalized;
  }
  if (schema.format === 'time') {
    const normalized = normalizeTimeForEvoMaster(value);
    if (normalized !== value) seedStats.normalizedTimes += 1;
    return normalized;
  }
  if (isFreeFormObjectSchema(schema)) {
    if (typeof value === 'object') {
      seedStats.prunedFreeFormObjectValues += 1;
      return { value: 'sample' };
    }
    return value;
  }
  const type = schemaType(schema);
  if (type === 'array') {
    const itemsSchema = schema.items ?? {};
    if (!Array.isArray(value)) return value;
    return value.map(item => sanitizeSeedPayload(item, itemsSchema)).filter(item => item !== OMIT_SEED_VALUE);
  }
  const properties = collectProperties(schema);
  if ((type === 'object' || Object.keys(properties).length) && value && typeof value === 'object' && !Array.isArray(value)) {
    const output = {};
    for (const [property, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[property];
      if (propertySchema) {
        const sanitized = sanitizeSeedPayload(propertyValue, propertySchema);
        if (sanitized !== OMIT_SEED_VALUE) {
          output[property] = sanitized;
        }
      } else if (schema.additionalProperties && schema.additionalProperties !== true) {
        const sanitized = sanitizeSeedPayload(propertyValue, schema.additionalProperties);
        if (sanitized !== OMIT_SEED_VALUE) {
          output[property] = sanitized;
        }
      } else if (schema.additionalProperties === true) {
        seedStats.skippedUnknownAdditionalProperties += 1;
      }
    }
    return output;
  }
  return value;
}

function pathMatches(templatePath, concretePath) {
  const templateSegments = normalizePathPart(templatePath).split('/').filter(Boolean);
  const concreteSegments = normalizePathPart(concretePath).split('/').filter(Boolean);
  return (
    templateSegments.length === concreteSegments.length &&
    templateSegments.every((segment, index) => (segment.startsWith('{') && segment.endsWith('}')) || segment === concreteSegments[index])
  );
}

function operationForResult(result) {
  const method = result?.method?.toLowerCase();
  if (!openApi?.paths || !method || !result?.path) return undefined;
  const exact = openApi.paths[result.path]?.[method];
  if (exact) return exact;
  const matchedPath = Object.entries(openApi.paths).find(([templatePath, pathItem]) => pathMatches(templatePath, result.path) && pathItem?.[method]);
  return matchedPath?.[1]?.[method];
}

function jsonSchemaForRequest(operation) {
  const requestBody = resolveOpenApiRef(operation?.requestBody);
  const content = requestBody?.content;
  return content?.['application/json']?.schema ?? Object.values(content ?? {}).find(mediaType => mediaType?.schema)?.schema;
}

function itemForResult(result) {
  if (!result || result.status < 200 || result.status >= 300 || !result.method || !result.path) return undefined;
  const headers = [];
  for (const [key, value] of Object.entries(result.requestHeaders ?? {})) {
    if (/^authorization$/i.test(key)) continue;
    pushHeader(headers, key, value);
  }
  if (seedIncludeAuthorization) {
    pushHeader(headers, 'Authorization', seedAuthorization);
  }

  let body;
  if (result.requestFile) {
    const requestSchema = jsonSchemaForRequest(operationForResult(result));
    let payload = readJson(result.requestFile);
    if (requestSchema) {
      payload = sanitizeSeedPayload(payload, requestSchema);
      seedStats.sanitizedBodies += 1;
    }
    if (payload === OMIT_SEED_VALUE) {
      seedStats.omittedBodies += 1;
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === 0) {
      seedStats.omittedBodies += 1;
      seedStats.omittedEmptyBodies += 1;
    } else {
      body = {
        mode: 'raw',
        raw: JSON.stringify(payload, null, 2),
      };
      if (seedIncludeStandardHeaders) {
        pushHeader(headers, 'Content-Type', 'application/json');
      }
    }
  }
  if (seedIncludeStandardHeaders) {
    pushHeader(headers, 'Accept', 'application/json');
  }

  return {
    name: `${result.method.toUpperCase()} ${result.path}`,
    request: {
      method: result.method.toUpperCase(),
      header: headers,
      url: postmanUrl(result.path),
      ...(body ? { body } : {}),
    },
  };
}

const summary = readJson(summaryPath);
const items = (summary.results ?? []).map(itemForResult).filter(Boolean);
const collection = {
  info: {
    name: `${summary.appName ?? path.basename(path.dirname(summaryPath))} EvoMaster smoke seeds`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: items,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
console.log(
  JSON.stringify({
    seedFile: outputPath,
    itemCount: items.length,
    bodyMode: seedBodyMode,
    includeAuthorization: seedIncludeAuthorization,
    includeStandardHeaders: seedIncludeStandardHeaders,
    ...seedStats,
  }),
);
