#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const [, , yamlPath, baseUrl, token, appName, outputDir = '.'] = process.argv;
if (!yamlPath || !baseUrl || !appName) {
  console.error('Usage: openapi-smoke.mjs <yaml> <base-url> <token-or-> <app-name> [output-dir]');
  process.exit(2);
}

const doc = parse(fs.readFileSync(yamlPath, 'utf8'));
const schemas = doc.components?.schemas ?? {};
const requestBodies = doc.components?.requestBodies ?? {};
const results = [];
const created = [];
let evidenceSequence = 0;

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.join(outputDir, 'payloads'), { recursive: true });
fs.mkdirSync(path.join(outputDir, 'responses'), { recursive: true });

function decodePointer(value) {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerFor(parts) {
  if (!parts.length) return '';
  return `/${parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

function resolveRef(value) {
  if (!value?.$ref) return value;
  if (requestBodies[value.$ref]) return requestBodies[value.$ref];
  if (!value.$ref.startsWith('#/')) return undefined;
  let current = doc;
  for (const part of value.$ref.slice(2).split('/').map(decodePointer)) {
    current = current?.[part];
  }
  return current;
}

function deref(value, seen = new Set()) {
  if (!value?.$ref) return value;
  if (seen.has(value.$ref)) return { type: 'object', 'x-cycle': true };
  seen.add(value.$ref);
  return deref(resolveRef(value), seen);
}

function schemaNameFor(schema) {
  if (!schema) return undefined;
  if (schema.$ref) return decodePointer(schema.$ref.split('/').pop() ?? '');
  return Object.entries(schemas).find(([, candidate]) => candidate === schema)?.[0];
}

function jsonContent(content) {
  if (!content) return undefined;
  return (
    content['application/json'] ??
    content['application/merge-patch+json'] ??
    content['application/json-patch+json'] ??
    Object.entries(content).find(([contentType]) => contentType.endsWith('+json'))?.[1] ??
    content['*/*'] ??
    Object.values(content)[0]
  );
}

function operationParameters(pathItem, operation) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => deref(parameter));
}

function operationRequestHeaders(pathItem, operation) {
  const headers = {};
  for (const parameter of operationParameters(pathItem, operation)) {
    if (parameter?.in !== 'header' || !parameter.required) continue;
    const name = String(parameter.name ?? '');
    if (/^(authorization|content-type|accept)$/i.test(name)) continue;
    const value = payloadFor(parameter.schema ?? {}, { mode: 'header', full: false });
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return headers;
}

function requestBodyFor(operation) {
  return deref(operation.requestBody);
}

function requestSchemaFor(operation) {
  return deref(jsonContent(requestBodyFor(operation)?.content)?.schema);
}

function responseSchemaFor(operation, status) {
  const responses = operation.responses ?? {};
  const response = deref(responses[String(status)] ?? responses[`${Math.floor(status / 100)}XX`] ?? responses.default);
  return deref(jsonContent(response?.content)?.schema);
}

function successStatuses(operation, method) {
  const codes = Object.keys(operation.responses ?? {})
    .filter(code => /^\d+$/.test(code) && Number(code) >= 200 && Number(code) < 300)
    .map(Number)
    .sort((a, b) => a - b);
  if (method === 'post' && codes.includes(201)) return [201, ...codes.filter(code => code !== 201)];
  if (method === 'delete' && codes.includes(204)) return [204, ...codes.filter(code => code !== 204)];
  return codes.length ? codes : [method === 'post' ? 201 : method === 'delete' ? 204 : 200];
}

function schemaType(schema) {
  schema = deref(schema);
  const type = Array.isArray(schema?.type) ? schema.type.find(item => item !== 'null') : schema?.type;
  if (type) return type;
  if (schema?.properties || schema?.additionalProperties) return 'object';
  if (schema?.items) return 'array';
  if (schema?.format || schema?.enum || schema?.pattern || schema?.minLength || schema?.maxLength) return 'string';
  return undefined;
}

function mergeObjects(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return right;
  if (!right || typeof right !== 'object' || Array.isArray(right)) return left;
  return { ...left, ...right };
}

function matchingPropertyName(name, source) {
  if (!name || !source) return undefined;
  if (Object.hasOwn(source, name)) return name;
  const normalized = String(name).toLowerCase();
  return Object.keys(source).find(candidate => candidate.toLowerCase() === normalized);
}

function hasRequiredValue(value, requiredProperty, properties) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value[requiredProperty] !== undefined) return true;
  const propertyAlias = matchingPropertyName(requiredProperty, properties);
  return propertyAlias !== undefined && value[propertyAlias] !== undefined;
}

function requiredMatchesProperty(requiredProperty, property, properties) {
  const propertyAlias = matchingPropertyName(requiredProperty, properties) ?? requiredProperty;
  return propertyAlias === property || String(propertyAlias).toLowerCase() === String(property).toLowerCase();
}

function isRequiredProperty(property, required, properties) {
  for (const requiredProperty of required) {
    if (requiredMatchesProperty(requiredProperty, property, properties)) return true;
  }
  return false;
}

function isRequestPayloadMode(mode) {
  return mode === 'request' || mode === 'create' || mode === 'patch';
}

function unknownRequiredPayload(property) {
  return /(?:^|[_-])id$/i.test(property) || /id$/i.test(property) ? 1 : 'sample';
}

function backfillRequiredPayload(output, source, schema, options = {}) {
  const mode = options.mode ?? 'create';
  const full = options.full ?? mode !== 'patch';
  const seen = options.seen ?? new Set();
  const properties = collectProperties(schema);
  const required = collectRequired(schema);
  for (const property of required) {
    if (hasRequiredValue(output, property, properties)) continue;
    const propertyKey = matchingPropertyName(property, properties) ?? property;
    const propertySchema = properties[propertyKey];
    if (propertySchema) {
      if (mode === 'patch' && deref(propertySchema)?.readOnly) continue;
      const sourceKey = matchingPropertyName(propertyKey, source);
      const value =
        sourceKey === undefined
          ? payloadFor(propertySchema, { mode, full, seen })
          : sanitizePayloadForSchema(source[sourceKey], propertySchema, { mode, full, seen });
      if (value !== undefined) output[propertyKey] = value;
    } else if (schema.additionalProperties !== false) {
      const sourceKey = matchingPropertyName(property, source);
      output[property] =
        sourceKey === undefined
          ? unknownRequiredPayload(property)
          : source[sourceKey] ?? unknownRequiredPayload(property);
    }
  }
}

function shouldBackfillSafeOptionalProperty(propertySchema) {
  propertySchema = deref(propertySchema);
  if (!propertySchema) return false;
  if (schemaType(propertySchema) === 'array' && (propertySchema.minItems ?? 0) > 0) return true;
  if (schemaType(propertySchema) === 'object' && (propertySchema.minProperties ?? 0) > 0) return true;
  return false;
}

function backfillSafeOptionalPayload(output, source, schema, options = {}) {
  const mode = options.mode ?? 'create';
  const full = options.full ?? mode !== 'patch';
  if (!isRequestPayloadMode(mode)) return;
  const seen = options.seen ?? new Set();
  const properties = collectProperties(schema);
  for (const [property, propertySchema] of Object.entries(properties)) {
    const resolvedPropertySchema = deref(propertySchema);
    if (!shouldBackfillSafeOptionalProperty(resolvedPropertySchema)) continue;
    if (resolvedPropertySchema?.readOnly) continue;
    if (output[property] !== undefined) continue;
    const sourceKey = matchingPropertyName(property, source);
    const value =
      sourceKey === undefined
        ? payloadFor(propertySchema, { mode, full, seen })
        : sanitizePayloadForSchema(source[sourceKey], propertySchema, { mode, full, seen });
    if (value !== undefined) output[property] = value;
  }
}

function hasRootObjectMembers(schema) {
  schema = deref(schema);
  return Boolean(
    schema &&
      (Object.keys(schema.properties ?? {}).length || (schema.required ?? []).length || schema.additionalProperties !== undefined)
  );
}

function withoutObjectVariants(schema) {
  schema = deref(schema);
  if (!schema) return schema;
  const { oneOf: _oneOf, anyOf: _anyOf, discriminator: _discriminator, ...rest } = schema;
  return rest;
}

function collectProperties(schema, seen = new Set()) {
  const schemaName = schemaNameFor(schema);
  if (schemaName && seen.has(schemaName)) return {};
  if (schemaName) seen.add(schemaName);
  schema = deref(schema);
  const properties = { ...(schema?.properties ?? {}) };
  for (const part of schema?.allOf ?? []) Object.assign(properties, collectProperties(part, seen));
  if (schemaName) seen.delete(schemaName);
  return properties;
}

function collectRequired(schema, seen = new Set()) {
  const schemaName = schemaNameFor(schema);
  if (schemaName && seen.has(schemaName)) return new Set();
  if (schemaName) seen.add(schemaName);
  schema = deref(schema);
  const required = new Set(schema?.required ?? []);
  for (const part of schema?.allOf ?? []) {
    for (const property of collectRequired(part, seen)) required.add(property);
  }
  if (!required.size) {
    for (const part of schema?.anyOf ?? []) {
      const partRequired = [...collectRequired(part, seen)];
      if (partRequired.length) {
        required.add(partRequired[0]);
        break;
      }
    }
  }
  if (schemaName) seen.delete(schemaName);
  return required;
}

function explicitExample(operation, schema) {
  const content = jsonContent(requestBodyFor(operation)?.content);
  if (content?.example !== undefined) return content.example;
  const example = content?.examples ? deref(Object.values(content.examples)[0]) : undefined;
  if (example?.value !== undefined) return example.value;
  const resolvedSchema = deref(schema);
  if (resolvedSchema?.example !== undefined) return resolvedSchema.example;
  return undefined;
}

function chooseVariant(schema, value) {
  schema = deref(schema);
  const variants = schema?.oneOf ?? schema?.anyOf;
  if (!variants?.length) return undefined;
  const discriminatorName = schema.discriminator?.propertyName;
  if (discriminatorName && value && typeof value === 'object') {
    const discriminatorValue = value[discriminatorName];
    const mappedRef = discriminatorValue === undefined ? undefined : schema.discriminator?.mapping?.[discriminatorValue];
    if (mappedRef) return { $ref: mappedRef };
    const exact = variants.find(variant => schemaNameFor(variant) === discriminatorValue);
    if (exact) return exact;
  }
  if (value !== undefined) {
    const compatible = variants.find(variant => !validateValue(value, variant, { mode: 'request' }).length);
    if (compatible) return compatible;
  }
  return variants[0];
}

function discriminatorSchemaFor(schema, seen = new Set()) {
  const schemaName = schemaNameFor(schema);
  if (schemaName && seen.has(schemaName)) return undefined;
  if (schemaName) seen.add(schemaName);
  schema = deref(schema);
  if (!schema) return undefined;
  if (schema.discriminator?.propertyName) return schema;
  for (const part of schema.allOf ?? []) {
    const found = discriminatorSchemaFor(part, seen);
    if (found) return found;
  }
  return undefined;
}

function schemaExtends(childName, parentName, seen = new Set()) {
  if (!childName || !parentName) return false;
  if (childName === parentName) return true;
  if (seen.has(childName)) return false;
  seen.add(childName);
  const schema = deref(schemas[childName]);
  for (const part of schema?.allOf ?? []) {
    const partName = schemaNameFor(part);
    if (partName && schemaExtends(partName, parentName, seen)) return true;
  }
  return false;
}

function schemaNameCompatibleWithTarget(candidateName, targetName) {
  if (!candidateName || !targetName) return false;
  return candidateName === targetName || schemaExtends(candidateName, targetName);
}

function discriminatorSchemaReferencesTarget(discriminatorSchema, targetName) {
  const names = new Set();
  const mapping = discriminatorSchema?.discriminator?.mapping ?? {};
  for (const ref of Object.values(mapping)) {
    const name = schemaNameFor({ $ref: ref });
    if (name) names.add(name);
  }
  for (const variant of [...(discriminatorSchema?.oneOf ?? []), ...(discriminatorSchema?.anyOf ?? [])]) {
    const name = schemaNameFor(variant);
    if (name) names.add(name);
  }
  return [...names].some(name => name === targetName || schemaExtends(targetName, name));
}

function discriminatorSchemasFor(schema, targetName) {
  const output = [];
  const direct = discriminatorSchemaFor(schema);
  if (direct) output.push(direct);
  if (targetName) {
    for (const candidate of Object.values(schemas)) {
      const resolved = deref(candidate);
      if (!resolved?.discriminator?.propertyName || resolved === direct) continue;
      if (discriminatorSchemaReferencesTarget(resolved, targetName)) output.push(resolved);
    }
  }
  return output;
}

function mappedDiscriminatorSchemaName(discriminatorSchema, discriminatorValue) {
  if (discriminatorValue === undefined || discriminatorValue === null) return undefined;
  const mappedRef = discriminatorSchema?.discriminator?.mapping?.[String(discriminatorValue)];
  if (mappedRef) return schemaNameFor({ $ref: mappedRef });
  const variant = [...(discriminatorSchema?.oneOf ?? []), ...(discriminatorSchema?.anyOf ?? [])].find(
    candidate => schemaNameFor(candidate) === discriminatorValue
  );
  if (variant) return discriminatorValue;
  return Object.keys(discriminatorSchema?.discriminator?.mapping ?? {}).length ? undefined : discriminatorValue;
}

function discriminatorValueCompatibleWithSchema(discriminatorSchema, discriminatorValue, targetName) {
  return schemaNameCompatibleWithTarget(mappedDiscriminatorSchemaName(discriminatorSchema, discriminatorValue), targetName);
}

function discriminatorPropertySchema(discriminatorSchema) {
  const discriminatorName = discriminatorSchema?.discriminator?.propertyName;
  return discriminatorName ? collectProperties(discriminatorSchema)[discriminatorName] : undefined;
}

function coerceDiscriminatorMappingKey(mappingKey, discriminatorSchema) {
  const propertySchema = deref(discriminatorPropertySchema(discriminatorSchema));
  const type = schemaType(propertySchema);
  if (type === 'boolean' && /^(true|false)$/i.test(mappingKey)) return mappingKey.toLowerCase() === 'true';
  if (type === 'integer' && /^-?\d+$/.test(mappingKey)) return Number.parseInt(mappingKey, 10);
  if (type === 'number' && /^-?\d+(?:\.\d+)?$/.test(mappingKey)) return Number(mappingKey);
  return mappingKey;
}

function discriminatorValueForSchema(discriminatorSchema, targetName) {
  const mapping = discriminatorSchema?.discriminator?.mapping ?? {};
  const entries = Object.entries(mapping);
  const exact = entries.find(([, ref]) => schemaNameFor({ $ref: ref }) === targetName);
  if (exact) return coerceDiscriminatorMappingKey(exact[0], discriminatorSchema);
  const compatible = entries.find(([, ref]) => schemaNameCompatibleWithTarget(schemaNameFor({ $ref: ref }), targetName));
  if (compatible) return coerceDiscriminatorMappingKey(compatible[0], discriminatorSchema);
  return mapping[targetName] ? targetName : undefined;
}

function ensureDiscriminatorValue(payload, schema, targetName) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const properties = collectProperties(schema);
  const required = collectRequired(schema);
  for (const discriminatorSchema of discriminatorSchemasFor(schema, targetName)) {
    const discriminatorName = discriminatorSchema?.discriminator?.propertyName;
    if (!discriminatorName) continue;
    const schemaUsesDiscriminator = payload[discriminatorName] !== undefined || properties[discriminatorName] || required.has(discriminatorName);
    if (!schemaUsesDiscriminator) continue;
    const propertySchema = discriminatorPropertySchema(discriminatorSchema);
    const discriminatorTypeErrors =
      payload[discriminatorName] === undefined || !propertySchema ? [] : validateValue(payload[discriminatorName], propertySchema, { mode: 'request' });
    if (
      payload[discriminatorName] !== undefined &&
      discriminatorTypeErrors.length === 0 &&
      discriminatorValueCompatibleWithSchema(discriminatorSchema, payload[discriminatorName], targetName)
    ) {
      continue;
    }
    const replacement = discriminatorValueForSchema(discriminatorSchema, targetName);
    if (replacement !== undefined) payload[discriminatorName] = replacement;
  }
  return payload;
}

function normalizePrimitive(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function nameTokens(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(normalizePrimitive)
    .filter(Boolean);
}

function patternExample(pattern, minLength = 1, maxLength = 64) {
  const candidates = ['ABC123', 'ABC', 'AA', 'A1', '1', 'sample', 'sample-value', '2026-05-20'];
  let re;
  try {
    re = new RegExp(pattern);
  } catch {
    return sizedString('sample', minLength, maxLength);
  }
  const match = candidates.find(candidate => re.test(candidate));
  return sizedString(match ?? 'ABC123', minLength, maxLength);
}

function sizedString(value, minLength = 1, maxLength = 64) {
  const min = Math.max(minLength ?? 1, 0);
  const max = Math.max(maxLength ?? 64, min);
  let output = value || 'sample';
  while (output.length < min) output += output || 'x';
  if (output.length > max) output = output.slice(0, max);
  return output;
}

function primitivePayload(schema) {
  schema = deref(schema) ?? {};
  const type = schemaType(schema);
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum.find(value => value !== null) ?? null;
  if (type === 'integer') {
    const minimum = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + 1 : 1);
    const maximum = schema.maximum ?? schema.exclusiveMaximum;
    return maximum !== undefined && minimum > maximum ? maximum : minimum;
  }
  if (type === 'number') {
    const minimum = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + 0.5 : 1.5);
    const maximum = schema.maximum ?? schema.exclusiveMaximum;
    return maximum !== undefined && minimum > maximum ? maximum : minimum;
  }
  if (type === 'boolean') return true;
  if (type === 'string' || schema.format || schema.pattern) {
    if (schema.format === 'date-time') return '2026-05-20T08:00:00Z';
    if (schema.format === 'date') return '2026-05-20';
    if (schema.format === 'email') return 'user@example.test';
    if (schema.format === 'uuid') return '11111111-1111-4111-8111-111111111111';
    if (schema.format === 'uri' || schema.format === 'url') return 'https://example.test/resource';
    if (schema.format === 'hostname') return 'example.test';
    if (schema.format === 'byte') return 'c2FtcGxl';
    if (schema.pattern) return patternExample(schema.pattern, schema.minLength, schema.maxLength);
    return sizedString('sample', schema.minLength, schema.maxLength);
  }
  return undefined;
}

function payloadFor(schema, options = {}) {
  const mode = options.mode ?? 'create';
  const full = options.full ?? mode !== 'patch';
  const seen = options.seen ?? new Set();
  const schemaName = schemaNameFor(schema);
  const visitKey = schemaName ? `payload:${schemaName}` : undefined;
  if (visitKey && seen.has(visitKey)) return undefined;
  if (visitKey) seen.add(visitKey);
  schema = deref(schema);
  try {
    if (!schema) return {};
    if (schema['x-cycle']) return undefined;
    if (schema.example !== undefined) return sanitizePayloadForSchema(schema.example, schema, { mode, full, seen });
    if (schema.default !== undefined) return sanitizePayloadForSchema(schema.default, schema, { mode, full, seen });
    if (schema.allOf?.length) {
      const output = schema.allOf
        .map(part => payloadFor(part, { mode, full, seen }))
        .filter(value => value !== undefined)
        .reduce(mergeObjects, {});
      backfillRequiredPayload(output, {}, schema, { mode, full, seen });
      backfillSafeOptionalPayload(output, {}, schema, { mode, full, seen });
      return ensureDiscriminatorValue(output, schema, schemaName);
    }
    const variant = chooseVariant(schema);
    if (variant) {
      const payload = hasRootObjectMembers(schema)
        ? mergeObjects(payloadFor(withoutObjectVariants(schema), { mode, full, seen }), payloadFor(variant, { mode, full, seen }))
        : payloadFor(variant, { mode, full, seen });
      return ensureDiscriminatorValue(payload, schema, schemaNameFor(variant) ?? schemaName);
    }
    if (schema.enum || ['integer', 'number', 'boolean', 'string'].includes(schemaType(schema))) return primitivePayload(schema);
    if (schemaType(schema) === 'array') {
      const count = Math.max(schema.minItems ?? 1, full ? 1 : 0);
      const values = Array.from({ length: count }, () => payloadFor(schema.items ?? {}, { mode, full, seen })).filter(value => value !== undefined);
      return values.length ? values : undefined;
    }
    const properties = collectProperties(schema);
    const required = collectRequired(schema);
    const output = {};
    const entries = Object.entries(properties).filter(([, propertySchema]) => !deref(propertySchema)?.readOnly);
    const selectedEntries =
      mode === 'patch'
        ? entries.filter(([property]) => required.has(property)).slice(0, 1).length
          ? entries.filter(([property]) => required.has(property)).slice(0, 1)
          : entries.slice(0, 1)
        : entries.filter(([property, propertySchema]) => full || required.has(property) || deref(propertySchema)?.enum);
    for (const [property, propertySchema] of selectedEntries) {
      const value = payloadFor(propertySchema, { mode, full, seen });
      if (value !== undefined) output[property] = value;
    }
    for (const property of required) {
      if (hasRequiredValue(output, property, properties)) continue;
      const propertyKey = matchingPropertyName(property, properties) ?? property;
      const propertySchema = properties[propertyKey];
      if (propertySchema) {
        if (mode === 'patch' && deref(propertySchema)?.readOnly) continue;
        const value = payloadFor(propertySchema, { mode, full, seen });
        if (value !== undefined) output[propertyKey] = value;
      } else if (schema.additionalProperties !== false) {
        output[property] = unknownRequiredPayload(property);
      }
    }
    backfillSafeOptionalPayload(output, {}, schema, { mode, full, seen });
    if (!Object.keys(output).length && schema.additionalProperties) {
      output.additionalProperty = schema.additionalProperties === true ? 'sample' : payloadFor(schema.additionalProperties, { mode, full, seen });
    }
    return ensureDiscriminatorValue(output, schema, schemaName);
  } finally {
    if (visitKey) seen.delete(visitKey);
  }
}

function sanitizePayloadForSchema(value, schema, options = {}) {
  const mode = options.mode ?? 'create';
  const full = options.full ?? mode !== 'patch';
  const seen = options.seen ?? new Set();
  const schemaName = schemaNameFor(schema);
  const visitKey = schemaName && value && typeof value === 'object' ? `sanitize:${schemaName}` : undefined;
  if (visitKey && seen.has(visitKey)) return value;
  if (visitKey) seen.add(visitKey);
  schema = deref(schema);
  try {
    if (!schema || value === undefined) return value;
    if (value === null) return schema.nullable || schema.type === 'null' || schema.type?.includes?.('null') ? null : payloadFor(schema, { mode, full, seen });
    if (schema.allOf?.length) {
      const output = schema.allOf
        .map(part => sanitizePayloadForSchema(value, part, { mode, full, seen }))
        .filter(part => part !== undefined)
        .reduce(mergeObjects, {});
      const properties = collectProperties(schema);
      const required = collectRequired(schema);
      for (const [property, propertyValue] of Object.entries(output)) {
        const propertyKey = matchingPropertyName(property, properties);
        const propertySchema = propertyKey ? properties[propertyKey] : undefined;
        if (!propertySchema) continue;
        if (
          isRequestPayloadMode(mode) &&
          deref(propertySchema)?.readOnly
        ) {
          delete output[property];
          continue;
        }
        const sanitizedValue = sanitizePayloadForSchema(propertyValue, propertySchema, { mode, full, seen });
        if (sanitizedValue !== undefined) output[property] = sanitizedValue;
      }
      backfillRequiredPayload(output, value, schema, { mode, full, seen });
      backfillSafeOptionalPayload(output, value, schema, { mode, full, seen });
      return ensureDiscriminatorValue(output, schema, schemaName);
    }
    const variant = chooseVariant(schema, value);
    if (variant) {
      const output = hasRootObjectMembers(schema)
        ? mergeObjects(
            sanitizePayloadForSchema(value, withoutObjectVariants(schema), { mode, full, seen }),
            sanitizePayloadForSchema(value, variant, { mode, full, seen })
          )
        : sanitizePayloadForSchema(value, variant, { mode, full, seen });
      return ensureDiscriminatorValue(output, schema, schemaNameFor(variant) ?? schemaName);
    }
    if (schemaType(schema) === 'array') {
      const source = Array.isArray(value) ? value : [payloadFor(schema.items ?? {}, { mode, full, seen })];
      const output = source.map(item => sanitizePayloadForSchema(item, schema.items ?? {}, { mode, full, seen }));
      while (output.length < (schema.minItems ?? 0)) output.push(payloadFor(schema.items ?? {}, { mode, full, seen }));
      return schema.maxItems !== undefined ? output.slice(0, schema.maxItems) : output;
    }
    if (['integer', 'number', 'boolean', 'string'].includes(schemaType(schema)) || schema.enum) {
      return validateValue(value, schema, { mode: 'request' }).length ? primitivePayload(schema) : value;
    }
    if (typeof value !== 'object' || Array.isArray(value)) return payloadFor(schema, { mode, full, seen });
    const properties = collectProperties(schema);
    const required = collectRequired(schema);
    const output = {};
    for (const [property, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[property];
      if (deref(propertySchema)?.readOnly) continue;
      if (propertySchema) {
        output[property] = sanitizePayloadForSchema(propertyValue, propertySchema, { mode, full, seen });
      } else if (schema.additionalProperties !== false) {
        output[property] =
          schema.additionalProperties === undefined || schema.additionalProperties === true
            ? propertyValue
            : sanitizePayloadForSchema(propertyValue, schema.additionalProperties, { mode, full, seen });
      }
    }
    const shouldBackfill = full || mode !== 'patch';
    backfillRequiredPayload(output, value, schema, { mode, full: shouldBackfill, seen });
    backfillSafeOptionalPayload(output, value, schema, { mode, full: shouldBackfill, seen });
    return ensureDiscriminatorValue(output, schema, schemaName);
  } finally {
    if (visitKey) seen.delete(visitKey);
  }
}

function validateValue(value, schema, options = {}) {
  const mode = options.mode ?? 'response';
  const pointer = options.pointer ?? [];
  const errors = [];
  schema = deref(schema);
  if (!schema) return errors;
  if (value === null) {
    if (schema.nullable || schema.type === 'null' || schema.type?.includes?.('null')) return errors;
    return [`${pointerFor(pointer)} expected non-null value`];
  }
  if (value === undefined) return errors;
  if (schema.allOf?.length) return schema.allOf.flatMap(part => validateValue(value, part, { mode, pointer }));
  if (schema.oneOf?.length || schema.anyOf?.length) {
    if (hasRootObjectMembers(schema)) {
      errors.push(...validateValue(value, withoutObjectVariants(schema), { mode, pointer }));
    }
    const variants = schema.oneOf ?? schema.anyOf;
    const matches = variants.map(variant => validateValue(value, variant, { mode, pointer })).filter(variantErrors => variantErrors.length === 0);
    if (!matches.length) errors.push(`${pointerFor(pointer)} did not match any composed schema`);
    return errors;
  }
  if (schema.enum?.length && !schema.enum.includes(value)) errors.push(`${pointerFor(pointer)} expected enum value ${schema.enum.join(', ')}`);
  const type = schemaType(schema);
  if (type === 'integer' && !Number.isInteger(value)) errors.push(`${pointerFor(pointer)} expected integer`);
  if (type === 'number' && typeof value !== 'number') errors.push(`${pointerFor(pointer)} expected number`);
  if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${pointerFor(pointer)} expected boolean`);
  if (type === 'string' && typeof value !== 'string') errors.push(`${pointerFor(pointer)} expected string`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pointerFor(pointer)} expected >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pointerFor(pointer)} expected <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${pointerFor(pointer)} expected minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${pointerFor(pointer)} expected maxLength ${schema.maxLength}`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${pointerFor(pointer)} expected pattern ${schema.pattern}`);
      } catch {
        // Ignore invalid patterns from source specs; the generator cannot enforce them reliably either.
      }
    }
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${pointerFor(pointer)} expected array`);
    } else {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pointerFor(pointer)} expected minItems ${schema.minItems}`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${pointerFor(pointer)} expected maxItems ${schema.maxItems}`);
      value.forEach((item, index) => errors.push(...validateValue(item, schema.items ?? {}, { mode, pointer: [...pointer, index] })));
    }
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${pointerFor(pointer)} expected object`);
    } else {
      const properties = collectProperties(schema);
      const required = collectRequired(schema);
      for (const property of required) {
        const propertySchema = deref(properties[property]);
        if (mode === 'request' && propertySchema?.readOnly) continue;
        if (mode === 'response' && propertySchema?.writeOnly) continue;
        if (!hasRequiredValue(value, property, properties)) errors.push(`${pointerFor([...pointer, property])} is required`);
      }
      for (const [property, propertyValue] of Object.entries(value)) {
        const propertySchema = properties[property];
        if (propertyValue === null && !required.has(property)) continue;
        if (mode === 'request' && deref(propertySchema)?.readOnly) continue;
        if (mode === 'response' && deref(propertySchema)?.writeOnly) continue;
        if (propertySchema) errors.push(...validateValue(propertyValue, propertySchema, { mode, pointer: [...pointer, property] }));
        else if (schema.additionalProperties && schema.additionalProperties !== true) {
          errors.push(...validateValue(propertyValue, schema.additionalProperties, { mode, pointer: [...pointer, property] }));
        }
      }
    }
  }
  return errors;
}

function operationKey(method, rawPath, operation) {
  return `${String(evidenceSequence).padStart(3, '0')}-${method}-${(operation.operationId ?? rawPath)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function pathTemplateBase(rawPath) {
  return rawPath.replace(/\/$/, '');
}

function resourceKey(rawPath) {
  const segments = rawPath
    .split('/')
    .filter(Boolean)
    .filter(segment => !segment.startsWith('{'));
  return segments.at(-1) ?? rawPath;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathParamsFromResolved(rawPath, resolvedPath) {
  const template = rawPath.split('?')[0];
  const pathname = resolvedPath.split('?')[0];
  const names = [];
  let pattern = '^';
  let cursor = 0;
  for (const match of template.matchAll(/\{([^}]+)}/g)) {
    pattern += escapeRegExp(template.slice(cursor, match.index));
    pattern += '([^/]+)';
    names.push(match[1]);
    cursor = match.index + match[0].length;
  }
  pattern += escapeRegExp(template.slice(cursor));
  pattern += '$';
  const match = new RegExp(pattern).exec(pathname);
  if (!match) return {};
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
}

function allPrimitiveProperties(value, prefix = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const output = [];
  for (const [property, propertyValue] of Object.entries(value)) {
    if (propertyValue === null || propertyValue === undefined) continue;
    if (typeof propertyValue === 'object') {
      output.push(...allPrimitiveProperties(propertyValue, [...prefix, property]));
    } else {
      output.push({ name: property, path: [...prefix, property], value: propertyValue });
    }
  }
  return output;
}

function identityValueFor(paramName, json, locationHeader) {
  const properties = allPrimitiveProperties(json);
  const normalizedParam = normalizePrimitive(paramName);
  const exact = properties.find(property => normalizePrimitive(property.name) === normalizedParam);
  if (exact) return exact.value;
  const suffix = properties.find(property => normalizePrimitive(property.name).endsWith(normalizedParam));
  if (suffix) return suffix.value;
  const paramTokens = nameTokens(paramName);
  const tokenCompatible = properties.find(property => {
    const propertyTokens = nameTokens(property.name);
    return (
      paramTokens.length > 1 &&
      propertyTokens.at(-1) === paramTokens.at(-1) &&
      paramTokens.every(token => propertyTokens.includes(token))
    );
  });
  if (tokenCompatible) return tokenCompatible.value;
  if (normalizedParam === 'id') {
    const idLike = properties.find(property => /(^|[_-])id$/i.test(property.name) || /id$/i.test(property.name) || /reference$/i.test(property.name));
    if (idLike) return idLike.value;
  }
  if (normalizedParam.endsWith('id')) {
    const plainId = properties.find(property => normalizePrimitive(property.name) === 'id');
    if (plainId) return plainId.value;
  }
  if (locationHeader) {
    const lastSegment = locationHeader.split('?')[0].split('/').filter(Boolean).pop();
    if (lastSegment) return decodeURIComponent(lastSegment);
  }
  return undefined;
}

function createdRecordForPath(rawPath) {
  const base = pathTemplateBase(rawPath);
  const resource = resourceKey(rawPath);
  return [...created]
    .reverse()
    .find(record => record.base === base || rawPath.startsWith(`${record.base}/`) || record.resource === resource);
}

function resolvePath(rawPath, pathItem, operation, allowDefault = false) {
  const record = createdRecordForPath(rawPath);
  let resolved = true;
  const pathname = rawPath.replace(/\{([^}]+)\}/g, (_, paramName) => {
    const value = record?.params?.[paramName] ?? record?.params?.[normalizePrimitive(paramName)];
    if (value !== undefined) return encodeURIComponent(String(value));
    resolved = false;
    return allowDefault ? '1' : `{${paramName}}`;
  });
  if (!resolved && !allowDefault) return undefined;
  const query = new URLSearchParams();
  for (const parameter of operationParameters(pathItem, operation)) {
    if (parameter?.in !== 'query' || !parameter.required) continue;
    const value = payloadFor(parameter.schema ?? {}, { mode: 'query', full: false });
    if (value === undefined) continue;
    query.set(parameter.name, Array.isArray(value) ? value.join(',') : String(value));
  }
  return query.size ? `${pathname}?${query}` : pathname;
}

function coercePathValue(value, schema) {
  const type = schemaType(schema);
  if (type === 'integer') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  if (type === 'boolean') return value === true || value === 'true';
  return value;
}

function mergePathParamsIntoPayload(payload, schema, pathParams) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(pathParams).length) return payload;
  const properties = collectProperties(schema);
  for (const [paramName, paramValue] of Object.entries(pathParams)) {
    const normalizedParam = normalizePrimitive(paramName);
    const property = Object.keys(properties).find(candidate => normalizePrimitive(candidate) === normalizedParam);
    if (!property) continue;
    const propertySchema = deref(properties[property]);
    if (propertySchema?.readOnly) continue;
    payload[property] = coercePathValue(paramValue, propertySchema);
  }
  return payload;
}

function urlFor(resolvedPath) {
  const trimmedBase = baseUrl.replace(/\/$/, '');
  if (trimmedBase.endsWith('/api') && resolvedPath.startsWith('/api/')) {
    return `${trimmedBase}${resolvedPath.slice(4)}`;
  }
  return `${trimmedBase}${resolvedPath}`;
}

function serializeError(error) {
  if (!error || typeof error !== 'object') return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    address: error.address,
    port: error.port,
    stack: error.stack,
    cause: error.cause ? serializeError(error.cause) : undefined,
  };
}

async function request(method, resolvedPath, body, requestHeaders = {}) {
  const headers = { Accept: 'application/json', Connection: 'close', ...requestHeaders };
  if (token && token !== '-') headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !Object.keys(headers).some(header => /^content-type$/i.test(header))) headers['Content-Type'] = 'application/json';
  const response = await fetch(urlFor(resolvedPath), {
    method: method.toUpperCase(),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json, headers: response.headers };
}

function rememberCreated(rawPath, resolvedPath, operation, response) {
  if (!response.json || typeof response.json !== 'object') return;
  const params = pathParamsFromResolved(rawPath, resolvedPath);
  const rememberParam = (name, value) => {
    if (value === undefined || params[name] !== undefined) return;
    params[name] = value;
    params[normalizePrimitive(name)] = value;
  };
  const location = response.headers.get('location');
  const readPaths = Object.entries(doc.paths ?? {})
    .filter(([candidate, pathItem]) => pathItem.get && candidate.startsWith(`${pathTemplateBase(rawPath)}/`) && /\{[^}]+}/.test(candidate))
    .map(([candidate]) => candidate);
  for (const readPath of readPaths) {
    for (const paramName of readPath.matchAll(/\{([^}]+)\}/g)) {
      const value = identityValueFor(paramName[1], response.json, location);
      rememberParam(paramName[1], value);
    }
  }
  for (const property of allPrimitiveProperties(response.json)) {
    if (/id$/i.test(property.name) || /reference$/i.test(property.name)) {
      rememberParam(property.name, property.value);
    }
  }
  if (Object.keys(params).length) {
    created.push({
      base: pathTemplateBase(rawPath),
      resource: resourceKey(rawPath),
      operationId: operation.operationId,
      params,
    });
  }
}

async function exercise(method, rawPath, pathItem, operation, bodyMode = 'create') {
  const resolvedPath = resolvePath(rawPath, pathItem, operation, false);
  if (!resolvedPath) return undefined;
  const schema = requestSchemaFor(operation);
  const explicit = schema ? explicitExample(operation, schema) : undefined;
  const payload =
    schema && bodyMode !== 'none'
      ? explicit !== undefined
        ? sanitizePayloadForSchema(explicit, schema, { mode: bodyMode, full: bodyMode !== 'patch' })
        : payloadFor(schema, { mode: bodyMode, full: bodyMode !== 'patch' })
      : undefined;
  const requestHeaders = operationRequestHeaders(pathItem, operation);
  mergePathParamsIntoPayload(payload, schema, pathParamsFromResolved(rawPath, resolvedPath));
  evidenceSequence += 1;
  const key = operationKey(method, rawPath, operation);
  const requestFile = payload === undefined ? undefined : writeJson(path.join(outputDir, 'payloads', `${key}.json`), payload);
  const headersFile = Object.keys(requestHeaders).length
    ? writeJson(path.join(outputDir, 'payloads', `${key}.headers.json`), requestHeaders)
    : undefined;
  if (schema && payload !== undefined) {
    const requestErrors = validateValue(payload, schema, { mode: 'request' });
    if (requestErrors.length) {
      writeJson(path.join(outputDir, 'failure.json'), {
        appName,
        artifact: yamlPath,
        command: `${method.toUpperCase()} ${urlFor(resolvedPath)}`,
        endpoint: resolvedPath,
        requestJson: requestFile,
        requestHeaders,
        requestValidation: requestErrors,
      });
      throw new Error(`${appName} generated invalid request for ${method.toUpperCase()} ${resolvedPath}: ${requestErrors.join('; ')}`);
    }
  }
  let response;
  try {
    response = await request(method, resolvedPath, payload, requestHeaders);
  } catch (error) {
    const networkError = serializeError(error);
    writeJson(path.join(outputDir, 'failure.json'), {
      appName,
      artifact: yamlPath,
      command: `${method.toUpperCase()} ${urlFor(resolvedPath)}`,
      endpoint: resolvedPath,
      requestJson: requestFile,
      requestHeaders,
      networkError,
    });
    throw new Error(`${appName} ${method.toUpperCase()} ${resolvedPath} request failed: ${networkError.message}`, { cause: error });
  }
  const responseFile = writeJson(path.join(outputDir, 'responses', `${key}.json`), {
    status: response.status,
    body: response.json ?? response.text,
  });
  const expected = successStatuses(operation, method);
  const result = {
    method: method.toUpperCase(),
    path: resolvedPath,
    status: response.status,
    expected,
    requestFile,
    headersFile,
    requestHeaders,
    responseFile,
  };
  results.push(result);
  if (response.status >= 500 || !expected.includes(response.status)) {
    writeJson(path.join(outputDir, 'failure.json'), {
      appName,
      artifact: yamlPath,
      command: `${method.toUpperCase()} ${urlFor(resolvedPath)}`,
      endpoint: resolvedPath,
      requestJson: requestFile,
      requestHeaders,
      responseStatus: response.status,
      responseBody: response.json ?? response.text,
    });
    throw new Error(`${appName} ${method.toUpperCase()} ${resolvedPath} expected ${expected.join('/')} got ${response.status}: ${response.text}`);
  }
  const responseSchema = responseSchemaFor(operation, response.status);
  if (responseSchema && response.json !== undefined) {
    const responseErrors = validateValue(response.json, responseSchema, { mode: 'response' });
    if (responseErrors.length) {
      result.responseValidation = responseErrors;
      writeJson(path.join(outputDir, 'failure.json'), {
        appName,
        artifact: yamlPath,
        command: `${method.toUpperCase()} ${urlFor(resolvedPath)}`,
        endpoint: resolvedPath,
        requestJson: requestFile,
        requestHeaders,
        responseStatus: response.status,
        responseBody: response.json,
        responseValidation: responseErrors,
      });
      throw new Error(`${appName} ${method.toUpperCase()} ${resolvedPath} response schema errors: ${responseErrors.join('; ')}`);
    }
  }
  if (method === 'post') rememberCreated(rawPath, resolvedPath, operation, response);
  return result;
}

function operationsFor(method) {
  const output = [];
  for (const [rawPath, pathItem] of Object.entries(doc.paths ?? {})) {
    if (pathItem[method]) output.push({ rawPath, pathItem, operation: pathItem[method] });
  }
  return output;
}

async function main() {
  for (const item of operationsFor('get').filter(item => !/\{[^}]+}/.test(item.rawPath))) {
    await exercise('get', item.rawPath, item.pathItem, item.operation, 'none');
  }

  let createdInPass = true;
  const postOperations = operationsFor('post');
  const exercisedPosts = new Set();
  while (createdInPass) {
    createdInPass = false;
    for (const item of postOperations) {
      const key = `${item.rawPath}:${item.operation.operationId ?? ''}`;
      if (exercisedPosts.has(key) || !resolvePath(item.rawPath, item.pathItem, item.operation, false)) continue;
      const before = created.length;
      await exercise('post', item.rawPath, item.pathItem, item.operation, 'create');
      exercisedPosts.add(key);
      createdInPass ||= created.length > before;
    }
  }

  for (const item of operationsFor('get').filter(item => /\{[^}]+}/.test(item.rawPath))) {
    if (resolvePath(item.rawPath, item.pathItem, item.operation, false)) await exercise('get', item.rawPath, item.pathItem, item.operation, 'none');
  }

  for (const method of ['patch', 'put']) {
    for (const item of operationsFor(method)) {
      if (resolvePath(item.rawPath, item.pathItem, item.operation, false)) {
        await exercise(method, item.rawPath, item.pathItem, item.operation, method === 'patch' ? 'patch' : 'create');
      }
    }
  }

  for (const item of operationsFor('delete')) {
    if (resolvePath(item.rawPath, item.pathItem, item.operation, false)) await exercise('delete', item.rawPath, item.pathItem, item.operation, 'none');
  }

  const summary = { appName, artifact: yamlPath, results, created };
  writeJson(path.join(outputDir, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
