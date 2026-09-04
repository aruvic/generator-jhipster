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
  type MapperContext,
  type MapperMethod,
  type OpenAPIOperation,
  type ParsedOpenAPISpec,
  type PolymorphicTypeInfo,
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
 * Schemas that don't have corresponding domain entities (abstract/interface types)
 * These are skipped during mapper generation
 */
const ABSTRACT_SCHEMAS = new Set<string>();

/**
 * Check if a schema should be skipped (no domain entity exists)
 */
function shouldSkipSchema(schemaBaseName: string): boolean {
  return ABSTRACT_SCHEMAS.has(schemaBaseName);
}

/**
 * Collect all properties declared directly or through allOf chains
 */
function collectSchemaProperties(
  schemaName: string,
  schema: any,
  allSchemas: Record<string, any>,
  visited = new Set<string>(),
): Record<string, any> {
  if (!schema || visited.has(schemaName)) {
    return {};
  }

  visited.add(schemaName);

  const properties: Record<string, any> = { ...(schema.properties ?? {}) };

  if (Array.isArray(schema.allOf)) {
    for (const fragment of schema.allOf) {
      if (fragment.$ref) {
        const refName = extractSchemaRef(fragment);
        if (refName) {
          Object.assign(properties, collectSchemaProperties(refName, allSchemas[refName], allSchemas, visited));
        }
      } else if (fragment.properties) {
        Object.assign(properties, fragment.properties);
      }
    }
  }

  return properties;
}

/**
 * Generate mapper contexts from parsed OpenAPI spec
 */
export function generateMapperContexts(spec: ParsedOpenAPISpec, basePackage: string): MapperContext[] {
  const mappers: MapperContext[] = [];
  const mapperNamesSeen = new Set<string>();
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

  // For each entity/operation, create appropriate mappers (deduplicate by mapper name)
  operationsByEntity.forEach((operations, entitySchema) => {
    const entityBaseName = stripDtoSuffix(entitySchema);

    for (const operation of operations) {
      const operationType = getOperationType(operation);

      if (operationType === 'create') {
        const mapper = createInputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas, 'create');
        if (mapper && !mapperNamesSeen.has(mapper.mapperName)) {
          mappers.push(mapper);
          mapperNamesSeen.add(mapper.mapperName);
        }

        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper && !mapperNamesSeen.has(outputMapper.mapperName)) {
          mappers.push(outputMapper);
          mapperNamesSeen.add(outputMapper.mapperName);
        }
      } else if (operationType === 'update') {
        const mapper = createInputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas, 'update');
        if (mapper && !mapperNamesSeen.has(mapper.mapperName)) {
          mappers.push(mapper);
          mapperNamesSeen.add(mapper.mapperName);
        }

        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper && !mapperNamesSeen.has(outputMapper.mapperName)) {
          mappers.push(outputMapper);
          mapperNamesSeen.add(outputMapper.mapperName);
        }
      } else if (operationType === 'read') {
        const outputMapper = createOutputMapper(operation, entityBaseName, basePackage, schemaGraph, spec.schemas);
        if (outputMapper && !mapperNamesSeen.has(outputMapper.mapperName)) {
          mappers.push(outputMapper);
          mapperNamesSeen.add(outputMapper.mapperName);
        }
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

    const baseName = stripDtoSuffix(schemaName);

    // Skip abstract schemas that don't have domain entities
    if (shouldSkipSchema(baseName)) {
      return;
    }

    const dtoFqcn = buildDtoFqcn(schemaName, basePackage);
    const domainFqcn = buildDomainFqcn(baseName, basePackage);

    const schemaProperties = collectSchemaProperties(schemaName, schema, allSchemas);

    const method = createMappingMethod(
      baseName,
      dtoFqcn,
      domainFqcn,
      'dto-to-domain',
      opType === 'create',
      opType === 'update',
      schemaProperties,
      allSchemas,
    );

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

    const baseName = stripDtoSuffix(schemaName);

    // Skip abstract schemas that don't have domain entities
    if (shouldSkipSchema(baseName)) {
      return;
    }

    const dtoFqcn = buildDtoFqcn(schemaName, basePackage);
    const domainFqcn = buildDomainFqcn(baseName, basePackage);

    const schemaProperties = collectSchemaProperties(schemaName, schema, allSchemas);

    const method = createMappingMethod(baseName, domainFqcn, dtoFqcn, 'domain-to-dto', false, false, schemaProperties, allSchemas);

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
 * Check if a field schema corresponds to an abstract/polymorphic type
 */
function isFieldAbstract(fieldSchema: any, allSchemas: Record<string, any>): boolean {
  if (!fieldSchema) return false;

  if (fieldSchema.oneOf || fieldSchema.anyOf) return true;

  if (fieldSchema.$ref) {
    const refName = extractSchemaRef(fieldSchema);
    if (refName && allSchemas[refName]) {
      const schema = allSchemas[refName];
      if (isPolymorphicSchema(schema)) return true;
      // Also check for discriminator without oneOf (some specs do this)
      if (schema.discriminator) return true;
    }
  }

  if (fieldSchema.type === 'array' && fieldSchema.items) {
    return isFieldAbstract(fieldSchema.items, allSchemas);
  }

  return false;
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
  schemaProperties?: Record<string, any>,
  allSchemas?: Record<string, any>,
): MapperMethod {
  const annotations: string[] = [];

  if (direction === 'dto-to-domain') {
    // DTO to domain: ignore IDs for create/update
    if (isCreate || isUpdate) {
      annotations.push('@Mapping(target = "id", ignore = true)');
      // Note: UUID generation removed - should be handled by JPA @GeneratedValue or service layer
    }
  }

  // Ignore fields with abstract/polymorphic types that MapStruct can't handle
  // Only add ignore annotations for fields that actually exist in the schema and match abstract type patterns
  const fieldsToIgnore = new Set<string>();

  // Schema-based detection - only if schema is provided
  if (schemaProperties && allSchemas) {
    for (const [fieldName, fieldSchema] of Object.entries<any>(schemaProperties)) {
      if (isFieldAbstract(fieldSchema, allSchemas)) {
        fieldsToIgnore.add(fieldName);
      }
    }
  }

  // Generate @Mapping ignore annotations for all identified fields
  fieldsToIgnore.forEach(field => {
    annotations.push(`@Mapping(target = "${field}", ignore = true)`);
  });

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

  // MapStruct applies @SubclassMapping declarations in order. To avoid
  // warnings about broad supertypes shadowing their concrete subtypes
  // (e.g., PartyRole before Supplier/Producer/Consumer), push the
  // common supertype entries to the end of the list. Use a lightweight
  // heuristic based on simple class names so we don't need the full
  // inheritance graph here.
  const specificity = (fqcn: string) => {
    const simple = fqcn.substring(fqcn.lastIndexOf('.') + 1);
    // PartyRole* acts as a base for several generated variants; keep it last.
    if (simple.includes('PartyRole')) return 0;
    // Longer names tend to be more specific (e.g., BusinessPartner > Party).
    return simple.length;
  };
  subtypes.sort((a, b) => specificity(b.targetType) - specificity(a.targetType));

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
 * DTOs are always fully-qualified (never imported) to avoid name collisions with domain entities
 */
export function collectImports(context: MapperContext): string[] {
  const imports = new Set<string>();

  // MapStruct imports
  imports.add('org.mapstruct.Mapper');
  imports.add('org.mapstruct.Mapping');
  imports.add('org.mapstruct.ReportingPolicy');
  imports.add('org.mapstruct.factory.Mappers');
  imports.add('org.springframework.context.annotation.Lazy');

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

  const addTypeImport = (type: string) => {
    if (type.includes('.') && !type.startsWith('java.lang.') && !type.startsWith(`${context.packageName}.`)) {
      imports.add(type);
    }
  };

  // Add type imports from methods
  for (const method of context.methods) {
    addTypeImport(method.sourceType);
    addTypeImport(method.targetType);
  }

  // Add polymorphic type imports
  if (context.polymorphicTypes) {
    for (const polymorphic of context.polymorphicTypes) {
      addTypeImport(polymorphic.baseType);
      for (const subtype of polymorphic.subtypes) {
        addTypeImport(subtype.sourceType);
        addTypeImport(subtype.targetType);
      }
    }
  }

  return Array.from(imports).sort();
}
