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

import type { ParsedOpenAPISpec } from './openapi-mapper-generator.ts';
import {
  buildDomainFqcn,
  buildDtoFqcn,
  extractSchemaRef,
  isEnumSchema,
  normalizeTypeName,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

/**
 * Polymorphic mapper context (shared for all entities)
 */
export interface PolymorphicMapperContext {
  mapperName: string;
  packageName: string;
  polymorphicTypes: PolymorphicTypeMapping[];
}

/**
 * Entity-specific mapper context
 */
export interface EntityMapperContext {
  mapperName: string;
  packageName: string;
  entityName: string;
  usesPolymorphicMapper: boolean;
  requestMappings: EntityMapping[];
  responseMappings: EntityMapping[];
}

export interface PolymorphicTypeMapping {
  baseType: string;
  baseDtoType: string;
  baseDomainType: string;
  subtypes: SubtypeInfo[];
  variants: PolymorphicVariantInfo[];
}

export interface SubtypeInfo {
  dtoType: string;
  domainType: string;
  dtoSimpleName: string;
  domainSimpleName: string;
}

export interface PolymorphicVariantInfo {
  dtoType: string;
  dtoSimpleName: string;
  normalizedName: string;
  isBase: boolean;
  isWrapper: boolean;
  subtypes: SubtypeInfo[];
}

export interface EntityMapping {
  methodName: string;
  sourceType: string;
  targetType: string;
  annotations: string[];
}

/**
 * Schemas that don't have corresponding domain entities
 */
const ABSTRACT_SCHEMAS = new Set(['Entity', 'Extensible', 'Addressable']);

/**
 * Check if schema is polymorphic
 */
function isPolymorphic(schema: any, schemaName?: string): boolean {
  if (!schema) return false;

  const hasOneOf = Array.isArray(schema.oneOf) && schema.oneOf.length > 0;
  const hasAnyOf = Array.isArray(schema.anyOf) && schema.anyOf.length > 0;
  if (hasOneOf || hasAnyOf) {
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

  return new Set(referencedTargets).size > 0;
}

/**
 * Extract subtypes from polymorphic schema
 */
function extractSubtypes(schema: any): string[] {
  const refs = schema.oneOf || schema.anyOf || [];
  return refs
    .map((ref: any) => extractSchemaRef(ref))
    .filter((name: string | undefined): name is string => !!name);
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

function isWrapperVariantSchema(
  variantName: string,
  schemas: Record<string, any>,
  baseSubtypeEntities: Set<string>
): boolean {
  const variantSchema = schemas[variantName];
  if (!variantSchema) return false;

  const variantSubtypes = extractSubtypes(variantSchema);
  if (variantSubtypes.length === 0) return false;

  const introducesNewSubtype = variantSubtypes.some(subtype => !baseSubtypeEntities.has(stripDtoSuffix(subtype)));
  if (introducesNewSubtype) return false;

  if (hasOwnSchemaProperties(variantSchema)) return false;

  return true;
}

function buildPolymorphicMapping(
  schemaName: string,
  schema: any,
  basePackage: string,
  schemaVariants: Map<string, Set<string>>,
  schemas: Record<string, any>
): PolymorphicTypeMapping | null {
  if (!isPolymorphic(schema, schemaName)) return null;

  const subtypeNames = extractSubtypes(schema);
  if (subtypeNames.length === 0) return null;

  // Filter out abstract schemas from subtypes
  const concreteSubtypes = subtypeNames.filter(name => {
    const entity = stripDtoSuffix(name);
    return !ABSTRACT_SCHEMAS.has(entity);
  });

  if (concreteSubtypes.length === 0) return null;

  const baseType = stripDtoSuffix(schemaName);
  const normalizedBase = normalizeTypeName(baseType);
  const variants = Array.from(schemaVariants.get(baseType) ?? new Set<string>([schemaName]));
  variants.sort((a, b) => {
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
  
  const baseSubtypeEntities = new Set(concreteSubtypes.map(subtypeName => stripDtoSuffix(subtypeName)));

  return {
    baseType,
    baseDtoType: buildDtoFqcn(schemaName, basePackage),
    baseDomainType: buildDomainFqcn(baseType, basePackage),
    subtypes: concreteSubtypes.map(subtypeName => {
      const subEntity = stripDtoSuffix(subtypeName);
      return {
        dtoType: buildDtoFqcn(subtypeName, basePackage),
        domainType: buildDomainFqcn(subEntity, basePackage),
        dtoSimpleName: subtypeName,
        domainSimpleName: subEntity,
      };
    }),
    variants: variants.map(variantName => {
      const normalized = normalizeTypeName(variantName);
      const variantSchema = schemas[variantName];
      const variantSubtypeNames = extractSubtypes(variantSchema) ?? [];
      const variantSubtypeInfos: SubtypeInfo[] = variantSubtypeNames
        .map(subtypeName => {
          const subEntity = stripDtoSuffix(subtypeName);
          return {
            dtoType: buildDtoFqcn(subtypeName, basePackage),
            domainType: buildDomainFqcn(subEntity, basePackage),
            dtoSimpleName: subtypeName,
            domainSimpleName: subEntity,
          } satisfies SubtypeInfo;
        })
        .filter(subtypeInfo => !!subtypeInfo.domainSimpleName);
      return {
        dtoType: buildDtoFqcn(variantName, basePackage),
        dtoSimpleName: variantName,
        normalizedName: normalized,
        isBase: normalized === normalizedBase,
        isWrapper: isWrapperVariantSchema(variantName, schemas, baseSubtypeEntities),
        subtypes: variantSubtypeInfos,
      };
    }),
  };
}

/**
 * Generate hybrid mapper architecture:
 * - 1 PolymorphicMapper for shared polymorphic types
 * - N EntityMappers for concrete entities
 */
export function generateHybridMappers(spec: ParsedOpenAPISpec, basePackage: string): {
  polymorphicMapper: PolymorphicMapperContext;
  entityMappers: EntityMapperContext[];
} {
  const schemas = spec.schemas;
  const polymorphicTypes: PolymorphicTypeMapping[] = [];
  const entityMappersMap = new Map<string, EntityMapperContext>();
  const processedPolyTypes = new Set<string>();
  const variantsByEntity = new Map<string, Set<string>>();
  const schemaVariants = new Map<string, Set<string>>();

  for (const schemaName of Object.keys(schemas)) {
    const base = stripDtoSuffix(schemaName);
    if (!schemaVariants.has(base)) {
      schemaVariants.set(base, new Set());
    }
    schemaVariants.get(base)!.add(schemaName);
  }

  for (const operation of spec.operations) {
    const requestSchema = operation.requestBodySchema;
    const responseSchema = operation.responseSchema;

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
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) continue;
    if (!isObjectLikeSchema(schema)) continue;

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) continue;

    // Only process each base polymorphic type once (skip DTO/FVO/MVO variants)
    if (isPolymorphic(schema, schemaName) && !processedPolyTypes.has(baseEntity)) {
      processedPolyTypes.add(baseEntity);
      const polyMapping = buildPolymorphicMapping(schemaName, schema, basePackage, schemaVariants, schemas);
      if (polyMapping) {
        polymorphicTypes.push(polyMapping);
      }
    }
  }

  // Phase 2: Create entity mappers for concrete entities
  
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) continue;
    if (!isObjectLikeSchema(schema)) continue;

    const baseEntity = stripDtoSuffix(schemaName);
    if (ABSTRACT_SCHEMAS.has(baseEntity)) continue;

    // Skip polymorphic base types (they're in PolymorphicMapper)
    if (isPolymorphic(schema, schemaName)) continue;

    // Skip DTO variants (FVO, MVO) - only process base entity once
    if (!entityMappersMap.has(baseEntity)) {
      const domainType = buildDomainFqcn(baseEntity, basePackage);

      const requestMappings: EntityMapping[] = [];
      const responseMappings: EntityMapping[] = [];

      const normalizedBase = normalizeTypeName(baseEntity);
      const operationVariants = new Set<string>(variantsByEntity.get(baseEntity) ?? []);
      operationVariants.add(schemaName);

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

      for (const variant of variants) {
        const variantDtoType = buildDtoFqcn(variant, basePackage);
        const normalizedVariant = normalizeTypeName(variant);
        const isFVO = normalizedVariant.endsWith('FVO');
        const isBaseVariant = normalizedVariant === normalizedBase;

        requestMappings.push({
          methodName: `to${baseEntity}`,
          sourceType: variantDtoType,
          targetType: domainType,
          annotations: isFVO ? ['@Mapping(target = "id", ignore = true)'] : [],
        });

        responseMappings.push({
          methodName: isBaseVariant ? `to${baseEntity}Dto` : `to${normalizedVariant}`,
          sourceType: domainType,
          targetType: variantDtoType,
          annotations: [],
        });
      }

      entityMappersMap.set(baseEntity, {
        mapperName: `${baseEntity}Mapper`,
        packageName: `${basePackage}.web.api.mapper`,
        entityName: baseEntity,
        usesPolymorphicMapper: true,
        requestMappings,
        responseMappings,
      });
    }
  }

  return {
    polymorphicMapper: {
      mapperName: 'PolymorphicMapper',
      packageName: `${basePackage}.web.api.mapper`,
      polymorphicTypes,
    },
    entityMappers: Array.from(entityMappersMap.values()),
  };
}
