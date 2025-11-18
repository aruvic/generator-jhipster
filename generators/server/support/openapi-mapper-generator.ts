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

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

/**
 * Represents an OpenAPI operation (GET, POST, PUT, DELETE, etc.)
 */
export interface OpenAPIOperation {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  requestBodySchema?: string; // e.g., PartyInteractionFVO
  responseSchema?: string; // e.g., PartyInteraction or [PartyInteraction]
  responseIsArray?: boolean;
}

/**
 * Represents a mapping requirement between source and target types
 */
export interface MappingPair {
  sourceDto: string; // e.g., PartyInteractionFVO
  targetDomain: string; // e.g., PartyInteraction
  direction: 'dto-to-domain' | 'domain-to-dto';
  operation?: OpenAPIOperation;
  isNested?: boolean;
}

/**
 * Schema node in the relationship graph
 */
export interface SchemaNode {
  name: string;
  schema: any;
  isDtoSchema: boolean;
  properties?: Record<string, any>;
  references: string[]; // Direct references from properties
  allOfRefs: string[];
  oneOfRefs: string[];
  anyOfRefs: string[];
}

/**
 * Parsed OpenAPI specification data
 */
export interface ParsedOpenAPISpec {
  operations: OpenAPIOperation[];
  schemas: Record<string, any>;
  basePath?: string;
  version?: string;
}

/**
 * Mapper generation context
 */
export interface MapperContext {
  mapperName: string;
  packageName: string;
  methods: MapperMethod[];
  usesMappers?: string[];
  polymorphicTypes?: PolymorphicTypeInfo[];
}

/**
 * Single mapping method in a mapper
 */
export interface MapperMethod {
  methodName: string;
  sourceType: string; // FQCN
  sourceName: string; // Simple name
  targetType: string; // FQCN
  targetName: string; // Simple name
  annotations: string[]; // @Mapping lines
  isCreate?: boolean;
  isUpdate?: boolean;
  isNested?: boolean;
}

/**
 * Information about polymorphic types
 */
export interface PolymorphicTypeInfo {
  baseType: string;
  subtypes: PolymorphicSubtype[];
  direction: 'dto-to-domain' | 'domain-to-dto';
}

/**
 * A subtype in polymorphic mapping
 */
export interface PolymorphicSubtype {
  sourceType: string;
  targetType: string;
}

interface ParseOpenAPISpecOptions {
  isFilePath?: boolean;
}

/**
 * Parse OpenAPI specification from swagger/api.yml
 */
export function parseOpenAPISpec(swaggerInput: string, options: ParseOpenAPISpecOptions = {}): ParsedOpenAPISpec {
  const { isFilePath = true } = options;
  const yamlContent = isFilePath ? readFileSync(swaggerInput, 'utf-8') : swaggerInput;
  const spec = parseYaml(yamlContent) as any;

  const operations: OpenAPIOperation[] = [];
  const schemas = spec.components?.schemas || {};

  // Helper function to resolve $ref pointers in OpenAPI spec
  function resolveRef(ref: string | undefined): any | undefined {
    if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;

    const parts = ref.substring(2).split('/'); // Remove '#/' and split by '/'
    let current = spec;
    for (const part of parts) {
      current = current[part];
      if (!current) return undefined;
    }
    return current;
  }

  const getSchemaName = (schema: any): string | undefined => {
    if (!schema) {
      return undefined;
    }

    const refName = extractSchemaRef(schema);
    if (refName) {
      return refName;
    }

    if (schema.$ref) {
      const resolved = resolveRef(schema.$ref);
      if (resolved) {
        return getSchemaName(resolved);
      }
    }

    if (schema.type === 'array' && schema.items) {
      return getSchemaName(schema.items);
    }

    return schema.title as string | undefined;
  };

  // Extract all operations from paths
  if (spec.paths) {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const pathObj = pathItem as Record<string, any>;

      for (const [method, operation] of Object.entries(pathObj)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method.toLowerCase())) {
          continue;
        }

        const op = operation as Record<string, any>;
        const openAPIOperation: OpenAPIOperation = {
          path,
          method: method.toUpperCase(),
          operationId: op.operationId,
          summary: op.summary,
        };

        // Extract request body schema - handle both direct schema and $ref
        let requestBodySpec = op.requestBody;
        if (requestBodySpec?.$ref) {
          requestBodySpec = resolveRef(requestBodySpec.$ref);
        }

        if (requestBodySpec?.content?.['application/json']?.schema) {
          const requestSchema = requestBodySpec.content['application/json'].schema;
          const schemaName = getSchemaName(requestSchema);
          if (schemaName) {
            openAPIOperation.requestBodySchema = schemaName;
          }
        }

        // Extract response schema (prefer 200, then 201) - handle both direct and $ref
        let responseStatus = op.responses?.['200'] || op.responses?.['201'];
        if (responseStatus?.$ref) {
          responseStatus = resolveRef(responseStatus.$ref);
        }

        if (responseStatus?.content?.['application/json']?.schema) {
          const responseSchema = responseStatus.content['application/json'].schema;
          const resolvedSchema = responseSchema.$ref ? resolveRef(responseSchema.$ref) : responseSchema;

          if (resolvedSchema?.type === 'array' || responseSchema?.type === 'array') {
            openAPIOperation.responseIsArray = true;
            const arraySchema = resolvedSchema?.items ?? responseSchema?.items;
            const arraySchemaName = getSchemaName(arraySchema);
            if (arraySchemaName) {
              openAPIOperation.responseSchema = arraySchemaName;
            }
          } else {
            const schemaName = getSchemaName(responseSchema) ?? getSchemaName(resolvedSchema);
            if (schemaName) {
              openAPIOperation.responseSchema = schemaName;
            }
          }
        }

        if (openAPIOperation.requestBodySchema || openAPIOperation.responseSchema) {
          operations.push(openAPIOperation);
        }
      }
    }
  }

  return {
    operations,
    schemas,
    basePath: spec.basePath,
    version: spec.info?.version,
  };
}

/**
 * Extract schema reference name (e.g., "PartyInteractionFVO" from "#/components/schemas/PartyInteractionFVO")
 */
export function extractSchemaRef(schemaObj: any): string | undefined {
  if (schemaObj.$ref) {
    const ref = schemaObj.$ref as string;
    return ref.split('/').pop();
  }
  return undefined;
}

/**
 * Build a directed graph of schema relationships
 */
export function buildSchemaGraph(schemas: Record<string, any>): Map<string, SchemaNode> {
  const graph = new Map<string, SchemaNode>();

  for (const [schemaName, schema] of Object.entries(schemas)) {
    const node: SchemaNode = {
      name: schemaName,
      schema,
      isDtoSchema: true,
      references: [],
      allOfRefs: [],
      oneOfRefs: [],
      anyOfRefs: [],
    };

    // Extract direct property references
    if (schema.properties) {
      node.properties = schema.properties;
      for (const [, property] of Object.entries(schema.properties)) {
        const prop = property as Record<string, any>;
        const ref = extractSchemaRef(prop);
        if (ref) {
          node.references.push(ref);
        }
        // Handle array items
        if (prop.type === 'array' && prop.items) {
          const itemRef = extractSchemaRef(prop.items);
          if (itemRef) {
            node.references.push(itemRef);
          }
        }
      }
    }

    // Handle allOf (inheritance/composition)
    if (schema.allOf && Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) {
        const ref = extractSchemaRef(item);
        if (ref) {
          node.allOfRefs.push(ref);
        }
      }
    }

    // Handle oneOf (polymorphism)
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      for (const item of schema.oneOf) {
        const ref = extractSchemaRef(item);
        if (ref) {
          node.oneOfRefs.push(ref);
        }
      }
    }

    // Handle anyOf
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      for (const item of schema.anyOf) {
        const ref = extractSchemaRef(item);
        if (ref) {
          node.anyOfRefs.push(ref);
        }
      }
    }

    graph.set(schemaName, node);
  }

  return graph;
}

/**
 * Traverse schema graph to find all nested types reachable from a root schema
 */
export function findNestedSchemas(rootSchema: string, graph: Map<string, SchemaNode>, visited = new Set<string>()): Set<string> {
  if (visited.has(rootSchema)) {
    return new Set();
  }

  visited.add(rootSchema);
  const nested = new Set<string>();
  nested.add(rootSchema);

  const node = graph.get(rootSchema);
  if (!node) {
    return nested;
  }

  // Add all directly referenced schemas
  for (const ref of [...node.references, ...node.allOfRefs, ...node.oneOfRefs, ...node.anyOfRefs]) {
    if (!visited.has(ref)) {
      const subNested = findNestedSchemas(ref, graph, visited);
      subNested.forEach(item => {
        nested.add(item);
      });
    }
  }

  return nested;
}

/**
 * Extract schema name without DTO suffixes (FVO, MVO, DTO, etc.)
 */
export function stripDtoSuffix(dtoName: string): string {
  const suffixes = ['FVO', 'MVO', 'DTO', 'Dto', 'Fvo', 'Mvo'];
  for (const suffix of suffixes) {
    if (dtoName.endsWith(suffix)) {
      return dtoName.substring(0, dtoName.length - suffix.length);
    }
  }
  return dtoName;
}

/**
 * Build fully-qualified class name for DTO
 */
export function buildDtoFqcn(dtoName: string, basePackage: string): string {
  return `${basePackage}.service.api.dto.${dtoName}`;
}

/**
 * Build fully-qualified class name for domain entity
 */
export function buildDomainFqcn(entityName: string, basePackage: string): string {
  return `${basePackage}.domain.${entityName}`;
}

/**
 * Determine operation type from HTTP method or operationId
 */
export function getOperationType(operation: OpenAPIOperation): 'create' | 'update' | 'read' | 'delete' | 'other' {
  const id = operation.operationId?.toLowerCase() || '';
  const method = operation.method.toUpperCase();

  if (method === 'POST' || id.includes('create')) {
    return 'create';
  }
  if (method === 'PUT' || method === 'PATCH' || id.includes('update')) {
    return 'update';
  }
  if (method === 'GET' || id.includes('get') || id.includes('list') || id.includes('retrieve')) {
    return 'read';
  }
  if (method === 'DELETE' || id.includes('delete')) {
    return 'delete';
  }
  return 'other';
}

/**
 * Determine if a schema represents an enumeration
 */
export function isEnumSchema(schema: any): boolean {
  return (schema.type === 'string' || schema.type === 'integer') && Array.isArray(schema.enum) && schema.enum.length > 0;
}

/**
 * Determine if a schema is polymorphic (oneOf or anyOf)
 */
export function isPolymorphicSchema(schema: any): boolean {
  return (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) || (Array.isArray(schema.anyOf) && schema.anyOf.length > 0);
}
