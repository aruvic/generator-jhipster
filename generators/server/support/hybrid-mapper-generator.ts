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
import { singularize } from '../../type-utils.ts';


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
  usesHelperMapper?: boolean;
  isDtoSubtype?: boolean;
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
  requiresHelperMapping?: boolean;
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
  elementDomainType: string;
  elementDomainSimple: string;
  mapperFqcn: string;
  mapperField: string;
  mapMethod: string;
  updateMethod: string;
  hasId: boolean;
  hasTmfId: boolean;
  referencedEntity?: string;
  keyExpressions?: string[];
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

function isReferenceLikeName(name?: string): boolean {
  if (!name) {
    return false;
  }
  return /(Ref(?:Or|$)|Reference|Relationship|OrValue)(?:$|[A-Z])/i.test(name);
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

  const registerDiscriminatorMapping = (value?: string, target?: string, abstractFlag?: boolean) => {
    const discriminatorValue = value?.trim();
    const targetName = target?.trim() ?? discriminatorValue;
    if (!discriminatorValue || !targetName) {
      return;
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
    discriminatorProperty: entity.discriminator?.property ?? entity.discriminatorProperty,
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
    const resolvedSchema = resolveSchema(propertySchema, schemas) ?? propertySchema;
    const kind = detectJsonFieldKind(fieldName, propertySchema, schemas);
    if (kind) {
      const usesJsonNullable = Boolean(resolvedSchema?.nullable ?? propertySchema?.nullable);
      info.fields.set(fieldName, { kind, usesJsonNullable });
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
  if (Array.isArray(schema.oneOf)) {
    for (const fragment of schema.oneOf) {
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
  if (Array.isArray(schema.anyOf)) {
    for (const fragment of schema.anyOf) {
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

function isPrimitiveSchema(schema: any): boolean {
  if (!schema) {
    return false;
  }
  const type = schema.type;
  return type === 'string' || type === 'integer' || type === 'number' || type === 'boolean';
}

function collectCollectionFieldContexts(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  basePackage: string,
  schemaPropertiesCache: Map<string, SchemaProperties>,
  polymorphicHelperTypes: Set<string>,
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
    const targetField = toJHipsterPropertyName(fieldName);
    const sourceGetter = upperFirstCamelCase(sourceField);
    const targetGetter = upperFirstCamelCase(targetField);
    const targetSetter = `set${targetGetter}`;
    const normalizedBase = normalizeTypeName(baseEntity) ?? baseEntity;
    let collectionBaseEntity = baseEntity;
    let normalizedCollectionBase = normalizedBase;
    const normalizedTargetEntity = normalizeTypeName(targetEntityName ?? '');
    const relationshipTarget = normalizedTargetEntity
      ? relationshipTargets?.get(normalizedTargetEntity)?.get(targetField)
      : undefined;
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
    const elementDomainType = buildDomainFqcn(collectionBaseEntity, basePackage);
    const elementDomainSimple = elementDomainType.split('.').pop() ?? collectionBaseEntity;
    const isPolymorphic = polymorphicHelperTypes.has(normalizedCollectionBase);
    const mapperSimple = `${collectionBaseEntity}Mapper`;
    const mapperFqcn = `${basePackage}.web.api.mapper.${mapperSimple}`;
    const mapperField = `${lowerFirst(collectionBaseEntity)}Mapper`;
    const normalizedElementName = normalizeTypeName(elementSchemaName) ?? elementSchemaName;
    const isElementBase = normalizedElementName === normalizedCollectionBase;
    const elementSchema = schemas[elementSchemaName] ?? resolveSchema(elementSchemaName, schemas);
    const elementProperties = collectSchemaProperties(elementSchemaName, schemas, schemaPropertiesCache) ?? elementSchema?.properties ?? {};
    const hasTmfId = Boolean(elementProperties?.tmfId);
    const mapMethod = isPolymorphic
      ? (isElementBase ? `to${collectionBaseEntity}` : `to${elementSchemaName}`)
      : `to${collectionBaseEntity}Entity`;
    const updateMethod = isPolymorphic
      ? `update${collectionBaseEntity}From${elementDtoSimple}`
      : `update${collectionBaseEntity}EntityFrom${elementDtoSimple}`;
    const referencedEntity = normalizedCollectionBase;
    const hasId = Boolean(elementProperties?.id);
    const keyExpressions: string[] = [];
    const registerKeyExpression = (expression: string | undefined) => {
      if (!expression) {
        return;
      }
      if (!keyExpressions.includes(expression)) {
        keyExpressions.push(expression);
      }
    };
    if (hasTmfId) {
      registerKeyExpression('{var}.getTmfId()');
    }
    if (hasId) {
      registerKeyExpression('{var}.getId()');
    }
    const singularTarget = singularize(targetField);
    const adderName = upperFirstCamelCase(singularTarget);
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
      elementDomainType,
      elementDomainSimple,
      mapperFqcn,
      mapperField,
      mapMethod,
      updateMethod,
      hasId,
      hasTmfId,
      referencedEntity,
      keyExpressions,
    });
  }
  return collectionFields;
}

type SchemaFieldReferences = Map<string, Set<string>>;

type SchemaReferenceGraph = Map<string, Set<string>>;

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
  
  // Also check if it matches known abstract schemas (if we must keep this list, but user said no hardcoding)
  // For now, let's rely on isPolymorphic. 
  // If the schema is missing but referenced, we can't know for sure, but usually schemas are present.
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

  registerMatch(schema.title ?? schema['x-class-name']);
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

function buildCycleMappingAnnotations(
  schemaName: string | undefined,
  schemas: Record<string, any>,
  propertyCache: Map<string, SchemaProperties>,
  referenceCache: Map<string, SchemaFieldReferences>,
  normalizedBase: string | undefined,
  direction: 'request' | 'response',
  shouldIgnoreReference: (source?: string, target?: string, sourceIsCollection?: boolean) => boolean,
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
    const shouldIgnore = Array.from(targets).some(target => shouldIgnoreReference(normalizedBase, target, Boolean(isCollection)));
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
  polymorphicBaseTypes: Set<string>,
): PolymorphicTypeMapping | null {
  if (!isPolymorphic(schema, schemaName)) return null;

  const baseType = stripDtoSuffix(schemaName);
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
  const isAbstract = !!schema.discriminator || !!schema.abstract || !!schema['x-abstract'] || (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) || (Array.isArray(schema.anyOf) && schema.anyOf.length > 0);

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
      const isCompatible =
        isSubtypeInstantiationCompatible(baseType, domainCandidate, baseMetadata) ||
        (metadataKey ? effectiveAncestors.has(metadataKey) : false);
      const usesHelperMapper = normalizedDomainCandidate ? polymorphicBaseTypes.has(normalizedDomainCandidate) : false;
      const normalizedSubtype = normalizeTypeName(stripDtoSuffix(subtypeName)) ?? subtypeName;
      const isDtoSubtype = compositionSubtypeNames.size === 0 ? true : compositionSubtypeNames.has(normalizedSubtype);

      return {
        dtoType: buildDtoFqcn(subtypeName, basePackage),
        domainType: buildDomainFqcn(domainCandidate, basePackage),
        dtoSimpleName: subtypeName,
        domainSimpleName: domainCandidate,
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

  const variantNames = new Set<string>(schemaVariants.get(baseType) ?? []);
  variantNames.add(schemaName);

  for (const subtypeInfo of subtypeInfos) {
    const normalizedSubtype = normalizeTypeName(subtypeInfo.domainSimpleName) ?? subtypeInfo.domainSimpleName;
    if (polymorphicBaseTypes.has(normalizedSubtype)) {
      continue;
    }
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

  const variants = Array.from(variantNames);
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
        const isCompatible =
          isSubtypeInstantiationCompatible(baseType, domainCandidate, baseMetadata) ||
          (metadataKey ? effectiveAncestors.has(metadataKey) : false);
        const usesHelperMapper = normalizedDomainCandidate ? polymorphicBaseTypes.has(normalizedDomainCandidate) : false;
        const normalizedSubtype = normalizeTypeName(stripDtoSuffix(subtypeName)) ?? subtypeName;
        const isDtoSubtype = compositionSubtypeNames.size === 0 ? true : compositionSubtypeNames.has(normalizedSubtype);

          return {
            dtoType: buildDtoFqcn(subtypeName, basePackage),
            domainType: buildDomainFqcn(domainCandidate, basePackage),
            dtoSimpleName: subtypeName,
            domainSimpleName: domainCandidate,
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
  const entityMetadata = collectEntityMetadata(operationDescriptors, resolveDomainMetadata, entityDefinitions);
  const relationshipTargets = new Map<string, Map<string, string>>();
  const schemaJsonMetadataCache = new Map<string, SchemaJsonMetadata>();
  const schemaPropertiesCache = new Map<string, SchemaProperties>();
  const fieldReferenceCache = new Map<string, SchemaFieldReferences>();
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

  try {
  const schemaReferenceGraph = buildSchemaReferenceGraph(schemas, schemaPropertiesCache, fieldReferenceCache);
  const { componentByNode, componentSizes } = computeStronglyConnectedComponents(schemaReferenceGraph);

  const shouldIgnoreReference = (source?: string, target?: string, sourceIsCollection = false): boolean => {
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
    if (componentSize <= 1) {
      return false;
    }
    if (sourceIsCollection) {
      return true;
    }
    return false;
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
        const normalized = normalizeTypeName(ref);
        if (!normalized || normalized === normalizedBase || ABSTRACT_SCHEMAS.has(normalized)) {
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

  const polymorphicBaseTypes = new Set<string>();
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) {
      continue;
    }
    if (!isObjectLikeSchema(schema)) {
      continue;
    }
    const baseEntity = stripDtoSuffix(schemaName);
    if (!baseEntity || ABSTRACT_SCHEMAS.has(baseEntity)) {
      continue;
    }
    const normalizedBase = normalizeTypeName(baseEntity) ?? baseEntity;
    const hasDerivedPolymorphism = resolveDerivedSchemas(baseEntity, derivedByBase).size > 0;
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

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) continue;

    // Only process each base polymorphic type once (skip DTO/FVO/MVO variants)
    const hasDerivedPolymorphism = resolveDerivedSchemas(baseEntity, derivedByBase).size > 0;
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
      const operationVariants = new Set<string>(schemaVariants.get(baseEntity) ?? []);
      operationVariants.add(schemaName);
      const requestTargets = requestTargetsBySchema.get(baseEntity) ?? new Set<string>();
      const responseSources = responseSourcesBySchema.get(baseEntity) ?? new Set<string>();

      const siblingVariants = Object.keys(schemas).filter(schemaKey => stripDtoSuffix(schemaKey) === baseEntity);
      for (const siblingVariant of siblingVariants) {
        operationVariants.add(siblingVariant);
      }

      const baseJsonMetadata = collectSchemaJsonMetadata(baseEntity, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
      const { annotations: baseRequestJsonAnnotations } = buildJsonMappingAnnotations(baseJsonMetadata, 'request');
      const { annotations: baseResponseJsonAnnotations } = buildJsonMappingAnnotations(baseJsonMetadata, 'response');

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
        if (!normalized || normalized === normalizedBase || ABSTRACT_SCHEMAS.has(normalized)) {
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
        const variantJsonMetadata = collectSchemaJsonMetadata(variant, schemas, schemaJsonMetadataCache, schemaPropertiesCache);
        const { annotations: requestJsonAnnotations, mappedFields: requestMappedFields } = buildJsonMappingAnnotations(variantJsonMetadata, 'request');
        const { annotations: responseJsonAnnotations, mappedFields: responseMappedFields } = buildJsonMappingAnnotations(variantJsonMetadata, 'response');
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
          shouldIgnoreReference,
        );
        const requestExcludedFields = new Set<string>([...requestMappedFields, ...requestCycleIgnoredFields]);
        const responseExcludedFields = new Set<string>([...responseMappedFields, ...responseCycleIgnoredFields]);
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

        if (isFVO || isMVO || isBaseVariant) {
          const annotations = [
            ...(isFVO ? ['@Mapping(target = "id", ignore = true)'] : []),
            ...requestJsonAnnotations,
            ...requestAbstractAnnotations,
            ...requestCycleAnnotations,
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
            annotations: [...responseJsonAnnotations, ...responseAbstractAnnotations, ...responseCycleAnnotations],
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
          const {
            annotations: fallbackAbstractAnnotations,
            abstractTargets: fallbackRequestTargets,
          } = buildAbstractFieldMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            'request',
            new Set<string>([...baseCycleIgnoredFields]),
            resolvableAbstractTargets,
          );
          fallbackRequestTargets.forEach(target => addReferencedTarget(target));
          addRequestMapping({
            methodName,
            sourceType,
            targetType,
            annotations: [
              '@Mapping(target = "id", ignore = true)',
              ...baseRequestJsonAnnotations,
              ...fallbackAbstractAnnotations,
              ...baseCycleAnnotations,
            ],
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
          const { annotations: baseCycleAnnotations, ignoredFields: baseCycleIgnoredFields } = buildCycleMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            fieldReferenceCache,
            normalizedBase,
            'response',
            shouldIgnoreReference,
          );
          const {
            annotations: fallbackAbstractAnnotations,
            abstractTargets: fallbackResponseTargets,
          } = buildAbstractFieldMappingAnnotations(
            baseEntity,
            schemas,
            schemaPropertiesCache,
            'response',
            new Set<string>([...baseCycleIgnoredFields]),
            resolvableAbstractTargets,
          );
          fallbackResponseTargets.forEach(target => addReferencedTarget(target));
          addResponseMapping({
            methodName,
            sourceType,
            targetType,
            annotations: [...baseResponseJsonAnnotations, ...fallbackAbstractAnnotations, ...baseCycleAnnotations],
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
      variant =>
        ({
          ...variant,
          requiresHelperMapping: !variant.isBase,
          subtypes: variant.subtypes.map(updateHelperUsage),
        }) satisfies PolymorphicVariantInfo,
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
      baseDomainType: poly.baseDomainType,
      subtypes: poly.subtypes.map(updateHelperUsage),
      variants: decoratedVariants,
      usesMappers: Array.from(subtypeMapperFqcns).sort(),
      isAbstract: poly.isAbstract,
      baseMethodAnnotations: poly.baseMethodAnnotations,
    } satisfies PolymorphicHelperMapperContext;
  });

  const helperMapperByBaseType = new Map(
    helperMappers.map(helper => [normalizeTypeName(helper.baseType) ?? helper.baseType, `${helper.packageName}.${helper.mapperName}`]),
  );
  for (const mapper of entityMappersMap.values()) {
    const referenced = new Set<string>(mapper.referencedEntities ?? []);
    for (const mapping of mapper.requestMappings) {
      const collectionFields = collectCollectionFieldContexts(
        mapping.sourceSchemaName,
        schemas,
        basePackage,
        schemaPropertiesCache,
        polymorphicHelperTypes,
        relationshipTargets,
        mapping.targetSchemaName ?? mapper.entityName,
      )
        .filter(field => {
          const normalized = normalizeTypeName(field.baseEntity) ?? field.baseEntity;
          return entityMappersMap.has(field.baseEntity) || helperMapperByBaseType.has(normalized);
        });
      if (collectionFields.length === 0) {
        continue;
      }
      mapping.collectionFields = collectionFields;
      for (const field of collectionFields) {
        referenced.add(field.referencedEntity ?? field.baseEntity);
        const ignoreAnnotation = `@Mapping(target = "${field.targetField}", ignore = true)`;
        if (!mapping.annotations.some(annotation => annotation.includes(`target = \"${field.targetField}\"`))) {
          mapping.annotations.push(ignoreAnnotation);
        }
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
      if (ABSTRACT_SCHEMAS.has(normalized)) {
        continue;
      }
      const entityDependency = resolveEntityMapper(normalized);
      if (entityDependency) {
        usesMapperFqcns.add(`${entityDependency.packageName}.${entityDependency.mapperName}`);
      }
      const helperDependency = helperMapperByBaseType.get(normalized);
      if (helperDependency) {
        usesMapperFqcns.add(helperDependency);
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
