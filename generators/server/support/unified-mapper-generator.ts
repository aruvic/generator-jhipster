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

import {
  type ParsedOpenAPISpec,
  buildDomainFqcn,
  buildDtoFqcn,
  extractSchemaRef,
  isEnumSchema,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

/**
 * Unified mapper context for request/response mapping
 */
export interface UnifiedMapperContext {
  mapperName: string;
  packageName: string;
  direction: 'request' | 'response';
  mappings: UnifiedMapping[];
  polymorphicMappings: PolymorphicMapping[];
  customMethods: CustomMappingMethod[];
}

/**
 * Single entity mapping (DTO <-> Domain)
 */
export interface UnifiedMapping {
  entityName: string;
  dtoType: string; // FQCN
  domainType: string; // FQCN
  annotations: string[];
  isAbstract?: boolean;
}

/**
 * Polymorphic mapping with subclass mappings
 */
export interface PolymorphicMapping {
  baseType: string;
  baseDtoType: string;
  baseDomainType: string;
  subtypes: SubtypeMapping[];
  direction: 'request' | 'response';
}

/**
 * Subtype in polymorphic hierarchy
 */
export interface SubtypeMapping {
  dtoType: string;
  domainType: string;
  dtoSimpleName: string;
  domainSimpleName: string;
}

/**
 * Custom mapping method for abstract types
 */
export interface CustomMappingMethod {
  methodName: string;
  sourceType: string;
  targetType: string;
  subtypes: SubtypeMapping[];
  hasObjectFactory: boolean;
}

/**
 * Schemas that don't have corresponding domain entities (abstract/interface types)
 */
const ABSTRACT_SCHEMAS = new Set<string>();

/**
 * Check if a schema is polymorphic (has oneOf, anyOf, or discriminator)
 */
function isPolymorphic(schema: any): boolean {
  return !!(schema.oneOf || schema.anyOf || schema.discriminator);
}

/**
 * Extract subtypes from oneOf/anyOf
 */
function extractSubtypes(schema: any): string[] {
  const refs = schema.oneOf || schema.anyOf || [];
  return refs.map((ref: any) => extractSchemaRef(ref)).filter((name: string | undefined): name is string => !!name);
}

/**
 * Build polymorphic mapping hierarchy
 */
function buildPolymorphicHierarchy(
  baseSchemaName: string,
  schema: any,
  basePackage: string,
  direction: 'request' | 'response',
): PolymorphicMapping | null {
  if (!isPolymorphic(schema)) {
    return null;
  }

  const baseName = stripDtoSuffix(baseSchemaName);
  const subtypeNames = extractSubtypes(schema);

  if (subtypeNames.length === 0) {
    return null;
  }

  const subtypes: SubtypeMapping[] = subtypeNames.map(subtypeName => {
    const subtypeBaseName = stripDtoSuffix(subtypeName);
    return {
      dtoType: buildDtoFqcn(subtypeName, basePackage),
      domainType: buildDomainFqcn(subtypeBaseName, basePackage),
      dtoSimpleName: subtypeName.split('_')[0], // Remove _FVO suffix
      domainSimpleName: subtypeBaseName,
    };
  });

  return {
    baseType: baseName,
    baseDtoType: buildDtoFqcn(baseSchemaName, basePackage),
    baseDomainType: buildDomainFqcn(baseName, basePackage),
    subtypes,
    direction,
  };
}

/**
 * Generate unified mappers (RequestMapper and ResponseMapper)
 */
export function generateUnifiedMappers(spec: ParsedOpenAPISpec, basePackage: string): UnifiedMapperContext[] {
  const { schemas } = spec;
  const requestMappings: UnifiedMapping[] = [];
  const responseMappings: UnifiedMapping[] = [];
  const polymorphicMappings: PolymorphicMapping[] = [];

  // Collect all schemas and detect polymorphic types
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (isEnumSchema(schema)) {
      continue; // Skip enums
    }

    const baseName = stripDtoSuffix(schemaName);

    // Skip abstract schemas
    if (ABSTRACT_SCHEMAS.has(baseName)) {
      continue;
    }

    // Check if this is a polymorphic base type
    if (isPolymorphic(schema)) {
      const requestPoly = buildPolymorphicHierarchy(schemaName, schema, basePackage, 'request');
      const responsePoly = buildPolymorphicHierarchy(schemaName, schema, basePackage, 'response');

      if (requestPoly) {
        polymorphicMappings.push(requestPoly);
      }
      if (responsePoly) {
        polymorphicMappings.push({ ...responsePoly, direction: 'response' });
      }
    }

    // Create standard mappings
    const dtoType = buildDtoFqcn(schemaName, basePackage);
    const domainType = buildDomainFqcn(baseName, basePackage);

    const annotations: string[] = [];

    // Always ignore ID for request mappings (create/update)
    if (schemaName.endsWith('FVO')) {
      annotations.push('@Mapping(target = "id", ignore = true)');
    }

    requestMappings.push({
      entityName: baseName,
      dtoType,
      domainType,
      annotations,
    });

    responseMappings.push({
      entityName: baseName,
      dtoType,
      domainType,
      annotations: [], // No special annotations for response
    });
  }

  // Generate custom mapping methods for polymorphic types
  const customMethods: CustomMappingMethod[] = polymorphicMappings.map(poly => ({
    methodName: `to${poly.baseType}`,
    sourceType: poly.direction === 'request' ? poly.baseDtoType : poly.baseDomainType,
    targetType: poly.direction === 'request' ? poly.baseDomainType : poly.baseDtoType,
    subtypes: poly.subtypes,
    hasObjectFactory: true,
  }));

  return [
    {
      mapperName: 'RequestMapper',
      packageName: `${basePackage}.web.api.mapper`,
      direction: 'request',
      mappings: requestMappings,
      polymorphicMappings: polymorphicMappings.filter(p => p.direction === 'request'),
      customMethods: customMethods.filter(m => m.sourceType.includes('.dto.')),
    },
    {
      mapperName: 'ResponseMapper',
      packageName: `${basePackage}.web.api.mapper`,
      direction: 'response',
      mappings: responseMappings,
      polymorphicMappings: polymorphicMappings.filter(p => p.direction === 'response'),
      customMethods: customMethods.filter(m => !m.sourceType.includes('.dto.')),
    },
  ];
}
