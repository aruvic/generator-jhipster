/**
 * Copyright 2013-2025 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see https://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { upperFirstCamelCase } from '../../../lib/utils/string.ts';
import { appendFileSync } from 'node:fs';

import type { OperationDescriptor } from './openapi-entity-matcher.ts';
import {
  buildDomainFqcn,
  buildDtoFqcn,
  extractSchemaRef,
  isEnumSchema,
  normalizeTypeName,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';
import type { OpenAPIOperation, ParsedOpenAPISpec } from './openapi-mapper-generator.ts';

/**
 * Polymorphic helper mapper context (per abstract family)
 */
export interface PolymorphicHelperMapperContext {
  mapperName: string;
  packageName: string;
  baseType: string;
  baseDtoType: string;
  baseDomainType: string;
  subtypes: SubtypeInfo[];
  variants: PolymorphicVariantInfo[];
  usesMappers: string[];
  isAbstract?: boolean;
  baseMethodAnnotations?: string[];
}

/**
 * Entity-specific mapper context
 */
export interface EntityMapperContext {
  mapperName: string;
  packageName: string;
  entityName: string;
  usesMappers: string[];
  referencedEntities?: string[];
  requestMappings: EntityMapping[];
  responseMappings: EntityMapping[];
  objectFactories?: ObjectFactoryMethodContext[];
}

export interface PolymorphicTypeMapping {
  baseType: string;
  baseDtoType: string;
  baseDomainType: string;
  subtypes: SubtypeInfo[];
  variants: PolymorphicVariantInfo[];
  isAbstract?: boolean;
  baseMethodAnnotations?: string[];
}

export interface SubtypeInfo {
  dtoType: string;
  domainType: string;
  dtoSimpleName: string;
  domainSimpleName: string;
  isCompatible?: boolean;
}

export interface PolymorphicVariantInfo {
  dtoType: string;
  dtoSimpleName: string;
  normalizedName: string;
  isBase: boolean;
  isWrapper: boolean;
  targetDomainType?: string;
  targetDomainSimpleName?: string;
  subtypes: SubtypeInfo[];
  mappingMethodName?: string;
  annotations?: string[];
}

export interface EntityMapping {
  methodName: string;
  sourceType: string;
  targetType: string;
  annotations: string[];
  sourceSchemaName?: string;
  targetSchemaName?: string;
}

export interface ObjectFactoryVariantContext {
  discriminatorValue: string;
  discriminatorLiteral: string;
  instantiationType: string;
  isDefault?: boolean;
}

export interface ObjectFactoryMethodContext {
  methodName: string;
  returnType: string;
  sourceType: string;
  discriminatorAccessor?: string;
  fallbackAccessor: string;
  variants: ObjectFactoryVariantContext[];
  defaultVariant: ObjectFactoryVariantContext;
}

interface PolymorphicFallbackFactoryMetadata {
  discriminatorProperty?: string;
  variants: ObjectFactoryVariantContext[];
}

interface EntityMetadata {
  isAbstract?: boolean;
  discriminatorProperty?: string;
  childEntities: Array<{
    name: string;
    discriminatorValue?: string;
    abstract?: boolean;
  }>;
  discriminatorValues?: Record<string, string>;
}

type DomainMetadataResolver = (entityName: string) => Partial<EntityMetadata> | undefined;

/**
 * Schemas that don't have corresponding domain entities
 */
const ABSTRACT_SCHEMAS = new Set(['Entity', 'Extensible', 'Addressable']);

/**
 * Check if schema is polymorphic
 */
function isPolymorphic(schema: any, schemaName?: string): boolean {
  if (schemaName === 'Party') {
    try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Checking isPolymorphic for Party\n'); } catch (e) {}
  }
  if (!schema) return false;

  const hasOneOf = Array.isArray(schema.oneOf) && schema.oneOf.length > 0;
  if (hasOneOf) {
    if (schemaName === 'Party') {
        try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party has oneOf\n'); } catch (e) {}
    }
    return true;
  }

  const discriminator = schema.discriminator;
  if (!discriminator) {
    if (schemaName === 'Party') {
        try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party has no discriminator\n'); } catch (e) {}
    }
    return false;
  }

  const mapping = discriminator.mapping;
  if (!mapping || Object.keys(mapping).length === 0) {
    if (schemaName === 'Party') {
        try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party has discriminator but no mapping\n'); } catch (e) {}
    }
    // Some specs rely on discriminator + oneOf/anyOf, already handled above.
    return false;
  }

  const normalizedBase = stripDtoSuffix(schemaName ? normalizeTypeName(schemaName) : '');
  const referencedTargets = Object.values(mapping)
    .map(ref => (typeof ref === 'string' ? ref.split('/').pop() : undefined))
    .filter((name): name is string => !!name)
    .map(name => stripDtoSuffix(name))
    .filter(name => name && (!normalizedBase || name !== normalizedBase));

  const result = new Set(referencedTargets).size > 0;
  if (schemaName === 'Party') {
      try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party isPolymorphic result: ' + result + '\n'); } catch (e) {}
  }
  return result;
}

function singularizeName(value: string): string {
  if (!value) return value;
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith('ses') && value.length > 3) {
    return value.slice(0, -2);
  }
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) {
    return value.slice(0, -1);
  }
  return value;
}

function buildVariantMappingMethodName(baseType: string, _variantSimpleName: string): string {
  return `to${baseType}Entity`;
}

/**
 * Extract subtypes from polymorphic schema
 */
function extractSubtypes(schema: any): string[] {
  const refs = schema.oneOf || schema.anyOf || [];
  const subtypeNames = refs
    .map((ref: any) => {
      const refName = extractSchemaRef(ref);
      if (refName) {
        return refName;
      }
      if (ref && typeof ref === 'object') {
        const candidate = (ref as any).title ?? (ref as any)['x-class-name'];
        if (candidate) {
          return normalizeTypeName(candidate as string);
        }
      }
      return undefined;
    })
    .filter((name: string | undefined): name is string => !!name)
    .filter((name: string) => name && name !== 'null');

  if (subtypeNames.length === 0 && schema?.discriminator?.mapping) {
    for (const mappingTarget of Object.values<string>(schema.discriminator.mapping)) {
      if (!mappingTarget) {
        continue;
      }
      const refName = mappingTarget.includes('/') ? mappingTarget.split('/').pop() : mappingTarget;
      const normalized = refName;
      if (normalized && normalized !== 'null') {
        subtypeNames.push(normalized);
      }
    }
  }

  return Array.from(new Set(subtypeNames));
}

function isObjectLikeSchema(schema: any): boolean {
  if (!schema) return false;
  if (schema.type === 'object') return true;
  if (schema.allOf || schema.oneOf || schema.anyOf) return true;
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  return false;
}

/**
 * Build polymorphic type mapping
 */
function hasOwnSchemaProperties(schema: any): boolean {
  if (!schema) return false;
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  if (Array.isArray(schema.required) && schema.required.length > 0) return true;
  return false;
}

function isWrapperVariantSchema(variantName: string, schemas: Record<string, any>, baseSubtypeEntities: Set<string>): boolean {
  const variantSchema = schemas[variantName];
  if (!variantSchema) return false;

  const variantSubtypes = extractSubtypes(variantSchema);
  if (variantSubtypes.length === 0) return false;

  const introducesNewSubtype = variantSubtypes.some(subtype => !baseSubtypeEntities.has(stripDtoSuffix(subtype)));
  if (introducesNewSubtype) return false;

  if (hasOwnSchemaProperties(variantSchema)) return false;

  return true;
}

function collectReferencedEntities(
  schema: any,
  referencedEntities: Set<string>,
  schemas: Record<string, any>,
  visited: Set<string> = new Set(),
): void {
  if (!schema) {
    return;
  }

  if (schema.type === 'array' && schema.items) {
    collectReferencedEntities(schema.items, referencedEntities, schemas, visited);
  }

  const ref = extractSchemaRef(schema);
  if (ref) {
    referencedEntities.add(stripDtoSuffix(ref));
  }

  if (schema.properties) {
    for (const propertySchema of Object.values<any>(schema.properties)) {
      collectReferencedEntities(propertySchema, referencedEntities, schemas, visited);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) {
      collectReferencedEntities(item, referencedEntities, schemas, visited);

      const refName = extractSchemaRef(item);
      if (refName && schemas[refName] && !visited.has(refName)) {
        visited.add(refName);
        collectReferencedEntities(schemas[refName], referencedEntities, schemas, visited);
        visited.delete(refName);
      }
    }
  }

  if (Array.isArray(schema.oneOf)) {
    for (const item of schema.oneOf) {
      collectReferencedEntities(item, referencedEntities, schemas, visited);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    for (const item of schema.anyOf) {
      collectReferencedEntities(item, referencedEntities, schemas, visited);
    }
  }
}

function resolveVariantDomainSubtype(
  variantName: string,
  variantSubtypeInfos: SubtypeInfo[],
  baseType: string,
  subtypeInfoByName: Map<string, SubtypeInfo>,
): SubtypeInfo | undefined {
  if (variantSubtypeInfos.length === 1) {
    return variantSubtypeInfos[0];
  }
  const normalizedVariant = normalizeTypeName(stripDtoSuffix(variantName));
  if (!normalizedVariant) {
    return undefined;
  }
  const directMatch = subtypeInfoByName.get(normalizedVariant);
  if (directMatch) {
    return directMatch;
  }

  // If the variant name matches the base type, do not attempt fuzzy matching against subtypes.
  // This prevents incorrect mapping when the base type name contains a subtype name (e.g. PartyOrPartyRole containing PartyRole).
  if (normalizedVariant === normalizeTypeName(baseType)) {
    return undefined;
  }

  for (const info of subtypeInfoByName.values()) {
    const normalizedSubtype = normalizeTypeName(info.domainSimpleName);
    if (normalizedSubtype && normalizedVariant.includes(normalizedSubtype)) {
      return info;
    }
  }
  if (normalizedVariant === normalizeTypeName(baseType)) {
    const fallbackInfo = subtypeInfoByName.get(normalizedVariant);
    if (fallbackInfo) {
      return fallbackInfo;
    }
  }
  return undefined;
}

function normalizeEntityKey(name?: string): string | undefined {
  if (!name) {
    return undefined;
  }
  return normalizeTypeName(stripDtoSuffix(name));
}

function collectAllOfDerivedSchemas(schemas: Record<string, any>): Map<string, Set<string>> {
  const derivedByBase = new Map<string, Set<string>>();

  const register = (baseName?: string, derivedName?: string) => {
    if (!baseName || !derivedName) {
      return;
    }
    const normalizedBase = normalizeTypeName(stripDtoSuffix(baseName));
    if (!normalizedBase) {
      return;
    }
    if (!derivedByBase.has(normalizedBase)) {
      derivedByBase.set(normalizedBase, new Set());
    }
    derivedByBase.get(normalizedBase)!.add(derivedName);
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!Array.isArray(schema?.allOf)) {
      continue;
    }
    for (const fragment of schema.allOf) {
      const refName = extractSchemaRef(fragment);
      if (!refName) {
        continue;
      }
      register(refName, schemaName);
    }
  }

  return derivedByBase;
}

function resolveDerivedSchemas(baseType: string, derivedByBase: Map<string, Set<string>>): Set<string> {
  const resolved = new Set<string>();
  const queue: string[] = [];
  const normalizedBase = normalizeTypeName(stripDtoSuffix(baseType));
  if (normalizedBase) {
    queue.push(normalizedBase);
  }

  while (queue.length > 0) {
    const currentBase = queue.pop()!;
    const derivedEntries = derivedByBase.get(currentBase);
    if (!derivedEntries) {
      continue;
    }
    for (const derivedSchema of derivedEntries) {
      if (resolved.has(derivedSchema)) {
        continue;
      }
      resolved.add(derivedSchema);
      const normalizedDerived = normalizeTypeName(stripDtoSuffix(derivedSchema));
      if (normalizedDerived && normalizedDerived !== currentBase) {
        queue.push(normalizedDerived);
      }
    }
  }

  return resolved;
}

function normalizeNameForComparison(name?: string): string | undefined {
  if (!name) {
    return undefined;
  }
  return stripDtoSuffix(name);
}

function mergeEntityMetadata(target: EntityMetadata, source?: Partial<EntityMetadata>): EntityMetadata {
  if (!source) {
    return target;
  }
  if (source.isAbstract !== undefined) {
    target.isAbstract = source.isAbstract;
  }
  if (source.discriminatorProperty) {
    target.discriminatorProperty = source.discriminatorProperty;
  }
  if (source.discriminatorValues) {
    target.discriminatorValues = {
      ...(target.discriminatorValues ?? {}),
      ...source.discriminatorValues,
    };
  }
  if (Array.isArray(source.childEntities)) {
    const existing = new Map(target.childEntities.map(child => [child.name, child]));
    for (const child of source.childEntities) {
      if (!child.name) continue;
      const normalized = normalizeTypeName(child.name);
      if (!normalized) continue;
      const current = existing.get(normalized) ?? { name: normalized };
      current.discriminatorValue = child.discriminatorValue ?? current.discriminatorValue;
      current.abstract = child.abstract ?? current.abstract;
      existing.set(normalized, current);
    }
    target.childEntities = Array.from(existing.values());
  }
  return target;
}

function buildEntityMetadataFromDescriptor(entity: any): Partial<EntityMetadata> | undefined {
  if (!entity) {
    return undefined;
  }
  const childEntities: EntityMetadata['childEntities'] = [];
  if (Array.isArray(entity.childEntities)) {
    for (const child of entity.childEntities) {
      const normalized = normalizeEntityKey(child?.name ?? child?.entityClass ?? child?.entityNameCapitalized);
      if (!normalized) {
        continue;
      }
      childEntities.push({
        name: normalized,
        discriminatorValue: child?.discriminatorValue,
        abstract: child?.abstractClass ?? child?.abstract,
      });
    }
  }

  const annotationsAbstract = entity.annotations?.abstract;
  return {
    isAbstract: Boolean(entity.abstractClass ?? entity.abstract ?? annotationsAbstract ?? entity.polymorphicRoot),
    discriminatorProperty: entity.discriminator?.property ?? entity.discriminatorProperty,
    childEntities,
    discriminatorValues: entity.discriminatorColumn?.values,
  } satisfies Partial<EntityMetadata>;
}

function collectEntityMetadata(
  operationDescriptors?: Map<OpenAPIOperation, OperationDescriptor>,
  resolveDomainMetadata?: DomainMetadataResolver,
): Map<string, EntityMetadata> {
  const metadataByName = new Map<string, EntityMetadata>();

  const register = (entityInfo?: { name?: string; entity?: any }) => {
    const key = normalizeEntityKey(entityInfo?.name);
    if (!key) {
      return;
    }
    const existing: EntityMetadata = metadataByName.get(key) ?? { childEntities: [] };
    metadataByName.set(key, mergeEntityMetadata(existing, buildEntityMetadataFromDescriptor(entityInfo?.entity)));
  };

  if (operationDescriptors) {
    for (const descriptor of operationDescriptors.values()) {
      register(descriptor.matchedEntity);
      register(descriptor.requestEntityMatch);
      register(descriptor.responseEntityMatch);
    }
  }

  if (resolveDomainMetadata) {
    for (const [entityName, metadata] of metadataByName.entries()) {
      mergeEntityMetadata(metadata, resolveDomainMetadata(entityName));
    }
  }

  return metadataByName;
}

type JsonConversionKind = 'map' | 'list';

interface SchemaJsonFieldMetadata {
  kind: JsonConversionKind;
  usesJsonNullable: boolean;
}

interface SchemaJsonMetadata {
  fields: Map<string, SchemaJsonFieldMetadata>;
}

function collectSchemaJsonMetadata(
  schemaName: string,
  schemas: Record<string, any>,
  cache: Map<string, SchemaJsonMetadata>,
): SchemaJsonMetadata {
  if (cache.has(schemaName)) {
    return cache.get(schemaName)!;
  }
  const schema = schemas[schemaName];
  const info: SchemaJsonMetadata = { fields: new Map() };
  if (schema?.properties) {
    for (const [fieldName, propertySchema] of Object.entries<any>(schema.properties)) {
      const resolvedSchema = resolveSchema(propertySchema, schemas) ?? propertySchema;
      const kind = detectJsonFieldKind(fieldName, propertySchema, schemas);
      if (kind) {
        const usesJsonNullable = Boolean(resolvedSchema?.nullable ?? propertySchema?.nullable);
        info.fields.set(fieldName, { kind, usesJsonNullable });
      }
    }
  }
  cache.set(schemaName, info);
  return info;
}

function detectJsonFieldKind(_fieldName: string, propertySchema: any, schemas: Record<string, any>): JsonConversionKind | undefined {
  if (!propertySchema) {
    return undefined;
  }
  if (propertySchema.type === 'array') {
    const itemSchema = resolveSchema(propertySchema.items, schemas);
    if (itemSchema?.type === 'string') {
      return 'list';
    }
    return undefined;
  }
  
  if (propertySchema.additionalProperties) {
    return 'map';
  }
  
  if (propertySchema.type === 'object') {
      const hasProps = propertySchema.properties && Object.keys(propertySchema.properties).length > 0;
      const hasRef = !!propertySchema.$ref;
      const hasComposites = propertySchema.allOf || propertySchema.oneOf || propertySchema.anyOf;
      
      if (!hasProps && !hasRef && !hasComposites) {
          return 'map';
      }
  }
  
  return undefined;
}

function resolveSchema(schema: any, schemas: Record<string, any>): any {
  if (!schema) {
    return undefined;
  }
  if (schema.$ref) {
    const refName = extractSchemaRef(schema);
    if (refName && schemas[refName]) {
      return schemas[refName];
    }
  }
  return schema;
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toOpenApiPropertyName(fieldName: string): string {
  if (!fieldName) {
    return fieldName;
  }
  // Handle acronyms at the start: HSCodes -> hsCodes, XMLParser -> xmlParser
  if (/^[A-Z]{2,}/.test(fieldName)) {
      const match = fieldName.match(/^([A-Z]+)([A-Z][a-z0-9].*)$/);
      if (match) {
          return match[1].toLowerCase() + match[2];
      }
      if (/^[A-Z]+$/.test(fieldName)) {
          return fieldName.toLowerCase();
      }
  }
  return lowerFirst(fieldName);
}

function toJHipsterPropertyName(fieldName: string): string {
  return toOpenApiPropertyName(fieldName);
}



function buildJsonMappingAnnotations(metadata: SchemaJsonMetadata | undefined, direction: 'request' | 'response'): { annotations: string[], mappedFields: Set<string> } {
  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  if (!metadata) {
    return { annotations, mappedFields };
  }
  for (const [field, metadataEntry] of metadata.fields) {
    const { kind, usesJsonNullable } = metadataEntry;
    const dtoField = toOpenApiPropertyName(field);
    const domainField = toJHipsterPropertyName(field);
    const targetField = direction === 'request' ? domainField : dtoField;
    const sourceField = direction === 'request' ? dtoField : domainField;
    
    mappedFields.add(targetField);

    const qualifierForKind = (jsonKind: JsonConversionKind, nullable: boolean, dir: 'request' | 'response') => {
      if (jsonKind === 'map') {
        if (dir === 'request') {
          return nullable ? 'jsonNullableMapToString' : 'mapToJsonString';
        }
        return nullable ? 'jsonStringToJsonNullableMap' : 'jsonStringToMap';
      }
      if (dir === 'request') {
        return nullable ? 'jsonNullableStringListToString' : 'stringListToJsonString';
      }
      return nullable ? 'jsonStringToJsonNullableStringList' : 'jsonStringToStringList';
    };
    const qualifiedByName = qualifierForKind(kind, usesJsonNullable, direction);
    if (kind === 'map') {
      annotations.push(`@Mapping(source = "${sourceField}", target = "${targetField}", qualifiedByName = "${qualifiedByName}")`);
    } else if (kind === 'list') {
      annotations.push(`@Mapping(source = "${sourceField}", target = "${targetField}", qualifiedByName = "${qualifiedByName}")`);
    }
  }
  return { annotations, mappedFields };
}

type SchemaProperties = Record<string, any>;

function collectSchemaProperties(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  visiting = new Set<string>(),
): SchemaProperties {
  if (!schemaName) {
    return {};
  }
  if (cache.has(schemaName)) {
    return cache.get(schemaName)!;
  }
  const schema = schemas[schemaName];
  if (!schema || visiting.has(schemaName)) {
    return {};
  }
  visiting.add(schemaName);
  const properties: SchemaProperties = { ...(schema.properties ?? {}) };
  if (Array.isArray(schema.allOf)) {
    for (const fragment of schema.allOf) {
      if (fragment?.$ref) {
        const refName = extractSchemaRef(fragment);
        if (refName) {
          Object.assign(properties, collectSchemaProperties(refName, schemas, cache, visiting));
        }
      } else if (fragment?.properties) {
        Object.assign(properties, fragment.properties);
      }
    }
  }
  visiting.delete(schemaName);
  cache.set(schemaName, properties);
  return properties;
}

function matchesAbstractType(candidate: string | undefined, schemas: Record<string, any>): boolean {
  if (!candidate) {
    return false;
  }
  const normalized = normalizeTypeName(stripDtoSuffix(candidate));
  if (!normalized) return false;
  
  // Check if schema exists and is polymorphic
  const schema = schemas[candidate] || schemas[normalized];
  if (schema && isPolymorphic(schema, candidate)) {
    return true;
  }
  
  // Also check if it matches known abstract schemas (if we must keep this list, but user said no hardcoding)
  // For now, let's rely on isPolymorphic. 
  // If the schema is missing but referenced, we can't know for sure, but usually schemas are present.
  return false;
}

function schemaContainsAbstractReference(schema: any, schemas: Record<string, any>, visited = new Set<string>()): boolean {
  if (!schema) {
    return false;
  }

  const refName = extractSchemaRef(schema);
  if (matchesAbstractType(refName, schemas)) {
    return true;
  }
  if (refName && schemas[refName] && !visited.has(refName)) {
    visited.add(refName);
    if (schemaContainsAbstractReference(schemas[refName], schemas, visited)) {
      return true;
    }
    visited.delete(refName);
  }

  if (schema.type === 'array' && schema.items) {
    if (schemaContainsAbstractReference(schema.items, schemas, visited)) {
      return true;
    }
  }

  const composites = [schema.oneOf, schema.anyOf, schema.allOf];
  for (const branch of composites) {
    if (Array.isArray(branch)) {
      for (const fragment of branch) {
        if (schemaContainsAbstractReference(fragment, schemas, visited)) {
          return true;
        }
      }
    }
  }

  if (schema.additionalProperties) {
    if (schemaContainsAbstractReference(schema.additionalProperties, schemas, visited)) {
      return true;
    }
  }

  const inlineName = schema.title ?? schema['x-class-name'];
  if (matchesAbstractType(inlineName, schemas)) {
    return true;
  }

  return false;
}

function shouldIgnoreAbstractField(_fieldName: string, fieldSchema: any, schemas: Record<string, any>): boolean {
  // Remove name-based check, rely on schema analysis
  return schemaContainsAbstractReference(fieldSchema, schemas);
}

function buildAbstractFieldMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  excludedFields: Set<string> = new Set()
): string[] {
  if (!schemaName) {
    return [];
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  if (!properties || Object.keys(properties).length === 0) {
    return [];
  }
  const targets = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    if (!fieldSchema) {
      continue;
    }
    const targetField = direction === 'request' ? toJHipsterPropertyName(fieldName) : toOpenApiPropertyName(fieldName);
    
    if (excludedFields.has(targetField)) {
      continue;
    }

    if (shouldIgnoreAbstractField(fieldName, fieldSchema, schemas)) {
      targets.add(targetField);
    }
  }
  return Array.from(targets).map(field => `@Mapping(target = "${field}", ignore = true)`);
}

function buildDiscriminatorAccessorExpression(propertyName: string, sourceAccessor = 'source'): string {
  if (!propertyName) {
    return '';
  }
  let normalized = propertyName.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('@')) {
    normalized = `at ${normalized.substring(1)}`;
  }
  normalized = normalized.replace(/[^A-Za-z0-9]+/g, ' ');
  const getterName = upperFirstCamelCase(normalized);
  return `${sourceAccessor}.get${getterName}()`;
}

function buildObjectFactoryVariants(
  entityName: string,
  metadata: EntityMetadata,
  basePackage: string,
  fallbackVariants?: ObjectFactoryVariantContext[],
): ObjectFactoryVariantContext[] {
  const variants: ObjectFactoryVariantContext[] = [];
  const variantEntries = new Map<string, ObjectFactoryVariantContext>();
  const baseEntityFqcn = buildDomainFqcn(entityName, basePackage);

  const registerVariant = (name: string, discriminatorValue?: string) => {
    const normalized = normalizeTypeName(name);
    if (!normalized) {
      return;
    }
    const instantiationType = buildDomainFqcn(normalized, basePackage);
    if (instantiationType === baseEntityFqcn) {
      return;
    }
    const literal = JSON.stringify(discriminatorValue ?? normalized);
    const key = discriminatorValue ?? normalized;
    if (!variantEntries.has(key)) {
      variantEntries.set(key, {
        discriminatorValue: discriminatorValue ?? normalized,
        discriminatorLiteral: literal,
        instantiationType,
      });
    }
  };

  if (metadata.childEntities) {
    for (const child of metadata.childEntities) {
      if (child.abstract) {
        continue;
      }
      registerVariant(child.name, child.discriminatorValue);
    }
  }

  if (metadata.discriminatorValues) {
    for (const [childName, discriminator] of Object.entries(metadata.discriminatorValues)) {
      registerVariant(childName, discriminator);
    }
  }

  const resolved = Array.from(variantEntries.values());
  resolved.sort((a, b) => a.discriminatorValue.localeCompare(b.discriminatorValue));
  if (resolved.length > 0) {
    resolved[0].isDefault = true;
  }
  variants.push(...resolved);
  if (variants.length === 0 && fallbackVariants?.length) {
    const filteredFallback = fallbackVariants.filter(v => v.instantiationType !== baseEntityFqcn);
    return filteredFallback.map((variant, index) => ({
      ...variant,
      isDefault: index === 0,
    }));
  }
  return variants;
}

function buildObjectFactoryContexts(
  entityName: string,
  requestMappings: EntityMapping[],
  metadata: EntityMetadata,
  schemas: Record<string, any>,
  basePackage: string,
  fallback?: PolymorphicFallbackFactoryMetadata,
): ObjectFactoryMethodContext[] {
  const childEntityKeys = new Set(
    (metadata?.childEntities ?? [])
      .map(child => normalizeEntityKey(child?.name))
      .filter((key): key is string => Boolean(key)),
  );
  const isPolymorphicEntity = Boolean(metadata?.isAbstract || childEntityKeys.size > 0);
  if (!isPolymorphicEntity) {
    return [];
  }
  const variants = buildObjectFactoryVariants(entityName, metadata, basePackage, fallback?.variants);
  const applicableVariants = childEntityKeys.size > 0
    ? variants.filter(variant => {
        const variantEntity = normalizeEntityKey(extractDomainEntityName(variant.instantiationType));
        return variantEntity ? childEntityKeys.has(variantEntity) : false;
      })
    : variants;
  if (applicableVariants.length === 0) {
    return [];
  }

  const defaultVariant = applicableVariants.find(variant => variant.isDefault) ?? applicableVariants[0];
  const seenSources = new Set<string>();
  const factoryContexts: ObjectFactoryMethodContext[] = [];

  for (const mapping of requestMappings) {
    if (!mapping.sourceSchemaName) {
      continue;
    }
    if (seenSources.has(mapping.sourceType)) {
      continue;
    }
    seenSources.add(mapping.sourceType);
    const schema = schemas[mapping.sourceSchemaName];
    const normalizedSourceName = normalizeNameForComparison(mapping.sourceSchemaName ?? mapperSourceToName(mapping.sourceType));
    const normalizedEntityName = normalizeNameForComparison(entityName);
    const isKnownPolymorphicSource =
      normalizedSourceName !== undefined &&
      ((normalizedEntityName !== undefined && normalizedSourceName === normalizedEntityName) ||
        metadata?.childEntities?.some(child => normalizeNameForComparison(child.name) === normalizedSourceName) ||
        fallback?.variants?.some(
          variant => normalizeNameForComparison(extractDomainEntityName(variant.instantiationType)) === normalizedSourceName,
        ));
    const discriminatorProperty =
      schema?.discriminator?.propertyName ??
      (isKnownPolymorphicSource ? (metadata?.discriminatorProperty ?? fallback?.discriminatorProperty) : undefined);
    let discriminatorAccessor: string | undefined;
    if (discriminatorProperty) {
      discriminatorAccessor = buildDiscriminatorAccessorExpression(discriminatorProperty);
    }
    const methodName = `instantiate${entityName}From${normalizedSourceName || 'Variant'}`;
    factoryContexts.push({
      methodName,
      returnType: buildDomainFqcn(entityName, basePackage),
      sourceType: mapping.sourceType,
      discriminatorAccessor,
      fallbackAccessor: 'source.getClass().getSimpleName()',
      variants: applicableVariants,
      defaultVariant,
    });
  }

  return factoryContexts;
}

function buildAbstractTargetFactories(
  requestMappings: EntityMapping[],
  entityMetadata: Map<string, EntityMetadata>,
  schemas: Record<string, any>,
  basePackage: string,
  fallbackFactories?: Map<string, PolymorphicFallbackFactoryMetadata>,
): ObjectFactoryMethodContext[] {
  const mappingsByTarget = new Map<string, EntityMapping[]>();
  for (const mapping of requestMappings) {
    const targetEntity = extractDomainEntityName(mapping.targetType);
    if (!targetEntity) {
      continue;
    }
    if (!mappingsByTarget.has(targetEntity)) {
      mappingsByTarget.set(targetEntity, []);
    }
    mappingsByTarget.get(targetEntity)!.push(mapping);
  }

  const contexts: ObjectFactoryMethodContext[] = [];
  for (const [targetEntity, mappings] of mappingsByTarget.entries()) {
    const metadataKey = normalizeEntityKey(targetEntity) ?? targetEntity;
    let metadata = entityMetadata.get(metadataKey);
    const fallback = fallbackFactories?.get(metadataKey);
    if (!metadata) {
      if (!fallback) {
        continue;
      }
      metadata = { childEntities: [], isAbstract: true };
    }
    if (!metadata.isAbstract && !fallback) {
      continue;
    }
    const factoryContexts = buildObjectFactoryContexts(targetEntity, mappings, metadata, schemas, basePackage, fallback);
    contexts.push(...factoryContexts);
  }
  return contexts;
}

function extractSchemaSimpleName(refName?: string): string | undefined {
  if (!refName) {
    return undefined;
  }
  const fragment = refName.includes('#/') ? refName.split('#/').pop()! : refName;
  const slashSegments = fragment.split('/').filter(Boolean);
  const lastSlashSegment = slashSegments.length > 0 ? slashSegments[slashSegments.length - 1] : fragment;
  const dottedSegments = lastSlashSegment.split('.').filter(Boolean);
  if (dottedSegments.length > 0) {
    return dottedSegments[dottedSegments.length - 1];
  }
  return lastSlashSegment;
}

function buildFallbackFactoryVariantsFromSchema(
  schemaName: string,
  schema: any,
  basePackage: string,
  derivedByBase: Map<string, Set<string>>,
): ObjectFactoryVariantContext[] {
  const baseEntity = stripDtoSuffix(schemaName);
  if (!baseEntity) {
    return [];
  }
  const variantEntries = new Map<string, ObjectFactoryVariantContext>();

  const registerVariant = (variantSchemaName?: string, discriminatorValue?: string) => {
    if (!variantSchemaName) {
      return;
    }
    const simpleName = extractSchemaSimpleName(variantSchemaName);
    if (!simpleName) {
      return;
    }
    const normalized = stripDtoSuffix(simpleName);
    if (!normalized || ABSTRACT_SCHEMAS.has(normalized)) {
      return;
    }
    const instantiationType = buildDomainFqcn(normalized, basePackage);
    const value = discriminatorValue ?? normalized;
    if (!variantEntries.has(instantiationType)) {
      variantEntries.set(instantiationType, {
        discriminatorValue: value,
        discriminatorLiteral: JSON.stringify(value),
        instantiationType,
      });
    }
  };

  const discriminatorMapping = schema?.discriminator?.mapping;
  if (discriminatorMapping) {
    for (const [discValue, ref] of Object.entries<string>(discriminatorMapping)) {
      const refName = extractSchemaRef(ref) ?? ref;
      registerVariant(refName, discValue);
    }
  }

  const schemaVariants = schema?.oneOf ?? schema?.anyOf ?? [];
  for (const variant of schemaVariants) {
    const refName = extractSchemaRef(variant);
    registerVariant(refName);
  }

  const derivedSchemas = resolveDerivedSchemas(baseEntity, derivedByBase);
  for (const derivedSchema of derivedSchemas) {
    registerVariant(derivedSchema);
  }

  return Array.from(variantEntries.values()).sort((a, b) => a.discriminatorValue.localeCompare(b.discriminatorValue));
}

function extractDomainEntityName(fqcn: string): string | undefined {
  if (!fqcn) {
    return undefined;
  }
  const parts = fqcn.split('.');
  return parts.pop() ?? fqcn;
}

function mapperSourceToName(sourceType: string): string {
  return sourceType.split('.').pop() ?? sourceType;
}

function buildPolymorphicMapping(
  schemaName: string,
  schema: any,
  basePackage: string,
  schemaVariants: Map<string, Set<string>>,
  schemas: Record<string, any>,
  derivedByBase: Map<string, Set<string>>,
  entityMetadata: Map<string, EntityMetadata>,
): PolymorphicTypeMapping | null {
  if (schemaName === 'Party') {
      try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: buildPolymorphicMapping called for Party\n'); } catch (e) {}
  }
  if (!isPolymorphic(schema, schemaName)) return null;

  const baseType = stripDtoSuffix(schemaName);
  const normalizedBase = normalizeTypeName(baseType);
  const subtypeNames = extractSubtypes(schema);
  if (schemaName === 'Party') {
      try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party initial subtypes: ' + subtypeNames.join(', ') + '\n'); } catch (e) {}
  }
  const derivedSchemas = resolveDerivedSchemas(baseType, derivedByBase);
  for (const derivedSchema of derivedSchemas) {
    const normalizedDerived = stripDtoSuffix(derivedSchema);
    if (!normalizedDerived) {
      continue;
    }
    if (!subtypeNames.includes(normalizedDerived)) {
      subtypeNames.push(normalizedDerived);
    }
  }
  if (subtypeNames.length === 0) {
    if (schemaName === 'Party') {
        try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party has no subtypes\n'); } catch (e) {}
    }
    return null;
  }

  const baseDtoFqcn = buildDtoFqcn(schemaName, basePackage);
  const baseDomainFqcn = buildDomainFqcn(baseType, basePackage);
  const isAbstract = !!schema.discriminator || !!schema.abstract || !!schema['x-abstract'] || (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) || (Array.isArray(schema.anyOf) && schema.anyOf.length > 0);

  const subtypeInfos: SubtypeInfo[] = subtypeNames
    .map((subtypeName): SubtypeInfo | undefined => {
      if (schemaName === 'Party') {
         try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Processing subtype ${subtypeName} for Party\n`); } catch (e) {}
      }
      const domainCandidate = schemas[subtypeName] ? stripDtoSuffix(subtypeName) : baseType;
      if (!domainCandidate || ABSTRACT_SCHEMAS.has(domainCandidate)) {
        if (schemaName === 'Party') {
            try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Subtype ${subtypeName} ignored (domainCandidate: ${domainCandidate})\n`); } catch (e) {}
        }
        return undefined;
      }
      if (isAbstract && domainCandidate === baseType) {
        if (schemaName === 'Party') {
            try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Subtype ${subtypeName} ignored (isAbstract and domainCandidate is baseType)\n`); } catch (e) {}
        }
        return undefined;
      }

      const baseMetadata = entityMetadata.get(normalizeEntityKey(baseType) ?? baseType);
      const isCompatible = baseType === domainCandidate || baseMetadata?.childEntities.some(child => normalizeEntityKey(child.name) === normalizeEntityKey(domainCandidate));

      return {
        dtoType: buildDtoFqcn(subtypeName, basePackage),
        domainType: buildDomainFqcn(domainCandidate, basePackage),
        dtoSimpleName: subtypeName,
        domainSimpleName: domainCandidate,
        isCompatible,
      } satisfies SubtypeInfo;
    })
    .filter((info): info is SubtypeInfo => !!info);

  if (schemaName === 'Party') {
      try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Party subtypeInfos length: ${subtypeInfos.length}\n`); } catch (e) {}
  }

  const uniqueSubtypeInfos = Array.from(new Map(subtypeInfos.map(info => [info.domainSimpleName, info])).values());
  const subtypeInfoByName = new Map(uniqueSubtypeInfos.map(info => [normalizeTypeName(info.domainSimpleName)!, info]));

  const variants = Array.from(schemaVariants.get(baseType) ?? []);
  variants.push(schemaName);
  const baseSubtypeEntities = new Set(uniqueSubtypeInfos.map(info => info.domainSimpleName));

  return {
    baseType,
    baseDtoType: baseDtoFqcn,
    baseDomainType: baseDomainFqcn,
    subtypes: uniqueSubtypeInfos,
    isAbstract,
    baseMethodAnnotations: [],
    variants: variants.map(variantName => {
      const normalized = normalizeTypeName(variantName);
      const variantSchema = schemas[variantName];
      const variantSubtypeNames = extractSubtypes(variantSchema) ?? [];
      let variantSubtypeInfos: SubtypeInfo[] = variantSubtypeNames
        .map((subtypeName): SubtypeInfo | undefined => {
          const domainCandidate = schemas[subtypeName] ? stripDtoSuffix(subtypeName) : baseType;
          if (!domainCandidate || ABSTRACT_SCHEMAS.has(domainCandidate)) {
            return undefined;
          }
          if (isAbstract && domainCandidate === baseType) {
            return undefined;
          }

          const baseMetadata = entityMetadata.get(normalizeEntityKey(baseType) ?? baseType);
          const isCompatible = baseType === domainCandidate || baseMetadata?.childEntities.some(child => normalizeEntityKey(child.name) === normalizeEntityKey(domainCandidate));

          return {
            dtoType: buildDtoFqcn(subtypeName, basePackage),
            domainType: buildDomainFqcn(domainCandidate, basePackage),
            dtoSimpleName: subtypeName,
            domainSimpleName: domainCandidate,
            isCompatible,
          } satisfies SubtypeInfo;
        })
        .filter((subtypeInfo): subtypeInfo is SubtypeInfo => !!subtypeInfo);

      if (variantSubtypeInfos.length === 0 && normalized) {
        const normalizedDomain = normalizeTypeName(stripDtoSuffix(variantName));
        const candidate = (normalizedDomain && subtypeInfoByName.get(normalizedDomain)) ?? undefined;
        if (candidate) {
          variantSubtypeInfos = [candidate];
        }
      }

      const resolvedDomainSubtype = resolveVariantDomainSubtype(variantName, variantSubtypeInfos, baseType, subtypeInfoByName);
      const mappingMethodName = `to${variantName}`;

      return {
        dtoType: buildDtoFqcn(variantName, basePackage),
        dtoSimpleName: variantName,
        normalizedName: normalized,
        isBase: normalized === normalizedBase,
        isWrapper: isWrapperVariantSchema(variantName, schemas, baseSubtypeEntities),
        subtypes: variantSubtypeInfos,
        targetDomainType: resolvedDomainSubtype?.domainType ?? baseDomainFqcn,
        targetDomainSimpleName: resolvedDomainSubtype?.domainSimpleName ?? baseType,
        mappingMethodName,
        annotations: [],
      };
    }),
  };
}

/**
 * Generate hybrid mapper architecture:
 * - Dedicated polymorphic helper mappers per abstract family
 * - Entity mappers referencing those helpers via MapStruct uses
 */
export function generateHybridMappers(
  spec: ParsedOpenAPISpec,
  basePackage: string,
  operationDescriptors?: Map<OpenAPIOperation, OperationDescriptor>,
  resolveDomainMetadata?: DomainMetadataResolver,
): {
  helperMappers: PolymorphicHelperMapperContext[];
  entityMappers: EntityMapperContext[];
} {
  try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: generateHybridMappers called\n'); } catch (e) {}
  const schemas = spec.schemas;
  try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: schemas keys: ' + Object.keys(schemas).join(', ') + '\n'); } catch (e) {}
  const polymorphicTypes: PolymorphicTypeMapping[] = [];
  const entityMappersMap = new Map<string, EntityMapperContext>();
  const processedPolyTypes = new Set<string>();
  const variantsByEntity = new Map<string, Set<string>>();
  const schemaVariants = new Map<string, Set<string>>();
  const requestTargetsBySchema = new Map<string, Set<string>>();
  const responseSourcesBySchema = new Map<string, Set<string>>();
  const entityMetadata = collectEntityMetadata(operationDescriptors, resolveDomainMetadata);
  const schemaJsonMetadataCache = new Map<string, SchemaJsonMetadata>();
  const schemaPropertiesCache = new Map<string, SchemaProperties>();
  const polymorphicFactoryFallbacks = new Map<string, PolymorphicFallbackFactoryMetadata>();
  const derivedByBase = collectAllOfDerivedSchemas(schemas);

  const recordUsage = (target: Map<string, Set<string>>, key: string, value: string) => {
    if (!key || !value) {
      return;
    }
    if (!target.has(key)) {
      target.set(key, new Set());
    }
    target.get(key)!.add(value);
  };

  for (const schemaName of Object.keys(schemas)) {
    const base = stripDtoSuffix(schemaName);
    if (!schemaVariants.has(base)) {
      schemaVariants.set(base, new Set());
    }
    schemaVariants.get(base)!.add(schemaName);
  }

  for (const operation of spec.operations) {
    const descriptor = operationDescriptors?.get(operation);
    const requestSchema = operation.requestBodySchema;
    const responseSchema = operation.responseSchema;

    const resourceCandidate =
      descriptor?.matchedEntity?.name ??
      descriptor?.resourceName ??
      (requestSchema ? stripDtoSuffix(requestSchema) : undefined) ??
      (responseSchema ? stripDtoSuffix(responseSchema) : undefined);
    const resourceEntity = resourceCandidate ? singularizeName(normalizeTypeName(resourceCandidate)) : undefined;

    if (resourceEntity) {
      if (requestSchema) {
        recordUsage(requestTargetsBySchema, stripDtoSuffix(requestSchema), resourceEntity);
      }
      if (responseSchema) {
        recordUsage(responseSourcesBySchema, stripDtoSuffix(responseSchema), resourceEntity);
      }
    }

    if (requestSchema) {
      const base = stripDtoSuffix(requestSchema);
      if (!variantsByEntity.has(base)) {
        variantsByEntity.set(base, new Set());
      }
      variantsByEntity.get(base)!.add(requestSchema);
    }

    if (responseSchema) {
      const base = stripDtoSuffix(responseSchema);
      if (!variantsByEntity.has(base)) {
        variantsByEntity.set(base, new Set());
      }
      variantsByEntity.get(base)!.add(responseSchema);
    }
  }

  // Phase 1: Identify all polymorphic types (deduplicate by base type)
  const helperReferencedEntities = new Map<string, Set<string>>();

  const registerHelperReferences = (helperName: string, schemaName: string) => {
    if (!schemas[schemaName]) {
      return;
    }
    if (!helperReferencedEntities.has(helperName)) {
      helperReferencedEntities.set(helperName, new Set());
    }
    collectReferencedEntities(schemas[schemaName], helperReferencedEntities.get(helperName)!, schemas);
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (schemaName === 'Party') {
        try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Processing schema loop for Party\n'); } catch (e) {}
    }
    if (isEnumSchema(schema)) continue;
    if (!isObjectLikeSchema(schema)) continue;

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) continue;

    // Only process each base polymorphic type once (skip DTO/FVO/MVO variants)
    if (isPolymorphic(schema, schemaName) && !processedPolyTypes.has(baseEntity)) {
      if (schemaName === 'Party') {
          try { appendFileSync('/tmp/jhipster-debug.log', 'DEBUG: Party identified as polymorphic\n'); } catch (e) {}
      }
      processedPolyTypes.add(baseEntity);
      const polyMapping = buildPolymorphicMapping(schemaName, schema, basePackage, schemaVariants, schemas, derivedByBase, entityMetadata);
      if (schemaName === 'Party') {
          try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Party polyMapping result: ${polyMapping ? 'not null' : 'null'}\n`); } catch (e) {}
      }
      if (polyMapping) {
        polymorphicTypes.push(polyMapping);
        registerHelperReferences(polyMapping.baseType, schemaName);
        for (const variant of polyMapping.variants) {
          registerHelperReferences(polyMapping.baseType, variant.dtoSimpleName);
        }
        const fallbackVariants = buildFallbackFactoryVariantsFromSchema(schemaName, schema, basePackage, derivedByBase);
        if (fallbackVariants.length > 0) {
          polymorphicFactoryFallbacks.set(polyMapping.baseType, {
            discriminatorProperty: schema?.discriminator?.propertyName,
            variants: fallbackVariants,
          });
        }
      }
    }
  }

  // Phase 2: Create entity mappers for concrete entities

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (schemaName === 'Booking') {
        try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Processing schema loop for Booking\n`); } catch (e) {}
    }
    if (isEnumSchema(schema)) {
        if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking isEnumSchema\n`); } catch (e) {}
        continue;
    }
    if (!isObjectLikeSchema(schema)) {
        if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking !isObjectLikeSchema\n`); } catch (e) {}
        continue;
    }

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) {
        if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking is ABSTRACT_SCHEMAS\n`); } catch (e) {}
        continue;
    }

    // Skip polymorphic base types (handled by helper mappers)
    if (isPolymorphic(schema, schemaName)) {
        if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking isPolymorphic\n`); } catch (e) {}
        continue;
    }

    // Skip DTO variants (FVO, MVO) - only process base entity once
    if (!entityMappersMap.has(baseEntity)) {
      if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking processing entity mapper\n`); } catch (e) {}
      const domainType = buildDomainFqcn(baseEntity, basePackage);

      const requestMappings: EntityMapping[] = [];
      const responseMappings: EntityMapping[] = [];
        const requestSignatures = new Set<string>();
        const responseSignatures = new Set<string>();

        const addRequestMapping = (mapping: EntityMapping) => {
          const signature = `${mapping.sourceType}->${mapping.targetType}`;
          if (requestSignatures.has(signature)) {
            return;
          }
          requestSignatures.add(signature);
          requestMappings.push(mapping);
        };

        const addResponseMapping = (mapping: EntityMapping) => {
          const signature = `${mapping.sourceType}->${mapping.targetType}`;
          if (responseSignatures.has(signature)) {
            return;
          }
          responseSignatures.add(signature);
          responseMappings.push(mapping);
        };

      const normalizedBase = normalizeTypeName(baseEntity);
      const operationVariants = new Set<string>(schemaVariants.get(baseEntity) ?? []);
      operationVariants.add(schemaName);
      const requestTargets = requestTargetsBySchema.get(baseEntity) ?? new Set<string>();
      const responseSources = responseSourcesBySchema.get(baseEntity) ?? new Set<string>();

      const variants = Array.from(operationVariants).sort((a, b) => {
        const normalizedA = normalizeTypeName(a);
        const normalizedB = normalizeTypeName(b);

        const priority = (normalized: string) => {
          if (normalized === normalizedBase) return 0;
          if (normalized.endsWith('FVO')) return 1;
          if (normalized.endsWith('MVO')) return 2;
          if (normalized.endsWith('DTO')) return 3;
          return 4;
        };

        const diff = priority(normalizedA) - priority(normalizedB);
        return diff !== 0 ? diff : normalizedA.localeCompare(normalizedB);
      });

      // const hasFvoVariant = variants.some(variantName => normalizeTypeName(variantName).endsWith('FVO'));
      // const hasMvoVariant = variants.some(variantName => normalizeTypeName(variantName).endsWith('MVO'));
      // const hasRequestSpecificVariant = hasFvoVariant || hasMvoVariant;
      const hasBaseVariant = variants.some(variantName => normalizeTypeName(variantName) === normalizedBase);
      const referencedEntities = new Set<string>();

      for (const variant of variants) {
        collectReferencedEntities(schemas[variant], referencedEntities, schemas);
      }

      for (const variant of variants) {
        const variantDtoType = buildDtoFqcn(variant, basePackage);
        const normalizedVariant = normalizeTypeName(variant);
        const isFVO = normalizedVariant.endsWith('FVO');
        const isBaseVariant = normalizedVariant === normalizedBase;
        const isMVO = normalizedVariant.endsWith('MVO');
        const variantJsonMetadata = collectSchemaJsonMetadata(variant, schemas, schemaJsonMetadataCache);
        const { annotations: requestJsonAnnotations, mappedFields: requestMappedFields } = buildJsonMappingAnnotations(variantJsonMetadata, 'request');
        const { annotations: responseJsonAnnotations, mappedFields: responseMappedFields } = buildJsonMappingAnnotations(variantJsonMetadata, 'response');
        const requestAbstractAnnotations = buildAbstractFieldMappingAnnotations(variant, schemas, schemaPropertiesCache, 'request', requestMappedFields);
        const responseAbstractAnnotations = buildAbstractFieldMappingAnnotations(variant, schemas, schemaPropertiesCache, 'response', responseMappedFields);

        if (isFVO || isMVO || isBaseVariant) {
          const annotations = [
            ...(isFVO ? ['@Mapping(target = "id", ignore = true)'] : []),
            ...requestJsonAnnotations,
            ...requestAbstractAnnotations,
          ];
          const methodName = buildVariantMappingMethodName(baseEntity, variant);
          addRequestMapping({
            methodName,
            sourceType: variantDtoType,
            targetType: domainType,
            annotations,
            sourceSchemaName: variant,
          });
        }

        if (isBaseVariant || (!hasBaseVariant && isFVO)) {
          const responseMethodName = isBaseVariant ? `to${variant}Dto` : `to${variant}`;
          addResponseMapping({
            methodName: responseMethodName,
            sourceType: domainType,
            targetType: variantDtoType,
            annotations: [...responseJsonAnnotations, ...responseAbstractAnnotations],
            targetSchemaName: variant,
          });
        }
      }

      for (const targetEntity of requestTargets) {
        if (targetEntity === baseEntity) {
          continue;
        }
        const sourceType = buildDtoFqcn(baseEntity, basePackage);
        const targetType = buildDomainFqcn(targetEntity, basePackage);
        const methodName = `to${targetEntity}`;
        const alreadyPresent = requestMappings.some(
          mapping => mapping.methodName === methodName && mapping.sourceType === sourceType && mapping.targetType === targetType,
        );
        if (!alreadyPresent) {
          const fallbackAbstractAnnotations = buildAbstractFieldMappingAnnotations(baseEntity, schemas, schemaPropertiesCache, 'request');
          addRequestMapping({
            methodName,
            sourceType,
            targetType,
            annotations: ['@Mapping(target = "id", ignore = true)', ...fallbackAbstractAnnotations],
            sourceSchemaName: baseEntity,
          });
        }
      }

      for (const sourceEntity of responseSources) {
        if (sourceEntity === baseEntity) {
          continue;
        }
        const sourceType = buildDomainFqcn(sourceEntity, basePackage);
        const targetType = buildDtoFqcn(baseEntity, basePackage);
        const methodName = `to${baseEntity}`;
        const alreadyPresent = responseMappings.some(
          mapping => mapping.methodName === methodName && mapping.sourceType === sourceType && mapping.targetType === targetType,
        );
        if (!alreadyPresent) {
          const fallbackAbstractAnnotations = buildAbstractFieldMappingAnnotations(baseEntity, schemas, schemaPropertiesCache, 'response');
          addResponseMapping({
            methodName,
            sourceType,
            targetType,
            annotations: fallbackAbstractAnnotations,
            targetSchemaName: baseEntity,
          });
        }
      }

      if (schemaName === 'Booking') try { appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking setting entityMappersMap. Request mappings: ${requestMappings.length}, Response mappings: ${responseMappings.length}\n`); } catch (e) {}

      entityMappersMap.set(baseEntity, {
        mapperName: `${baseEntity}Mapper`,
        packageName: `${basePackage}.web.api.mapper`,
        entityName: baseEntity,
        referencedEntities: Array.from(referencedEntities),
        usesMappers: [],
        requestMappings,
        responseMappings,
      });
    }
  }

  const helperMappers: PolymorphicHelperMapperContext[] = polymorphicTypes.map(poly => {
    const mapperName = `${poly.baseType}Mapper`;
    const helperPackage = `${basePackage}.web.api.mapper`;
    const subtypeMapperFqcns = new Set<string>();
    const primitiveMapperFqcn = `${helperPackage}.OpenApiPrimitiveMapper`;

    const referencedForHelper = helperReferencedEntities.get(poly.baseType) ?? new Set<string>();
    for (const referencedEntity of referencedForHelper) {
      if (!referencedEntity || referencedEntity === poly.baseType) {
        continue;
      }
      const normalized = normalizeTypeName(referencedEntity);
      if (!normalized) {
        continue;
      }
      if (entityMappersMap.has(normalized)) {
        subtypeMapperFqcns.add(`${helperPackage}.${normalized}Mapper`);
        continue;
      }
      if (polymorphicTypes.some(polyType => polyType.baseType === normalized)) {
        subtypeMapperFqcns.add(`${helperPackage}.${normalized}Mapper`);
        continue;
      }
      if (ABSTRACT_SCHEMAS.has(normalized)) {
        continue;
      }
    }

    subtypeMapperFqcns.add(primitiveMapperFqcn);

    return {
      mapperName,
      packageName: helperPackage,
      baseType: poly.baseType,
      baseDtoType: poly.baseDtoType,
      baseDomainType: poly.baseDomainType,
      subtypes: poly.subtypes,
      variants: poly.variants,
      usesMappers: Array.from(subtypeMapperFqcns).sort(),
      isAbstract: poly.isAbstract,
      baseMethodAnnotations: poly.baseMethodAnnotations,
    } satisfies PolymorphicHelperMapperContext;
  });

  const helperMapperByBaseType = new Map(
    helperMappers.map(helper => [normalizeTypeName(helper.baseType) ?? helper.baseType, `${helper.packageName}.${helper.mapperName}`]),
  );

  for (const helper of helperMappers) {
    const referenced = helperReferencedEntities.get(helper.baseType) ?? new Set<string>();
    const currentUses = new Set(helper.usesMappers ?? []);
    for (const referencedEntity of referenced) {
      const normalized = normalizeTypeName(referencedEntity);
      if (!normalized || normalized === normalizeTypeName(helper.baseType)) {
        continue;
      }
      if (entityMappersMap.has(normalized)) {
        currentUses.add(`${helper.packageName}.${normalized}Mapper`);
        continue;
      }
      const dependencyFqcn = helperMapperByBaseType.get(normalized);
      if (dependencyFqcn) {
        currentUses.add(dependencyFqcn);
      }
    }
    helper.usesMappers = Array.from(currentUses).sort();
  }

  const primitiveMapperFqcn = `${basePackage}.web.api.mapper.OpenApiPrimitiveMapper`;

  const entityMappers = Array.from(entityMappersMap.values()).map(mapper => {
    const usesMapperFqcns = new Set<string>([primitiveMapperFqcn]);

    const collectTransitiveHelperDeps = (entities: string[], visited: Set<string> = new Set()) => {
      for (const entity of entities) {
        if (visited.has(entity)) continue;
        visited.add(entity);

        const normalized = normalizeTypeName(entity) ?? entity;
        const helperDependency = helperMapperByBaseType.get(normalized);
        if (helperDependency) {
          usesMapperFqcns.add(helperDependency);
        } else if (entityMappersMap.has(normalized)) {
          const child = entityMappersMap.get(normalized)!;
          usesMapperFqcns.add(`${child.packageName}.${child.mapperName}`);
        }

        const childMapper = entityMappersMap.get(entity);
        if (childMapper?.referencedEntities) {
          collectTransitiveHelperDeps(childMapper.referencedEntities, visited);
        }
      }
    };

    if (mapper.referencedEntities) {
      collectTransitiveHelperDeps(mapper.referencedEntities);
    }

    for (const referencedEntity of mapper.referencedEntities ?? []) {
      if (referencedEntity === mapper.entityName) {
        continue;
      }
      if (ABSTRACT_SCHEMAS.has(referencedEntity)) {
        continue;
      }
      if (entityMappersMap.has(referencedEntity)) {
        usesMapperFqcns.add(`${mapper.packageName}.${referencedEntity}Mapper`);
      }
      const normalizedReference = normalizeTypeName(referencedEntity) ?? referencedEntity;
      const helperDependency = helperMapperByBaseType.get(normalizedReference);
      if (helperDependency) {
        usesMapperFqcns.add(helperDependency);
      }
    }

    const objectFactories = buildAbstractTargetFactories(
      mapper.requestMappings,
      entityMetadata,
      schemas,
      basePackage,
      polymorphicFactoryFallbacks,
    );

    return {
      ...mapper,
      usesMappers: Array.from(usesMapperFqcns).sort(),
      objectFactories: objectFactories.length > 0 ? objectFactories : undefined,
    } satisfies EntityMapperContext;
  });

  try {
    const bookingInMap = entityMappersMap.has('Booking');
    const bookingInArray = entityMappers.find(m => m.entityName === 'Booking');
    appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Final check in hybrid-mapper-generator. Booking in map: ${bookingInMap}, Booking in array: ${!!bookingInArray}\n`);
    if (bookingInArray) {
         appendFileSync('/tmp/jhipster-debug.log', `DEBUG: Booking mapper details: ${JSON.stringify(bookingInArray)}\n`);
    }
  } catch (e) {}

  return {
    helperMappers,
    entityMappers,
  };
}
