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

import pluralize from 'pluralize';

import { upperFirstCamelCase } from '../../../lib/utils/string.ts';
import { singularize } from '../../type-utils.ts';

import type { OperationDescriptor } from './openapi-entity-matcher.ts';
import {
  buildDomainFqcn,
  buildDtoFqcn,
  extractSchemaRef,
  isEnumSchema,
  normalizeDtoTypeName,
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
  canonicalBaseDtoType?: string;
  baseDomainType: string;
  subtypes: SubtypeInfo[];
  variants: PolymorphicVariantInfo[];
  usesMappers: string[];
  isAbstract?: boolean;
  isCompositionInterface?: boolean;
  baseMethodAnnotations?: string[];
  baseResponseMethodAnnotations?: string[];
  hasDomainDiscriminatorAccessor?: boolean;
  domainDiscriminatorAccessor?: string;
  requestDiscriminatorAccessor?: string;
  preserveReferenceId?: boolean;
  baseGeneratedUuidFields?: GeneratedUuidFieldContext[];
  baseGeneratedDefaultFields?: GeneratedDefaultFieldContext[];
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
  canonicalBaseDtoType?: string;
  baseDomainType: string;
  subtypes: SubtypeInfo[];
  variants: PolymorphicVariantInfo[];
  isAbstract?: boolean;
  isCompositionInterface?: boolean;
  baseMethodAnnotations?: string[];
  baseResponseMethodAnnotations?: string[];
  hasDomainDiscriminatorAccessor?: boolean;
  domainDiscriminatorAccessor?: string;
  requestDiscriminatorAccessor?: string;
}

export interface SubtypeInfo {
  dtoType: string;
  domainType: string;
  dtoSimpleName: string;
  domainSimpleName: string;
  discriminatorValue?: string;
  isCompatible?: boolean;
  usesHelperMapper?: boolean;
  isDtoSubtype?: boolean;
}

export interface PolymorphicVariantInfo {
  dtoType: string;
  dtoSimpleName: string;
  normalizedName: string;
  isBase: boolean;
  isWrapper: boolean;
  isRequestVariant?: boolean;
  isResponseVariant?: boolean;
  usesHelperMapper?: boolean;
  targetDomainType?: string;
  targetDomainSimpleName?: string;
  subtypes: SubtypeInfo[];
  mappingMethodName?: string;
  annotations?: string[];
  responseAnnotations?: string[];
  requiresHelperMapping?: boolean;
  generateObjectFactory?: boolean;
  assignableToBaseDto?: boolean;
  generatedUuidFields?: GeneratedUuidFieldContext[];
  generatedDefaultFields?: GeneratedDefaultFieldContext[];
}

export interface EntityMapping {
  methodName: string;
  sourceType: string;
  targetType: string;
  annotations: string[];
  updateMethodName?: string;
  sourceSchemaName?: string;
  targetSchemaName?: string;
  excludedTargets?: Set<string>;
  collectionFields?: CollectionFieldContext[];
  responseCollectionFields?: CollectionFieldContext[];
  generatedUuidFields?: GeneratedUuidFieldContext[];
  generatedDefaultFields?: GeneratedDefaultFieldContext[];
}

export interface CollectionFieldContext {
  baseEntity: string;
  sourceField: string;
  sourceGetter: string;
  targetField: string;
  targetGetter: string;
  targetSetter: string;
  adderName: string;
  elementDtoType: string;
  elementDtoSimple: string;
  responseCollectionDtoType?: string;
  elementDomainType: string;
  elementDomainSimple: string;
  mapperFqcn: string;
  mapperField: string;
  mapMethod: string;
  updateMethod: string;
  useInlineElementMapping?: boolean;
  inlineMapMethod?: string;
  inlineUpdateMethod?: string;
  responseListMapMethod?: string;
  responseMapMethod?: string;
  inlineMappingAnnotations?: string[];
  hasId: boolean;
  preserveNewItemId?: boolean;
  referencedEntity?: string;
  keyExpressions?: string[];
  existingKeyExpressions?: string[];
  incomingKeyExpressions?: string[];
}

export interface GeneratedUuidFieldContext {
  fieldName: string;
  accessor: string;
}

export interface GeneratedDefaultFieldContext {
  fieldName: string;
  accessor: string;
  valueExpression: string;
  presenceAccessor?: string;
}

type DefaultFieldCandidate = {
  rawFieldName: string;
  fieldName: string;
  field?: any;
  schema?: any;
};

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

interface AbstractFieldMappingResult {
  annotations: string[];
  abstractTargets: Set<string>;
}

let derivedSchemasCache: Map<string, Set<string>> | undefined;
let derivedAncestorsCache: Map<string, Set<string>> | undefined;
let domainAncestorsCache: Map<string, Set<string>> | undefined;

type DomainMetadataResolver = (entityName: string) => Partial<EntityMetadata> | undefined;

/**
 * Schemas that don't have corresponding domain entities
 */
const ABSTRACT_SCHEMAS = new Set<string>();

/**
 * Check if schema is polymorphic
 */
function isPolymorphic(schema: any, schemaName?: string): boolean {
  if (!schema) return false;

  const hasOneOf = Array.isArray(schema.oneOf) && schema.oneOf.length > 0;
  if (hasOneOf) {
    return true;
  }

  const discriminator = schema.discriminator;
  if (!discriminator) {
    return false;
  }

  const mapping = discriminator.mapping;
  if (!mapping || Object.keys(mapping).length === 0) {
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
  return result;
}

function singularizeName(value: string): string {
  return value ? pluralize.singular(value) : value;
}

function pluralizeName(value: string): string {
  return value ? pluralize(value) : value;
}

function isReferenceLikeName(name?: string): boolean {
  if (!name) {
    return false;
  }
  return /(Ref(?:Or|$)|Reference|Relationship|OrValue)(?:$|[A-Z])/i.test(name);
}

function isCycleSafeReferenceLikeCollectionTarget(name?: string): boolean {
  if (!name) {
    return false;
  }
  const normalized = normalizeTypeName(name);
  const isSafeName = (value: string) => /(?:Ref(?:Or|$)|Reference(?:$|[A-Z])|Relationship(?:$|[A-Z]))/i.test(value) && !/OrValue/i.test(value);
  if (isSafeName(name)) {
    return true;
  }
  const ancestors = normalized ? derivedAncestorsCache?.get(normalized) : undefined;
  return Boolean(ancestors && Array.from(ancestors).some(isSafeName));
}

function buildVariantMappingMethodName(baseType: string, _variantSimpleName: string): string {
  return `to${baseType}Entity`;
}

function normalizeInlineSchemaTypeName(value: string): string | undefined {
  const tokens = String(value).match(/[A-Za-z0-9]+/g);
  if (!tokens?.length) {
    return normalizeTypeName(value);
  }
  return tokens
    .map(token => (/^[A-Z0-9]{2,}$/.test(token) ? token : upperFirstCamelCase(token)))
    .join('');
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
          return normalizeInlineSchemaTypeName(candidate as string);
        }
      }
      return undefined;
    })
    .filter((name: string | undefined): name is string => !!name)
    .filter((name: string) => name && name !== 'null');

  if (schema?.discriminator?.mapping) {
    for (const mappingTarget of Object.values<string>(schema.discriminator.mapping)) {
      if (!mappingTarget) {
        continue;
      }
      const refName = mappingTarget.includes('/') ? mappingTarget.split('/').pop() : mappingTarget;
      if (refName && refName !== 'null') {
        subtypeNames.push(refName);
      }
    }
  }

  return Array.from(new Set(subtypeNames));
}

function collectCompositeSubtypeNames(schema: any): Set<string> {
  const names = new Set<string>();
  const register = (fragments?: any[]) => {
    if (!Array.isArray(fragments)) {
      return;
    }
    for (const fragment of fragments) {
      const refName = extractSchemaRef(fragment);
      const normalized = normalizeTypeName(stripDtoSuffix(refName ?? ''));
      if (normalized) {
        names.add(normalized);
      }
    }
  };

  register(schema?.oneOf);
  register(schema?.anyOf);

  return names;
}

function isObjectLikeSchema(schema: any): boolean {
  if (!schema) return false;
  if (schema.type === 'object') return true;
  if (schema.allOf || schema.oneOf || schema.anyOf) return true;
  if (schema.properties && Object.keys(schema.properties).length > 0) return true;
  return false;
}

function shouldTreatDerivedOnlyBaseAsPolymorphic(schemaName: string, schema: any, derivedByBase: Map<string, Set<string>>): boolean {
  const baseEntity = stripDtoSuffix(schemaName);
  if (resolveDerivedSchemas(baseEntity, derivedByBase).size === 0) {
    return false;
  }
  return Boolean(schema?.abstract || schema?.['x-abstract'] || isReferenceLikeName(baseEntity));
}

function isSchemaComposition(schema: any): boolean {
  return Array.isArray(schema?.allOf) || Array.isArray(schema?.oneOf) || Array.isArray(schema?.anyOf);
}

function hasSchemaObjectProperties(schema: any): boolean {
  return Boolean(schema?.properties && Object.keys(schema.properties).length > 0);
}

function isOpenApiAliasModelSchema(schema: any): boolean {
  if (!schema) {
    return false;
  }
  if (schema.type === 'array') {
    return true;
  }
  return Boolean(schema.additionalProperties && !hasSchemaObjectProperties(schema) && !isSchemaComposition(schema));
}

function isEmptyObjectMarkerSchema(schema: any): boolean {
  if (!schema || schema.type !== 'object') {
    return false;
  }
  if (hasSchemaObjectProperties(schema) || isSchemaComposition(schema)) {
    return false;
  }
  if (schema.discriminator || schema.additionalProperties) {
    return false;
  }
  return !Array.isArray(schema.required) || schema.required.length === 0;
}

function isGeneratedDtoModelSchema(schema: any): boolean {
  return isObjectLikeSchema(schema) && !isOpenApiAliasModelSchema(schema) && !isEmptyObjectMarkerSchema(schema);
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

function isSubtypeInstantiationCompatible(
  baseType: string,
  domainCandidate: string | undefined,
  metadata?: EntityMetadata,
): boolean {
  if (!domainCandidate) {
    return false;
  }
  if (baseType === domainCandidate) {
    return true;
  }

  const normalizedCandidate = normalizeEntityKey(domainCandidate);
  if (!normalizedCandidate) {
    return false;
  }

  const matchedChild = metadata?.childEntities?.find(
    child => normalizeEntityKey(child.name) === normalizedCandidate,
  );
  if (matchedChild) {
    return !matchedChild.abstract;
  }

  // If we know the base entity metadata but can't match the candidate to a declared child,
  // avoid assuming inheritance to prevent mapping siblings to each other.
  if (metadata) {
    return false;
  }

  // When no metadata is available (common for imported specs), optimistically allow instantiation
  // so MapStruct can create concrete subtypes instead of returning null factories.
  return true;
}

function isDomainAssignableToBase(
  baseType: string,
  domainCandidate: string | undefined,
  entityDefinitions?: Map<string, any>,
): boolean | undefined {
  if (!domainCandidate) {
    return false;
  }
  const normalizedBase = normalizeEntityKey(baseType);
  const normalizedCandidate = normalizeEntityKey(domainCandidate);
  if (!normalizedBase || !normalizedCandidate) {
    return false;
  }
  if (normalizedBase === normalizedCandidate) {
    return true;
  }
  if (!entityDefinitions || entityDefinitions.size === 0) {
    return undefined;
  }
  if (!resolveEntityDefinition(normalizedBase, entityDefinitions) || !resolveEntityDefinition(normalizedCandidate, entityDefinitions)) {
    return undefined;
  }

  const ancestors =
    domainAncestorsCache?.get(normalizedCandidate) ?? resolveDomainAncestors(normalizedCandidate, entityDefinitions, domainAncestorsCache ?? new Map());
  return ancestors.has(normalizedBase);
}

function collectAllOfDerivedSchemas(schemas: Record<string, any>): Map<string, Set<string>> {
  const derivedByBase = new Map<string, Set<string>>();
  const normalizedToOriginal = new Map<string, Set<string>>();
  const compositeRefsByBase = new Map<string, Set<string>>();

  const register = (baseName?: string, derivedName?: string) => {
    if (!baseName || !derivedName) {
      return;
    }
    const normalizedBase = normalizeTypeName(stripDtoSuffix(baseName));
    if (!normalizedBase) {
      return;
    }
    if (!normalizedToOriginal.has(normalizedBase)) {
      normalizedToOriginal.set(normalizedBase, new Set());
    }
    normalizedToOriginal.get(normalizedBase)!.add(baseName);
    if (!derivedByBase.has(normalizedBase)) {
      derivedByBase.set(normalizedBase, new Set());
    }
    derivedByBase.get(normalizedBase)!.add(derivedName);
  };

  const registerCompositeRefs = (base: string, refs?: any[]) => {
    if (!Array.isArray(refs)) {
      return;
    }
    for (const fragment of refs) {
      const refName = extractSchemaRef(fragment);
      if (!refName) {
        continue;
      }
      register(base, refName);
      const baseKey = normalizeTypeName(stripDtoSuffix(base));
      const refKey = normalizeTypeName(stripDtoSuffix(refName));
      if (!baseKey || !refKey) {
        continue;
      }
      if (!compositeRefsByBase.has(baseKey)) {
        compositeRefsByBase.set(baseKey, new Set());
      }
      compositeRefsByBase.get(baseKey)!.add(refKey);
    }
  };

  const registerDiscriminatorMappings = (base: string, mapping?: Record<string, string>) => {
    if (!mapping) {
      return;
    }
    const baseKey = normalizeTypeName(stripDtoSuffix(base));
    const allowedRefs = baseKey ? compositeRefsByBase.get(baseKey) : undefined;
    for (const target of Object.values(mapping)) {
      if (!target) {
        continue;
      }
      const refName = target.includes('/') ? target.split('/').pop() : target;
      const targetKey = normalizeTypeName(stripDtoSuffix(refName ?? ''));
      if (allowedRefs && targetKey && !allowedRefs.has(targetKey)) {
        continue;
      }
      register(base, refName);
    }
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (Array.isArray(schema?.allOf)) {
      for (const fragment of schema.allOf) {
        const refName = extractSchemaRef(fragment);
        if (!refName) {
          continue;
        }
        register(refName, schemaName);
      }
    }

    registerCompositeRefs(schemaName, schema?.oneOf);
    registerCompositeRefs(schemaName, schema?.anyOf);
    registerDiscriminatorMappings(schemaName, schema?.discriminator?.mapping);
  }

  // Ensure normalized base names also register the variants of the same stripped name
  for (const [normalizedBase, originalNames] of normalizedToOriginal.entries()) {
    const derivedSet = derivedByBase.get(normalizedBase);
    if (!derivedSet) {
      continue;
    }
    for (const original of originalNames) {
      const normalizedOriginal = stripDtoSuffix(original);
      if (normalizedOriginal && normalizedOriginal !== normalizedBase) {
        if (!derivedByBase.has(normalizedOriginal)) {
          derivedByBase.set(normalizedOriginal, new Set(derivedSet));
        } else {
          derivedSet.forEach(value => derivedByBase.get(normalizedOriginal)!.add(value));
        }
      }
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

function resolveDerivedAncestors(
  derivedType: string,
  derivedByBase: Map<string, Set<string>>,
  ancestorCache: Map<string, Set<string>>,
  visiting: Set<string> = new Set(),
): Set<string> {
  const normalizedDerived = normalizeTypeName(stripDtoSuffix(derivedType));
  if (!normalizedDerived) {
    return new Set();
  }
  if (ancestorCache.has(normalizedDerived)) {
    return ancestorCache.get(normalizedDerived)!;
  }

  if (visiting.has(normalizedDerived)) {
    return new Set();
  }

  visiting.add(normalizedDerived);

  const ancestors = new Set<string>();
  for (const [base, derivedSet] of derivedByBase.entries()) {
    if (!derivedSet) {
      continue;
    }
    if (derivedSet.has(derivedType) || derivedSet.has(normalizedDerived)) {
      ancestors.add(base);
      const ancestorAncestors = resolveDerivedAncestors(base, derivedByBase, ancestorCache, visiting);
      ancestorAncestors.forEach(a => ancestors.add(a));
    }
  }

  visiting.delete(normalizedDerived);
  ancestorCache.set(normalizedDerived, ancestors);
  return ancestors;
}

function resolveDomainAncestors(
  entityName: string,
  entityDefinitions: Map<string, any>,
  cache: Map<string, Set<string>>,
  visiting: Set<string> = new Set(),
): Set<string> {
  const normalized = normalizeEntityKey(entityName) ?? entityName;
  if (!normalized) {
    return new Set();
  }
  if (cache.has(normalized)) {
    return cache.get(normalized)!;
  }
  if (visiting.has(normalized)) {
    return new Set();
  }
  visiting.add(normalized);

  const ancestors = new Set<string>();
  const definition = entityDefinitions.get(normalized);
  const baseName = definition?.extends;
  const normalizedBase = normalizeEntityKey(baseName);
  if (normalizedBase) {
    ancestors.add(normalizedBase);
    const baseAncestors = resolveDomainAncestors(normalizedBase, entityDefinitions, cache, visiting);
    baseAncestors.forEach(ancestor => ancestors.add(ancestor));
  }

  visiting.delete(normalized);
  cache.set(normalized, ancestors);
  return ancestors;
}

function resolveEntityDefinition(entityName: string | undefined, entityDefinitions?: Map<string, any>): any | undefined {
  if (!entityName || !entityDefinitions) {
    return undefined;
  }
  return (
    entityDefinitions.get(entityName) ??
    entityDefinitions.get(normalizeTypeName(entityName) ?? '') ??
    entityDefinitions.get(normalizeEntityKey(entityName) ?? '') ??
    entityDefinitions.get(stripDtoSuffix(entityName))
  );
}

function collectEntityDefinitionFields(entityName: string | undefined, entityDefinitions?: Map<string, any>): any[] {
  const fields = new Map<string, any>();
  const visiting = new Set<string>();
  let currentName = entityName;
  while (currentName) {
    const normalized = normalizeTypeName(currentName) ?? currentName;
    if (visiting.has(normalized)) {
      break;
    }
    visiting.add(normalized);
    const definition = resolveEntityDefinition(currentName, entityDefinitions);
    if (!definition) {
      break;
    }
    for (const field of definition.fields ?? []) {
      const fieldName = field?.fieldName ?? field?.name;
      if (fieldName && !fields.has(toJHipsterPropertyName(fieldName))) {
        fields.set(toJHipsterPropertyName(fieldName), field);
      }
    }
    currentName = definition.extends;
  }
  return Array.from(fields.values());
}

function resolveEntitySimpleName(entityName: string | undefined, entityDefinitions?: Map<string, any>): string | undefined {
  if (!entityName) {
    return undefined;
  }
  const normalized = normalizeTypeName(entityName);
  if (!entityDefinitions) {
    return normalized;
  }
  const definition = resolveEntityDefinition(entityName, entityDefinitions);
  if (!definition) {
    return undefined;
  }
  return normalizeTypeName(definition.entityClass ?? definition.name ?? definition.entityNameCapitalized ?? entityName);
}

function resolveOperationResourceEntity(resourceCandidate: string | undefined, entityDefinitions?: Map<string, any>): string | undefined {
  if (!resourceCandidate) {
    return undefined;
  }

  const stripped = stripDtoSuffix(resourceCandidate);
  const normalized = normalizeTypeName(stripped);
  const candidates = [
    stripped,
    normalized,
    normalized ? pluralizeName(normalized) : undefined,
    normalized ? singularizeName(normalized) : undefined,
  ];

  for (const candidate of candidates) {
    const resolved = resolveEntitySimpleName(candidate, entityDefinitions);
    if (resolved) {
      return resolved;
    }
  }

  return normalized ? singularizeName(normalized) : undefined;
}

function collectDomainPropertyNames(
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  cache: Map<string, Set<string>>,
  visiting = new Set<string>(),
): Set<string> {
  const normalized = normalizeTypeName(entityName ?? '') ?? entityName;
  if (!normalized || !entityDefinitions) {
    return new Set();
  }
  if (cache.has(normalized)) {
    return cache.get(normalized)!;
  }
  if (visiting.has(normalized)) {
    return new Set();
  }
  visiting.add(normalized);

  const properties = new Set<string>(['id']);
  const definition = resolveEntityDefinition(normalized, entityDefinitions);
  for (const field of definition?.fields ?? []) {
    const fieldName = field?.fieldName ?? field?.name;
    if (fieldName) {
      properties.add(toJHipsterPropertyName(fieldName));
    }
  }
  for (const relationship of definition?.relationships ?? []) {
    const relationshipName = relationship?.relationshipName ?? relationship?.fieldName;
    if (relationshipName) {
      const mapStructPropertyName = relationshipMapStructPropertyName(relationship);
      properties.add(mapStructPropertyName ?? toJHipsterPropertyName(relationshipName));
    }
  }

  const parent = definition?.extends;
  if (parent) {
    const parentProperties = collectDomainPropertyNames(parent, entityDefinitions, cache, visiting);
    parentProperties.forEach(property => properties.add(property));
  }

  visiting.delete(normalized);
  cache.set(normalized, properties);
  return properties;
}

function collectDomainFieldTypes(
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  cache: Map<string, Map<string, string>>,
  visiting = new Set<string>(),
): Map<string, string> {
  const normalized = normalizeTypeName(entityName ?? '') ?? entityName;
  if (!normalized || !entityDefinitions) {
    return new Map();
  }
  if (cache.has(normalized)) {
    return cache.get(normalized)!;
  }
  if (visiting.has(normalized)) {
    return new Map();
  }
  visiting.add(normalized);

  const fields = new Map<string, string>();
  const definition = resolveEntityDefinition(normalized, entityDefinitions);
  for (const field of definition?.fields ?? []) {
    const fieldName = field?.fieldName ?? field?.name;
    const fieldType = field?.fieldType ?? field?.type;
    if (fieldName && fieldType) {
      fields.set(toJHipsterPropertyName(fieldName), String(fieldType));
    }
  }

  const parent = definition?.extends;
  if (parent) {
    const parentFields = collectDomainFieldTypes(parent, entityDefinitions, cache, visiting);
    parentFields.forEach((value, key) => {
      if (!fields.has(key)) {
        fields.set(key, value);
      }
    });
  }

  visiting.delete(normalized);
  cache.set(normalized, fields);
  return fields;
}

function isScalarDomainFieldType(fieldType: string | undefined): boolean {
  if (!fieldType) {
    return false;
  }
  return new Set([
    'anyblob',
    'bigdecimal',
    'blob',
    'boolean',
    'double',
    'duration',
    'float',
    'instant',
    'integer',
    'localdate',
    'long',
    'string',
    'textblob',
    'uuid',
    'zoneddatetime',
  ]).has(fieldType.toLowerCase());
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

function resolveDiscriminatorValue(metadata: EntityMetadata | undefined, entityName: string | undefined): string | undefined {
  const normalizedEntityName = normalizeEntityKey(entityName);
  if (!metadata || !normalizedEntityName) {
    return undefined;
  }
  const child = metadata.childEntities?.find(candidate => normalizeEntityKey(candidate.name) === normalizedEntityName);
  if (child?.discriminatorValue) {
    return child.discriminatorValue;
  }
  for (const [discriminatorValue, targetEntityName] of Object.entries(metadata.discriminatorValues ?? {})) {
    if (normalizeEntityKey(targetEntityName) === normalizedEntityName) {
      return discriminatorValue;
    }
  }
  return undefined;
}

function buildEntityMetadataFromDescriptor(entity: any): Partial<EntityMetadata> | undefined {
  if (!entity) {
    return undefined;
  }
  const childEntities: EntityMetadata['childEntities'] = [];
  const discriminatorValues: Record<string, string> = {};

  const registerChildEntity = (name?: string, discriminatorValue?: string, abstractFlag?: boolean) => {
    const normalized = normalizeEntityKey(name ?? discriminatorValue);
    if (!normalized) {
      return;
    }
    const existing = childEntities.find(child => normalizeEntityKey(child.name) === normalized);
    if (existing) {
      existing.discriminatorValue = existing.discriminatorValue ?? discriminatorValue;
      if (abstractFlag !== undefined) {
        existing.abstract = abstractFlag;
      }
      return;
    }
    childEntities.push({
      name: normalized,
      discriminatorValue,
      abstract: abstractFlag,
    });
  };

  if (Array.isArray(entity.childEntities)) {
    for (const child of entity.childEntities) {
      const normalized = normalizeEntityKey(child?.name ?? child?.entityClass ?? child?.entityNameCapitalized);
      if (!normalized) {
        continue;
      }
      registerChildEntity(normalized, child?.discriminatorValue, child?.abstractClass ?? child?.abstract);
    }
  }

  const looksLikeEntityName = (value?: string) => !!value && /^[A-Z][A-Za-z0-9_]*$/.test(stripDtoSuffix(value));
  const knownChildNames = () => new Set(childEntities.map(child => normalizeEntityKey(child.name)).filter((name): name is string => !!name));

  const registerDiscriminatorMapping = (left?: string, right?: string, abstractFlag?: boolean) => {
    const leftValue = left?.trim();
    const rightValue = right?.trim() ?? leftValue;
    if (!leftValue || !rightValue) {
      return;
    }
    const childNames = knownChildNames();
    const normalizedLeft = normalizeEntityKey(leftValue);
    const normalizedRight = normalizeEntityKey(rightValue);
    let discriminatorValue = leftValue;
    let targetName = rightValue;

    if (normalizedLeft && childNames.has(normalizedLeft) && (!normalizedRight || !childNames.has(normalizedRight))) {
      discriminatorValue = rightValue;
      targetName = leftValue;
    } else if (normalizedRight && childNames.has(normalizedRight)) {
      discriminatorValue = leftValue;
      targetName = rightValue;
    } else if (looksLikeEntityName(leftValue) && !looksLikeEntityName(rightValue)) {
      discriminatorValue = rightValue;
      targetName = leftValue;
    } else if (looksLikeEntityName(rightValue) && !looksLikeEntityName(leftValue)) {
      discriminatorValue = leftValue;
      targetName = rightValue;
    }

    const normalizedTarget = normalizeEntityKey(targetName);
    if (!normalizedTarget) {
      return;
    }
    discriminatorValues[discriminatorValue] = normalizedTarget;
    registerChildEntity(normalizedTarget, discriminatorValue, abstractFlag);
  };

  const discriminatorConfig = entity.annotations?.discriminator?.values ?? entity.discriminatorColumn?.values;
  if (typeof discriminatorConfig === 'string') {
    const mappings = discriminatorConfig.split(',').map(part => part.trim()).filter(Boolean);
    for (const mapping of mappings) {
      const [value, target] = mapping.split('->').map(entry => entry?.trim()).filter(Boolean);
      registerDiscriminatorMapping(value ?? mapping, target);
    }
  } else if (Array.isArray(discriminatorConfig)) {
    for (const entry of discriminatorConfig) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        registerDiscriminatorMapping(entry, entry);
      } else if (typeof entry === 'object') {
        registerDiscriminatorMapping(entry.value ?? entry.name ?? entry.entity, entry.entity ?? entry.name ?? entry.value, entry.abstract);
      }
    }
  } else if (discriminatorConfig && typeof discriminatorConfig === 'object') {
    for (const [value, target] of Object.entries(discriminatorConfig)) {
      if (typeof target === 'string') {
        registerDiscriminatorMapping(value, target);
      } else if (target && typeof target === 'object') {
        registerDiscriminatorMapping(value, (target as any).entity ?? (target as any).name ?? value);
      } else {
        registerDiscriminatorMapping(value, value);
      }
    }
  }

  const annotationsAbstract = entity.annotations?.abstract;
  const metadata: Partial<EntityMetadata> = {
    isAbstract: Boolean(entity.abstractClass ?? entity.abstract ?? annotationsAbstract ?? entity.polymorphicRoot),
    discriminatorProperty:
      entity.discriminator?.property ??
      entity.discriminatorProperty ??
      entity.annotations?.discriminator?.property ??
      entity.annotations?.discriminator?.column ??
      entity.discriminatorColumn?.property ??
      entity.discriminatorColumn?.column,
    childEntities,
  };

  if (Object.keys(discriminatorValues).length > 0) {
    metadata.discriminatorValues = discriminatorValues;
  } else if (entity.discriminatorColumn?.values) {
    metadata.discriminatorValues = entity.discriminatorColumn.values;
  }

  return metadata satisfies Partial<EntityMetadata>;
}

function collectEntityMetadata(
  operationDescriptors?: Map<OpenAPIOperation, OperationDescriptor>,
  resolveDomainMetadata?: DomainMetadataResolver,
  entityDefinitions?: Map<string, any>,
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

  if (entityDefinitions) {
    for (const [entityName, definition] of entityDefinitions.entries()) {
      register({ name: entityName, entity: definition });
      const childKey = normalizeEntityKey(entityName);
      const baseExtends = normalizeEntityKey(definition?.extends);
      if (childKey && baseExtends && childKey !== baseExtends) {
        const childMetadata = metadataByName.get(childKey);
        const childAbstract =
          childMetadata?.isAbstract ??
          Boolean(definition.abstractClass ?? definition.abstract ?? definition.annotations?.abstract ?? definition.polymorphicRoot);
        const current = metadataByName.get(baseExtends) ?? { childEntities: [] };
        metadataByName.set(
          baseExtends,
          mergeEntityMetadata(current, {
            childEntities: [
              {
                name: childKey,
                abstract: childAbstract,
              },
            ],
          }),
        );
      }
    }
  }

  if (resolveDomainMetadata) {
    for (const [entityName, metadata] of metadataByName.entries()) {
      mergeEntityMetadata(metadata, resolveDomainMetadata(entityName));
    }
  }

  return metadataByName;
}

type JsonConversionKind = 'map' | 'list' | 'any';

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
  propertyCache?: Map<string, SchemaProperties>,
): SchemaJsonMetadata {
  if (cache.has(schemaName)) {
    return cache.get(schemaName)!;
  }
  const schema = schemas[schemaName];
  const info: SchemaJsonMetadata = { fields: new Map() };
  const properties: Record<string, any> =
    (propertyCache ? collectSchemaProperties(schemaName, schemas, propertyCache) : schema?.properties) ?? {};

  for (const [fieldName, propertySchema] of Object.entries<any>(properties)) {
    if (isUntypedJsonValueSchema(propertySchema)) {
      info.fields.set(fieldName, { kind: 'any', usesJsonNullable: true });
      continue;
    }
    const resolvedSchema = resolveSchema(propertySchema, schemas) ?? propertySchema;
    let kind = detectJsonFieldKind(propertySchema, schemas);
    if (!kind && isUntypedJsonValueSchema(propertySchema)) {
      kind = 'any';
    }
    if (kind) {
      const usesJsonNullable = Boolean(resolvedSchema?.nullable ?? propertySchema?.nullable);
      info.fields.set(fieldName, { kind, usesJsonNullable });
    }
  }
  cache.set(schemaName, info);
  return info;
}

function detectJsonFieldKind(
  propertySchema: any,
  schemas: Record<string, any>,
  visiting = new Set<string>(),
): JsonConversionKind | undefined {
  if (!propertySchema) {
    return undefined;
  }
  const refName = extractSchemaRef(propertySchema);
  if (refName) {
    if (visiting.has(refName)) {
      return undefined;
    }
    visiting.add(refName);
    const result = detectJsonFieldKind(schemas[refName], schemas, visiting);
    visiting.delete(refName);
    return result;
  }
  const composedKinds = ['allOf', 'oneOf', 'anyOf']
    .flatMap(key => (Array.isArray(propertySchema[key]) ? propertySchema[key] : []))
    .map(fragment => detectJsonFieldKind(fragment, schemas, visiting))
    .filter((kind): kind is JsonConversionKind => Boolean(kind));
  if (composedKinds.includes('list')) {
    return 'list';
  }
  if (composedKinds.includes('map')) {
    return 'map';
  }
  if (composedKinds.includes('any')) {
    return 'any';
  }
  const schemaKeys = Object.keys(propertySchema);
  const hasTypeShape = schemaKeys.some(key =>
    ['$ref', 'type', 'properties', 'additionalProperties', 'allOf', 'oneOf', 'anyOf', 'enum', 'const', 'format', 'discriminator'].includes(key),
  );
  if (!hasTypeShape) {
    return 'any';
  }
  if (propertySchema.type === 'array') {
    return 'list';
  }

  if (propertySchema.additionalProperties) {
    return 'map';
  }

  if (propertySchema.type === 'object') {
    const hasProps = propertySchema.properties && Object.keys(propertySchema.properties).length > 0;
    const hasComposites = propertySchema.allOf || propertySchema.oneOf || propertySchema.anyOf;

    if (!hasProps && !hasComposites) {
      return 'any';
    }
  }

  return undefined;
}

function isUntypedJsonValueSchema(propertySchema: any): boolean {
  if (!propertySchema) {
    return false;
  }
  return !Object.keys(propertySchema).some(key =>
    ['$ref', 'type', 'properties', 'additionalProperties', 'allOf', 'oneOf', 'anyOf', 'enum', 'const', 'format', 'discriminator'].includes(key),
  );
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

function upperFirstPreservingAcronym(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isUppercaseAsciiLetter(value: string): boolean {
  return value >= 'A' && value <= 'Z';
}

function decapitalizeJavaBeanProperty(methodSuffix: string): string {
  if (!methodSuffix) {
    return methodSuffix;
  }
  if (methodSuffix.length > 1 && isUppercaseAsciiLetter(methodSuffix[0]) && isUppercaseAsciiLetter(methodSuffix[1])) {
    return methodSuffix;
  }
  return lowerFirst(methodSuffix);
}

function toJavaSafeOpenApiPropertyName(fieldName: string): string {
  if (!fieldName) {
    return fieldName;
  }
  if (fieldName.startsWith('@') && fieldName.length > 1) {
    return `at${upperFirstPreservingAcronym(fieldName.slice(1))}`;
  }
  return fieldName;
}

function toOpenApiPropertyName(fieldName: string): string {
  fieldName = toJavaSafeOpenApiPropertyName(fieldName);
  if (!fieldName) {
    return fieldName;
  }
  if (/^[A-Z]+$/.test(fieldName)) {
    return fieldName;
  }
  if (/^[A-Z]{2,}/.test(fieldName)) {
    return fieldName.slice(0, 2).toLowerCase() + fieldName.slice(2);
  }
  return lowerFirst(fieldName);
}

function toJHipsterPropertyName(fieldName: string): string {
  fieldName = toJavaSafeOpenApiPropertyName(fieldName);
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

function isCollectionRelationship(relationship: any): boolean {
  if (relationship?.collection !== undefined) {
    if (typeof relationship.collection === 'boolean') {
      return relationship.collection;
    }
    return String(relationship.collection).toLowerCase() === 'true';
  }
  const relationshipType = String(relationship?.relationshipType ?? '').toLowerCase();
  return relationshipType === 'one-to-many' || relationshipType === 'many-to-many';
}

function relationshipMapStructPropertyName(relationship: any): string | undefined {
  const relationshipName = relationship?.relationshipName ?? relationship?.fieldName;
  if (!relationshipName) {
    return undefined;
  }
  const collection = isCollectionRelationship(relationship);
  const fallbackFieldName = collection ? pluralizeName(toJHipsterPropertyName(relationshipName)) : toJHipsterPropertyName(relationshipName);
  const relationshipFieldName =
    relationship?.propertyName ??
    (collection ? relationship?.relationshipFieldNamePlural : relationship?.relationshipFieldName) ??
    fallbackFieldName;
  const accessorSuffix =
    (collection ? relationship?.relationshipNameCapitalizedPlural : relationship?.relationshipNameCapitalized) ??
    upperFirstPreservingAcronym(relationshipFieldName);
  return decapitalizeJavaBeanProperty(accessorSuffix);
}

function collectDomainMapStructPropertyNames(
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  cache: Map<string, Map<string, string>>,
  visiting = new Set<string>(),
): Map<string, string> {
  const normalized = normalizeTypeName(entityName ?? '') ?? entityName;
  if (!normalized || !entityDefinitions) {
    return new Map();
  }
  if (cache.has(normalized)) {
    return cache.get(normalized)!;
  }
  if (visiting.has(normalized)) {
    return new Map();
  }
  visiting.add(normalized);

  const properties = new Map<string, string>([['id', 'id']]);
  const definition = resolveEntityDefinition(normalized, entityDefinitions);
  for (const field of definition?.fields ?? []) {
    const fieldName = field?.fieldName ?? field?.name;
    if (fieldName) {
      const propertyName = toJHipsterPropertyName(fieldName);
      properties.set(propertyName, propertyName);
    }
  }
  for (const relationship of definition?.relationships ?? []) {
    const relationshipName = relationship?.relationshipName ?? relationship?.fieldName;
    if (relationshipName) {
      const collection = isCollectionRelationship(relationship);
      const propertyName = toJHipsterPropertyName(
        relationship?.propertyName ??
          (collection ? relationship?.relationshipFieldNamePlural : relationship?.relationshipFieldName) ??
          relationshipName,
      );
      const mapStructPropertyName = relationshipMapStructPropertyName(relationship) ?? propertyName;
      properties.set(propertyName, mapStructPropertyName);
      properties.set(mapStructPropertyName, mapStructPropertyName);
    }
  }

  const parent = definition?.extends;
  if (parent) {
    const parentProperties = collectDomainMapStructPropertyNames(parent, entityDefinitions, cache, visiting);
    parentProperties.forEach((mapStructProperty, propertyName) => properties.set(propertyName, mapStructProperty));
  }

  visiting.delete(normalized);
  cache.set(normalized, properties);
  return properties;
}

function buildJsonMappingAnnotations(
  metadata: SchemaJsonMetadata | undefined,
  direction: 'request' | 'response',
  domainEntityName?: string,
  entityDefinitions?: Map<string, any>,
  domainFieldTypeCache: Map<string, Map<string, string>> = new Map(),
): { annotations: string[], mappedFields: Set<string> } {
  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  if (!metadata) {
    return { annotations, mappedFields };
  }
  const domainFieldTypes = collectDomainFieldTypes(domainEntityName, entityDefinitions, domainFieldTypeCache);
  for (const [field, metadataEntry] of metadata.fields) {
    const { kind, usesJsonNullable } = metadataEntry;
    const dtoField = toOpenApiPropertyName(field);
    const domainField = toJHipsterPropertyName(field);
    if (domainEntityName && entityDefinitions && !isScalarDomainFieldType(domainFieldTypes.get(domainField))) {
      continue;
    }
    const targetField = direction === 'request' ? domainField : dtoField;
    const sourceField = direction === 'request' ? dtoField : domainField;
    
    mappedFields.add(targetField);

    const qualifierForKind = (jsonKind: JsonConversionKind, nullable: boolean, dir: 'request' | 'response') => {
      if (jsonKind === 'map') {
        if (dir === 'request') {
          return nullable ? 'jsonNullableMapToString' : 'mapToJsonString';
        }
        return nullable ? 'jsonStringToJsonNullableMap' : 'jsonStringToObject';
      }
      if (jsonKind === 'any') {
        if (dir === 'request') {
          return nullable ? 'jsonNullableObjectToString' : 'objectToJsonString';
        }
        return nullable ? 'jsonStringToJsonNullableObject' : 'jsonStringToObject';
      }
      if (dir === 'request') {
        return nullable ? 'jsonNullableListToString' : 'listToJsonString';
      }
      return nullable ? 'jsonStringToJsonNullableList' : 'jsonStringToList';
    };
    const qualifiedByName = qualifierForKind(kind, usesJsonNullable, direction);
    if (kind === 'map' || kind === 'list' || kind === 'any') {
      annotations.push(`@Mapping(source = "${sourceField}", target = "${targetField}", qualifiedByName = "${qualifiedByName}")`);
    }
  }
  return { annotations, mappedFields };
}

function isUriSchemaForMapping(schema: any, schemas: Record<string, any>, visiting = new Set<string>()): boolean {
  if (!schema) {
    return false;
  }
  const refName = extractSchemaRef(schema);
  if (refName) {
    if (visiting.has(refName)) {
      return false;
    }
    visiting.add(refName);
    const result = isUriSchemaForMapping(schemas[refName], schemas, visiting);
    visiting.delete(refName);
    return result;
  }
  if (schema.type === 'string' && ['uri', 'url', 'uri-reference'].includes(String(schema.format ?? '').toLowerCase())) {
    return true;
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const fragments = schema[key];
    if (Array.isArray(fragments) && fragments.some(fragment => isUriSchemaForMapping(fragment, schemas, visiting))) {
      return true;
    }
  }
  return false;
}

function buildUriMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  domainEntityName?: string,
  entityDefinitions?: Map<string, any>,
  domainFieldTypeCache: Map<string, Map<string, string>> = new Map(),
  excludedFields: Set<string> = new Set(),
): { annotations: string[]; mappedFields: Set<string> } {
  if (!schemaName) {
    return { annotations: [], mappedFields: new Set() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  const domainFieldTypes = collectDomainFieldTypes(domainEntityName, entityDefinitions, domainFieldTypeCache);
  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    if (!isUriSchemaForMapping(fieldSchema, schemas)) {
      continue;
    }
    const dtoField = toOpenApiPropertyName(fieldName);
    const domainField = toJHipsterPropertyName(fieldName);
    if (domainFieldTypes.size > 0 && String(domainFieldTypes.get(domainField) ?? '').toLowerCase() !== 'string') {
      continue;
    }
    const targetField = direction === 'request' ? domainField : dtoField;
    if (excludedFields.has(targetField)) {
      continue;
    }
    const sourceField = direction === 'request' ? dtoField : domainField;
    const qualifiedByName = direction === 'request' ? 'uriToString' : 'stringToUri';
    annotations.push(`@Mapping(source = "${sourceField}", target = "${targetField}", qualifiedByName = "${qualifiedByName}")`);
    mappedFields.add(targetField);
  }
  return { annotations, mappedFields };
}

function buildPropertyAliasMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  excludedFields: Set<string> = new Set(),
  domainEntityName?: string,
  entityDefinitions?: Map<string, any>,
  domainMapStructPropertyCache: Map<string, Map<string, string>> = new Map(),
  relationshipTargets?: Map<string, Map<string, string>>,
): { annotations: string[]; mappedFields: Set<string> } {
  if (!schemaName) {
    return { annotations: [], mappedFields: new Set() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  const domainMapStructProperties = collectDomainMapStructPropertyNames(domainEntityName, entityDefinitions, domainMapStructPropertyCache);
  const normalizedDomainEntity = normalizeTypeName(domainEntityName ?? '');
  const relationshipTargetMap = normalizedDomainEntity ? relationshipTargets?.get(normalizedDomainEntity) : undefined;
  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  const resolveRelationshipAlias = (domainField: string, fieldSchema: any): string | undefined => {
    if (!relationshipTargetMap) {
      return undefined;
    }
    const resolvedField = resolveSchema(fieldSchema, schemas) ?? fieldSchema;
    if (!resolvedField || resolvedField.type === 'array' || isPrimitiveSchema(resolvedField)) {
      return undefined;
    }
    const schemaRef = extractSchemaRef(fieldSchema) ?? extractSchemaRef(resolvedField);
    const normalizedSchemaTarget = normalizeTypeName(stripDtoSuffix(schemaRef ?? '') ?? schemaRef ?? '');
    if (!normalizedSchemaTarget) {
      return undefined;
    }
    const currentTarget = relationshipTargetMap.get(domainField) ?? relationshipTargetMap.get(domainMapStructProperties.get(domainField) ?? '');
    if (currentTarget === normalizedSchemaTarget) {
      return undefined;
    }
    const candidates = Array.from(relationshipTargetMap.entries())
      .filter(([key, target]) => target === normalizedSchemaTarget && key !== domainField)
      .map(([key]) => domainMapStructProperties.get(key) ?? key);
    const uniqueCandidates = Array.from(new Set(candidates)).filter(candidate => candidate && candidate !== domainField);
    if (uniqueCandidates.length === 0) {
      return undefined;
    }
    uniqueCandidates.sort((left, right) => {
      const leftStarts = left.startsWith(domainField) ? 0 : 1;
      const rightStarts = right.startsWith(domainField) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      const leftRef = left === `${domainField}Ref` ? 0 : 1;
      const rightRef = right === `${domainField}Ref` ? 0 : 1;
      if (leftRef !== rightRef) {
        return leftRef - rightRef;
      }
      return left.length - right.length || left.localeCompare(right);
    });
    return uniqueCandidates[0];
  };
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    const dtoField = toOpenApiPropertyName(fieldName);
    const domainField = toJHipsterPropertyName(fieldName);
    const relationshipAlias = resolveRelationshipAlias(domainField, fieldSchema);
    const domainMapStructField = relationshipAlias ?? domainMapStructProperties.get(domainField) ?? domainField;
    if (!dtoField || !domainMapStructField || dtoField === domainMapStructField) {
      continue;
    }
    const sourceField = direction === 'request' ? dtoField : domainMapStructField;
    const targetField = direction === 'request' ? domainMapStructField : dtoField;
    if (excludedFields.has(targetField)) {
      continue;
    }
    annotations.push(`@Mapping(source = "${sourceField}", target = "${targetField}")`);
    mappedFields.add(targetField);
    if (direction === 'request' && domainField !== domainMapStructField && !excludedFields.has(domainField)) {
      annotations.push(`@Mapping(target = "${domainField}", ignore = true)`);
      mappedFields.add(domainField);
    }
  }
  return { annotations, mappedFields };
}

function isSchemaObjectLikeForMapping(schema: any, schemas: Record<string, any>, visiting = new Set<string>()): boolean {
  if (!schema) {
    return false;
  }
  const refName = extractSchemaRef(schema);
  if (refName) {
    if (visiting.has(refName)) {
      return false;
    }
    const resolved = schemas[refName];
    if (!resolved) {
      return false;
    }
    visiting.add(refName);
    const result = isSchemaObjectLikeForMapping(resolved, schemas, visiting);
    visiting.delete(refName);
    return result;
  }
  if (schema.type === 'array') {
    return false;
  }
  if (isEnumSchema(schema)) {
    return false;
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    return true;
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const fragments = schema[key];
    if (Array.isArray(fragments) && fragments.some(fragment => isSchemaObjectLikeForMapping(fragment, schemas, visiting))) {
      return true;
    }
  }
  const resolved = resolveSchema(schema, schemas);
  return resolved && resolved !== schema ? isSchemaObjectLikeForMapping(resolved, schemas, visiting) : false;
}

function buildScalarToObjectResponseIgnoreAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  domainFieldTypeCache: Map<string, Map<string, string>>,
  excludedFields: Set<string> = new Set(),
): { annotations: string[]; mappedFields: Set<string> } {
  if (!schemaName || !entityName || !entityDefinitions) {
    return { annotations: [], mappedFields: new Set() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  const domainFieldTypes = collectDomainFieldTypes(entityName, entityDefinitions, domainFieldTypeCache);
  if (domainFieldTypes.size === 0) {
    return { annotations: [], mappedFields: new Set() };
  }
  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    const targetField = toOpenApiPropertyName(fieldName);
    const domainField = toJHipsterPropertyName(fieldName);
    if (excludedFields.has(targetField)) {
      continue;
    }
    const domainType = domainFieldTypes.get(domainField);
    if (!isScalarDomainFieldType(domainType)) {
      continue;
    }
    if (!isSchemaObjectLikeForMapping(fieldSchema, schemas)) {
      continue;
    }
    annotations.push(`@Mapping(target = "${targetField}", ignore = true)`);
    mappedFields.add(targetField);
  }
  return { annotations, mappedFields };
}

function buildScalarArrayMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  domainFieldTypeCache: Map<string, Map<string, string>>,
  basePackage: string,
  excludedFields: Set<string> = new Set(),
): { annotations: string[]; mappedFields: Set<string> } {
  if (!schemaName || !entityName || !entityDefinitions) {
    return { annotations: [], mappedFields: new Set() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  const domainFieldTypes = collectDomainFieldTypes(entityName, entityDefinitions, domainFieldTypeCache);
  if (domainFieldTypes.size === 0) {
    return { annotations: [], mappedFields: new Set() };
  }

  const annotations: string[] = [];
  const mappedFields = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    const resolvedField = resolveSchema(fieldSchema, schemas) ?? fieldSchema;
    if (resolvedField?.type !== 'array') {
      continue;
    }
    const itemSchema = resolvedField.items ?? fieldSchema?.items;
    if (!itemSchema) {
      continue;
    }
    const itemRef = extractSchemaRef(itemSchema);
    const resolvedItem = resolveSchema(itemSchema, schemas) ?? (itemRef ? schemas[itemRef] : itemSchema);
    const itemIsEnum = Boolean((itemRef && isEnumSchema(schemas[itemRef] ?? resolvedItem)) || isEnumSchema(resolvedItem));
    const itemIsPrimitive = isPrimitiveSchema(resolvedItem);
    if (!itemIsEnum && !itemIsPrimitive) {
      continue;
    }

    const dtoField = toOpenApiPropertyName(fieldName);
    const domainField = toJHipsterPropertyName(fieldName);
    const domainType = domainFieldTypes.get(domainField);
    if (!domainType) {
      continue;
    }
    const targetField = direction === 'request' ? domainField : dtoField;
    if (excludedFields.has(targetField)) {
      continue;
    }
    const sourceField = direction === 'request' ? dtoField : domainField;
    const sourceGetter = `source.get${upperFirstCamelCase(sourceField)}()`;

    if (itemIsEnum && itemRef) {
      if (!isScalarDomainFieldType(domainType)) {
        const enumTargetType =
          direction === 'request' ? `${basePackage}.domain.enumeration.${domainType}` : buildDtoFqcn(itemRef, basePackage);
        const expression =
          direction === 'request'
            ? `java(openApiPrimitiveMapper.firstEnumFromList(${sourceGetter}, ${enumTargetType}.class))`
            : `java(openApiPrimitiveMapper.enumToSingletonList(${sourceGetter}, ${enumTargetType}.class))`;
        annotations.push(`@Mapping(target = "${targetField}", expression = "${expression}")`);
        mappedFields.add(targetField);
        continue;
      }
      if (String(domainType).toLowerCase() === 'string') {
        const dtoEnumType = buildDtoFqcn(itemRef, basePackage);
        const expression =
          direction === 'request'
            ? `java(openApiPrimitiveMapper.firstTokenFromList(${sourceGetter}))`
            : `java(openApiPrimitiveMapper.enumToSingletonList(${sourceGetter}, ${dtoEnumType}.class))`;
        annotations.push(`@Mapping(target = "${targetField}", expression = "${expression}")`);
        mappedFields.add(targetField);
        continue;
      }
      continue;
    }

    if (itemIsPrimitive && isScalarDomainFieldType(domainType)) {
      const expression =
        direction === 'request'
          ? `java(openApiPrimitiveMapper.firstFromList(${sourceGetter}))`
          : `java(openApiPrimitiveMapper.scalarToSingletonList(${sourceGetter}))`;
      annotations.push(`@Mapping(target = "${targetField}", expression = "${expression}")`);
      mappedFields.add(targetField);
    }
  }

  return { annotations, mappedFields };
}

function buildAliasModelFieldIgnoreAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  excludedFields: Set<string> = new Set(),
): { annotations: string[]; ignoredFields: Set<string> } {
  if (!schemaName) {
    return { annotations: [], ignoredFields: new Set() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  const ignoredFields = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    const refName = extractSchemaRef(fieldSchema);
    if (!refName) {
      continue;
    }
    const resolved = schemas[refName];
    if (!isOpenApiAliasModelSchema(resolved)) {
      continue;
    }
    const targetField = direction === 'request' ? toJHipsterPropertyName(fieldName) : toOpenApiPropertyName(fieldName);
    if (excludedFields.has(targetField)) {
      continue;
    }
    ignoredFields.add(targetField);
  }

  return {
    annotations: Array.from(ignoredFields).map(field => `@Mapping(target = "${field}", ignore = true)`),
    ignoredFields,
  };
}

function extractMappingProperty(annotation: string, property: 'source' | 'target'): string | undefined {
  const match = annotation.match(new RegExp(`${property}\\s*=\\s*"([^"]+)"`));
  const value = match?.[1];
  return value ? value.split('.')[0] : undefined;
}

function filterMappingAnnotationsByDomainProperty(
  annotations: string[],
  entityName: string | undefined,
  entityDefinitions: Map<string, any> | undefined,
  domainPropertyCache: Map<string, Set<string>>,
  propertyRole: 'source' | 'target',
  domainMapStructPropertyCache: Map<string, Map<string, string>> = new Map(),
): string[] {
  if (!entityName || !entityDefinitions) {
    return annotations;
  }
  const domainProperties = collectDomainPropertyNames(entityName, entityDefinitions, domainPropertyCache);
  const domainMapStructProperties = collectDomainMapStructPropertyNames(entityName, entityDefinitions, domainMapStructPropertyCache);
  if (domainProperties.size === 0) {
    return annotations;
  }
  const isJavaBeanAlias = (property: string | undefined, mapStructProperty: string | undefined): boolean =>
    Boolean(
      property &&
        mapStructProperty &&
        property !== mapStructProperty &&
        (lowerFirst(mapStructProperty) === property || toJHipsterPropertyName(mapStructProperty) === property),
    );
  return annotations.filter(annotation => {
    const property = extractMappingProperty(annotation, propertyRole);
    const normalizedProperty = property ? toJHipsterPropertyName(property) : undefined;
    const mappedProperty =
      (property ? domainMapStructProperties.get(property) : undefined) ??
      (normalizedProperty ? domainMapStructProperties.get(normalizedProperty) : undefined);
    return (
      !property ||
      (normalizedProperty ? domainProperties.has(normalizedProperty) : false) ||
      isJavaBeanAlias(property, mappedProperty) ||
      isJavaBeanAlias(normalizedProperty, mappedProperty) ||
      Array.from(domainMapStructProperties.values()).includes(property)
    );
  });
}

function hasSchemaPropertyForField(properties: SchemaProperties, ...fieldNames: Array<string | undefined>): boolean {
  const normalizedCandidates = new Set<string>();
  for (const fieldName of fieldNames) {
    if (!fieldName) {
      continue;
    }
    normalizedCandidates.add(fieldName);
    normalizedCandidates.add(toOpenApiPropertyName(fieldName));
    normalizedCandidates.add(toJHipsterPropertyName(fieldName));
  }
  for (const property of Object.keys(properties)) {
    if (
      normalizedCandidates.has(property) ||
      normalizedCandidates.has(toOpenApiPropertyName(property)) ||
      normalizedCandidates.has(toJHipsterPropertyName(property))
    ) {
      return true;
    }
  }
  return false;
}

function uniqueAnnotations(annotations: string[]): string[] {
  return Array.from(new Set(annotations));
}

type SchemaProperties = Record<string, any>;

function buildReadOnlyRequiredUuidFields(
  targetEntity: string | undefined,
  sourceSchemaName: string | undefined,
  schemas: Record<string, any>,
  schemaPropertiesCache: Map<string, SchemaProperties>,
  entityDefinitions: Map<string, any> | undefined,
): GeneratedUuidFieldContext[] {
  if (!targetEntity || !sourceSchemaName || !entityDefinitions) {
    return [];
  }
  const fields = collectEntityDefinitionFields(targetEntity, entityDefinitions);
  if (fields.length === 0) {
    return [];
  }
  const properties = collectSchemaProperties(sourceSchemaName, schemas, schemaPropertiesCache);
  const generatedFields: GeneratedUuidFieldContext[] = [];
  for (const field of fields) {
    const fieldName = field?.fieldName ?? field?.name;
    if (!fieldName) {
      continue;
    }
    const fieldType = typeof field?.fieldType === 'string' ? field.fieldType.toLowerCase() : '';
    const validationRules = Array.isArray(field?.fieldValidateRules) ? field.fieldValidateRules : [];
    if (fieldType !== 'uuid' || !validationRules.includes('required')) {
      continue;
    }
    const propertyName = toOpenApiPropertyName(fieldName);
    const propertySchema = properties[propertyName] ?? properties[fieldName];
    if (!propertySchema?.readOnly) {
      continue;
    }
    generatedFields.push({
      fieldName: toJHipsterPropertyName(fieldName),
      accessor: upperFirstCamelCase(toJHipsterPropertyName(fieldName)),
    });
  }
  return generatedFields;
}

function collectSchemaRequiredProperties(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache = new Map<string, Set<string>>(),
  visiting = new Set<string>(),
): Set<string> {
  if (!schemaName) {
    return new Set();
  }
  if (cache.has(schemaName)) {
    return new Set(cache.get(schemaName)!);
  }
  const schema = schemas[schemaName];
  if (!schema || visiting.has(schemaName)) {
    return new Set();
  }
  visiting.add(schemaName);
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    for (const fragment of schema[key] ?? []) {
      const refName = extractSchemaRef(fragment);
      if (refName) {
        for (const property of collectSchemaRequiredProperties(refName, schemas, cache, visiting)) {
          required.add(property);
        }
      } else if (Array.isArray(fragment?.required)) {
        for (const property of fragment.required) {
          required.add(property);
        }
      }
    }
  }
  visiting.delete(schemaName);
  cache.set(schemaName, required);
  return new Set(required);
}

function javaStringLiteral(value: unknown): string {
  return JSON.stringify(String(value));
}

function schemaDefaultValue(schema: any): unknown {
  const resolved = schema ?? {};
  if (resolved.default !== undefined) {
    return resolved.default;
  }
  if (resolved.example !== undefined) {
    return resolved.example;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }
  return undefined;
}

function buildDefaultValueExpression(field: any, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const fieldType = typeof field?.fieldType === 'string' ? field.fieldType : '';
  const normalizedType = fieldType.toLowerCase();
  if (normalizedType === 'string' || normalizedType === 'textblob' || normalizedType === 'anyblob') {
    return javaStringLiteral(value);
  }
  if (normalizedType === 'integer') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `Integer.valueOf(${Math.trunc(numeric)})` : undefined;
  }
  if (normalizedType === 'long') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `Long.valueOf(${Math.trunc(numeric)}L)` : undefined;
  }
  if (normalizedType === 'float') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `Float.valueOf(${numeric}F)` : undefined;
  }
  if (normalizedType === 'double') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `Double.valueOf(${numeric}D)` : undefined;
  }
  if (normalizedType === 'bigdecimal') {
    const numeric = String(value);
    return /^-?\d+(\.\d+)?$/.test(numeric) ? `new java.math.BigDecimal(${javaStringLiteral(numeric)})` : undefined;
  }
  if (normalizedType === 'boolean') {
    if (typeof value === 'boolean') {
      return value ? 'Boolean.TRUE' : 'Boolean.FALSE';
    }
    if (String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'false') {
      return String(value).toLowerCase() === 'true' ? 'Boolean.TRUE' : 'Boolean.FALSE';
    }
    return undefined;
  }
  if (normalizedType === 'uuid') {
    const stringValue = String(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stringValue)
      ? `java.util.UUID.fromString(${javaStringLiteral(stringValue)})`
      : undefined;
  }
  if (normalizedType === 'localdate') {
    return `java.time.LocalDate.parse(${javaStringLiteral(value)})`;
  }
  if (normalizedType === 'instant') {
    return `java.time.Instant.parse(${javaStringLiteral(value)})`;
  }
  if (normalizedType === 'zoneddatetime') {
    return `java.time.ZonedDateTime.parse(${javaStringLiteral(value)})`;
  }
  if (normalizedType === 'duration') {
    return `java.time.Duration.parse(${javaStringLiteral(value)})`;
  }
  return undefined;
}

function fieldTypeFromSchema(schema: any): string | undefined {
  const type = typeof schema?.type === 'string' ? schema.type : undefined;
  const format = typeof schema?.format === 'string' ? schema.format : undefined;
  if (type === 'string') {
    if (format === 'uuid') {
      return 'UUID';
    }
    if (format === 'date') {
      return 'LocalDate';
    }
    if (format === 'date-time') {
      return 'Instant';
    }
    return 'String';
  }
  if (type === 'integer') {
    return format === 'int64' ? 'Long' : 'Integer';
  }
  if (type === 'number') {
    return format === 'float' ? 'Float' : 'Double';
  }
  if (type === 'boolean') {
    return 'Boolean';
  }
  return undefined;
}

function buildSchemaDefaultValueExpression(field: any | undefined, schema: any): string | undefined {
  const defaultValue = schemaDefaultValue(schema);
  const expressionField = field?.fieldType ? field : { ...(field ?? {}), fieldType: fieldTypeFromSchema(schema) };
  return buildDefaultValueExpression(expressionField, defaultValue);
}

function buildSchemaBackedDefaultFields(
  targetEntity: string | undefined,
  sourceSchemaName: string | undefined,
  targetSchemaNames: Array<string | undefined>,
  schemas: Record<string, any>,
  schemaPropertiesCache: Map<string, SchemaProperties>,
  entityDefinitions: Map<string, any> | undefined,
): GeneratedDefaultFieldContext[] {
  if (!targetEntity || !sourceSchemaName || !entityDefinitions) {
    return [];
  }
  const definition = resolveEntityDefinition(targetEntity, entityDefinitions);
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  const targetDomainProperties = collectDomainPropertyNames(targetEntity, entityDefinitions, new Map());
  const sourceProperties = collectSchemaProperties(sourceSchemaName, schemas, schemaPropertiesCache);
  const requiredBySchema = new Set<string>();
  const targetPropertiesByName = new Map<string, any>();
  const requiredCache = new Map<string, Set<string>>();
  for (const targetSchemaName of targetSchemaNames.filter(Boolean)) {
    const required = collectSchemaRequiredProperties(targetSchemaName, schemas, requiredCache);
    for (const property of required) {
      requiredBySchema.add(toJHipsterPropertyName(property));
    }
    const properties = collectSchemaProperties(targetSchemaName, schemas, schemaPropertiesCache);
    for (const [property, schema] of Object.entries(properties)) {
      const normalized = toJHipsterPropertyName(property);
      if (!targetPropertiesByName.has(normalized)) {
        targetPropertiesByName.set(normalized, schema);
      }
    }
  }

  const defaults: GeneratedDefaultFieldContext[] = [];
  const seenFields = new Set<string>();
  const candidates: DefaultFieldCandidate[] = [];
  const candidateNames = new Set<string>();

  for (const field of fields) {
    const rawFieldName = field?.fieldName ?? field?.name;
    if (!rawFieldName || rawFieldName === 'id') {
      continue;
    }
    const fieldName = toJHipsterPropertyName(rawFieldName);
    if (candidateNames.has(fieldName)) {
      continue;
    }
    candidateNames.add(fieldName);
    candidates.push({
      rawFieldName,
      fieldName,
      field,
      schema: targetPropertiesByName.get(fieldName),
    });
  }

  for (const [propertyName, schema] of targetPropertiesByName.entries()) {
    if (propertyName === 'id' || candidateNames.has(propertyName) || !requiredBySchema.has(propertyName) || !targetDomainProperties.has(propertyName)) {
      continue;
    }
    candidateNames.add(propertyName);
    candidates.push({
      rawFieldName: propertyName,
      fieldName: propertyName,
      schema,
    });
  }

  for (const candidate of candidates) {
    const { rawFieldName, fieldName, field, schema } = candidate;
    if (seenFields.has(fieldName)) {
      continue;
    }
    if (hasSchemaPropertyForField(sourceProperties, rawFieldName, fieldName)) {
      continue;
    }
    const validationRules = Array.isArray(field?.fieldValidateRules) ? field.fieldValidateRules : [];
    if (!validationRules.includes('required') && !requiredBySchema.has(fieldName)) {
      continue;
    }
    const valueExpression = buildSchemaDefaultValueExpression(field, schema);
    if (!valueExpression) {
      continue;
    }
    seenFields.add(fieldName);
    defaults.push({
      fieldName,
      accessor: upperFirstCamelCase(fieldName),
      valueExpression,
    });
  }
  return defaults;
}

function isBlobFieldWithContentType(field: any): boolean {
  if (field?.fieldWithContentType === true) {
    return true;
  }
  const fieldType = typeof field?.fieldType === 'string' ? field.fieldType.toLowerCase() : '';
  return fieldType === 'blob' || fieldType === 'anyblob' || fieldType === 'imageblob';
}

function buildBlobContentTypeDefaultFields(
  targetEntity: string | undefined,
  sourceSchemaName: string | undefined,
  schemas: Record<string, any>,
  schemaPropertiesCache: Map<string, SchemaProperties>,
  entityDefinitions: Map<string, any> | undefined,
): GeneratedDefaultFieldContext[] {
  if (!targetEntity || !sourceSchemaName || !entityDefinitions) {
    return [];
  }
  const definition = resolveEntityDefinition(targetEntity, entityDefinitions);
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  if (fields.length === 0) {
    return [];
  }
  const sourceProperties = collectSchemaProperties(sourceSchemaName, schemas, schemaPropertiesCache);
  const normalizedSourceProperties = new Map<string, string>();
  for (const propertyName of Object.keys(sourceProperties)) {
    normalizedSourceProperties.set(toJHipsterPropertyName(propertyName).toLowerCase(), toJHipsterPropertyName(propertyName));
  }
  const sourceGetterExpression = (blobFieldName: string): string | undefined => {
    const candidates = [
      `${blobFieldName}ContentType`,
      `${blobFieldName}MediaType`,
      `${blobFieldName}MimeType`,
      ...(blobFieldName === 'content' ? ['contentType', 'mediaType', 'mimeType'] : []),
    ];
    for (const candidate of candidates) {
      const sourceProperty = normalizedSourceProperties.get(toJHipsterPropertyName(candidate).toLowerCase());
      if (sourceProperty) {
        const accessor = upperFirstCamelCase(sourceProperty);
        return `source != null && source.get${accessor}() != null ? source.get${accessor}() : "application/octet-stream"`;
      }
    }
    return undefined;
  };

  const defaults: GeneratedDefaultFieldContext[] = [];
  for (const field of fields) {
    if (!isBlobFieldWithContentType(field)) {
      continue;
    }
    const rawFieldName = field?.fieldName ?? field?.name;
    if (!rawFieldName) {
      continue;
    }
    const fieldName = toJHipsterPropertyName(rawFieldName);
    const contentTypeField = `${fieldName}ContentType`;
    defaults.push({
      fieldName: contentTypeField,
      accessor: upperFirstCamelCase(contentTypeField),
      presenceAccessor: upperFirstCamelCase(fieldName),
      valueExpression: sourceGetterExpression(fieldName) ?? '"application/octet-stream"',
    });
  }
  return defaults;
}

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
  const properties = collectInlineSchemaProperties(schema, schemas, cache, visiting);
  visiting.delete(schemaName);
  cache.set(schemaName, properties);
  return properties;
}

function collectInlineSchemaProperties(
  schema: any,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  visiting: Set<string>,
): SchemaProperties {
  const properties: SchemaProperties = { ...(schema?.properties ?? {}) };
  for (const compositionKey of ['allOf', 'oneOf', 'anyOf']) {
    const fragments = schema?.[compositionKey];
    if (!Array.isArray(fragments)) {
      continue;
    }
    for (const fragment of fragments) {
      const refName = extractSchemaRef(fragment);
      if (refName) {
        Object.assign(properties, collectSchemaProperties(refName, schemas, cache, visiting));
      } else {
        Object.assign(properties, collectInlineSchemaProperties(fragment, schemas, cache, visiting));
      }
    }
  }
  return properties;
}

/**
 * Properties exposed by a generated composition base type. `oneOf` and `anyOf`
 * members are excluded because OpenAPI Generator models them as sibling
 * implementations rather than accessors on the base interface.
 */
function collectBaseDtoProperties(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  visiting = new Set<string>(),
): SchemaProperties {
  if (!schemaName || visiting.has(schemaName)) {
    return {};
  }
  const schema = schemas[schemaName];
  if (!schema || typeof schema !== 'object') {
    return {};
  }
  visiting.add(schemaName);
  const properties: SchemaProperties = { ...(schema.properties ?? {}) };
  for (const fragment of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const refName = extractSchemaRef(fragment);
    Object.assign(properties, refName ? collectBaseDtoProperties(refName, schemas, visiting) : { ...(fragment?.properties ?? {}) });
  }
  visiting.delete(schemaName);
  return properties;
}

function collectConcreteDtoProperties(schema: any): SchemaProperties {
  const properties: SchemaProperties = { ...(schema?.properties ?? {}) };
  for (const fragment of Array.isArray(schema?.allOf) ? schema.allOf : []) {
    if (!extractSchemaRef(fragment)) {
      Object.assign(properties, fragment?.properties ?? {});
    }
  }
  return properties;
}

function isPrimitiveSchema(schema: any): boolean {
  if (!schema) {
    return false;
  }
  const type = schema.type;
  return type === 'string' || type === 'integer' || type === 'number' || type === 'boolean';
}

function isIdentifierPropertyName(propertyName?: string): boolean {
  if (!propertyName) {
    return false;
  }
  return propertyName === 'id' || propertyName === 'href' || /(?:^|[_-])id$/i.test(propertyName) || /(?:Id|ID)$/.test(propertyName);
}

function collectIdentifierPropertyNames(properties: Record<string, any> | undefined): string[] {
  if (!properties) {
    return [];
  }
  const names = Object.keys(properties).filter(isIdentifierPropertyName);
  const priority = (name: string) => {
    const normalized = name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (normalized === 'tmfid') return 0;
    if (normalized === 'href') return 1;
    if (normalized === 'id') return names.length > 1 ? 100 : 2;
    return 10;
  };
  return names.sort((left, right) => priority(left) - priority(right));
}

function buildGetterExpression(propertyName: string): string {
  return `{var}.get${upperFirstCamelCase(toJHipsterPropertyName(propertyName))}()`;
}

function collectCollectionFieldContexts(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  basePackage: string,
  schemaPropertiesCache: Map<string, SchemaProperties>,
  polymorphicHelperTypes: Set<string>,
  entityDefinitions: Map<string, any> | undefined,
  domainPropertyCache: Map<string, Set<string>>,
  domainMapStructPropertyCache: Map<string, Map<string, string>>,
  relationshipTargets?: Map<string, Map<string, string>>,
  targetEntityName?: string,
): CollectionFieldContext[] {
  if (!schemaName) {
    return [];
  }
  const properties = collectSchemaProperties(schemaName, schemas, schemaPropertiesCache);
  if (!properties || Object.keys(properties).length === 0) {
    return [];
  }
  const collectionFields: CollectionFieldContext[] = [];
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    if (!fieldSchema) {
      continue;
    }
    const resolvedField = resolveSchema(fieldSchema, schemas) ?? fieldSchema;
    if (resolvedField?.type !== 'array') {
      continue;
    }
    const itemsSchema = resolvedField.items ? resolveSchema(resolvedField.items, schemas) ?? resolvedField.items : undefined;
    if (!itemsSchema || isPrimitiveSchema(itemsSchema)) {
      continue;
    }
    const elementSchemaName = extractSchemaRef(resolvedField.items) ?? extractSchemaRef(itemsSchema);
    if (!elementSchemaName) {
      continue;
    }
    const baseEntity = stripDtoSuffix(elementSchemaName);
    if (!baseEntity) {
      continue;
    }
    const sourceField = toOpenApiPropertyName(fieldName);
    const relationshipNameField = toJHipsterPropertyName(fieldName);
    const domainMapStructProperties = collectDomainMapStructPropertyNames(
      targetEntityName,
      entityDefinitions,
      domainMapStructPropertyCache,
    );
    const targetField = domainMapStructProperties.get(relationshipNameField) ?? relationshipNameField;
    const sourceGetter = upperFirstCamelCase(sourceField);
    const targetGetter = upperFirstCamelCase(targetField);
    const targetSetter = `set${targetGetter}`;
    const normalizedBase = normalizeTypeName(baseEntity) ?? baseEntity;
    let collectionBaseEntity = baseEntity;
    let normalizedCollectionBase = normalizedBase;
    const normalizedTargetEntity = normalizeTypeName(targetEntityName ?? '');
    const relationshipTargetMap = normalizedTargetEntity ? relationshipTargets?.get(normalizedTargetEntity) : undefined;
    const relationshipTarget = relationshipTargetMap?.get(relationshipNameField) ?? relationshipTargetMap?.get(targetField);
    const usesRelationshipTarget = Boolean(relationshipTarget);
    if (relationshipTarget) {
      collectionBaseEntity = relationshipTarget;
      normalizedCollectionBase = normalizeTypeName(relationshipTarget) ?? relationshipTarget;
    } else if (derivedAncestorsCache) {
      const ancestors = derivedAncestorsCache.get(normalizedBase);
      if (ancestors && ancestors.size > 0) {
        const helperAncestors = Array.from(ancestors).filter(name => polymorphicHelperTypes.has(name));
        if (helperAncestors.length > 0) {
          helperAncestors.sort(
            (a, b) => (derivedAncestorsCache?.get(b)?.size ?? 0) - (derivedAncestorsCache?.get(a)?.size ?? 0),
          );
          collectionBaseEntity = helperAncestors[0];
          normalizedCollectionBase = helperAncestors[0];
        }
      }
    }
    const elementDtoType = buildDtoFqcn(elementSchemaName, basePackage);
    const elementDtoSimple = elementDtoType.split('.').pop() ?? elementSchemaName;
    const elementDtoMapperName = normalizeDtoTypeName(elementSchemaName);
    const collectionDtoSchemaName = extractSchemaRef(fieldSchema);
    const responseCollectionDtoType =
      collectionDtoSchemaName && collectionDtoSchemaName !== elementSchemaName ? buildDtoFqcn(collectionDtoSchemaName, basePackage) : undefined;
    const elementDomainType = buildDomainFqcn(collectionBaseEntity, basePackage);
    const elementDomainSimple = elementDomainType.split('.').pop() ?? collectionBaseEntity;
    const useInlineElementMapping = usesRelationshipTarget && normalizedCollectionBase !== normalizedBase;
    const isPolymorphic = polymorphicHelperTypes.has(normalizedCollectionBase);
    const mapperBaseName = useInlineElementMapping && !isPolymorphic ? elementDtoMapperName : collectionBaseEntity;
    const mapperSimple = `${mapperBaseName}Mapper`;
    const mapperFqcn = `${basePackage}.web.api.mapper.${mapperSimple}`;
    const mapperField = `${lowerFirst(mapperBaseName)}Mapper`;
    const normalizedElementName = normalizeTypeName(elementSchemaName) ?? elementSchemaName;
    const isElementBase = normalizedElementName === normalizedCollectionBase;
    const elementSchema = schemas[elementSchemaName] ?? resolveSchema(elementSchemaName, schemas);
    const elementProperties = collectSchemaProperties(elementSchemaName, schemas, schemaPropertiesCache) ?? elementSchema?.properties ?? {};
    const hasOneOfOrAnyOf = Array.isArray(elementSchema?.oneOf) || Array.isArray(elementSchema?.anyOf);
    const elementHasDirectProperties = elementSchema?.properties ?? itemsSchema?.properties ?? {};
    const mapMethod = isPolymorphic
      ? (isElementBase ? `to${collectionBaseEntity}` : `to${elementDtoSimple}`)
      : `to${collectionBaseEntity}Entity`;
    const updateMethod = isPolymorphic
      ? `update${collectionBaseEntity}From${elementDtoSimple}`
      : `update${collectionBaseEntity}EntityFrom${elementDtoSimple}`;
    const responseMapMethod = isPolymorphic ? `to${collectionBaseEntity}Dto` : `to${elementDtoMapperName}Dto`;
    const referencedEntity = normalizedCollectionBase;
    const elementIdentifierProperties = collectIdentifierPropertyNames(elementProperties);
    const directElementIdentifierProperties = new Set(collectIdentifierPropertyNames(elementHasDirectProperties));
    const hasId = elementIdentifierProperties.length > 0;
    const existingKeyExpressions: string[] = [];
    const incomingKeyExpressions: string[] = [];
    const registerKeyExpression = (existingExpression: string | undefined, incomingExpression?: string | undefined) => {
      if (existingExpression && !existingKeyExpressions.includes(existingExpression)) {
        existingKeyExpressions.push(existingExpression);
      }
      if (incomingExpression && !incomingKeyExpressions.includes(incomingExpression)) {
        incomingKeyExpressions.push(incomingExpression);
      }
    };
    for (const identifierName of elementIdentifierProperties) {
      const getterExpression = buildGetterExpression(identifierName);
      const incomingExpression = hasOneOfOrAnyOf && !directElementIdentifierProperties.has(identifierName) ? undefined : getterExpression;
      registerKeyExpression(getterExpression, incomingExpression);
    }
    const elementRawProperties: Record<string, any> = { ...(elementSchema?.properties ?? {}) };
    if (Array.isArray(elementSchema?.allOf)) {
      for (const fragment of elementSchema.allOf) {
        if (fragment?.properties) {
          Object.assign(elementRawProperties, fragment.properties);
        } else if (fragment?.$ref) {
          const refName = extractSchemaRef(fragment);
          const refSchema = refName ? schemas[refName] ?? resolveSchema(refName, schemas) : undefined;
          Object.assign(elementRawProperties, refSchema?.properties ?? {});
        }
      }
    }
    if (existingKeyExpressions.length === 0) {
      const nestedKeyCandidates = Object.entries(elementRawProperties).filter(
        ([, propertySchema]) => extractSchemaRef(propertySchema) !== undefined,
      );
      for (const [propertyName, propertySchema] of nestedKeyCandidates) {
        const refName = extractSchemaRef(propertySchema);
        if (!refName) {
          continue;
        }
        const refSchema = schemas[refName] ?? resolveSchema(refName, schemas);
        const referencedProps: Record<string, any> = { ...(refSchema?.properties ?? {}) };
        if (Array.isArray(refSchema?.allOf)) {
          for (const fragment of refSchema.allOf) {
            if (fragment?.properties) {
              Object.assign(referencedProps, fragment.properties);
            } else if (fragment?.$ref) {
              const allOfRef = extractSchemaRef(fragment);
              const allOfSchema = allOfRef ? schemas[allOfRef] ?? resolveSchema(allOfRef, schemas) : undefined;
              Object.assign(referencedProps, allOfSchema?.properties ?? {});
            }
          }
        }
        if (Object.keys(referencedProps).length === 0) {
          continue;
        }
        const getter = `{var}.get${upperFirstCamelCase(propertyName)}()`;
        for (const identifierName of collectIdentifierPropertyNames(referencedProps)) {
          const identifierGetter = `get${upperFirstCamelCase(toJHipsterPropertyName(identifierName))}()`;
          const expr = `${getter} != null ? ${getter}.${identifierGetter} : null`;
          registerKeyExpression(expr, expr);
        }
        if (existingKeyExpressions.length > 0) {
          break;
        }
      }
    }
    const keyExpressions = existingKeyExpressions;
    const singularTarget = singularize(targetField);
    const adderName = upperFirstCamelCase(singularTarget);
    const inlineMappingAnnotations = useInlineElementMapping
      ? filterMappingAnnotationsByDomainProperty(
          buildPropertyAliasMappingAnnotations(elementSchemaName, schemas, schemaPropertiesCache, 'request').annotations,
          collectionBaseEntity,
          entityDefinitions,
          domainPropertyCache,
          'target',
        )
      : [];
    collectionFields.push({
      baseEntity,
      sourceField,
      sourceGetter,
      targetField,
      targetGetter,
      targetSetter,
      adderName,
      elementDtoType,
      elementDtoSimple,
      responseCollectionDtoType,
      elementDomainType,
      elementDomainSimple,
      mapperFqcn,
      mapperField,
      mapMethod,
      updateMethod,
      useInlineElementMapping,
      inlineMapMethod: useInlineElementMapping ? `map${targetGetter}${elementDtoSimple}Item` : undefined,
      inlineUpdateMethod: useInlineElementMapping ? `update${targetGetter}${elementDtoSimple}Item` : undefined,
      responseListMapMethod: `map${targetGetter}To${sourceGetter}Dto`,
      responseMapMethod,
      inlineMappingAnnotations,
      hasId,
      preserveNewItemId: false,
      referencedEntity,
      keyExpressions,
      existingKeyExpressions,
      incomingKeyExpressions,
    });
  }
  return collectionFields;
}

type SchemaFieldReferences = Map<string, Set<string>>;

type SchemaReferenceGraph = Map<string, Set<string>>;

function collectExactSchemaReferences(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  propertyCache: Map<string, SchemaProperties>,
  visited: Set<string> = new Set(),
): Set<string> {
  const references = new Set<string>();
  if (!schemaName || visited.has(schemaName)) {
    return references;
  }
  visited.add(schemaName);

  const visit = (fragment: any) => {
    if (!fragment) {
      return;
    }
    const refName = extractSchemaRef(fragment);
    if (refName) {
      references.add(refName);
      return;
    }
    if (fragment.type === 'array' && fragment.items) {
      visit(fragment.items);
    }
    if (fragment.additionalProperties) {
      visit(fragment.additionalProperties);
    }
    for (const composite of [fragment.allOf, fragment.anyOf, fragment.oneOf]) {
      if (Array.isArray(composite)) {
        composite.forEach(item => visit(item));
      }
    }
    if (fragment.properties && typeof fragment.properties === 'object') {
      Object.values<any>(fragment.properties).forEach(value => visit(value));
    }
  };

  visit(schemas[schemaName]);
  const properties = collectSchemaProperties(schemaName, schemas, propertyCache);
  Object.values<any>(properties).forEach(value => visit(value));
  visited.delete(schemaName);
  return references;
}

function collectSchemaFieldReferences(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  propertyCache: Map<string, SchemaProperties>,
  cache: Map<string, SchemaFieldReferences>,
): SchemaFieldReferences {
  if (!schemaName) {
    return new Map();
  }
  if (cache.has(schemaName)) {
    return cache.get(schemaName)!;
  }
  const properties = collectSchemaProperties(schemaName, schemas, propertyCache);
  const references: SchemaFieldReferences = new Map();

  const register = (target: string | undefined, bucket: Set<string>) => {
    const normalized = normalizeTypeName(stripDtoSuffix(target ?? ''));
    if (normalized) {
      bucket.add(normalized);
    }
  };

  const visit = (fragment: any, bucket: Set<string>) => {
    if (!fragment) {
      return;
    }
    const refName = extractSchemaRef(fragment);
    if (refName) {
      register(refName, bucket);
    }
    if (fragment.type === 'array' && fragment.items) {
      visit(fragment.items, bucket);
    }
    if (fragment.additionalProperties) {
      visit(fragment.additionalProperties, bucket);
    }
    for (const composite of [fragment.allOf, fragment.anyOf, fragment.oneOf]) {
      if (Array.isArray(composite)) {
        composite.forEach(item => visit(item, bucket));
      }
    }
    if (fragment.properties && typeof fragment.properties === 'object') {
      Object.values<any>(fragment.properties).forEach(value => visit(value, bucket));
    }
  };

  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    if (!fieldSchema) continue;
    const fieldTargets = new Set<string>();
    visit(fieldSchema, fieldTargets);
    if (fieldTargets.size > 0) {
      references.set(fieldName, fieldTargets);
    }
  }

  cache.set(schemaName, references);
  return references;
}

function buildSchemaReferenceGraph(
  schemas: Record<string, any>,
  propertyCache: Map<string, SchemaProperties>,
  referenceCache: Map<string, SchemaFieldReferences>,
): SchemaReferenceGraph {
  const graph: SchemaReferenceGraph = new Map();

  const ensureNode = (schemaName?: string): string | undefined => {
    const normalized = normalizeTypeName(stripDtoSuffix(schemaName ?? ''));
    if (!normalized || ABSTRACT_SCHEMAS.has(normalized)) {
      return undefined;
    }
    if (!graph.has(normalized)) {
      graph.set(normalized, new Set());
    }
    return normalized;
  };

  for (const schemaName of Object.keys(schemas)) {
    const source = ensureNode(schemaName);
    if (!source) {
      continue;
    }
    const fieldReferences = collectSchemaFieldReferences(schemaName, schemas, propertyCache, referenceCache);
    const edges = graph.get(source)!;
    for (const targets of fieldReferences.values()) {
      for (const target of targets) {
        const normalizedTarget = normalizeTypeName(target);
        if (!normalizedTarget || ABSTRACT_SCHEMAS.has(normalizedTarget)) {
          continue;
        }
        edges.add(normalizedTarget);
        ensureNode(normalizedTarget);
      }
    }
    for (const composition of [schemas[schemaName]?.allOf, schemas[schemaName]?.oneOf, schemas[schemaName]?.anyOf]) {
      if (!Array.isArray(composition)) continue;
      for (const fragment of composition) {
        const normalizedTarget = normalizeTypeName(stripDtoSuffix(extractSchemaRef(fragment) ?? ''));
        if (!normalizedTarget || ABSTRACT_SCHEMAS.has(normalizedTarget)) continue;
        edges.add(normalizedTarget);
        ensureNode(normalizedTarget);
      }
    }
  }

  return graph;
}

type StronglyConnectedComponents = {
  componentByNode: Map<string, number>;
  componentSizes: Map<number, number>;
};

function computeStronglyConnectedComponents(graph: SchemaReferenceGraph): StronglyConnectedComponents {
  let index = 0;
  let currentComponent = 0;
  const indexByNode = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const componentByNode = new Map<string, number>();
  const componentSizes = new Map<number, number>();

  const visit = (node: string): void => {
    indexByNode.set(node, index);
    lowLink.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!graph.has(neighbor)) {
        continue;
      }
      if (!indexByNode.has(neighbor)) {
        visit(neighbor);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, indexByNode.get(neighbor)!));
      }
    }

    if (lowLink.get(node) === indexByNode.get(node)) {
      let size = 0;
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) {
          break;
        }
        onStack.delete(member);
        componentByNode.set(member, currentComponent);
        size += 1;
      } while (member !== node);
      componentSizes.set(currentComponent, size);
      currentComponent += 1;
    }
  };

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) {
      visit(node);
    }
  }

  return { componentByNode, componentSizes };
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
  const derivedMatches = normalized ? derivedSchemasCache?.get(normalized) : undefined;
  if (derivedMatches && derivedMatches.size > 0) {
    return true;
  }
  if (normalized && derivedAncestorsCache) {
    const ancestors = derivedAncestorsCache.get(normalized);
    if (ancestors && ancestors.size > 0) {
      return true;
    }
  }

  if (schema && isReferenceLikeName(candidate) && /orvalue/i.test(candidate) && isObjectLikeSchema(schema)) {
    return true;
  }

  return false;
}

function collectAbstractSchemaMatches(
  schema: any,
  schemas: Record<string, any>,
  matches: Set<string> = new Set<string>(),
  visited = new Set<string>(),
): Set<string> {
  if (!schema) {
    return matches;
  }

  const registerMatch = (candidate?: string) => {
    if (!candidate) {
      return;
    }
    const normalized = normalizeTypeName(stripDtoSuffix(candidate));
    if (normalized) {
      matches.add(normalized);
    }
  };

  const refName = extractSchemaRef(schema);
  if (matchesAbstractType(refName, schemas)) {
    registerMatch(refName);
  }
  if (refName && schemas[refName] && !visited.has(refName)) {
    visited.add(refName);
    collectAbstractSchemaMatches(schemas[refName], schemas, matches, visited);
    visited.delete(refName);
  }

  if (schema.type === 'array' && schema.items) {
    collectAbstractSchemaMatches(schema.items, schemas, matches, visited);
  }

  const composites = [schema.oneOf, schema.anyOf, schema.allOf];
  for (const branch of composites) {
    if (Array.isArray(branch)) {
      for (const fragment of branch) {
        collectAbstractSchemaMatches(fragment, schemas, matches, visited);
      }
    }
  }

  if (schema.additionalProperties) {
    collectAbstractSchemaMatches(schema.additionalProperties, schemas, matches, visited);
  }

  const explicitTypeName = schema.title ?? schema['x-class-name'];
  if (matchesAbstractType(explicitTypeName, schemas)) {
    registerMatch(explicitTypeName);
  }
  return matches;
}

function buildAbstractFieldMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  excludedFields: Set<string> = new Set(),
  resolvableAbstractTargets: Set<string> = new Set()
): AbstractFieldMappingResult {
  if (!schemaName) {
    return { annotations: [], abstractTargets: new Set<string>() };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  if (!properties || Object.keys(properties).length === 0) {
    return { annotations: [], abstractTargets: new Set<string>() };
  }
  const targets = new Set<string>();
  const abstractTargets = new Set<string>();
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    if (!fieldSchema) {
      continue;
    }
    const targetField = direction === 'request' ? toJHipsterPropertyName(fieldName) : toOpenApiPropertyName(fieldName);
    
    if (excludedFields.has(targetField)) {
      continue;
    }

    const matches = collectAbstractSchemaMatches(fieldSchema, schemas);
    if (matches.size > 0) {
      const hasResolvableMatch = Array.from(matches).some(match => resolvableAbstractTargets.has(normalizeTypeName(match)!));
      if (hasResolvableMatch) {
        matches.forEach(match => abstractTargets.add(match));
        continue;
      }
      targets.add(targetField);
      matches.forEach(match => abstractTargets.add(match));
    }
  }
  return {
    annotations: Array.from(targets).map(field => `@Mapping(target = "${field}", ignore = true)`),
    abstractTargets,
  };
}

function buildObjectCollectionIgnoreAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  cache: Map<string, SchemaProperties>,
  direction: 'request' | 'response',
  excludedFields: Set<string> = new Set(),
): { annotations: string[]; ignoredFields: Set<string> } {
  const ignoredFields = new Set<string>();
  if (!schemaName) {
    return { annotations: [], ignoredFields };
  }
  const properties = collectSchemaProperties(schemaName, schemas, cache);
  for (const [fieldName, fieldSchema] of Object.entries<any>(properties)) {
    const resolvedField = resolveSchema(fieldSchema, schemas) ?? fieldSchema;
    if (resolvedField?.type !== 'array') {
      continue;
    }
    const itemsSchema = resolvedField.items ? resolveSchema(resolvedField.items, schemas) ?? resolvedField.items : undefined;
    if (!itemsSchema || isPrimitiveSchema(itemsSchema)) {
      continue;
    }
    const itemRef = extractSchemaRef(resolvedField.items);
    if (itemRef) {
      const itemProperties = collectSchemaProperties(itemRef, schemas, cache);
      const flatStructuredItem =
        Object.keys(itemProperties).length > 0 &&
        Object.values<any>(itemProperties).every(property => {
          const resolvedProperty = resolveSchema(property, schemas) ?? property;
          if (resolvedProperty?.type === 'array') {
            const resolvedItems = resolveSchema(resolvedProperty.items, schemas) ?? resolvedProperty.items;
            return Boolean(resolvedItems && isPrimitiveSchema(resolvedItems));
          }
          return isPrimitiveSchema(resolvedProperty);
        });
      if (flatStructuredItem) {
        continue;
      }
    }
    const targetField = direction === 'request' ? toJHipsterPropertyName(fieldName) : toOpenApiPropertyName(fieldName);
    if (!targetField || excludedFields.has(targetField)) {
      continue;
    }
    ignoredFields.add(targetField);
  }
  return {
    annotations: Array.from(ignoredFields).map(field => `@Mapping(target = "${field}", ignore = true)`),
    ignoredFields,
  };
}

function buildCycleMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  propertyCache: Map<string, SchemaProperties>,
  referenceCache: Map<string, SchemaFieldReferences>,
  normalizedBase: string | undefined,
  direction: 'request' | 'response',
  shouldIgnoreReference: (source?: string, target?: string, sourceIsCollection?: boolean, fieldName?: string) => boolean,
): { annotations: string[]; ignoredFields: Set<string> } {
  const annotations: string[] = [];
  const ignoredFields = new Set<string>();
  if (!schemaName || !normalizedBase) {
    return { annotations, ignoredFields };
  }

  const properties = collectSchemaProperties(schemaName, schemas, propertyCache);
  const references = collectSchemaFieldReferences(schemaName, schemas, propertyCache, referenceCache);

  for (const [fieldName, targets] of references.entries()) {
    const fieldSchema = properties?.[fieldName];
    const isCollection = fieldSchema?.type === 'array';
    const shouldIgnore = Array.from(targets).some(target =>
      shouldIgnoreReference(normalizedBase, target, Boolean(isCollection), fieldName),
    );
    if (!shouldIgnore) {
      continue;
    }
    const targetField = direction === 'request' ? toJHipsterPropertyName(fieldName) : toOpenApiPropertyName(fieldName);
    if (ignoredFields.has(targetField)) {
      continue;
    }
    ignoredFields.add(targetField);
    annotations.push(`@Mapping(target = "${targetField}", ignore = true)`);
  }

  return { annotations, ignoredFields };
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

function resolveDiscriminatorAccessorProperty(propertyName: string, schemaName: string | undefined, schemas: Record<string, any>): string {
  if (!propertyName || !schemaName) {
    return propertyName;
  }
  const properties = collectSchemaProperties(schemaName, schemas, new Map());
  if (propertyName.startsWith('@')) {
    const withoutAt = propertyName.substring(1);
    if (withoutAt && Object.prototype.hasOwnProperty.call(properties, withoutAt)) {
      return withoutAt;
    }
  }
  if (Object.prototype.hasOwnProperty.call(properties, propertyName)) {
    return propertyName.startsWith('@') ? propertyName.substring(1) || propertyName : propertyName;
  }
  const candidates = new Set<string>();
  if (propertyName.startsWith('@')) {
    const withoutAt = propertyName.substring(1);
    candidates.add(withoutAt);
    candidates.add(toJHipsterPropertyName(propertyName));
  } else {
    candidates.add(`@${propertyName}`);
    candidates.add(toJHipsterPropertyName(propertyName));
  }
  for (const candidate of candidates) {
    if (candidate && Object.prototype.hasOwnProperty.call(properties, candidate)) {
      return candidate;
    }
  }
  if (propertyName.startsWith('@')) {
    const withoutAt = propertyName.substring(1);
    if (withoutAt) {
      return withoutAt;
    }
  }
  return propertyName;
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
    for (const [discriminator, childName] of Object.entries(metadata.discriminatorValues)) {
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
      discriminatorAccessor = buildDiscriminatorAccessorExpression(
        resolveDiscriminatorAccessorProperty(discriminatorProperty, mapping.sourceSchemaName, schemas),
      );
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

function resolveSchemaDiscriminatorProperty(schemaName: string, schema: any, schemas: Record<string, any>): string | undefined {
  const discriminatorProperty = schema?.discriminator?.propertyName;
  if (discriminatorProperty) {
    return discriminatorProperty;
  }
  const properties = collectSchemaProperties(schemaName, schemas, new Map());
  if (Object.prototype.hasOwnProperty.call(properties, '@type')) {
    return '@type';
  }
  if (Object.prototype.hasOwnProperty.call(properties, 'atType')) {
    return 'atType';
  }
  return undefined;
}

function buildDomainDiscriminatorAccessorExpression(
  schemaName: string,
  schema: any,
  schemas: Record<string, any>,
  entityDefinitions: Map<string, any> | undefined,
  domainPropertyCache: Map<string, Set<string>>,
): string | undefined {
  const discriminatorProperty = resolveSchemaDiscriminatorProperty(schemaName, schema, schemas);
  if (!discriminatorProperty) {
    return undefined;
  }
  if (entityDefinitions && entityDefinitions.size > 0) {
    const domainProperties = collectDomainPropertyNames(stripDtoSuffix(schemaName), entityDefinitions, domainPropertyCache);
    if (!domainProperties.has(toJHipsterPropertyName(discriminatorProperty))) {
      return undefined;
    }
  }
  return buildDiscriminatorAccessorExpression(discriminatorProperty, 'unwrapped');
}

function buildRequestDiscriminatorAccessorExpression(
  schemaName: string,
  schema: any,
  schemas: Record<string, any>,
  fallbackDiscriminatorProperty?: string,
  subtypeNames: readonly string[] = [],
  basePackage = '',
  baseDtoIsCompositionInterface = false,
): string | undefined {
  const discriminatorProperty = resolveSchemaDiscriminatorProperty(schemaName, schema, schemas) ?? fallbackDiscriminatorProperty;
  if (!discriminatorProperty) {
    return undefined;
  }
  const accessorProperty = resolveDiscriminatorAccessorProperty(discriminatorProperty, schemaName, schemas);
  const normalizedAccessorProperty = toJHipsterPropertyName(accessorProperty);
  const baseProperties = collectBaseDtoProperties(schemaName, schemas);
  if (!baseDtoIsCompositionInterface && Object.keys(baseProperties).some(property => toJHipsterPropertyName(property) === normalizedAccessorProperty)) {
    return buildDiscriminatorAccessorExpression(accessorProperty);
  }

  // A valid discriminator can be declared only by concrete oneOf variants. In
  // that case the generated base is an interface, so use type-safe casts rather
  // than fabricating an accessor on the interface.
  const subtypeAccessors = subtypeNames.flatMap(subtypeName => {
    const subtypeSchema = schemas[subtypeName];
    if (!isGeneratedDtoModelSchema(subtypeSchema)) {
      return [];
    }
    const subtypeProperties = collectConcreteDtoProperties(subtypeSchema);
    if (!Object.keys(subtypeProperties).some(property => toJHipsterPropertyName(property) === normalizedAccessorProperty)) {
      return [];
    }
    const subtypeAccessor = resolveDiscriminatorAccessorProperty(discriminatorProperty, subtypeName, schemas);
    const dtoType = buildDtoFqcn(subtypeName, basePackage);
    const getter = buildDiscriminatorAccessorExpression(subtypeAccessor, `((${dtoType}) source)`);
    return [`source instanceof ${dtoType} ? ${getter} : `];
  });
  return subtypeAccessors.length > 0 ? `${subtypeAccessors.join('')}null` : undefined;
}

function buildPolymorphicMapping(
  schemaName: string,
  schema: any,
  basePackage: string,
  schemaVariants: Map<string, Set<string>>,
  schemas: Record<string, any>,
  derivedByBase: Map<string, Set<string>>,
  entityMetadata: Map<string, EntityMetadata>,
  polymorphicBaseTypes: Set<string>,
  entityDefinitions?: Map<string, any>,
  domainPropertyCache: Map<string, Set<string>> = new Map(),
  domainMapStructPropertyCache: Map<string, Map<string, string>> = new Map(),
  domainFieldTypeCache: Map<string, Map<string, string>> = new Map(),
  schemaPropertiesCache: Map<string, SchemaProperties> = new Map(),
  schemaJsonMetadataCache: Map<string, SchemaJsonMetadata> = new Map(),
  operationRequestSchemas: Set<string> = new Set(),
  operationResponseSchemas: Set<string> = new Set(),
  resolvableAbstractTargets: Set<string> = new Set(),
  fieldReferenceCache: Map<string, SchemaFieldReferences> = new Map(),
  shouldIgnoreRequestReference: (source?: string, target?: string, sourceIsCollection?: boolean) => boolean = () => false,
  shouldIgnoreResponseReference: (source?: string, target?: string, sourceIsCollection?: boolean) => boolean = () => false,
): PolymorphicTypeMapping | null {
  const baseType = stripDtoSuffix(schemaName);
  const derivedSchemasForBase = resolveDerivedSchemas(baseType, derivedByBase);
  if (!isPolymorphic(schema, schemaName) && derivedSchemasForBase.size === 0) return null;

  const normalizedBase = normalizeTypeName(baseType);
  // For RefOrValue families we need both reference and value subtypes, so avoid treating them as reference-only.
  const referenceLikeFamily = isReferenceLikeName(baseType) && !baseType.toLowerCase().includes('orvalue');
  let subtypeNames = extractSubtypes(schema);
  const compositionSubtypeNames = collectCompositeSubtypeNames(schema);
  const discriminatorSubtypeNames = new Set<string>();
  if (schema?.discriminator?.mapping) {
    for (const mappingTarget of Object.values<string>(schema.discriminator.mapping)) {
      if (!mappingTarget) {
        continue;
      }
      const refName = mappingTarget.includes('/') ? mappingTarget.split('/').pop() : mappingTarget;
      const normalized = normalizeTypeName(stripDtoSuffix(refName ?? ''));
      if (normalized) {
        discriminatorSubtypeNames.add(normalized);
      }
    }
  }
  if (compositionSubtypeNames.size > 0) {
    const allowedNames = new Set<string>([...compositionSubtypeNames, ...discriminatorSubtypeNames]);
    subtypeNames.splice(
      0,
      subtypeNames.length,
      ...subtypeNames.filter(name => allowedNames.has(normalizeTypeName(stripDtoSuffix(name)) ?? name)),
    );
  }
  if (subtypeNames.length === 0) {
    for (const derivedSchema of derivedSchemasForBase) {
      const normalizedDerived = stripDtoSuffix(derivedSchema);
      if (!normalizedDerived) {
        continue;
      }
      if (!subtypeNames.includes(normalizedDerived)) {
        subtypeNames.push(normalizedDerived);
      }
    }
  }
  if (subtypeNames.length === 0) {
    return null;
  }

  const baseMetadata = entityMetadata.get(normalizeEntityKey(baseType) ?? baseType);
  if (baseMetadata?.childEntities) {
    for (const child of baseMetadata.childEntities) {
      const normalizedChild = normalizeEntityKey(child.name);
      if (!normalizedChild) {
        continue;
      }
      if (compositionSubtypeNames.size > 0 && !compositionSubtypeNames.has(normalizedChild)) {
        continue;
      }
      if (!subtypeNames.includes(normalizedChild)) {
        subtypeNames.push(normalizedChild);
      }
    }
  }

  const baseDtoFqcn = buildDtoFqcn(schemaName, basePackage);
  const baseDomainFqcn = buildDomainFqcn(baseType, basePackage);
  const isAbstract =
    !!schema.discriminator ||
    !!schema.abstract ||
    !!schema['x-abstract'] ||
    (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) ||
    (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) ||
    derivedSchemasForBase.size > 0;
  const baseDtoIsCompositionInterface =
    (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) || (Array.isArray(schema.anyOf) && schema.anyOf.length > 0);
  const domainDiscriminatorAccessor = buildDomainDiscriminatorAccessorExpression(
    schemaName,
    schema,
    schemas,
    entityDefinitions,
    domainPropertyCache,
  );
  const hasDomainDiscriminatorAccessor = Boolean(domainDiscriminatorAccessor);
  const requestDiscriminatorAccessor = buildRequestDiscriminatorAccessorExpression(
    schemaName,
    schema,
    schemas,
    baseMetadata?.discriminatorProperty,
    subtypeNames,
    basePackage,
    baseDtoIsCompositionInterface,
  );
  const baseJsonMetadata = collectSchemaJsonMetadata(schemaName, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
  const { annotations: baseRequestJsonAnnotations, mappedFields: baseRequestJsonMappedFields } = buildJsonMappingAnnotations(
    baseJsonMetadata,
    'request',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
  );
  const { annotations: baseResponseJsonAnnotations, mappedFields: baseResponseJsonMappedFields } = buildJsonMappingAnnotations(
    baseJsonMetadata,
    'response',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
  );
  const { annotations: baseRequestUriAnnotations, mappedFields: baseRequestUriMappedFields } = buildUriMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'request',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
    baseRequestJsonMappedFields,
  );
  const { annotations: baseResponseUriAnnotations, mappedFields: baseResponseUriMappedFields } = buildUriMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'response',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
    baseResponseJsonMappedFields,
  );
  const { annotations: baseRequestScalarArrayAnnotations } = buildScalarArrayMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'request',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
    basePackage,
    new Set<string>([...baseRequestJsonMappedFields, ...baseRequestUriMappedFields]),
  );
  const { annotations: baseResponseScalarArrayAnnotations } = buildScalarArrayMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'response',
    baseType,
    entityDefinitions,
    domainFieldTypeCache,
    basePackage,
    new Set<string>([...baseResponseJsonMappedFields, ...baseResponseUriMappedFields]),
  );
  const { annotations: baseRequestObjectCollectionAnnotations } = buildObjectCollectionIgnoreAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'request',
    new Set<string>([...baseRequestJsonMappedFields, ...baseRequestUriMappedFields]),
  );
  const { annotations: baseResponseObjectCollectionAnnotations } = buildObjectCollectionIgnoreAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    'response',
    new Set<string>([...baseResponseJsonMappedFields, ...baseResponseUriMappedFields]),
  );
  const { annotations: baseRequestCycleAnnotations } = buildCycleMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    fieldReferenceCache,
    normalizedBase,
    'request',
    shouldIgnoreRequestReference,
  );
  const { annotations: baseResponseCycleAnnotations } = buildCycleMappingAnnotations(
    schemaName,
    schemas,
    schemaPropertiesCache,
    fieldReferenceCache,
    normalizedBase,
    'response',
    shouldIgnoreResponseReference,
  );

  let subtypeInfos: SubtypeInfo[] = subtypeNames
    .map((subtypeName): SubtypeInfo | undefined => {
      const domainCandidate = schemas[subtypeName] ? stripDtoSuffix(subtypeName) : baseType;
      if (!domainCandidate || ABSTRACT_SCHEMAS.has(domainCandidate)) {
        return undefined;
      }
      if (isAbstract && domainCandidate === baseType) {
        return undefined;
      }

      const metadataKey = normalizeEntityKey(baseType) ?? baseType;
      const ancestors = resolveDerivedAncestors(domainCandidate, derivedByBase, derivedAncestorsCache ?? new Map());
      const normalizedDomainCandidate = normalizeTypeName(domainCandidate) ?? domainCandidate;
      const domainAncestors = normalizedDomainCandidate ? domainAncestorsCache?.get(normalizedDomainCandidate) : undefined;
      const effectiveAncestors = domainAncestors && domainAncestors.size > 0 ? domainAncestors : ancestors;
      if (
        metadataKey &&
        effectiveAncestors.size > 0 &&
        !effectiveAncestors.has(metadataKey) &&
        metadataKey !== normalizeEntityKey(domainCandidate)
      ) {
        return undefined;
      }

      const baseMetadata = entityMetadata.get(normalizeEntityKey(baseType) ?? baseType);
      const domainAssignable = isDomainAssignableToBase(baseType, domainCandidate, entityDefinitions);
      const schemaAssignable = metadataKey ? effectiveAncestors.has(metadataKey) : false;
      const isCompatible =
        domainAssignable === undefined
          ? isSubtypeInstantiationCompatible(baseType, domainCandidate, baseMetadata) || schemaAssignable
          : domainAssignable;
      const discriminatorValue = resolveDiscriminatorValue(baseMetadata, domainCandidate);
      const usesHelperMapper = normalizedDomainCandidate ? polymorphicBaseTypes.has(normalizedDomainCandidate) : false;
      const normalizedSubtype = normalizeTypeName(stripDtoSuffix(subtypeName)) ?? subtypeName;
      const isDtoSubtype = compositionSubtypeNames.size === 0 ? true : compositionSubtypeNames.has(normalizedSubtype);

      return {
        dtoType: buildDtoFqcn(subtypeName, basePackage),
        domainType: buildDomainFqcn(domainCandidate, basePackage),
        dtoSimpleName: normalizeDtoTypeName(subtypeName),
        domainSimpleName: domainCandidate,
        discriminatorValue,
        isCompatible,
        usesHelperMapper,
        isDtoSubtype,
      } satisfies SubtypeInfo;
    })
    .filter((info): info is SubtypeInfo => !!info);
  subtypeInfos = subtypeInfos.filter(info => info.isCompatible !== false);

  if (referenceLikeFamily) {
    subtypeInfos = subtypeInfos.filter(info => isReferenceLikeName(info.domainSimpleName));
  }

  const uniqueSubtypeInfos = Array.from(new Map(subtypeInfos.map(info => [info.domainSimpleName, info])).values());
  const subtypeInfoByName = new Map(uniqueSubtypeInfos.map(info => [normalizeTypeName(info.domainSimpleName)!, info]));

  const inlineDtoVariantNames = new Set(extractSubtypes(schema).filter(subtypeName => !schemas[subtypeName]));
  const variantNames = new Set<string>(schemaVariants.get(baseType) ?? []);
  variantNames.add(schemaName);
  for (const derivedSchema of derivedSchemasForBase) {
    variantNames.add(derivedSchema);
  }
  for (const inlineVariantName of inlineDtoVariantNames) {
    variantNames.add(inlineVariantName);
  }

  for (const subtypeInfo of subtypeInfos) {
    const subtypeVariants = schemaVariants.get(subtypeInfo.domainSimpleName);
    if (!subtypeVariants) {
      continue;
    }
    for (const variantName of subtypeVariants) {
      variantNames.add(variantName);
    }
  }
  const nonAssignableSubtypes = subtypeInfos.filter(info => info.isDtoSubtype === false);
  if (nonAssignableSubtypes.length > 0) {
    const schemaNames = Object.keys(schemas);
    for (const subtypeInfo of nonAssignableSubtypes) {
      const normalizedSubtype = normalizeTypeName(stripDtoSuffix(subtypeInfo.dtoSimpleName)) ?? subtypeInfo.dtoSimpleName;
      if (!normalizedSubtype) {
        continue;
      }
      for (const candidate of schemaNames) {
        const normalizedCandidateBase = normalizeTypeName(stripDtoSuffix(candidate)) ?? candidate;
        if (normalizedCandidateBase === normalizedSubtype) {
          variantNames.add(candidate);
        }
      }
    }
  }

  const variants = Array.from(variantNames).filter(
    variantName => inlineDtoVariantNames.has(variantName) || isGeneratedDtoModelSchema(schemas[variantName]),
  );
  const baseSubtypeEntities = new Set(uniqueSubtypeInfos.map(info => info.domainSimpleName));

  return {
    baseType,
    baseDtoType: baseDtoFqcn,
    canonicalBaseDtoType:
      schemaName !== baseType && isGeneratedDtoModelSchema(schemas[baseType]) ? buildDtoFqcn(baseType, basePackage) : undefined,
    baseDomainType: baseDomainFqcn,
    subtypes: uniqueSubtypeInfos,
    isAbstract,
    isCompositionInterface: baseDtoIsCompositionInterface,
    baseMethodAnnotations: baseDtoIsCompositionInterface
      ? []
      : uniqueAnnotations([
          ...baseRequestJsonAnnotations,
          ...baseRequestUriAnnotations,
          ...baseRequestScalarArrayAnnotations,
          ...baseRequestObjectCollectionAnnotations,
          ...baseRequestCycleAnnotations,
        ]),
    baseResponseMethodAnnotations: baseDtoIsCompositionInterface
      ? []
      : uniqueAnnotations([
          ...baseResponseJsonAnnotations,
          ...baseResponseUriAnnotations,
          ...baseResponseScalarArrayAnnotations,
          ...baseResponseObjectCollectionAnnotations,
          ...baseResponseCycleAnnotations,
        ]),
    hasDomainDiscriminatorAccessor,
    domainDiscriminatorAccessor,
    requestDiscriminatorAccessor,
    variants: variants.map(variantName => {
      const normalized = normalizeTypeName(variantName);
      const variantSchema = schemas[variantName] ?? {};
      let variantSubtypeNames = extractSubtypes(variantSchema) ?? [];
      const variantCompositionSubtypeNames = collectCompositeSubtypeNames(variantSchema);
      if (variantCompositionSubtypeNames.size > 0) {
        variantSubtypeNames.splice(
          0,
          variantSubtypeNames.length,
          ...variantSubtypeNames.filter(name =>
            variantCompositionSubtypeNames.has(normalizeTypeName(stripDtoSuffix(name)) ?? name),
          ),
        );
      }
      let variantSubtypeInfos: SubtypeInfo[] = variantSubtypeNames
        .map((subtypeName): SubtypeInfo | undefined => {
          const domainCandidate = schemas[subtypeName] ? stripDtoSuffix(subtypeName) : baseType;
        if (!domainCandidate || ABSTRACT_SCHEMAS.has(domainCandidate)) {
          return undefined;
        }
        if (isAbstract && domainCandidate === baseType) {
          return undefined;
        }

        const metadataKey = normalizeEntityKey(baseType) ?? baseType;
        const ancestors = resolveDerivedAncestors(domainCandidate, derivedByBase, derivedAncestorsCache ?? new Map());
        const normalizedDomainCandidate = normalizeTypeName(domainCandidate) ?? domainCandidate;
        const domainAncestors = normalizedDomainCandidate ? domainAncestorsCache?.get(normalizedDomainCandidate) : undefined;
        const effectiveAncestors = domainAncestors && domainAncestors.size > 0 ? domainAncestors : ancestors;
        if (
          metadataKey &&
          effectiveAncestors.size > 0 &&
          !effectiveAncestors.has(metadataKey) &&
          metadataKey !== normalizeEntityKey(domainCandidate)
        ) {
          return undefined;
        }

        const baseMetadata = entityMetadata.get(normalizeEntityKey(baseType) ?? baseType);
        const domainAssignable = isDomainAssignableToBase(baseType, domainCandidate, entityDefinitions);
        const schemaAssignable = metadataKey ? effectiveAncestors.has(metadataKey) : false;
        const isCompatible =
          domainAssignable === undefined
            ? isSubtypeInstantiationCompatible(baseType, domainCandidate, baseMetadata) || schemaAssignable
            : domainAssignable;
        const discriminatorValue = resolveDiscriminatorValue(baseMetadata, domainCandidate);
        const usesHelperMapper = normalizedDomainCandidate ? polymorphicBaseTypes.has(normalizedDomainCandidate) : false;
        const normalizedSubtype = normalizeTypeName(stripDtoSuffix(subtypeName)) ?? subtypeName;
        const isDtoSubtype = compositionSubtypeNames.size === 0 ? true : compositionSubtypeNames.has(normalizedSubtype);

        return {
          dtoType: buildDtoFqcn(subtypeName, basePackage),
          domainType: buildDomainFqcn(domainCandidate, basePackage),
          dtoSimpleName: normalizeDtoTypeName(subtypeName),
          domainSimpleName: domainCandidate,
          discriminatorValue,
          isCompatible,
          usesHelperMapper,
          isDtoSubtype,
        } satisfies SubtypeInfo;
        })
        .filter((subtypeInfo): subtypeInfo is SubtypeInfo => !!subtypeInfo);
      variantSubtypeInfos = variantSubtypeInfos.filter(info => info.isCompatible !== false);

      if (referenceLikeFamily) {
        variantSubtypeInfos = variantSubtypeInfos.filter(info => isReferenceLikeName(info.domainSimpleName));
      }

      if (variantSubtypeInfos.length === 0 && normalized) {
        const normalizedDomain = normalizeTypeName(stripDtoSuffix(variantName));
        const candidate = (normalizedDomain && subtypeInfoByName.get(normalizedDomain)) ?? undefined;
        if (candidate && (!referenceLikeFamily || isReferenceLikeName(candidate.domainSimpleName))) {
          variantSubtypeInfos = [candidate];
        }
      }

      const resolvedDomainSubtype = resolveVariantDomainSubtype(variantName, variantSubtypeInfos, baseType, subtypeInfoByName);
      const variantDtoSimpleName = normalizeDtoTypeName(variantName);
      const mappingMethodName = `to${variantDtoSimpleName}`;
      const targetDomainSimpleName = resolvedDomainSubtype?.domainSimpleName ?? baseType;
      const assignableToBaseDto =
        inlineDtoVariantNames.has(variantName) ||
        uniqueSubtypeInfos.some(info => info.dtoSimpleName === variantDtoSimpleName && info.isDtoSubtype !== false);
      const variantJsonMetadata = collectSchemaJsonMetadata(variantName, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
      const { annotations: variantRequestJsonAnnotations, mappedFields: variantRequestJsonMappedFields } = buildJsonMappingAnnotations(
        variantJsonMetadata,
        'request',
        targetDomainSimpleName,
        entityDefinitions,
        domainFieldTypeCache,
      );
      const { annotations: variantResponseJsonAnnotations, mappedFields: variantResponseJsonMappedFields } = buildJsonMappingAnnotations(
        variantJsonMetadata,
        'response',
        targetDomainSimpleName,
        entityDefinitions,
        domainFieldTypeCache,
      );
      const { annotations: variantRequestUriAnnotations, mappedFields: variantRequestUriMappedFields } = buildUriMappingAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        'request',
        targetDomainSimpleName,
        entityDefinitions,
        domainFieldTypeCache,
        variantRequestJsonMappedFields,
      );
      const { annotations: variantResponseUriAnnotations, mappedFields: variantResponseUriMappedFields } = buildUriMappingAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        'response',
        targetDomainSimpleName,
        entityDefinitions,
        domainFieldTypeCache,
        variantResponseJsonMappedFields,
      );
      const { annotations: variantRequestScalarArrayAnnotations, mappedFields: variantRequestScalarArrayMappedFields } =
        buildScalarArrayMappingAnnotations(
          variantName,
          schemas,
          schemaPropertiesCache,
          'request',
          targetDomainSimpleName,
          entityDefinitions,
          domainFieldTypeCache,
          basePackage,
          new Set<string>([...variantRequestJsonMappedFields, ...variantRequestUriMappedFields]),
        );
      const { annotations: variantResponseScalarArrayAnnotations, mappedFields: variantResponseScalarArrayMappedFields } =
        buildScalarArrayMappingAnnotations(
          variantName,
          schemas,
          schemaPropertiesCache,
          'response',
          targetDomainSimpleName,
          entityDefinitions,
          domainFieldTypeCache,
          basePackage,
          new Set<string>([...variantResponseJsonMappedFields, ...variantResponseUriMappedFields]),
        );
      const { annotations: variantRequestObjectCollectionAnnotations } = buildObjectCollectionIgnoreAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        'request',
        new Set<string>([
          ...variantRequestJsonMappedFields,
          ...variantRequestUriMappedFields,
          ...variantRequestScalarArrayMappedFields,
        ]),
      );
      const { annotations: variantResponseObjectCollectionAnnotations } = buildObjectCollectionIgnoreAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        'response',
        new Set<string>([
          ...variantResponseJsonMappedFields,
          ...variantResponseUriMappedFields,
          ...variantResponseScalarArrayMappedFields,
        ]),
      );
      const { annotations: variantRequestCycleAnnotations, ignoredFields: variantRequestCycleIgnoredFields } = buildCycleMappingAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        fieldReferenceCache,
        normalizedBase,
        'request',
        shouldIgnoreRequestReference,
      );
      const { annotations: variantResponseCycleAnnotations, ignoredFields: variantResponseCycleIgnoredFields } = buildCycleMappingAnnotations(
        variantName,
        schemas,
        schemaPropertiesCache,
        fieldReferenceCache,
        normalizedBase,
        'response',
        shouldIgnoreResponseReference,
      );
      const variantAbstractAnnotations = filterMappingAnnotationsByDomainProperty(
        uniqueAnnotations([
          ...variantRequestJsonAnnotations,
          ...variantRequestUriAnnotations,
          ...variantRequestScalarArrayAnnotations,
          ...variantRequestObjectCollectionAnnotations,
          ...variantRequestCycleAnnotations,
          ...buildAbstractFieldMappingAnnotations(
            variantName,
            schemas,
            schemaPropertiesCache,
            'request',
            new Set<string>([
              ...variantRequestJsonMappedFields,
              ...variantRequestUriMappedFields,
              ...variantRequestScalarArrayMappedFields,
              ...variantRequestCycleIgnoredFields,
            ]),
            resolvableAbstractTargets,
          ).annotations,
        ]),
        baseType,
        entityDefinitions,
        domainPropertyCache,
        'target',
        domainMapStructPropertyCache,
      );
      const variantResponseAbstractAnnotations = filterMappingAnnotationsByDomainProperty(
        uniqueAnnotations([
          ...variantResponseJsonAnnotations,
          ...variantResponseUriAnnotations,
          ...variantResponseScalarArrayAnnotations,
          ...variantResponseObjectCollectionAnnotations,
          ...variantResponseCycleAnnotations,
          ...buildAbstractFieldMappingAnnotations(
            variantName,
            schemas,
            schemaPropertiesCache,
            'response',
            new Set<string>([
              ...variantResponseJsonMappedFields,
              ...variantResponseUriMappedFields,
              ...variantResponseScalarArrayMappedFields,
              ...variantResponseCycleIgnoredFields,
            ]),
            resolvableAbstractTargets,
          ).annotations,
        ]),
        targetDomainSimpleName,
        entityDefinitions,
        domainPropertyCache,
        'source',
        domainMapStructPropertyCache,
      );

      return {
        dtoType: buildDtoFqcn(variantName, basePackage),
        dtoSimpleName: variantDtoSimpleName,
        normalizedName: normalized,
        isBase: normalized === normalizedBase,
        isWrapper: isWrapperVariantSchema(variantName, schemas, baseSubtypeEntities),
        isRequestVariant: operationRequestSchemas.has(variantName),
        isResponseVariant: operationResponseSchemas.has(variantName),
        usesHelperMapper: resolvedDomainSubtype?.usesHelperMapper ?? false,
        subtypes: variantSubtypeInfos,
        targetDomainType: resolvedDomainSubtype?.domainType ?? baseDomainFqcn,
        targetDomainSimpleName,
        mappingMethodName,
        annotations: variantAbstractAnnotations,
        responseAnnotations: variantResponseAbstractAnnotations,
        generateObjectFactory: targetDomainSimpleName === baseType && !inlineDtoVariantNames.has(variantName),
        assignableToBaseDto,
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
  abstractSchemas?: Iterable<string>,
  entityDefinitions?: Map<string, any>,
): {
  helperMappers: PolymorphicHelperMapperContext[];
  entityMappers: EntityMapperContext[];
} {
  ABSTRACT_SCHEMAS.clear();
  if (abstractSchemas) {
    for (const name of abstractSchemas) {
      const normalized = normalizeTypeName(name);
      if (normalized) {
        ABSTRACT_SCHEMAS.add(normalized);
      }
    }
  }

  const schemas = spec.schemas;
  const polymorphicTypes: PolymorphicTypeMapping[] = [];
  const entityMappersMap = new Map<string, EntityMapperContext>();
  const processedPolyTypes = new Set<string>();
  const variantsByEntity = new Map<string, Set<string>>();
  const schemaVariants = new Map<string, Set<string>>();
  const requestTargetsBySchema = new Map<string, Set<string>>();
  const responseSourcesBySchema = new Map<string, Set<string>>();
  const responseSchemasByRequestTarget = new Map<string, Set<string>>();
  const operationRequestSchemas = new Set<string>();
  const operationResponseSchemas = new Set<string>();
  const entityMetadata = collectEntityMetadata(operationDescriptors, resolveDomainMetadata, entityDefinitions);
  const relationshipTargets = new Map<string, Map<string, string>>();
  const schemaJsonMetadataCache = new Map<string, SchemaJsonMetadata>();
  const schemaPropertiesCache = new Map<string, SchemaProperties>();
  const fieldReferenceCache = new Map<string, SchemaFieldReferences>();
  const domainPropertyCache = new Map<string, Set<string>>();
  const domainMapStructPropertyCache = new Map<string, Map<string, string>>();
  const domainFieldTypeCache = new Map<string, Map<string, string>>();
  const polymorphicFactoryFallbacks = new Map<string, PolymorphicFallbackFactoryMetadata>();
  const derivedByBase = collectAllOfDerivedSchemas(schemas);
  derivedSchemasCache = derivedByBase;
  const ancestorCache = new Map<string, Set<string>>();
  derivedAncestorsCache = ancestorCache;
  for (const base of derivedByBase.keys()) {
    resolveDerivedAncestors(base, derivedByBase, ancestorCache);
  }
  if (entityDefinitions) {
    for (const [entityName, definition] of entityDefinitions.entries()) {
      const normalizedEntity = normalizeTypeName(entityName) ?? entityName;
      if (!normalizedEntity) {
        continue;
      }
      const relationships = Array.isArray(definition?.relationships) ? definition.relationships : [];
      if (relationships.length === 0) {
        continue;
      }
      const relationshipMap = new Map<string, string>();
      for (const relationship of relationships) {
        const relName = relationship?.relationshipName ?? relationship?.fieldName;
        const otherEntity =
          relationship?.otherEntityName ??
          relationship?.otherEntityNameCapitalized ??
          relationship?.otherEntity ??
          relationship?.otherEntityRelationshipName;
        const normalizedOther = normalizeTypeName(otherEntity ?? '');
        if (relName && normalizedOther) {
          relationshipMap.set(relName, normalizedOther);
          relationshipMap.set(toJHipsterPropertyName(relName), normalizedOther);
          const mapStructPropertyName = relationshipMapStructPropertyName(relationship);
          if (mapStructPropertyName) {
            relationshipMap.set(mapStructPropertyName, normalizedOther);
          }
        }
      }
      if (relationshipMap.size > 0) {
        relationshipTargets.set(normalizedEntity, relationshipMap);
      }
    }
  }
  if (entityDefinitions && entityDefinitions.size > 0) {
    const cache = new Map<string, Set<string>>();
    for (const entityName of entityDefinitions.keys()) {
      resolveDomainAncestors(entityName, entityDefinitions, cache);
    }
    domainAncestorsCache = cache;
  }

  const allEntityNames = new Set<string>();
  for (const schemaName of Object.keys(schemas)) {
    const base = stripDtoSuffix(schemaName);
    const normalized = normalizeTypeName(base);
    if (normalized) {
      allEntityNames.add(normalized);
    }
  }
  const resolvableAbstractTargets = new Set<string>(allEntityNames);
  for (const abstractName of ABSTRACT_SCHEMAS) {
    const normalized = normalizeTypeName(abstractName) ?? abstractName;
    resolvableAbstractTargets.delete(normalized);
  }
  for (const schemaName of Object.keys(schemas)) {
    if (isReferenceLikeName(schemaName) && /orvalue/i.test(schemaName)) {
      const normalized = normalizeTypeName(stripDtoSuffix(schemaName)) ?? schemaName;
      resolvableAbstractTargets.delete(normalized);
    }
  }

  try {
  const schemaReferenceGraph = buildSchemaReferenceGraph(schemas, schemaPropertiesCache, fieldReferenceCache);
  const { componentByNode, componentSizes } = computeStronglyConnectedComponents(schemaReferenceGraph);

  const isCyclicReference = (source?: string, target?: string): boolean => {
    const normalizedSource = normalizeTypeName(source ?? '');
    const normalizedTarget = normalizeTypeName(target ?? '');
    if (!normalizedSource || !normalizedTarget) {
      return false;
    }
    const sourceComponent = componentByNode.get(normalizedSource);
    const targetComponent = componentByNode.get(normalizedTarget);
    if (sourceComponent === undefined || targetComponent === undefined) {
      return false;
    }
    if (sourceComponent !== targetComponent) {
      return false;
    }
    const componentSize = componentSizes.get(sourceComponent) ?? 0;
    return componentSize > 1;
  };

  const shouldIgnoreReference = (source?: string, target?: string, sourceIsCollection = false): boolean => {
    if (!isCyclicReference(source, target)) return false;
    if (sourceIsCollection) {
      if (isCycleSafeReferenceLikeCollectionTarget(target)) {
        return false;
      }
      return true;
    }
    return false;
  };

  const isInverseDomainRelationship = (source?: string, fieldName?: string): boolean => {
    if (!source || !fieldName) {
      return false;
    }
    const definition = resolveEntityDefinition(source, entityDefinitions);
    const relationships = Array.isArray(definition?.relationships) ? definition.relationships : [];
    const normalizedField = toJHipsterPropertyName(fieldName);
    return relationships.some((relationship: any) => {
      const relationshipName = relationshipMapStructPropertyName(relationship) ?? relationship?.relationshipName ?? relationship?.fieldName;
      if (relationshipName !== normalizedField) {
        return false;
      }
      return relationship?.relationshipSide === 'right' || Boolean(relationship?.otherEntityRelationshipName);
    });
  };

  const shouldIgnoreResponseReference = (
    source?: string,
    target?: string,
    sourceIsCollection = false,
    fieldName?: string,
  ): boolean => {
    if (!isCyclicReference(source, target)) return false;
    return sourceIsCollection ? shouldIgnoreReference(source, target, true) : isInverseDomainRelationship(source, fieldName);
  };

  const addSchemaReferences = (target: Set<string>, schemaName: string | undefined, normalizedBase?: string) => {
    if (!schemaName || !normalizedBase) {
      return;
    }
    const properties = collectSchemaProperties(schemaName, schemas, schemaPropertiesCache);
    const fieldReferences = collectSchemaFieldReferences(schemaName, schemas, schemaPropertiesCache, fieldReferenceCache);
    for (const [fieldName, refs] of fieldReferences.entries()) {
      const fieldSchema = properties?.[fieldName];
      const isCollection = fieldSchema?.type === 'array';
      for (const ref of refs) {
        if (isOpenApiAliasModelSchema(schemas[ref])) {
          continue;
        }
        const normalized = normalizeTypeName(ref);
        if (!normalized || normalized === normalizedBase) {
          continue;
        }
        if (shouldIgnoreReference(normalizedBase, normalized, Boolean(isCollection))) {
          continue;
        }
        target.add(normalized);
      }
    }
  };
  const recordUsage = (target: Map<string, Set<string>>, key: string, value: string) => {
    if (!key || !value) {
      return;
    }
    if (!target.has(key)) {
      target.set(key, new Set());
    }
    target.get(key)!.add(value);
  };
  const requestTargetKey = (requestSchemaName: string, targetEntityName: string) => `${stripDtoSuffix(requestSchemaName)}->${targetEntityName}`;

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
    if (requestSchema) {
      operationRequestSchemas.add(requestSchema);
    }
    if (responseSchema) {
      operationResponseSchemas.add(responseSchema);
    }

    const resourceCandidate =
      descriptor?.matchedEntity?.name ??
      descriptor?.resourceName ??
      (requestSchema ? stripDtoSuffix(requestSchema) : undefined) ??
      (responseSchema ? stripDtoSuffix(responseSchema) : undefined);
    const resourceEntity = resolveOperationResourceEntity(resourceCandidate, entityDefinitions);

    if (resourceEntity) {
      if (requestSchema) {
        recordUsage(requestTargetsBySchema, stripDtoSuffix(requestSchema), resourceEntity);
        if (responseSchema) {
          recordUsage(responseSchemasByRequestTarget, requestTargetKey(requestSchema, resourceEntity), responseSchema);
        }
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

  const schemaNamesByNormalizedName = new Map<string, string>();
  for (const schemaName of Object.keys(schemas)) {
    const normalized = normalizeTypeName(stripDtoSuffix(schemaName));
    if (normalized && !schemaNamesByNormalizedName.has(normalized)) {
      schemaNamesByNormalizedName.set(normalized, schemaName);
    }
  }

  const expandRequestSchemaReachability = () => {
    const requestSchemaQueue = Array.from(operationRequestSchemas);
    const visitedRequestSchemas = new Set<string>();
    while (requestSchemaQueue.length > 0) {
      const currentSchema = requestSchemaQueue.shift()!;
      if (!currentSchema || visitedRequestSchemas.has(currentSchema)) {
        continue;
      }
      visitedRequestSchemas.add(currentSchema);
      const exactReferences = collectExactSchemaReferences(currentSchema, schemas, schemaPropertiesCache);
      for (const target of exactReferences) {
        const targetSchemaName = schemas[target] ? target : schemaNamesByNormalizedName.get(normalizeTypeName(stripDtoSuffix(target)) ?? '');
        if (targetSchemaName && !operationRequestSchemas.has(targetSchemaName)) {
          operationRequestSchemas.add(targetSchemaName);
          requestSchemaQueue.push(targetSchemaName);
        }
        const targetBaseSchemaName = schemaNamesByNormalizedName.get(normalizeTypeName(stripDtoSuffix(target)) ?? '');
        if (targetBaseSchemaName && !operationRequestSchemas.has(targetBaseSchemaName)) {
          operationRequestSchemas.add(targetBaseSchemaName);
          requestSchemaQueue.push(targetBaseSchemaName);
        }
      }
    }
  };

  expandRequestSchemaReachability();

  for (const [baseEntity, variants] of schemaVariants.entries()) {
    const hasRequestVariantForEntity = [...variants].some(variantName => operationRequestSchemas.has(variantName));
    if (hasRequestVariantForEntity) {
      continue;
    }
    const normalizedBase = normalizeTypeName(baseEntity);
    for (const variantName of variants) {
      if (!isGeneratedDtoModelSchema(schemas[variantName])) {
        continue;
      }
      const normalizedVariant = normalizeTypeName(variantName) ?? variantName;
      const normalizedVariantUpper = normalizedVariant.toUpperCase();
      if (normalizedVariant === normalizedBase || normalizedVariantUpper.endsWith('FVO') || normalizedVariantUpper.endsWith('MVO')) {
        operationRequestSchemas.add(variantName);
      }
    }
  }

  expandRequestSchemaReachability();

  const polymorphicBaseTypes = new Set<string>();
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) {
      continue;
    }
    if (!isObjectLikeSchema(schema)) {
      continue;
    }
    if (isOpenApiAliasModelSchema(schema)) {
      continue;
    }
    const baseEntity = stripDtoSuffix(schemaName);
    if (!baseEntity || ABSTRACT_SCHEMAS.has(baseEntity)) {
      continue;
    }
    const normalizedBase = normalizeTypeName(baseEntity) ?? baseEntity;
    const hasDerivedPolymorphism = shouldTreatDerivedOnlyBaseAsPolymorphic(schemaName, schema, derivedByBase);
    if (isPolymorphic(schema, schemaName) || hasDerivedPolymorphism) {
      polymorphicBaseTypes.add(normalizedBase);
    }
  }

  // Phase 1: Identify all polymorphic types (deduplicate by base type)
  const helperReferencedEntities = new Map<string, Set<string>>();

  const registerHelperReferences = (helperName: string, schemaName: string) => {
    const normalizedHelper = normalizeTypeName(helperName);
    if (!normalizedHelper) {
      return;
    }
    const target = helperReferencedEntities.get(helperName) ?? new Set<string>();
    addSchemaReferences(target, schemaName, normalizedHelper);
    helperReferencedEntities.set(helperName, target);
  };

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) continue;
    if (!isObjectLikeSchema(schema)) continue;
    if (isOpenApiAliasModelSchema(schema)) continue;

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) continue;

    // Only process each base polymorphic type once (skip DTO/FVO/MVO variants)
    const hasDerivedPolymorphism = shouldTreatDerivedOnlyBaseAsPolymorphic(schemaName, schema, derivedByBase);
    if ((isPolymorphic(schema, schemaName) || hasDerivedPolymorphism) && !processedPolyTypes.has(baseEntity)) {
      processedPolyTypes.add(baseEntity);
      const polyMapping = buildPolymorphicMapping(
        schemaName,
        schema,
        basePackage,
        schemaVariants,
        schemas,
        derivedByBase,
        entityMetadata,
        polymorphicBaseTypes,
        entityDefinitions,
        domainPropertyCache,
        domainMapStructPropertyCache,
        domainFieldTypeCache,
        schemaPropertiesCache,
        schemaJsonMetadataCache,
        operationRequestSchemas,
        operationResponseSchemas,
        resolvableAbstractTargets,
        fieldReferenceCache,
        shouldIgnoreReference,
        shouldIgnoreResponseReference,
      );
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
    if (isEnumSchema(schema)) {
        continue;
    }
    if (!isObjectLikeSchema(schema)) {
        continue;
    }
    if (isOpenApiAliasModelSchema(schema)) {
        continue;
    }
    if (isEmptyObjectMarkerSchema(schema)) {
        continue;
    }

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) {
        continue;
    }

    // Skip polymorphic base types (handled by helper mappers)
    if (isPolymorphic(schema, schemaName)) {
        continue;
    }

    // Skip DTO variants (FVO, MVO) - only process base entity once
    if (!entityMappersMap.has(baseEntity)) {
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
      if (normalizedBase && polymorphicBaseTypes.has(normalizedBase)) {
        continue;
      }
      const operationVariants = new Set<string>(
        [...(schemaVariants.get(baseEntity) ?? [])].filter(variantName => isGeneratedDtoModelSchema(schemas[variantName])),
      );
      operationVariants.add(schemaName);
      const requestTargets = requestTargetsBySchema.get(baseEntity) ?? new Set<string>();
      const responseSources = responseSourcesBySchema.get(baseEntity) ?? new Set<string>();
      const operationResponseVariants = new Set<string>(
        [...(responseSchemasByRequestTarget.get(requestTargetKey(baseEntity, baseEntity)) ?? [])].filter(variantName =>
          isGeneratedDtoModelSchema(schemas[variantName]),
        ),
      );
      operationResponseVariants.forEach(variantName => operationVariants.add(variantName));

      const siblingVariants = Object.keys(schemas).filter(
        schemaKey => stripDtoSuffix(schemaKey) === baseEntity && isGeneratedDtoModelSchema(schemas[schemaKey]),
      );
      for (const siblingVariant of siblingVariants) {
        operationVariants.add(siblingVariant);
      }

      const baseJsonMetadata = collectSchemaJsonMetadata(baseEntity, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
      const { annotations: baseRequestJsonAnnotations, mappedFields: baseRequestJsonMappedFields } = buildJsonMappingAnnotations(
        baseJsonMetadata,
        'request',
        baseEntity,
        entityDefinitions,
        domainFieldTypeCache,
      );
      const { annotations: baseResponseJsonAnnotations, mappedFields: baseResponseJsonMappedFields } = buildJsonMappingAnnotations(
        baseJsonMetadata,
        'response',
        baseEntity,
        entityDefinitions,
        domainFieldTypeCache,
      );
      const { annotations: baseRequestUriAnnotations, mappedFields: baseRequestUriMappedFields } = buildUriMappingAnnotations(
        baseEntity,
        schemas,
        schemaPropertiesCache,
        'request',
        baseEntity,
        entityDefinitions,
        domainFieldTypeCache,
        baseRequestJsonMappedFields,
      );
      const { annotations: baseResponseUriAnnotations, mappedFields: baseResponseUriMappedFields } = buildUriMappingAnnotations(
        baseEntity,
        schemas,
        schemaPropertiesCache,
        'response',
        baseEntity,
        entityDefinitions,
        domainFieldTypeCache,
        baseResponseJsonMappedFields,
      );
      const { annotations: baseRequestAliasAnnotations, ignoredFields: baseRequestAliasIgnoredFields } =
        buildAliasModelFieldIgnoreAnnotations(baseEntity, schemas, schemaPropertiesCache, 'request', baseRequestJsonMappedFields);
      const { annotations: baseResponseAliasAnnotations, ignoredFields: baseResponseAliasIgnoredFields } =
        buildAliasModelFieldIgnoreAnnotations(baseEntity, schemas, schemaPropertiesCache, 'response', baseResponseJsonMappedFields);

      const variants = Array.from(operationVariants).sort((a, b) => {
        const normalizedA = normalizeTypeName(a);
        const normalizedB = normalizeTypeName(b);

        const priority = (normalized: string) => {
          const upper = normalized.toUpperCase();
          if (normalized === normalizedBase) return 0;
          if (upper.endsWith('FVO')) return 1;
          if (upper.endsWith('MVO')) return 2;
          if (upper.endsWith('DTO')) return 3;
          return 4;
        };

        const diff = priority(normalizedA) - priority(normalizedB);
        return diff !== 0 ? diff : normalizedA.localeCompare(normalizedB);
      });

      // const hasFvoVariant = variants.some(variantName => normalizeTypeName(variantName).endsWith('FVO'));
      // const hasMvoVariant = variants.some(variantName => normalizeTypeName(variantName).endsWith('MVO'));
      // const hasRequestSpecificVariant = hasFvoVariant || hasMvoVariant;
      const hasBaseVariant = variants.some(variantName => normalizeTypeName(variantName) === normalizedBase);
      const hasOperationRequestUsage = operationRequestSchemas.size > 0;
      const hasOperationRequestVariantForEntity = variants.some(variantName => operationRequestSchemas.has(variantName));
      const referencedEntities = new Set<string>();
      const registerFieldReferences = (schemaVariant?: string) => addSchemaReferences(referencedEntities, schemaVariant, normalizedBase ?? undefined);

      for (const variant of variants) {
        registerFieldReferences(variant);
      }

      const addReferencedTarget = (target?: string) => {
        if (!target) {
          return;
        }
        const normalized = normalizeTypeName(target);
        if (!normalized || normalized === normalizedBase) {
          return;
        }
        if (shouldIgnoreReference(normalizedBase, normalized)) {
          return;
        }
        referencedEntities.add(normalized);
      };

      for (const variant of variants) {
        const variantDtoType = buildDtoFqcn(variant, basePackage);
        const normalizedVariant = normalizeTypeName(variant) ?? variant;
        const normalizedVariantUpper = normalizedVariant.toUpperCase();
        const isFVO = normalizedVariantUpper.endsWith('FVO');
        const isBaseVariant = normalizedVariant === normalizedBase;
        const isMVO = normalizedVariantUpper.endsWith('MVO');
        const isOperationRequestVariant = operationRequestSchemas.has(variant);
        const isOperationResponseVariant = operationResponseVariants.has(variant);
        const variantJsonMetadata = collectSchemaJsonMetadata(variant, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
        const { annotations: requestJsonAnnotations, mappedFields: requestMappedFields } = buildJsonMappingAnnotations(
          variantJsonMetadata,
          'request',
          baseEntity,
          entityDefinitions,
          domainFieldTypeCache,
        );
        const { annotations: responseJsonAnnotations, mappedFields: responseMappedFields } = buildJsonMappingAnnotations(
          variantJsonMetadata,
          'response',
          baseEntity,
          entityDefinitions,
          domainFieldTypeCache,
        );
        const { annotations: requestUriAnnotations, mappedFields: requestUriMappedFields } = buildUriMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          'request',
          baseEntity,
          entityDefinitions,
          domainFieldTypeCache,
          requestMappedFields,
        );
        const { annotations: responseUriAnnotations, mappedFields: responseUriMappedFields } = buildUriMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          'response',
          baseEntity,
          entityDefinitions,
          domainFieldTypeCache,
          responseMappedFields,
        );
        const { annotations: requestAliasAnnotations, ignoredFields: requestAliasIgnoredFields } =
          buildAliasModelFieldIgnoreAnnotations(variant, schemas, schemaPropertiesCache, 'request', requestMappedFields);
        const { annotations: responseAliasAnnotations, ignoredFields: responseAliasIgnoredFields } =
          buildAliasModelFieldIgnoreAnnotations(variant, schemas, schemaPropertiesCache, 'response', responseMappedFields);
        const { annotations: requestCycleAnnotations, ignoredFields: requestCycleIgnoredFields } = buildCycleMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          fieldReferenceCache,
          normalizedBase,
          'request',
          shouldIgnoreReference,
        );
        const { annotations: responseCycleAnnotations, ignoredFields: responseCycleIgnoredFields } = buildCycleMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          fieldReferenceCache,
          normalizedBase,
          'response',
          shouldIgnoreResponseReference,
        );
        const { annotations: requestPropertyAliasAnnotations, mappedFields: requestPropertyAliasMappedFields } =
          buildPropertyAliasMappingAnnotations(
            variant,
            schemas,
            schemaPropertiesCache,
            'request',
            new Set<string>([...requestMappedFields, ...requestUriMappedFields, ...requestAliasIgnoredFields, ...requestCycleIgnoredFields]),
            baseEntity,
            entityDefinitions,
            domainMapStructPropertyCache,
            relationshipTargets,
          );
        const { annotations: responsePropertyAliasAnnotations, mappedFields: responsePropertyAliasMappedFields } =
          buildPropertyAliasMappingAnnotations(
            variant,
            schemas,
            schemaPropertiesCache,
            'response',
            new Set<string>([...responseMappedFields, ...responseUriMappedFields, ...responseAliasIgnoredFields, ...responseCycleIgnoredFields]),
            baseEntity,
            entityDefinitions,
            domainMapStructPropertyCache,
            relationshipTargets,
          );
        const { annotations: requestScalarArrayAnnotations, mappedFields: requestScalarArrayMappedFields } =
          buildScalarArrayMappingAnnotations(
            variant,
            schemas,
            schemaPropertiesCache,
            'request',
            baseEntity,
            entityDefinitions,
            domainFieldTypeCache,
            basePackage,
            new Set<string>([
              ...requestMappedFields,
              ...requestUriMappedFields,
              ...requestPropertyAliasMappedFields,
              ...requestAliasIgnoredFields,
              ...requestCycleIgnoredFields,
            ]),
          );
        const { annotations: responseScalarArrayAnnotations, mappedFields: responseScalarArrayMappedFields } =
          buildScalarArrayMappingAnnotations(
            variant,
            schemas,
            schemaPropertiesCache,
            'response',
            baseEntity,
            entityDefinitions,
            domainFieldTypeCache,
            basePackage,
            new Set<string>([
              ...responseMappedFields,
              ...responseUriMappedFields,
              ...responsePropertyAliasMappedFields,
              ...responseAliasIgnoredFields,
              ...responseCycleIgnoredFields,
            ]),
          );
        const requestExcludedFields = new Set<string>([
          ...requestMappedFields,
          ...requestUriMappedFields,
          ...requestPropertyAliasMappedFields,
          ...requestScalarArrayMappedFields,
          ...requestAliasIgnoredFields,
          ...requestCycleIgnoredFields,
        ]);
        const responseExcludedFields = new Set<string>([
          ...responseMappedFields,
          ...responseUriMappedFields,
          ...responsePropertyAliasMappedFields,
          ...responseScalarArrayMappedFields,
          ...responseAliasIgnoredFields,
          ...responseCycleIgnoredFields,
        ]);
        const {
          annotations: responseScalarObjectMismatchAnnotations,
          mappedFields: responseScalarObjectMismatchMappedFields,
        } = buildScalarToObjectResponseIgnoreAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          baseEntity,
          entityDefinitions,
          domainFieldTypeCache,
          responseExcludedFields,
        );
        responseScalarObjectMismatchMappedFields.forEach(field => responseExcludedFields.add(field));
        const {
          annotations: requestAbstractAnnotations,
          abstractTargets: requestAbstractTargets,
        } = buildAbstractFieldMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          'request',
          requestExcludedFields,
          resolvableAbstractTargets,
        );
        const {
          annotations: responseAbstractAnnotations,
          abstractTargets: responseAbstractTargets,
        } = buildAbstractFieldMappingAnnotations(
          variant,
          schemas,
          schemaPropertiesCache,
          'response',
          responseExcludedFields,
          resolvableAbstractTargets,
        );
        requestAbstractTargets.forEach(target => addReferencedTarget(target));
        responseAbstractTargets.forEach(target => addReferencedTarget(target));

        if (
          ((!hasOperationRequestUsage || !hasOperationRequestVariantForEntity) && (isFVO || isMVO || isBaseVariant)) ||
          isOperationRequestVariant
        ) {
          const generatedUuidFields = buildReadOnlyRequiredUuidFields(
            baseEntity,
            variant,
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const generatedDefaultFields = buildSchemaBackedDefaultFields(
            baseEntity,
            variant,
            [baseEntity],
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const generatedBlobContentTypeFields = buildBlobContentTypeDefaultFields(
            baseEntity,
            variant,
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const annotations = filterMappingAnnotationsByDomainProperty(
            uniqueAnnotations([
              ...(isFVO ? ['@Mapping(target = "id", ignore = true)'] : []),
              ...requestJsonAnnotations,
              ...requestUriAnnotations,
              ...requestPropertyAliasAnnotations,
              ...requestScalarArrayAnnotations,
              ...requestAliasAnnotations,
              ...requestAbstractAnnotations,
              ...requestCycleAnnotations,
            ]),
            baseEntity,
            entityDefinitions,
            domainPropertyCache,
            'target',
            domainMapStructPropertyCache,
          );
          const methodName = buildVariantMappingMethodName(baseEntity, variant);
          addRequestMapping({
            methodName,
            sourceType: variantDtoType,
            targetType: domainType,
            annotations,
            sourceSchemaName: variant,
            generatedUuidFields,
            generatedDefaultFields: [...generatedDefaultFields, ...generatedBlobContentTypeFields],
          });
        }

        if (isBaseVariant || isOperationResponseVariant || (!hasBaseVariant && isFVO)) {
          const variantDtoSimpleName = normalizeDtoTypeName(variant);
          const responseMethodName = isBaseVariant ? `to${variantDtoSimpleName}Dto` : `to${variantDtoSimpleName}`;
          const annotations = filterMappingAnnotationsByDomainProperty(
            uniqueAnnotations([
              ...responseJsonAnnotations,
              ...responseUriAnnotations,
              ...responsePropertyAliasAnnotations,
              ...responseScalarArrayAnnotations,
              ...responseAliasAnnotations,
              ...responseScalarObjectMismatchAnnotations,
              ...responseAbstractAnnotations,
              ...responseCycleAnnotations,
            ]),
            baseEntity,
            entityDefinitions,
            domainPropertyCache,
            'source',
            domainMapStructPropertyCache,
          );
          addResponseMapping({
            methodName: responseMethodName,
            sourceType: domainType,
            targetType: variantDtoType,
            annotations,
            sourceSchemaName: baseEntity,
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
          const { annotations: baseCycleAnnotations, ignoredFields: baseCycleIgnoredFields } = buildCycleMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            fieldReferenceCache,
            normalizedBase,
            'request',
            shouldIgnoreReference,
          );
          const { annotations: baseRequestPropertyAliasAnnotations, mappedFields: baseRequestPropertyAliasMappedFields } =
            buildPropertyAliasMappingAnnotations(
              baseEntity,
              schemas,
              schemaPropertiesCache,
              'request',
              new Set<string>([
                ...baseRequestJsonMappedFields,
                ...baseRequestUriMappedFields,
                ...baseRequestAliasIgnoredFields,
                ...baseCycleIgnoredFields,
              ]),
              targetEntity,
              entityDefinitions,
              domainMapStructPropertyCache,
              relationshipTargets,
            );
          const { annotations: baseRequestScalarArrayAnnotations, mappedFields: baseRequestScalarArrayMappedFields } =
            buildScalarArrayMappingAnnotations(
              baseEntity,
              schemas,
              schemaPropertiesCache,
              'request',
              targetEntity,
              entityDefinitions,
              domainFieldTypeCache,
              basePackage,
              new Set<string>([
                ...baseRequestJsonMappedFields,
                ...baseRequestUriMappedFields,
                ...baseRequestPropertyAliasMappedFields,
                ...baseRequestAliasIgnoredFields,
                ...baseCycleIgnoredFields,
              ]),
            );
          const {
            annotations: fallbackAbstractAnnotations,
            abstractTargets: fallbackRequestTargets,
          } = buildAbstractFieldMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            'request',
              new Set<string>([
                ...baseRequestJsonMappedFields,
                ...baseRequestUriMappedFields,
                ...baseRequestPropertyAliasMappedFields,
                ...baseRequestScalarArrayMappedFields,
                ...baseRequestAliasIgnoredFields,
                ...baseCycleIgnoredFields,
              ]),
              resolvableAbstractTargets,
            );
          fallbackRequestTargets.forEach(target => addReferencedTarget(target));
          const generatedUuidFields = buildReadOnlyRequiredUuidFields(
            targetEntity,
            baseEntity,
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const generatedDefaultFields = buildSchemaBackedDefaultFields(
            targetEntity,
            baseEntity,
            [targetEntity, ...(responseSchemasByRequestTarget.get(requestTargetKey(baseEntity, targetEntity)) ?? [])],
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const generatedBlobContentTypeFields = buildBlobContentTypeDefaultFields(
            targetEntity,
            baseEntity,
            schemas,
            schemaPropertiesCache,
            entityDefinitions,
          );
          const annotations = filterMappingAnnotationsByDomainProperty(
            uniqueAnnotations([
              '@Mapping(target = "id", ignore = true)',
              ...baseRequestJsonAnnotations,
              ...baseRequestUriAnnotations,
              ...baseRequestPropertyAliasAnnotations,
              ...baseRequestScalarArrayAnnotations,
              ...baseRequestAliasAnnotations,
              ...fallbackAbstractAnnotations,
              ...baseCycleAnnotations,
            ]),
            targetEntity,
            entityDefinitions,
            domainPropertyCache,
            'target',
            domainMapStructPropertyCache,
          );
          addRequestMapping({
            methodName,
            sourceType,
            targetType,
            annotations,
            sourceSchemaName: baseEntity,
            targetSchemaName: targetEntity,
            generatedUuidFields,
            generatedDefaultFields: [...generatedDefaultFields, ...generatedBlobContentTypeFields],
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
          const { annotations: baseCycleAnnotations, ignoredFields: baseCycleIgnoredFields } = buildCycleMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            fieldReferenceCache,
            normalizedBase,
            'response',
            shouldIgnoreResponseReference,
          );
          const { annotations: baseResponsePropertyAliasAnnotations, mappedFields: baseResponsePropertyAliasMappedFields } =
            buildPropertyAliasMappingAnnotations(
              baseEntity,
              schemas,
              schemaPropertiesCache,
              'response',
              new Set<string>([
                ...baseResponseJsonMappedFields,
                ...baseResponseUriMappedFields,
                ...baseResponseAliasIgnoredFields,
                ...baseCycleIgnoredFields,
              ]),
              sourceEntity,
              entityDefinitions,
              domainMapStructPropertyCache,
              relationshipTargets,
            );
          const { annotations: baseResponseScalarArrayAnnotations, mappedFields: baseResponseScalarArrayMappedFields } =
            buildScalarArrayMappingAnnotations(
              baseEntity,
              schemas,
              schemaPropertiesCache,
              'response',
              sourceEntity,
              entityDefinitions,
              domainFieldTypeCache,
              basePackage,
              new Set<string>([
                ...baseResponseJsonMappedFields,
                ...baseResponseUriMappedFields,
                ...baseResponsePropertyAliasMappedFields,
                ...baseResponseAliasIgnoredFields,
                ...baseCycleIgnoredFields,
              ]),
            );
          const fallbackResponseExcludedFields = new Set<string>([
            ...baseResponseJsonMappedFields,
            ...baseResponseUriMappedFields,
            ...baseResponsePropertyAliasMappedFields,
            ...baseResponseScalarArrayMappedFields,
            ...baseResponseAliasIgnoredFields,
            ...baseCycleIgnoredFields,
          ]);
          const {
            annotations: fallbackScalarObjectMismatchAnnotations,
            mappedFields: fallbackScalarObjectMismatchMappedFields,
          } = buildScalarToObjectResponseIgnoreAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            sourceEntity,
            entityDefinitions,
            domainFieldTypeCache,
            fallbackResponseExcludedFields,
          );
          fallbackScalarObjectMismatchMappedFields.forEach(field => fallbackResponseExcludedFields.add(field));
          const {
            annotations: fallbackAbstractAnnotations,
            abstractTargets: fallbackResponseTargets,
          } = buildAbstractFieldMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            'response',
            fallbackResponseExcludedFields,
            resolvableAbstractTargets,
          );
          fallbackResponseTargets.forEach(target => addReferencedTarget(target));
          const annotations = filterMappingAnnotationsByDomainProperty(
            uniqueAnnotations([
              ...baseResponseJsonAnnotations,
              ...baseResponseUriAnnotations,
              ...baseResponsePropertyAliasAnnotations,
              ...baseResponseScalarArrayAnnotations,
              ...baseResponseAliasAnnotations,
              ...fallbackScalarObjectMismatchAnnotations,
              ...fallbackAbstractAnnotations,
              ...baseCycleAnnotations,
            ]),
            sourceEntity,
            entityDefinitions,
            domainPropertyCache,
            'source',
            domainMapStructPropertyCache,
          );
          addResponseMapping({
            methodName,
            sourceType,
            targetType,
            annotations,
            sourceSchemaName: sourceEntity,
            targetSchemaName: baseEntity,
          });
        }
      }

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

  const normalizedStandaloneMapperNames = new Set<string>();
  const registerStandaloneMapper = (name?: string) => {
    if (!name) {
      return;
    }
    const normalized = normalizeTypeName(stripDtoSuffix(name));
    if (normalized) {
      normalizedStandaloneMapperNames.add(normalized);
    }
  };

  for (const poly of polymorphicTypes) {
    registerStandaloneMapper(poly.baseType);
  }

  for (const entityName of entityMappersMap.keys()) {
    registerStandaloneMapper(entityName);
  }

  const polymorphicHelperTypes = new Set<string>(
    polymorphicTypes.map(mapping => normalizeTypeName(mapping.baseType) ?? mapping.baseType),
  );
  const updateHelperUsage = (subtype: SubtypeInfo): SubtypeInfo => {
    const normalizedSubtype = normalizeTypeName(subtype.domainSimpleName) ?? subtype.domainSimpleName;
    return {
      ...subtype,
      usesHelperMapper: normalizedSubtype ? polymorphicHelperTypes.has(normalizedSubtype) : false,
    };
  };

  const helperMappers: PolymorphicHelperMapperContext[] = polymorphicTypes.map(poly => {
    const mapperName = `${poly.baseType}Mapper`;
    const helperPackage = `${basePackage}.web.api.mapper`;
    const subtypeMapperFqcns = new Set<string>();
    const primitiveMapperFqcn = `${helperPackage}.OpenApiPrimitiveMapper`;
    // Always reference subtype mappers so MapStruct can delegate full field mapping (including FVO/MVO variants).
    for (const subtype of poly.subtypes) {
      const subtypeName = normalizeTypeName(subtype.domainSimpleName) ?? subtype.domainSimpleName;
      if (!subtypeName) {
        continue;
      }
      subtypeMapperFqcns.add(`${helperPackage}.${subtypeName}Mapper`);
    }
    const decoratedVariants = poly.variants.map(
      variant => {
        const generatedUuidFields = buildReadOnlyRequiredUuidFields(
          poly.baseType,
          variant.normalizedName,
          schemas,
          schemaPropertiesCache,
          entityDefinitions,
        );
        const generatedDefaultFields = buildSchemaBackedDefaultFields(
          poly.baseType,
          variant.normalizedName,
          [poly.baseType],
          schemas,
          schemaPropertiesCache,
          entityDefinitions,
        );
        const generatedBlobContentTypeFields = buildBlobContentTypeDefaultFields(
          poly.baseType,
          variant.normalizedName,
          schemas,
          schemaPropertiesCache,
          entityDefinitions,
        );
        return {
          ...variant,
          requiresHelperMapping: !variant.isBase,
          subtypes: variant.subtypes.map(updateHelperUsage),
          generatedUuidFields,
          generatedDefaultFields: [...generatedDefaultFields, ...generatedBlobContentTypeFields],
        } satisfies PolymorphicVariantInfo;
      },
    );

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
      canonicalBaseDtoType: poly.canonicalBaseDtoType,
      baseDomainType: poly.baseDomainType,
      subtypes: poly.subtypes.map(updateHelperUsage),
      variants: decoratedVariants,
      usesMappers: Array.from(subtypeMapperFqcns).sort(),
      isAbstract: poly.isAbstract,
      isCompositionInterface: poly.isCompositionInterface,
      baseMethodAnnotations: poly.baseMethodAnnotations,
      baseResponseMethodAnnotations: poly.baseResponseMethodAnnotations,
      hasDomainDiscriminatorAccessor: poly.hasDomainDiscriminatorAccessor,
      domainDiscriminatorAccessor: poly.domainDiscriminatorAccessor,
      requestDiscriminatorAccessor: poly.requestDiscriminatorAccessor,
      preserveReferenceId: isReferenceLikeName(poly.baseType),
      baseGeneratedUuidFields: buildReadOnlyRequiredUuidFields(
        poly.baseType,
        poly.baseType,
        schemas,
        schemaPropertiesCache,
        entityDefinitions,
      ),
      baseGeneratedDefaultFields: [
        ...buildSchemaBackedDefaultFields(poly.baseType, poly.baseType, [poly.baseType], schemas, schemaPropertiesCache, entityDefinitions),
        ...buildBlobContentTypeDefaultFields(poly.baseType, poly.baseType, schemas, schemaPropertiesCache, entityDefinitions),
      ],
    } satisfies PolymorphicHelperMapperContext;
  });

  const helperMapperByBaseType = new Map(
    helperMappers.map(helper => [normalizeTypeName(helper.baseType) ?? helper.baseType, `${helper.packageName}.${helper.mapperName}`]),
  );
  for (const mapper of entityMappersMap.values()) {
    const referenced = new Set<string>(mapper.referencedEntities ?? []);
    for (const mapping of mapper.requestMappings) {
      const targetEntityName = mapping.targetSchemaName ?? mapper.entityName;
      const domainProperties = collectDomainPropertyNames(targetEntityName, entityDefinitions, domainPropertyCache);
      const domainFieldTypes = collectDomainFieldTypes(targetEntityName, entityDefinitions, domainFieldTypeCache);
      const collectionFields = collectCollectionFieldContexts(
        mapping.sourceSchemaName,
        schemas,
        basePackage,
        schemaPropertiesCache,
        polymorphicHelperTypes,
        entityDefinitions,
        domainPropertyCache,
        domainMapStructPropertyCache,
        relationshipTargets,
        targetEntityName,
      )
        .filter(field => {
          const normalized = normalizeTypeName(field.baseEntity) ?? field.baseEntity;
          const hasMapper = entityMappersMap.has(field.baseEntity) || helperMapperByBaseType.has(normalized);
          return (
            hasMapper &&
            !isScalarDomainFieldType(domainFieldTypes.get(field.targetField)) &&
            (domainProperties.size === 0 || domainProperties.has(field.targetField))
          );
        });
      if (collectionFields.length === 0) {
        continue;
      }
      mapping.collectionFields = collectionFields;
      for (const field of collectionFields) {
        referenced.add(field.referencedEntity ?? field.baseEntity);
        mapping.annotations = mapping.annotations.filter(annotation => {
          const target = extractMappingProperty(annotation, 'target');
          return !target || (target !== field.targetField && target !== field.sourceField);
        });
        const ignoreAnnotation = `@Mapping(target = "${field.targetField}", ignore = true)`;
        if (!mapping.annotations.some(annotation => annotation.includes(`target = \"${field.targetField}\"`))) {
          mapping.annotations.push(ignoreAnnotation);
        }
      }
    }
    for (const mapping of mapper.responseMappings) {
      const sourceEntityName = mapping.sourceSchemaName ?? mapper.entityName;
      const domainProperties = collectDomainPropertyNames(sourceEntityName, entityDefinitions, domainPropertyCache);
      const domainFieldTypes = collectDomainFieldTypes(sourceEntityName, entityDefinitions, domainFieldTypeCache);
      const candidateCollectionFields = collectCollectionFieldContexts(
        mapping.targetSchemaName,
        schemas,
        basePackage,
        schemaPropertiesCache,
        polymorphicHelperTypes,
        entityDefinitions,
        domainPropertyCache,
        domainMapStructPropertyCache,
        relationshipTargets,
        sourceEntityName,
      )
        .filter(field => {
          const normalized = normalizeTypeName(field.baseEntity) ?? field.baseEntity;
          return (
            (entityMappersMap.has(field.baseEntity) || helperMapperByBaseType.has(normalized)) &&
            !isScalarDomainFieldType(domainFieldTypes.get(field.targetField)) &&
            domainProperties.has(field.targetField)
          );
        });

      const collectionFields = [];
      for (const field of candidateCollectionFields) {
        const referencedEntity = field.referencedEntity ?? field.baseEntity;
        if (shouldIgnoreReference(sourceEntityName, referencedEntity, true)) {
          mapping.annotations = mapping.annotations.filter(annotation => {
            const target = extractMappingProperty(annotation, 'target');
            return !target || (target !== field.sourceField && target !== field.targetField);
          });
          const ignoreAnnotation = `@Mapping(target = "${field.sourceField}", ignore = true)`;
          if (!mapping.annotations.includes(ignoreAnnotation)) {
            mapping.annotations.push(ignoreAnnotation);
          }
          continue;
        }
        collectionFields.push(field);
      }

      if (collectionFields.length === 0) {
        continue;
      }
      mapping.responseCollectionFields = collectionFields;
      for (const field of collectionFields) {
        referenced.add(field.referencedEntity ?? field.baseEntity);
        const qualifiedMethod = field.responseListMapMethod ? `${mapper.mapperName}.${field.responseListMapMethod}` : undefined;
        mapping.annotations = mapping.annotations.filter(annotation => {
          const target = extractMappingProperty(annotation, 'target');
          return !target || (target !== field.sourceField && target !== field.targetField);
        });
        if (!qualifiedMethod || !field.responseListMapMethod || mapping.annotations.some(annotation => annotation.includes(`target = \"${field.sourceField}\"`))) {
          continue;
        }
        mapping.annotations.push(
          `@Mapping(target = "${field.sourceField}", expression = "java(${field.responseListMapMethod}(source.get${field.targetGetter}()))")`,
        );
      }
    }
    mapper.referencedEntities = Array.from(referenced);
  }

  const resolveEntityMapper = (entityName?: string): EntityMapperContext | undefined => {
    if (!entityName) {
      return undefined;
    }
    const direct = entityMappersMap.get(entityName);
    if (direct) {
      return direct;
    }
    const normalized = normalizeTypeName(entityName);
    if (normalized) {
      const normalizedMatch = entityMappersMap.get(normalized);
      if (normalizedMatch) {
        return normalizedMatch;
      }
      for (const [key, value] of entityMappersMap.entries()) {
        if (normalizeTypeName(key) === normalized) {
          return value;
        }
      }
    }
    return undefined;
  };

  for (const helper of helperMappers) {
    const referenced = new Set<string>(helperReferencedEntities.get(helper.baseType) ?? []);
    const normalizedHelper = normalizeTypeName(helper.baseType);
    addSchemaReferences(referenced, helper.baseType, normalizedHelper);
    for (const variant of helper.variants ?? []) {
      if (variant.targetDomainSimpleName) {
        const normalized = normalizeTypeName(variant.targetDomainSimpleName);
        if (normalized) {
          referenced.add(normalized);
        }
      }
      addSchemaReferences(referenced, variant.dtoSimpleName, normalizedHelper);
    }
    const currentUses = new Set(helper.usesMappers ?? []);
    for (const referencedEntity of referenced) {
      const normalized = normalizeTypeName(referencedEntity);
      if (!normalized || normalized === normalizedHelper) {
        continue;
      }
      const entityDependency = resolveEntityMapper(normalized);
      if (entityDependency) {
        currentUses.add(`${entityDependency.packageName}.${entityDependency.mapperName}`);
        continue;
      }
      const dependencyFqcn = helperMapperByBaseType.get(normalized);
      if (dependencyFqcn) {
        currentUses.add(dependencyFqcn);
      }
    }
    helper.usesMappers = Array.from(currentUses)
      .filter(fqcn => !fqcn.endsWith(`.${helper.mapperName}`))
      .sort();
  }

  const primitiveMapperFqcn = `${basePackage}.web.api.mapper.OpenApiPrimitiveMapper`;

  const entityMappers = Array.from(entityMappersMap.values()).map(mapper => {
    const usesMapperFqcns = new Set<string>([primitiveMapperFqcn]);
    const normalizedMapperName = normalizeTypeName(mapper.entityName);
    for (const referencedEntity of mapper.referencedEntities ?? []) {
      const normalized = normalizeTypeName(referencedEntity);
      if (!normalized || normalized === normalizedMapperName) {
        continue;
      }
      const entityDependency = resolveEntityMapper(normalized);
      if (entityDependency) {
        usesMapperFqcns.add(`${entityDependency.packageName}.${entityDependency.mapperName}`);
      }
      const helperDependency = helperMapperByBaseType.get(normalized);
      if (helperDependency) {
        usesMapperFqcns.add(helperDependency);
        continue;
      }
      if (ABSTRACT_SCHEMAS.has(normalized)) {
        continue;
      }
    }

    const filteredUses = Array.from(usesMapperFqcns)
      .filter(fqcn => !fqcn.endsWith(`.${mapper.mapperName}`))
      .sort();

    const objectFactories = buildAbstractTargetFactories(
      mapper.requestMappings,
      entityMetadata,
      schemas,
      basePackage,
      polymorphicFactoryFallbacks,
    );

    return {
      ...mapper,
      usesMappers: filteredUses,
      objectFactories: objectFactories.length > 0 ? objectFactories : undefined,
    } satisfies EntityMapperContext;
  });

  return {
    helperMappers,
    entityMappers,
  };
  } finally {
    derivedSchemasCache = undefined;
    derivedAncestorsCache = undefined;
    domainAncestorsCache = undefined;
  }
}
