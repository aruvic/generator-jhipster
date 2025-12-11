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
import { upperFirstCamelCase } from '../../../lib/utils/string.ts';

/**
 * Represents an OpenAPI operation (GET, POST, PUT, DELETE, etc.)
 */
export interface OpenAPIOperation {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  tags?: string[]; // e.g., ['Booking', 'Notifications']
  requestBodySchema?: string; // e.g., PartyInteractionFVO
  requestBodySchemaObject?: any; // Raw schema (may include $ref)
 requestBodyRequired?: boolean;
  responseSchema?: string; // e.g., PartyInteraction or [PartyInteraction]
  responseIsArray?: boolean;
  responseSchemaObject?: any; // Raw schema (may include $ref)
  responseStatus?: string; // HTTP status code string for primary success response
  parameters?: OpenAPIParameter[];
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

export interface OpenAPIParameter {
  name: string;
  in?: string;
  required?: boolean;
  schema?: any;
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
      const pathParameters = (pathObj.parameters as any[]) || [];

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
          tags: op.tags || [],
        };

        // Collect parameters (path + operation level)
        const operationParameters = (op.parameters as any[]) || [];
        const resolvedParams: OpenAPIParameter[] = [];
        for (const param of [...pathParameters, ...operationParameters]) {
          let resolved = param;
          if (param?.$ref) {
            resolved = resolveRef(param.$ref);
          }
          if (resolved) {
            resolvedParams.push({
              name: resolved.name,
              in: resolved.in,
              required: resolved.required,
              schema: resolved.schema,
            });
          }
        }
        openAPIOperation.parameters = resolvedParams;

        // Extract request body schema - handle both direct schema and $ref
        let requestBodySpec = op.requestBody;
        if (requestBodySpec?.$ref) {
          requestBodySpec = resolveRef(requestBodySpec.$ref);
        }

        if (requestBodySpec?.content?.['application/json']?.schema) {
          const requestSchema = requestBodySpec.content['application/json'].schema;
          openAPIOperation.requestBodySchemaObject = requestSchema;
          const schemaName = getSchemaName(requestSchema);
          if (schemaName) {
            openAPIOperation.requestBodySchema = schemaName;
          }
          openAPIOperation.requestBodyRequired = Boolean(requestBodySpec?.required);
        }

        // Extract response schema preferring successful (2xx) responses - handle both direct and $ref
        const responses = op.responses ?? {};
        const prioritizedStatuses = ['200', '201', '202', '204', '206'];
        let responseStatus: any;
        let selectedStatusCode: string | undefined;

        for (const status of prioritizedStatuses) {
          if (responses[status]) {
            responseStatus = responses[status];
            selectedStatusCode = status;
            break;
          }
        }

        if (!responseStatus) {
          const successEntry = Object.entries(responses).find(([code]) => /^2\d\d$/.test(code));
          if (successEntry) {
            selectedStatusCode = successEntry[0];
            responseStatus = successEntry[1];
          }
        }

        if (responseStatus?.$ref) {
          responseStatus = resolveRef(responseStatus.$ref);
        }

        if (responseStatus?.content?.['application/json']?.schema) {
          const responseSchema = responseStatus.content['application/json'].schema;
          const resolvedSchema = responseSchema.$ref ? resolveRef(responseSchema.$ref) : responseSchema;
          openAPIOperation.responseSchemaObject = responseSchema;
          openAPIOperation.responseStatus = selectedStatusCode;

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
        } else if (selectedStatusCode) {
          openAPIOperation.responseStatus = selectedStatusCode;
        }

        // Keep all operations, even those without explicit request/response schemas (e.g., deletes returning 204).
        operations.push(openAPIOperation);
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
 * Normalize schema/type names by removing separators that may appear in OpenAPI refs
 * e.g., `Hub_FVO` -> `HubFVO`, `party-interaction` -> `partyinteraction`
 */
export function normalizeTypeName(name: string): string {
  if (!name) return name;
  const segments = name.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  return segments.map(segment => upperFirstCamelCase(segment)).join('');
}

/**
 * Normalize DTO schema names to follow OpenAPI generator casing rules without collapsing acronyms.
 */
export function normalizeDtoTypeName(name: string): string {
  if (!name) return name;
  const segments = name.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  return segments
    .map(segment => (segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : segment))
    .join('');
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
  if (!dtoName) return dtoName;
  const normalized = normalizeTypeName(dtoName);
  const suffixes = ['FVO', 'MVO', 'DTO', 'Dto', 'Fvo', 'Mvo'];
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix)) {
      return normalized.substring(0, normalized.length - suffix.length);
    }
  }
  return normalized;
}

/**
 * Optional overrides when a schema base name maps to a differently named domain entity.
 */
const DOMAIN_NAME_OVERRIDES = new Map<string, string>();

/**
 * Clear previously registered domain name overrides.
 */
export function clearDomainNameOverrides(): void {
  DOMAIN_NAME_OVERRIDES.clear();
}

/**
 * Register a domain name override for a given schema base name.
 */
export function registerDomainNameOverride(schemaBaseName: string, domainEntityName: string): void {
  const base = normalizeTypeName(schemaBaseName);
  const domain = normalizeTypeName(domainEntityName);
  if (!base || !domain) {
    return;
  }
  DOMAIN_NAME_OVERRIDES.set(base, domain);
}

function resolveDomainTypeName(entityName: string): string {
  const normalized = normalizeTypeName(entityName);
  if (!normalized) {
    return entityName;
  }
  return DOMAIN_NAME_OVERRIDES.get(normalized) ?? normalized;
}

/**
 * Build fully-qualified class name for DTO
 */
export function buildDtoFqcn(dtoName: string, basePackage: string): string {
  return `${basePackage}.service.api.dto.${normalizeDtoTypeName(dtoName)}`;
}

/**
 * Build fully-qualified class name for domain entity
 */
export function buildDomainFqcn(entityName: string, basePackage: string): string {
  return `${basePackage}.domain.${resolveDomainTypeName(entityName)}`;
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
