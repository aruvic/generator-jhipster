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

import type { MapperContext, MapperMethod, OpenAPIOperation, ParsedOpenAPISpec, PolymorphicTypeInfo } from './openapi-mapper-generator.ts';
import {
  buildDomainFqcn,
  buildDtoFqcn,
  buildSchemaGraph,
  extractSchemaRef,
  findNestedSchemas,
  getOperationType,
  isEnumSchema,
  isPolymorphicSchema,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

/**
 * Generate mapper contexts from parsed OpenAPI spec
 */
export function generateMapperContexts(spec: ParsedOpenAPISpec, basePackage: string): MapperContext[] {
  const mappers: MapperContext[] = [];
  const schemaGraph = buildSchemaGraph(spec.schemas);

  // Group operations by entity
  const operationsByEntity = new Map<string, OpenAPIOperation[]>();

  for (const operation of spec.operations) {
    const entityName = operation.requestBodySchema || operation.responseSchema || 'Unknown';
    if (!operationsByEntity.has(entityName)) {
      operationsByEntity.set(entityName, []);
    }
    operationsByEntity.get(entityName)!.push(operation);
  }

  // For each entity/operation, create appropriate mappers
  operationsByEntity.forEach((operations, entitySchema) => {
    const entityBaseName = stripDtoSuffix(entitySchema);

    for (const operation of operations) {
      const operationType = getOperationType(operation);

      if (operationType === 'create') {
        const mapper = createInputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas, 'create');
        if (mapper) mappers.push(mapper);

        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper) mappers.push(outputMapper);
      } else if (operationType === 'update') {
        const mapper = createInputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas, 'update');
        if (mapper) mappers.push(mapper);

        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper) mappers.push(outputMapper);
      } else if (operationType === 'read') {
        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper) mappers.push(outputMapper);
      }
      // delete operations typically don't need mappers
    }
  });

  return mappers;
}

/**
 * Create input mapper (DTO → Domain) for create/update operations
 */
function createInputMapper(
  operation: OpenAPIOperation,
  entityBaseName: string,
  basePackage: string,
  schemaGraph: Map<string, any>,
  allSchemas: Record<string, any>,
  opType: 'create' | 'update',
): MapperContext | null {
  if (!operation.requestBodySchema) {
    return null;
  }

  const inputDtoName = operation.requestBodySchema;
  const nestedSchemas = findNestedSchemas(inputDtoName, schemaGraph);

  // Build mapper methods
  const methods: MapperMethod[] = [];
  const polymorphicTypes: PolymorphicTypeInfo[] = [];

  nestedSchemas.forEach((schemaName: string) => {
    const schema = allSchemas[schemaName];
    if (!schema || isEnumSchema(schema)) {
      return; // Skip enums for now, MapStruct can handle them
    }

    const dtoFqcn = buildDtoFqcn(schemaName, basePackage);
    const baseName = stripDtoSuffix(schemaName);
    const domainFqcn = buildDomainFqcn(baseName, basePackage);

    const method = createMappingMethod(baseName, dtoFqcn, domainFqcn, 'dto-to-domain', opType === 'create', opType === 'update');

    methods.push(method);

    // Handle polymorphic types
    if (isPolymorphicSchema(schema)) {
      const polymorphic = createPolymorphicMapping(schemaName, schema, basePackage, 'dto-to-domain');
      if (polymorphic) {
        polymorphicTypes.push(polymorphic);
      }
    }
  });

  const opTypeStr = opType === 'create' ? 'Create' : 'Update';
  const mapperName = `${entityBaseName}${opTypeStr}Mapper`;

  return {
    mapperName,
    packageName: `${basePackage}.web.api.mapper`,
    methods,
    polymorphicTypes: polymorphicTypes.length > 0 ? polymorphicTypes : undefined,
  };
}

/**
 * Create output mapper (Domain → DTO) for read/retrieve operations
 */
function createOutputMapper(
  operation: OpenAPIOperation,
  entityBaseName: string,
  basePackage: string,
  schemaGraph: Map<string, any>,
  allSchemas: Record<string, any>,
): MapperContext | null {
  if (!operation.responseSchema) {
    return null;
  }

  const outputDtoName = operation.responseSchema;
  const nestedSchemas = findNestedSchemas(outputDtoName, schemaGraph);

  // Build mapper methods
  const methods: MapperMethod[] = [];
  const polymorphicTypes: PolymorphicTypeInfo[] = [];

  nestedSchemas.forEach((schemaName: string) => {
    const schema = allSchemas[schemaName];
    if (!schema || isEnumSchema(schema)) {
      return;
    }

    const dtoFqcn = buildDtoFqcn(schemaName, basePackage);
    const baseName = stripDtoSuffix(schemaName);
    const domainFqcn = buildDomainFqcn(baseName, basePackage);

    const method = createMappingMethod(baseName, domainFqcn, dtoFqcn, 'domain-to-dto', false, false);

    methods.push(method);

    // Handle polymorphic types
    if (isPolymorphicSchema(schema)) {
      const polymorphic = createPolymorphicMapping(schemaName, schema, basePackage, 'domain-to-dto');
      if (polymorphic) {
        polymorphicTypes.push(polymorphic);
      }
    }
  });

  const mapperName = `${entityBaseName}ResponseMapper`;

  return {
    mapperName,
    packageName: `${basePackage}.web.api.mapper`,
    methods,
    polymorphicTypes: polymorphicTypes.length > 0 ? polymorphicTypes : undefined,
  };
}

/**
 * Create a single mapping method
 */
function createMappingMethod(
  baseName: string,
  sourceFqcn: string,
  targetFqcn: string,
  direction: 'dto-to-domain' | 'domain-to-dto',
  isCreate: boolean,
  isUpdate: boolean,
): MapperMethod {
  const annotations: string[] = [];

  if (direction === 'dto-to-domain') {
    // DTO to domain: ignore IDs for create/update
    if (isCreate || isUpdate) {
      annotations.push('@Mapping(target = "id", ignore = true)');

      // For create, generate new UUID if applicable
      if (isCreate) {
        annotations.push('@Mapping(target = "uuid", expression = "java(java.util.UUID.randomUUID())")');
      }
    }
  }

  // Build method name
  let methodName: string;
  if (direction === 'dto-to-domain') {
    methodName = `to${baseName}Entity`;
  } else {
    methodName = `to${baseName}Dto`;
  }

  const sourceSimpleName = sourceFqcn.split('.').pop() || 'Source';
  const targetSimpleName = targetFqcn.split('.').pop() || 'Target';

  return {
    methodName,
    sourceType: sourceFqcn,
    sourceName: sourceSimpleName,
    targetType: targetFqcn,
    targetName: targetSimpleName,
    annotations,
    isCreate,
    isUpdate,
  };
}

/**
 * Create polymorphic type mapping info
 */
function createPolymorphicMapping(
  baseSchemaName: string,
  baseSchema: any,
  basePackage: string,
  direction: 'dto-to-domain' | 'domain-to-dto',
): PolymorphicTypeInfo | null {
  const subtypeRefs = baseSchema.oneOf || baseSchema.anyOf || [];
  if (subtypeRefs.length === 0) {
    return null;
  }

  const subtypes = [];
  const baseName = stripDtoSuffix(baseSchemaName);

  for (const subtypeRef of subtypeRefs) {
    const subtypeName = extractSchemaRef(subtypeRef);
    if (!subtypeName) continue;

    const subtypeBaseName = stripDtoSuffix(subtypeName);

    if (direction === 'dto-to-domain') {
      const sourceFqcn = buildDtoFqcn(subtypeName, basePackage);
      const targetFqcn = buildDomainFqcn(subtypeBaseName, basePackage);
      subtypes.push({
        sourceType: sourceFqcn,
        targetType: targetFqcn,
      });
    } else {
      const sourceFqcn = buildDomainFqcn(subtypeBaseName, basePackage);
      const targetFqcn = buildDtoFqcn(subtypeName, basePackage);
      subtypes.push({
        sourceType: sourceFqcn,
        targetType: targetFqcn,
      });
    }
  }

  if (subtypes.length === 0) {
    return null;
  }

  return {
    baseType: direction === 'dto-to-domain' ? buildDtoFqcn(baseSchemaName, basePackage) : buildDomainFqcn(baseName, basePackage),
    subtypes,
    direction,
  };
}

/**
 * Collect unique imports needed for a mapper context
 */
export function collectImports(context: MapperContext): string[] {
  const imports = new Set<string>();

  // MapStruct imports
  imports.add('org.mapstruct.Mapper');
  imports.add('org.mapstruct.Mapping');
  imports.add('org.mapstruct.ReportingPolicy');
  imports.add('org.mapstruct.factory.Mappers');

  // Add UUID if needed
  let needsUuid = false;
  for (const method of context.methods) {
    if (method.annotations.some((a: string) => a.includes('UUID'))) {
      needsUuid = true;
      break;
    }
  }
  if (needsUuid) {
    imports.add('java.util.UUID');
  }

  // Add polymorphic annotations if needed
  if (context.polymorphicTypes && context.polymorphicTypes.length > 0) {
    imports.add('org.mapstruct.SubclassMapping');
    imports.add('org.mapstruct.SubclassExhaustiveStrategy');
  }

  // Add type imports from methods
  for (const method of context.methods) {
    const sourcePackage = method.sourceType.substring(0, method.sourceType.lastIndexOf('.'));
    const targetPackage = method.targetType.substring(0, method.targetType.lastIndexOf('.'));

    if (!sourcePackage.startsWith('java.')) {
      imports.add(method.sourceType);
    }
    if (!targetPackage.startsWith('java.')) {
      imports.add(method.targetType);
    }
  }

  // Add polymorphic type imports
  if (context.polymorphicTypes) {
    for (const polymorphic of context.polymorphicTypes) {
      imports.add(polymorphic.baseType);
      for (const subtype of polymorphic.subtypes) {
        imports.add(subtype.sourceType);
        imports.add(subtype.targetType);
      }
    }
  }

  return Array.from(imports).sort();
}
