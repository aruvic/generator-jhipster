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

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import ejs from 'ejs';

import {
  type JavaResolvedType,
  type JavaTypeResolverContext,
  type JavaTypeResolverOptions,
  camelize,
  pascalize,
  resolveJavaType,
  singularize,
  toJavaOperationName,
  toJavaParamName,
} from '../../type-utils.ts';
import type { Application as SpringBootApplication } from '../types.ts';

import { OpenApiEntityMatcher, type OperationDescriptor } from './openapi-entity-matcher.ts';
import {
  type OpenAPIOperation,
  type OpenAPIParameter,
  normalizeTypeName,
  parseOpenAPISpec,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

const CRUD_PREFIXES = ['create', 'list', 'retrieve', 'delete', 'patch'] as const;
type CrudPrefix = (typeof CRUD_PREFIXES)[number];
type OperationKind = CrudPrefix | 'other';

const CRUD_SUFFIX_MAPPINGS: Record<string, CrudPrefix> = {
  Delete: 'delete',
  Create: 'create',
  Retrieve: 'retrieve',
  List: 'list',
  Patch: 'patch',
};

const BASE_TEMPLATE_IMPORTS = new Set([
  'com.fasterxml.jackson.databind.JsonNode',
  'com.fasterxml.jackson.databind.ObjectMapper',
  'com.fasterxml.jackson.databind.node.ArrayNode',
  'com.fasterxml.jackson.databind.node.NullNode',
  'com.fasterxml.jackson.databind.node.ObjectNode',
  'java.net.URI',
  'java.nio.charset.StandardCharsets',
  'java.util.HashSet',
  'java.util.List',
  'java.util.Optional',
  'java.util.Set',
  'org.slf4j.Logger',
  'org.slf4j.LoggerFactory',
  'org.springframework.data.domain.Page',
  'org.springframework.data.domain.PageRequest',
  'org.springframework.data.domain.Pageable',
  'org.springframework.http.HttpStatus',
  'org.springframework.http.ResponseEntity',
  'org.springframework.stereotype.Service',
  'org.springframework.transaction.annotation.Transactional',
  'org.springframework.web.server.ResponseStatusException',
  'org.springframework.web.servlet.support.ServletUriComponentsBuilder',
  'org.springframework.web.util.ContentCachingRequestWrapper',
  'jakarta.servlet.http.HttpServletRequest',
]);

const RESOURCE_SUFFIXES_TO_STRIP = new Set(['dto', 'request', 'response', 'payload', 'command', 'input', 'output']);

type ParameterContext = {
  name: string;
  varName: string;
  javaType: string;
  fullType: string; // Full type with generics, e.g., ResponseEntity<List<BookingDto>>
  in?: string;
  signatureFragment?: string; // Original declaration with annotations, modifiers, etc.
  annotations?: string[];
  resolvedType?: JavaResolvedType;
  required?: boolean;
  orderIndex?: number;
};

type DependencyDescriptor = {
  key: string;
  fieldName: string;
  simpleName: string;
  import: string;
  order: number;
};

type EntityInfo = {
  name: string;
  fqcn: string;
  definition?: any;
};

type OperationContext = {
  kind: OperationKind;
  methodName: string;
  parameters: ParameterContext[];
  requestBodyType?: string;
  requestBodyResolvedType?: JavaResolvedType;
  responseType?: string;
  responseIsArray?: boolean;
  responseResolvedType?: JavaResolvedType;
  fullSignature?: string; // Full method signature from generated interface
  returnType?: string; // Full return type with generics
  throwsClause?: string;
  persistenceEntityName?: string;
  persistenceEntityFqcn?: string;
  persistenceRepositoryField?: string;
  willPersist?: boolean;
  requestMapperField?: string;
  requestMapperMethod?: string;
  requestMapperUpdateMethod?: string;
  responseMapperField?: string;
  responseMapperMethod?: string;
  responseEntityName?: string;
  responseEntityFqcn?: string;
  successStatus?: number;
  tmfIdAccessor?: string;
};

type ResourceContext = {
  className: string;
  interfaceName: string;
  resourceName: string;
  resourceSlug: string;
  domainFqcn: string;
  operations: OperationContext[];
  imports: string[];
  hasCreate: boolean;
  hasList: boolean;
  hasRetrieve: boolean;
  hasDelete: boolean;
  hasPatch: boolean;
  idParamName?: string;
  repositories: DependencyDescriptor[];
  mappers: DependencyDescriptor[];
  injections: DependencyDescriptor[];
  repositoryMap?: Map<string, DependencyDescriptor>;
  mapperMap?: Map<string, DependencyDescriptor>;
};

type CrudOperationMatch = {
  operation: OpenAPIOperation;
  descriptor?: OperationDescriptor;
  kind: OperationKind;
  operationIdFragment?: string;
};

const dependencyKey = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

type MapperMethodSignature = {
  name: string;
  returnType: string;
  returnSimple: string;
  parameterTypes: string[];
  parameterSimples: string[];
  parameterAnnotations: string[][];
};

export function ensureMapperDependency(
  ctx: ResourceContext,
  typeName: string,
  basePackage: string,
  options: { primary?: boolean } = {},
): DependencyDescriptor {
  const stripped = stripDtoSuffix(typeName ?? '') ?? '';
  const normalized = normalizeTypeName(stripped) || 'Resource';
  if (!ctx.mapperMap) {
    ctx.mapperMap = new Map();
  }
  const key = dependencyKey(normalized);
  let dependency = ctx.mapperMap.get(key);
  if (!dependency) {
    const simpleName = `${normalized}Mapper`;
    const fieldName = options.primary ? 'mapper' : `${camelize(normalized, { lowerFirst: true })}Mapper`;
    dependency = {
      key,
      fieldName,
      simpleName,
      import: `${basePackage}.web.api.mapper.${simpleName}`,
      order: ctx.injections.length,
    } satisfies DependencyDescriptor;
    ctx.mapperMap.set(key, dependency);
    ctx.mappers.push(dependency);
    ctx.injections.push(dependency);
  }
  return dependency;
}

/**
 * Parsed method signature from generated API interface
 */
type ParsedMethodSignature = {
  methodName: string;
  returnType: string;
  parameters: Array<{
    type: string;
    name: string;
    annotations: string[];
    declaration: string;
  }>;
  fullSignature: string;
  throwsClause?: string;
};

/**
 * Parse generated ApiDelegate interface to extract actual method signatures
 */
function parseApiDelegateInterface(interfaceFilePath: string): Map<string, ParsedMethodSignature> {
  const methodMap = new Map<string, ParsedMethodSignature>();

  if (!existsSync(interfaceFilePath)) {
    return methodMap;
  }

  const content = readFileSync(interfaceFilePath, 'utf-8');

  // Regex to match method declarations in Java interfaces
  // Matches: default ResponseEntity<Type> methodName(params) { ... }
  const methodRegex = /default\s+([\w<>.,\s]+?)\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:throws\s+([^{]+))?\s*\{/g;

  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const returnType = match[1].trim();
    const methodName = match[2];
    const paramsStr = match[3];
    const throwsClause = match[4]?.trim();

    const parameterDeclarations: Array<{ type: string; name: string; annotations: string[]; declaration: string }> = [];

    if (paramsStr.trim()) {
      // Split parameters, handling nested generics
      const params = splitParameters(paramsStr);

      for (const param of params) {
        const paramTrim = param.trim();
        if (!paramTrim) continue;

        // Extract annotations (e.g., @PathVariable, @RequestBody)
        const annotations: string[] = [];
        let cleanParam = paramTrim;
        const annotationRegex = /@[\w.]+(?:\([^)]*\))?/g;
        let annotMatch;
        while ((annotMatch = annotationRegex.exec(paramTrim)) !== null) {
          annotations.push(annotMatch[0]);
          cleanParam = cleanParam.replace(annotMatch[0], '').trim();
        }

        // Parse "Type name" from remaining string
        const lastSpace = cleanParam.lastIndexOf(' ');
        if (lastSpace > 0) {
          const type = cleanParam.substring(0, lastSpace).trim();
          const name = cleanParam.substring(lastSpace + 1).trim();
          parameterDeclarations.push({
            type,
            name,
            annotations,
            declaration: paramTrim.replace(/\s+/g, ' ').trim(),
          });
        }
      }
    }

    methodMap.set(methodName, {
      methodName,
      returnType,
      parameters: parameterDeclarations,
      fullSignature: match[0],
      throwsClause,
    });
  }

  return methodMap;
}

/**
 * Split parameter string handling nested generics like ResponseEntity<List<Dto>>
 */
function splitParameters(paramsStr: string): string[] {
  const params: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of paramsStr) {
    if (char === '<') {
      depth++;
      current += char;
    } else if (char === '>') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    params.push(current.trim());
  }

  return params;
}

function normalizeTypeSignature(type?: string): string | undefined {
  if (!type) return undefined;
  return removeModifiers(type)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function extractSimpleType(type?: string): string | undefined {
  const normalized = normalizeTypeSignature(type);
  if (!normalized) return undefined;
  const withoutArray = normalized.replace(/\[\]$/, '');
  const segments = withoutArray.split('.');
  return segments[segments.length - 1] || withoutArray;
}

function matchesTypeSignature(candidate: string, expectedFqcn?: string, expectedSimple?: string): boolean {
  const normalizedCandidate = normalizeTypeSignature(candidate);
  const candidateSimple = extractSimpleType(candidate);
  if (expectedFqcn) {
    const normalizedExpected = normalizeTypeSignature(expectedFqcn);
    if (normalizedCandidate && normalizedExpected && normalizedCandidate === normalizedExpected) {
      return true;
    }
    const expectedSimpleFromFqcn = extractSimpleType(expectedFqcn);
    if (expectedSimpleFromFqcn && normalizedCandidate && !normalizedCandidate.includes('.')) {
      return candidateSimple === expectedSimpleFromFqcn;
    }
    return false;
  }
  if (expectedSimple) {
    return candidateSimple === expectedSimple;
  }
  return false;
}

function isCollectionTypeSignature(type?: string): boolean {
  if (!type) return false;
  return /(?:List|Set|Collection|Iterable)<|\[\]/.test(type);
}

function parseMapperMethods(content: string): MapperMethodSignature[] {
  const methods: MapperMethodSignature[] = [];
  const methodRegex = /(?:public\s+)?(?:default\s+)?([\w<>\[\].,\s?]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:;|\{)/g;

  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    const returnType = match[1]?.trim();
    const methodName = match[2];
    if (!methodName || !returnType) {
      continue;
    }
    const paramsStr = match[3] ?? '';
    const parameterTypes: string[] = [];
    const parameterAnnotations: string[][] = [];
    const parameters = splitParameters(paramsStr);
    for (const param of parameters) {
      const annotations: string[] = [];
      const annotationRegex = /@[\w.]+(?:\([^)]*\))?/g;
      let annotationMatch;
      while ((annotationMatch = annotationRegex.exec(param)) !== null) {
        annotations.push(annotationMatch[0]);
      }
      const cleaned = removeModifiers(param.replace(annotationRegex, '').trim());
      const lastSpace = cleaned.lastIndexOf(' ');
      const typeOnly = lastSpace === -1 ? cleaned : cleaned.substring(0, lastSpace);
      if (typeOnly) {
        parameterTypes.push(typeOnly.trim());
      }
      parameterAnnotations.push(annotations);
    }

    methods.push({
      name: methodName,
      returnType,
      returnSimple: extractSimpleType(returnType) ?? returnType,
      parameterTypes,
      parameterSimples: parameterTypes.map(type => extractSimpleType(type) ?? type),
      parameterAnnotations,
    });
  }

  return methods;
}

function collectMapperMethods(generator: any, mapperDir: string): Map<string, MapperMethodSignature[]> {
  const mapperMethods = new Map<string, MapperMethodSignature[]>();
  const mapperDirAbsolute = generator.destinationPath(mapperDir);
  const candidatePaths = new Set<string>();

  try {
    if (existsSync(mapperDirAbsolute)) {
      readdirSync(mapperDirAbsolute)
        .filter(file => file.endsWith('Mapper.java'))
        .forEach(file => candidatePaths.add(join(mapperDirAbsolute, file)));
    }
  } catch {
    // Continue to mem-fs inspection even if the directory is not yet on disk.
  }

  try {
    const memFsStore = generator.fs?.store;
    if (memFsStore?.each && typeof memFsStore.each === 'function') {
      memFsStore.each((file: { path?: string }) => {
        const filePath = file?.path;
        if (typeof filePath !== 'string') {
          return;
        }
        if (filePath.startsWith(mapperDirAbsolute) && filePath.endsWith('Mapper.java')) {
          candidatePaths.add(filePath);
        }
      });
    }
  } catch {
    // Ignore mem-fs inspection failures.
  }

  for (const absolutePath of candidatePaths) {
    let content: string | undefined;
    try {
      content = generator.fs?.read?.(absolutePath);
    } catch {
      // Ignore mem-fs read issues and fall back to disk.
    }
    if (!content) {
      try {
        if (existsSync(absolutePath)) {
          content = readFileSync(absolutePath, 'utf-8');
        }
      } catch {
        // Skip files that cannot be read.
      }
    }
    if (!content) {
      continue;
    }
    const simpleName = basename(absolutePath).replace(/\.java$/, '');
    mapperMethods.set(simpleName, parseMapperMethods(content));
  }
  return mapperMethods;
}

function resolveRequestMapperMethod(
  mapperSimpleName: string,
  persistenceEntityName: string,
  persistenceEntityFqcn: string | undefined,
  requestTypeFqcn: string | undefined,
  requestTypeSimple: string | undefined,
  mapperMethods: Map<string, MapperMethodSignature[]>,
): string | undefined {
  const defaultName = `to${persistenceEntityName}Entity`;
  const methods = mapperMethods.get(mapperSimpleName);
  if (!methods || methods.length === 0) {
    return defaultName;
  }

  const acceptsRequestType = (method: MapperMethodSignature): boolean =>
    method.parameterTypes.length === 0 ||
    method.parameterTypes.some(param => matchesTypeSignature(param, requestTypeFqcn, requestTypeSimple));

  const preferred = methods.find(
    method =>
      !isCollectionTypeSignature(method.returnType) &&
      matchesTypeSignature(method.returnType, persistenceEntityFqcn, persistenceEntityName) &&
      acceptsRequestType(method),
  );
  if (preferred) {
    return preferred.name;
  }

  const fallbackName = [`to${persistenceEntityName}Entity`, `to${persistenceEntityName}`].find(candidate =>
    methods.some(method => method.name === candidate),
  );
  if (!fallbackName) {
    return requestTypeFqcn || requestTypeSimple ? undefined : defaultName;
  }

  const fallbackMethod = methods.find(method => method.name === fallbackName);
  if (!fallbackMethod) {
    return requestTypeFqcn || requestTypeSimple ? undefined : fallbackName;
  }

  if (acceptsRequestType(fallbackMethod)) {
    return fallbackMethod.name;
  }

  return requestTypeFqcn || requestTypeSimple ? undefined : fallbackMethod.name;
}

function resolveRequestMapperUpdateMethod(
  mapperSimpleName: string,
  persistenceEntityName: string,
  persistenceEntityFqcn: string | undefined,
  requestTypeFqcn: string | undefined,
  requestTypeSimple: string | undefined,
  mapperMethods: Map<string, MapperMethodSignature[]>,
): string | undefined {
  const methods = mapperMethods.get(mapperSimpleName);
  if (!methods || methods.length === 0) {
    return undefined;
  }

  const matchesTarget = (type: string): boolean => matchesTypeSignature(type, persistenceEntityFqcn, persistenceEntityName);
  const matchesSource = (type: string): boolean => matchesTypeSignature(type, requestTypeFqcn, requestTypeSimple);

  for (const method of methods) {
    if (!method.name.startsWith('update')) {
      continue;
    }
    if (method.returnSimple && method.returnSimple.toLowerCase() !== 'void') {
      continue;
    }
    if (!method.parameterTypes || method.parameterTypes.length < 2) {
      continue;
    }

    let targetIndex = -1;
    for (let i = 0; i < method.parameterTypes.length; i += 1) {
      const annotations = method.parameterAnnotations?.[i] ?? [];
      if (annotations.some(annotation => annotation.includes('@MappingTarget')) && matchesTarget(method.parameterTypes[i])) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      continue;
    }

    const sourceIndex = method.parameterTypes.findIndex((type, idx) => idx !== targetIndex && matchesSource(type));
    if (sourceIndex === -1) {
      continue;
    }

    return method.name;
  }

  return undefined;
}

function resolveResponseMapperMethod(
  mapperSimpleName: string,
  responseEntityName: string,
  responseReturnFqcn: string | undefined,
  sourceEntityFqcn: string | undefined,
  sourceEntityName: string | undefined,
  mapperMethods: Map<string, MapperMethodSignature[]>,
): string | undefined {
  const defaultName = responseEntityName && sourceEntityName && responseEntityName !== sourceEntityName
    ? `to${responseEntityName}`
    : `to${responseEntityName}Dto`;
  const methods = mapperMethods.get(mapperSimpleName);
  if (!methods || methods.length === 0) {
    return defaultName;
  }

  const preferred = methods.find(
    method =>
      !isCollectionTypeSignature(method.returnType) &&
      matchesTypeSignature(method.returnType, responseReturnFqcn, responseEntityName) &&
      (method.parameterTypes.length === 0 ||
        method.parameterTypes.some(param => matchesTypeSignature(param, sourceEntityFqcn, sourceEntityName))),
  );
  if (preferred) {
    return preferred.name;
  }

  const fallbackCandidates = [`to${responseEntityName}Dto`, `to${responseEntityName}`];

  const bestFallback = fallbackCandidates.find(candidate =>
    methods.some(method =>
      method.name === candidate &&
      (method.parameterTypes.length === 0 ||
        method.parameterTypes.some(param => matchesTypeSignature(param, sourceEntityFqcn, sourceEntityName)))
    )
  );

  if (bestFallback) {
    return bestFallback;
  }

  return fallbackCandidates.find(candidate =>
    methods.some(method => method.name === candidate),
  );
}

function classifyCrudOperation(
  operation: OpenAPIOperation,
  descriptor?: OperationDescriptor,
): { kind: OperationKind; operationIdFragment?: string } | undefined {
  const opId = operation.operationId?.trim() ?? '';
  const lowerOpId = opId.toLowerCase();
  const method = operation.method?.toUpperCase?.() ?? '';
  const descriptorHasPathParams = descriptor?.pathParameters?.length ? descriptor.pathParameters.length > 0 : undefined;
  const operationHasPathParams = (operation.parameters ?? []).some(param => param.in === 'path');
  const hasPathParams =
    descriptorHasPathParams === undefined
      ? operationHasPathParams || Boolean(operation.path && operation.path.includes('{'))
      : descriptorHasPathParams;

  let kind: CrudPrefix | undefined;
  let operationIdFragment: string | undefined;

  switch (descriptor?.operationType) {
    case 'create':
      kind = 'create';
      break;
    case 'delete':
      kind = 'delete';
      break;
    case 'read':
      kind = hasPathParams ? 'retrieve' : 'list';
      break;
    case 'update':
      if (method === 'PATCH' || lowerOpId.startsWith('patch') || lowerOpId.includes('patch')) {
        kind = 'patch';
      } else if (method === 'PUT' || lowerOpId.includes('update')) {
        kind = 'patch';
      }
      break;
    default:
      break;
  }

  if (!kind && opId) {
    const prefix = CRUD_PREFIXES.find(candidate => lowerOpId.startsWith(candidate));
    if (prefix) {
      kind = prefix;
      operationIdFragment = opId.substring(prefix.length);
    } else {
      const suffix = Object.keys(CRUD_SUFFIX_MAPPINGS).find(candidate => opId.endsWith(candidate));
      if (suffix) {
        kind = CRUD_SUFFIX_MAPPINGS[suffix];
        operationIdFragment = opId.substring(0, opId.length - suffix.length);
      }
    }
  }

  if (!kind) {
    switch (method) {
      case 'POST':
        kind = 'create';
        break;
      case 'DELETE':
        kind = 'delete';
        break;
      case 'GET':
        kind = hasPathParams ? 'retrieve' : 'list';
        break;
      case 'PATCH':
        kind = 'patch';
        break;
      case 'PUT':
        kind = 'patch';
        break;
      default:
        break;
    }
  }

  if (!kind) {
    return undefined;
  }

  if (!operationIdFragment && opId) {
    const matchedPrefix = CRUD_PREFIXES.find(candidate => lowerOpId.startsWith(candidate));
    if (matchedPrefix) {
      operationIdFragment = opId.substring(matchedPrefix.length);
    }
  }

  return { kind, operationIdFragment: operationIdFragment?.trim() ? operationIdFragment : undefined };
}

/**
 * Generate ApiDelegate implementations generically for CRUD-style operationIds (create/list/retrieve/delete/patch).
 * This keeps generation aligned with any OAS3 definition using those operationId prefixes.
 */
export async function generateOpenApiDelegates(generator: any, application: SpringBootApplication): Promise<void> {
  if (!application.enableSwaggerCodegen) {
    generator.log.debug('Swagger codegen disabled, skipping delegate implementation generation');
    return;
  }

  const swaggerRelativePath = 'src/main/resources/swagger/api.yml';
  const swaggerContent = generator.readDestination(swaggerRelativePath)?.toString();

  if (!swaggerContent) {
    generator.log.debug('Swagger spec not found or not yet readable, skipping delegate implementation generation');
    return;
  }

  let spec;
  try {
    spec = parseOpenAPISpec(swaggerContent, { isFilePath: false });
  } catch (error: any) {
    generator.log.warn(`Failed to parse OpenAPI spec for delegate generation: ${error?.message || error}`);
    return;
  }

  if (!application.packageName) {
    generator.log.warn('Application package name missing, skipping delegate implementation generation');
    return;
  }
  const basePackage = application.packageName;

  const entityMatcher = new OpenApiEntityMatcher(generator, basePackage);
  const operationDescriptors = entityMatcher.describeOperations(spec);

  const operations: OpenAPIOperation[] = spec.operations || [];
  const crudOperations: CrudOperationMatch[] = operations.map(operation => {
    const descriptor = operationDescriptors.get(operation);
    const classification = classifyCrudOperation(operation, descriptor);
    const result: CrudOperationMatch = {
      operation,
      descriptor,
      kind: classification?.kind ?? 'other',
      operationIdFragment: classification?.operationIdFragment,
    };
    return result;
  });

  if (crudOperations.length === 0) {
    generator.log.debug('No OpenAPI operations found, skipping delegate implementation generation');
    return;
  }

  // Determine where generated API interfaces are located
  const javaPackageDir =
    application.javaPackageSrcDir ??
    (application.srcMainJava && application.packageNameWithSlashes
      ? join(application.srcMainJava, application.packageNameWithSlashes)
      : undefined);

  if (!javaPackageDir) {
    generator.log.warn('Unable to resolve Java package directory for delegate implementations');
    return;
  }

  const apiInterfaceDir = join(javaPackageDir, 'web', 'api');
  const potentialInterfaceDirs = [apiInterfaceDir];

  if (application.packageNameWithSlashes) {
    const generatedApiDir = join(
      'target',
      'generated-sources',
      'openapi',
      'src',
      'main',
      'java',
      application.packageNameWithSlashes,
      'web',
      'api',
    );
    potentialInterfaceDirs.push(generatedApiDir);
  }
  const mapperDir = join(javaPackageDir, 'web', 'api', 'mapper');
  const mapperMethodsByName = collectMapperMethods(generator, mapperDir);

  const contexts: ResourceContext[] = [];
  const ensureRepositoryDependency = (
    ctx: ResourceContext,
    entityName: string,
    options: { primary?: boolean } = {},
  ): DependencyDescriptor => {
    const normalized = entityName || 'Resource';
    if (!ctx.repositoryMap) {
      ctx.repositoryMap = new Map();
    }
    const key = dependencyKey(normalized);
    let dependency = ctx.repositoryMap.get(key);
    if (!dependency) {
      const simpleName = `${normalized}Repository`;
      const fieldName = options.primary ? 'repository' : `${camelize(normalized, { lowerFirst: true })}Repository`;
      dependency = {
        key,
        fieldName,
        simpleName,
        import: `${basePackage}.repository.${simpleName}`,
        order: ctx.injections.length,
      } satisfies DependencyDescriptor;
      ctx.repositoryMap.set(key, dependency);
      ctx.repositories.push(dependency);
      ctx.injections.push(dependency);
    }
    return dependency;
  };

  const ensureMapperDependencyContext = (
    ctx: ResourceContext,
    typeName: string,
    options: { primary?: boolean } = {},
  ): DependencyDescriptor => ensureMapperDependency(ctx, typeName, basePackage, options);

  const methodNamesByInterface = new Map<string, Set<string>>();
  const methodToInterface = new Map<
    string,
    {
      interfaceName: string;
      interfaceBase: string;
      parsedMethods: Map<string, ParsedMethodSignature>;
    }
  >();

  const inspectedDirs = new Set<string>();
  for (const relativeDir of potentialInterfaceDirs) {
    if (!relativeDir || inspectedDirs.has(relativeDir)) continue;
    inspectedDirs.add(relativeDir);

    const absoluteDir = generator.destinationPath(relativeDir);
    if (!existsSync(absoluteDir)) {
      generator.log.debug(`API interface directory ${relativeDir} not found when generating delegates`);
      continue;
    }

    try {
      const interfaceFiles = readdirSync(absoluteDir).filter(file => file.endsWith('ApiDelegate.java'));
      for (const file of interfaceFiles) {
        const interfaceName = file.replace(/\.java$/, '');
        const interfaceBase = interfaceName.replace(/ApiDelegate$/, '') || interfaceName;
        const interfaceFilePath = generator.destinationPath(join(relativeDir, file));
        const parsedMethods = parseApiDelegateInterface(interfaceFilePath);
        for (const methodName of parsedMethods.keys()) {
          methodToInterface.set(methodName, { interfaceName, interfaceBase, parsedMethods });
          generator.log.debug(`Discovered delegate method ${methodName} in ${interfaceName}`);
        }
      }
    } catch (error: any) {
      generator.log.warn(`Failed to inspect generated API delegates for signature alignment at ${relativeDir}: ${error?.message ?? error}`);
    }
  }

  const dtoPackage = `${basePackage}.service.api.dto`;

  for (const { operation, descriptor, kind: prefix, operationIdFragment } of crudOperations) {
    const resourceName = deriveResourceName(operation, descriptor, operationIdFragment);
    const resourceSlugSource = descriptor?.resourceToken ? sanitizeResourceToken(descriptor.resourceToken) : resourceName;
    const resourceSlug = toKebabCase(resourceSlugSource || resourceName);

    const candidateMethodNames = [
      operation.operationId?.trim(),
      operation.operationId ? camelize(operation.operationId, { lowerFirst: true }) : undefined,
      toJavaOperationName(operation.operationId, operation.method, operation.path),
    ].filter((value): value is string => Boolean(value));

    let bindingEntry:
      | {
          methodName: string;
          binding: {
            interfaceName: string;
            interfaceBase: string;
            parsedMethods: Map<string, ParsedMethodSignature>;
          };
        }
      | undefined;

    for (const candidate of candidateMethodNames) {
      const binding = methodToInterface.get(candidate);
      if (binding) {
        const parsedSignature = binding.parsedMethods.get(candidate);
        if (parsedSignature) {
          bindingEntry = { binding, methodName: candidate };
          break;
        }
      }
    }

    const methodBinding = bindingEntry?.binding;
    const fallbackInterfaceBase = deriveInterfaceBase(operation, resourceName, descriptor);
    const interfaceName = methodBinding?.interfaceName ?? `${fallbackInterfaceBase}ApiDelegate`;
    const interfaceBase = methodBinding?.interfaceBase ?? fallbackInterfaceBase;

    let context = contexts.find(ctx => ctx.interfaceName === interfaceName);
    if (!context) {
      const newContext: ResourceContext = {
        className: `${interfaceBase}ApiDelegateImpl`,
        interfaceName,
        resourceName,
        resourceSlug,
        domainFqcn: descriptor?.matchedEntity?.fqcn ?? `${basePackage}.domain.${resourceName}`,
        operations: [],
        imports: [],
        hasCreate: false,
        hasList: false,
        hasRetrieve: false,
        hasDelete: false,
        hasPatch: false,
        idParamName: undefined,
        repositories: [],
        mappers: [],
        injections: [],
      };
      contexts.push(newContext);
      context = newContext;
    } else if (context.resourceName !== resourceName) {
      generator.log.debug(
        `Interface ${interfaceName} already bound to resource ${context.resourceName}, ignoring alternate resource ${resourceName}`,
      );
    }

    const isPrimaryResource = resourceName === context.resourceName;
    const isCrudOperation = prefix !== 'other';

    if (isCrudOperation) {
      ensureRepositoryDependency(context, resourceName, { primary: isPrimaryResource });
      ensureMapperDependencyContext(context, resourceName, { primary: isPrimaryResource });
    }

    if (descriptor?.matchedEntity?.fqcn) {
      if (!context.domainFqcn || descriptor.matchedEntity.name === context.resourceName) {
        context.domainFqcn = descriptor.matchedEntity.fqcn;
      }
    }

    if (!context.idParamName && descriptor?.pathParameters?.length) {
      context.idParamName = descriptor.pathParameters[0]?.name;
    }

    if (resourceSlug && (!context.resourceSlug || resourceName === context.resourceName)) {
      context.resourceSlug = resourceSlug;
    }

    const interfaceMethodNames = methodNamesByInterface.get(interfaceName) ?? new Set<string>();
    if (!methodNamesByInterface.has(interfaceName)) {
      methodNamesByInterface.set(interfaceName, interfaceMethodNames);
    }

    let parsedSignature = bindingEntry ? methodBinding?.parsedMethods.get(bindingEntry.methodName) : undefined;
    if (!parsedSignature && !methodBinding) {
      const fallbackInterfacePath = generator.destinationPath(join(apiInterfaceDir, `${interfaceBase}ApiDelegate.java`));
      const fallbackParsed = parseApiDelegateInterface(fallbackInterfacePath);
      for (const candidate of candidateMethodNames) {
        parsedSignature = fallbackParsed.get(candidate);
        if (parsedSignature) {
          bindingEntry = {
            methodName: candidate,
            binding: {
              interfaceName,
              interfaceBase,
              parsedMethods: fallbackParsed,
            },
          };
          break;
        }
      }
    }

    if (parsedSignature) {
      generator.log.debug(
        `Using parsed signature for ${bindingEntry?.methodName ?? operation.operationId ?? 'unknown'}: ${parsedSignature.fullSignature}`,
      );
    }

    let methodName = parsedSignature?.methodName ?? bindingEntry?.methodName;
    if (!methodName && operation.operationId?.trim()) {
      methodName = operation.operationId.trim();
    }
    if (methodName) {
      if (interfaceMethodNames.has(methodName)) {
        methodName = toJavaOperationName(operation.operationId, operation.method, operation.path, {
          usedNames: interfaceMethodNames,
        });
      } else {
        interfaceMethodNames.add(methodName);
      }
    } else {
      methodName = toJavaOperationName(operation.operationId, operation.method, operation.path, {
        usedNames: interfaceMethodNames,
      });
    }

    const resolverOptions = dtoPackage ? { dtoPackage } : undefined;
    const opContext = buildOperationContext(operation, prefix, methodName, parsedSignature, { schemas: spec.schemas }, resolverOptions);

    const matchedEntityInfo: EntityInfo | undefined = descriptor?.matchedEntity
      ? {
          name: descriptor.matchedEntity.name,
          fqcn: descriptor.matchedEntity.fqcn,
          definition: descriptor.matchedEntity.entity,
        }
      : undefined;
    const primaryEntity: EntityInfo = matchedEntityInfo ?? {
      name: resourceName,
      fqcn: descriptor?.matchedEntity?.fqcn ?? `${basePackage}.domain.${resourceName}`,
      definition: descriptor?.matchedEntity?.entity,
    };

    const responseEntityInfo: EntityInfo | undefined = descriptor?.responseEntityMatch
      ? {
          name: descriptor.responseEntityMatch.name,
          fqcn: descriptor.responseEntityMatch.fqcn,
          definition: descriptor.responseEntityMatch.entity,
        }
      : undefined;

    const isMutation = prefix === 'create' || prefix === 'patch';
    if (isCrudOperation) {
      const persistenceEntity = primaryEntity;
      const persistenceRepository = ensureRepositoryDependency(context, persistenceEntity.name, {
        primary: persistenceEntity.name === context.resourceName,
      });

      opContext.persistenceEntityName = persistenceEntity.name;
      opContext.persistenceEntityFqcn = persistenceEntity.fqcn;
      opContext.persistenceRepositoryField = persistenceRepository.fieldName;

      const bodyParam = opContext.parameters.find(param => param.in === 'body');
      if (bodyParam && isMutation) {
        const requestMapperType = stripDtoSuffix(opContext.requestBodyType ?? '') || persistenceEntity.name;
        const requestMapper = ensureMapperDependencyContext(context, requestMapperType, {
          primary: requestMapperType === context.resourceName,
        });
        const requestMapperMethods = mapperMethodsByName.get(requestMapper.simpleName);
        const requestBodyBaseName = stripDtoSuffix(opContext.requestBodyType ?? '');
        const requestBodyFullType = opContext.requestBodyResolvedType?.fullType ?? bodyParam?.fullType;
        const requestBodySimpleType = extractSimpleType(opContext.requestBodyType) ?? extractSimpleType(bodyParam?.javaType) ?? bodyParam?.javaType;
        opContext.requestMapperField = requestMapper.fieldName;
        opContext.requestMapperMethod = resolveRequestMapperMethod(
          requestMapper.simpleName,
          persistenceEntity.name,
          opContext.persistenceEntityFqcn,
          requestBodyFullType,
          requestBodySimpleType,
          mapperMethodsByName,
        );
        opContext.requestMapperUpdateMethod = resolveRequestMapperUpdateMethod(
          requestMapper.simpleName,
          persistenceEntity.name,
          opContext.persistenceEntityFqcn,
          requestBodyFullType,
          requestBodySimpleType,
          mapperMethodsByName,
        );
        if (!opContext.requestMapperUpdateMethod && requestBodyBaseName && persistenceEntity.name) {
          const requestBodySimple = extractSimpleType(opContext.requestBodyType) ?? requestBodyBaseName;
          const bodyTypeSimple = extractSimpleType(bodyParam?.javaType ?? bodyParam?.fullType ?? '') ?? requestBodySimple;
          const expectedUpdateNames = [
            `update${persistenceEntity.name}EntityFrom${bodyTypeSimple}`,
            `update${persistenceEntity.name}EntityFrom${requestBodySimple}`,
            `update${persistenceEntity.name}EntityFrom${requestBodyBaseName}`,
            `update${persistenceEntity.name}From${bodyTypeSimple}`,
            `update${persistenceEntity.name}From${requestBodySimple}`,
            `update${persistenceEntity.name}From${requestBodyBaseName}`,
          ];
          for (const candidate of expectedUpdateNames) {
            if (!requestMapperMethods || requestMapperMethods.some(method => method.name === candidate)) {
              opContext.requestMapperUpdateMethod = candidate;
              break;
            }
          }
        }
        if (!opContext.requestMapperMethod && persistenceEntity.name) {
          const candidateNames = [`to${persistenceEntity.name}`, `to${persistenceEntity.name}Entity`];
          for (const candidate of candidateNames) {
            if (!requestMapperMethods || requestMapperMethods.some(method => method.name === candidate)) {
              opContext.requestMapperMethod = candidate;
              break;
            }
          }
        }
        opContext.willPersist = true;
        const tmfIdField = persistenceEntity?.definition?.fields?.find(
          (field: any) => field?.fieldName?.toLowerCase() === 'tmfid',
        );
        if (
          tmfIdField &&
          typeof tmfIdField.fieldType === 'string' &&
          tmfIdField.fieldType.toLowerCase() === 'uuid' &&
          Array.isArray(tmfIdField.fieldValidateRules) &&
          tmfIdField.fieldValidateRules.includes('required')
        ) {
          opContext.tmfIdAccessor = pascalize(tmfIdField.fieldName ?? 'tmfId');
        }
      } else {
        opContext.willPersist = false;
      }

      if (opContext.responseType) {
        const responseEntity = responseEntityInfo ?? primaryEntity;
        const responseMapper = ensureMapperDependencyContext(context, responseEntity.name, {
          primary: responseEntity.name === context.resourceName,
        });
        const responseReturnType =
          opContext.responseResolvedType?.fullType ?? (dtoPackage ? `${dtoPackage}.${opContext.responseType}` : undefined);
        const responseMapperMethods = mapperMethodsByName.get(responseMapper.simpleName);
        const responseMapperMethod = resolveResponseMapperMethod(
          responseMapper.simpleName,
          responseEntity.name,
          responseReturnType,
          opContext.persistenceEntityFqcn,
          opContext.persistenceEntityName,
          mapperMethodsByName,
        );
        if (responseMapperMethod) {
          opContext.responseMapperField = responseMapper.fieldName;
          opContext.responseEntityName = responseEntity.name;
          opContext.responseEntityFqcn = responseEntity.fqcn;
          opContext.responseMapperMethod = responseMapperMethod;
          if (responseMapperMethods) {
            const resolvedMethod = responseMapperMethods.find(method => method.name === responseMapperMethod);
            const acceptsSource =
              resolvedMethod &&
              (!resolvedMethod.parameterTypes?.length ||
                resolvedMethod.parameterTypes.some(param =>
                  matchesTypeSignature(param, opContext.persistenceEntityFqcn, opContext.persistenceEntityName),
                ));
            if (!acceptsSource) {
              const alternative = responseMapperMethods.find(
                method =>
                  matchesTypeSignature(method.returnType, responseReturnType, responseEntity.name) &&
                  (method.parameterTypes.length === 0 ||
                    method.parameterTypes.some(param =>
                      matchesTypeSignature(param, opContext.persistenceEntityFqcn, opContext.persistenceEntityName),
                    )),
              );
              if (alternative) {
                opContext.responseMapperMethod = alternative.name;
              }
            }
            if (opContext.responseMapperMethod?.endsWith('Dto')) {
              const candidateName = `to${responseEntity.name}`;
              const candidate = responseMapperMethods.find(method => method.name === candidateName);
              const candidateMatches =
                candidate &&
                matchesTypeSignature(candidate.returnType, responseReturnType, responseEntity.name) &&
                (candidate.parameterTypes.length === 0 ||
                  candidate.parameterTypes.some(param =>
                    matchesTypeSignature(param, opContext.persistenceEntityFqcn, opContext.persistenceEntityName),
                  ));
              if (candidateMatches) {
                opContext.responseMapperMethod = candidateName;
              }
            }
          }
        }
      }
    } else {
      opContext.willPersist = false;
    }

    context.operations.push(opContext);

    switch (prefix) {
      case 'create':
        context.hasCreate = true;
        break;
      case 'list':
        context.hasList = true;
        break;
      case 'retrieve':
        context.hasRetrieve = true;
        break;
      case 'delete':
        context.hasDelete = true;
        break;
      case 'patch':
        context.hasPatch = true;
        break;
    }

    const idParam = operation.parameters?.find((param: OpenAPIParameter) => param.in === 'path');
    if (idParam?.name) {
      context.idParamName = idParam.name;
    }
  }

  for (const context of contexts) {
    const key = dependencyKey('objectmapper');
    if (!context.injections.some(dep => dep.key === key)) {
      const dependency: DependencyDescriptor = {
        key,
        fieldName: 'objectMapper',
        simpleName: 'ObjectMapper',
        import: 'com.fasterxml.jackson.databind.ObjectMapper',
        order: context.injections.length,
      };
      context.injections.push(dependency);
    }
  }

  for (const context of contexts) {
    const key = dependencyKey('validator');
    if (!context.injections.some(dep => dep.key === key)) {
      const dependency: DependencyDescriptor = {
        key,
        fieldName: 'validator',
        simpleName: 'Validator',
        import: 'jakarta.validation.Validator',
        order: context.injections.length,
      };
      context.injections.push(dependency);
    }
  }

  for (const context of contexts) {
    const importSet = new Set<string>();
    for (const operation of context.operations) {
      for (const parameter of operation.parameters) {
        parameter.resolvedType?.imports.forEach(fqcn => importSet.add(fqcn));
      }
      operation.requestBodyResolvedType?.imports.forEach(fqcn => importSet.add(fqcn));
      operation.responseResolvedType?.imports.forEach(fqcn => importSet.add(fqcn));
    }
    for (const dependency of context.repositories) {
      importSet.add(dependency.import);
    }
    for (const dependency of context.mappers) {
      importSet.add(dependency.import);
    }
    context.imports = [...importSet].filter(fqcn => !BASE_TEMPLATE_IMPORTS.has(fqcn)).sort((a, b) => a.localeCompare(b));
    context.injections.sort((a, b) => a.order - b.order);
  }

  if (contexts.length === 0) {
    generator.log.debug('No delegate contexts generated, skipping delegate implementation generation');
    return;
  }

  // javaPackageDir was already determined above
  const implDir = join(javaPackageDir, 'web', 'api', 'impl');
  const implDirAbsolute = generator.destinationPath(implDir);
  mkdirSync(implDirAbsolute, { recursive: true });

  // Remove stale delegate implementations that are no longer generated
  try {
    const expectedFiles = new Set(contexts.map(context => `${context.className}.java`));
    const existingFiles = readdirSync(implDirAbsolute).filter(file => file.endsWith('ApiDelegateImpl.java'));
    for (const file of existingFiles) {
      if (expectedFiles.has(file)) {
        continue;
      }
      const absoluteFile = join(implDirAbsolute, file);
      try {
        const fileContents = readFileSync(absoluteFile, 'utf-8');
        if (!fileContents.includes('Generated delegate implementation')) {
          continue;
        }
      } catch {
        // If the file cannot be read, skip deletion to avoid accidental removal.
        continue;
      }
      generator.fs.delete(absoluteFile);
      generator.log.ok(`Removed stale OpenAPI delegate implementation ${file}`);
    }
  } catch (cleanupError: any) {
    generator.log.debug(`Unable to prune stale delegate implementations: ${cleanupError?.message ?? cleanupError}`);
  }

  const relativeTemplatePath = join('server', 'templates', 'api-delegate-impl.java.ejs');
  const templatePath = generator.fetchFromInstalledJHipster(relativeTemplatePath);
  if (!templatePath || !existsSync(templatePath)) {
    generator.log.warn(`Template not found for delegate generation: ${relativeTemplatePath}`);
    return;
  }
  const templateContent = readFileSync(templatePath, 'utf-8');

  for (const context of contexts) {
    const rendered = ejs.render(templateContent, {
      packageName: `${basePackage}.web.api.impl`,
      basePackage,
      ...context,
    });

    generator.fs.write(join(generator.destinationPath(implDir), `${context.className}.java`), rendered);
    generator.log.ok(`Generated OpenAPI delegate implementation ${context.className}`);
  }
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function deriveResourceName(
  operation: OpenAPIOperation,
  descriptor: OperationDescriptor | undefined,
  operationIdFragment?: string,
): string {
  if (descriptor?.matchedEntity?.name) {
    return descriptor.matchedEntity.name;
  }
  if (descriptor?.resourceName) {
    return descriptor.resourceName;
  }

  const descriptorToken = sanitizeResourceToken(descriptor?.resourceToken);
  if (descriptorToken) {
    return singularize(capitalizeFirst(descriptorToken));
  }

  const schemaCandidate = descriptor?.requestSchemaNames?.[0] ?? descriptor?.responseSchemaNames?.[0];
  const sanitizedSchema = sanitizeResourceToken(schemaCandidate);
  if (sanitizedSchema) {
    return singularize(capitalizeFirst(sanitizedSchema));
  }

  const sanitizedFragment = sanitizeResourceToken(operationIdFragment);
  if (sanitizedFragment) {
    return singularize(capitalizeFirst(sanitizedFragment));
  }

  const tagCandidate = operation.tags?.find(tag => !isVersionTag(tag)) ?? operation.tags?.[0];
  const sanitizedTag = sanitizeResourceToken(tagCandidate);
  if (sanitizedTag) {
    return singularize(capitalizeFirst(sanitizedTag));
  }

  const staticSegments = getStaticPathSegments(operation.path);
  if (staticSegments.length > 0) {
    const pathToken = sanitizeResourceToken(staticSegments[staticSegments.length - 1]);
    if (pathToken) {
      return singularize(capitalizeFirst(pathToken));
    }
  }

  if (operationIdFragment?.trim()) {
    return singularize(capitalizeFirst(operationIdFragment.trim()));
  }

  return 'Resource';
}

function deriveInterfaceBase(operation: OpenAPIOperation, resourceName: string, descriptor?: OperationDescriptor): string {
  const descriptorToken = sanitizeResourceToken(descriptor?.resourceToken);
  if (descriptorToken) {
    return capitalizeFirst(descriptorToken);
  }

  const segments = getStaticPathSegments(operation.path);
  if (segments.length > 0) {
    const sanitized = sanitizeResourceToken(segments[0]);
    if (sanitized) {
      return capitalizeFirst(sanitized);
    }
  }
  return resourceName;
}

function getStaticPathSegments(path?: string): string[] {
  if (!path) {
    return [];
  }
  return path
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0 && !(segment.startsWith('{') && segment.endsWith('}')));
}

function sanitizeResourceToken(value?: string): string {
  if (!value) return '';

  const tokens = value
    // Split camel case boundaries to avoid concatenated words turning lowercase.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // Normalize any separator to a space.
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0);

  if (tokens.length === 0) {
    return '';
  }

  const normalizedTokens = [...tokens];
  while (normalizedTokens.length > 1 && RESOURCE_SUFFIXES_TO_STRIP.has(normalizedTokens[normalizedTokens.length - 1].toLowerCase())) {
    normalizedTokens.pop();
  }

  return normalizedTokens.map(token => token.charAt(0).toUpperCase() + token.slice(1)).join('');
}

function isVersionTag(tag?: string): boolean {
  if (!tag) return false;
  const normalized = tag.trim();
  return /^v\d+(?:\.\d+)?$/i.test(normalized);
}

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildOperationContext(
  operation: OpenAPIOperation,
  kind: OperationKind,
  methodName: string,
  parsedSignature: ParsedMethodSignature | undefined,
  resolverContext: JavaTypeResolverContext,
  resolverOptions?: JavaTypeResolverOptions,
): OperationContext {
  const parameters = operation.parameters || [];
  const specParametersByName = new Map<string, OpenAPIParameter>();
  for (const param of parameters) {
    if (param.name) {
      specParametersByName.set(param.name.toLowerCase(), param);
    }
  }

  const paramNameSet = new Set<string>();
  const parameterContexts: ParameterContext[] = [];
  let paramOrder = 0;
  const returnType = parsedSignature?.returnType;
  const throwsClause = parsedSignature?.throwsClause;

  if (parsedSignature) {
    for (const param of parsedSignature.parameters) {
      const cleanedType = removeModifiers(param.type);
      const key = param.name?.toLowerCase();
      const specParam = key ? specParametersByName.get(key) : undefined;
      let location = determineParamLocation(param.annotations);
      if (!location) {
        location = specParam?.in ?? 'unknown';
      }
      const sanitizedVarName = toJavaParamName(param.name ?? 'param', { usedNames: paramNameSet });
      const resolvedType = specParam?.schema ? resolveJavaType(specParam.schema, resolverContext, resolverOptions) : undefined;
      const javaType = resolvedType?.baseType ?? extractBaseTypeFromTypeString(cleanedType);
      const required = specParam?.required ?? specParam?.in === 'path';
      parameterContexts.push({
        name: param.name,
        varName: sanitizedVarName,
        javaType,
        fullType: cleanedType,
        in: location,
        signatureFragment: replaceVarNameInDeclaration(param.declaration, sanitizedVarName),
        annotations: param.annotations,
        resolvedType,
        required,
        orderIndex: paramOrder++,
      });
    }
  } else {
    const pathParams = parameters.filter(param => param.in === 'path');
    const otherParams = parameters.filter(param => param.in !== 'path');

    for (const param of [...pathParams, ...otherParams]) {
      const sanitizedVarName = toJavaParamName(param.name ?? 'param', { usedNames: paramNameSet });
      const resolvedType = param.schema ? resolveJavaType(param.schema, resolverContext, resolverOptions) : undefined;
      const required = param.required ?? param.in === 'path';
      parameterContexts.push({
        name: param.name,
        varName: sanitizedVarName,
        javaType: resolvedType?.baseType ?? 'Object',
        fullType: resolvedType?.fullType ?? 'Object',
        in: param.in,
        resolvedType,
        required,
        orderIndex: paramOrder++,
      });
    }

    if (operation.requestBodySchemaObject) {
      const bodyType = resolveJavaType(operation.requestBodySchemaObject, resolverContext, resolverOptions);
      const bodyVarName = toJavaParamName(operation.requestBodySchema ?? 'body', { usedNames: paramNameSet, fallback: 'body' });
      parameterContexts.push({
        name: operation.requestBodySchema ?? 'body',
        varName: bodyVarName,
        javaType: bodyType.baseType,
        fullType: bodyType.fullType,
        in: 'body',
        resolvedType: bodyType,
        required: operation.requestBodyRequired,
        orderIndex: paramOrder++,
      });
    }
  }

  const resolvedRequestBodyType = operation.requestBodySchemaObject
    ? resolveJavaType(operation.requestBodySchemaObject, resolverContext, resolverOptions)
    : undefined;
  tagRequestBodyParameter(parameterContexts, operation, resolvedRequestBodyType);

  if (!parsedSignature) {
    sortParameterContexts(parameterContexts);
  }

  const bodyParam = parameterContexts.find(param => param.in === 'body');
  const requestBodyResolvedType = resolvedRequestBodyType ?? bodyParam?.resolvedType;
  const requestBodyType = requestBodyResolvedType?.baseType ?? bodyParam?.javaType;

  const responseSchema = operation.responseSchemaObject;
  const responseResolvedType = responseSchema ? resolveJavaType(responseSchema, resolverContext, resolverOptions) : undefined;
  const responseType = responseResolvedType?.baseType;

  const defaultReturnType = responseResolvedType ? `ResponseEntity<${responseResolvedType.fullType}>` : 'ResponseEntity<Void>';
  const successStatus = operation.responseStatus ? Number.parseInt(operation.responseStatus, 10) : undefined;

  return {
    kind,
    methodName,
    parameters: parameterContexts,
    requestBodyType,
    requestBodyResolvedType,
    responseType,
    responseResolvedType,
    responseIsArray: responseResolvedType?.isList ?? operation.responseIsArray,
    fullSignature: parsedSignature?.fullSignature,
    returnType: returnType ?? defaultReturnType,
    throwsClause,
    successStatus: Number.isFinite(successStatus) ? successStatus : undefined,
  };
}

function determineParamLocation(annotations: string[] = []): string | undefined {
  if (annotations.some(a => a.includes('@PathVariable'))) return 'path';
  if (annotations.some(a => a.includes('@RequestParam'))) return 'query';
  if (annotations.some(a => a.includes('@RequestBody'))) return 'body';
  if (annotations.some(a => a.includes('@RequestPart'))) return 'body';
  const parameterAnnotation = annotations.find(annotation => annotation.startsWith('@Parameter'));
  if (parameterAnnotation) {
    if (/ParameterIn\.PATH/.test(parameterAnnotation)) {
      return 'path';
    }
    if (/ParameterIn\.QUERY/.test(parameterAnnotation)) {
      return 'query';
    }
    if (/ParameterIn\.HEADER/.test(parameterAnnotation)) {
      return 'header';
    }
    if (/ParameterIn\.COOKIE/.test(parameterAnnotation)) {
      return 'cookie';
    }
  }
  return undefined;
}

function removeModifiers(type: string): string {
  return type
    .replace(/\bfinal\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBaseTypeFromTypeString(fullType: string): string {
  const sanitized = removeModifiers(fullType);
  const match = sanitized.match(/<([^<>]+)>$/);
  if (match) {
    const inner = match[1];
    const segments = inner.split(',');
    return segments[segments.length - 1].trim().replace(/^.*\./, '');
  }
  const withoutGenerics = sanitized.replace(/<[^>]+>/g, '').trim();
  const tokens = withoutGenerics.split(/\s+/);
  return tokens[tokens.length - 1]?.replace(/^.*\./, '') ?? withoutGenerics;
}

function replaceVarNameInDeclaration(declaration: string, newName: string): string {
  const trimmed = declaration.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) {
    return newName;
  }
  return `${trimmed.substring(0, lastSpace + 1)}${newName}`;
}

const PARAMETER_LOCATION_ORDER: Record<string, number> = {
  path: 0,
  query: 1,
  header: 2,
  cookie: 3,
  body: 4,
  form: 5,
  unknown: 6,
};

function sortParameterContexts(parameters: ParameterContext[]): void {
  parameters.sort((left, right) => {
    const requiredRank = (value?: boolean): number => (value ? 0 : 1);
    const leftRequired = requiredRank(left.required);
    const rightRequired = requiredRank(right.required);
    if (leftRequired !== rightRequired) {
      return leftRequired - rightRequired;
    }

    const locationRank = (value?: string): number => {
      if (!value) {
        return PARAMETER_LOCATION_ORDER.unknown;
      }
      return PARAMETER_LOCATION_ORDER[value] ?? PARAMETER_LOCATION_ORDER.unknown;
    };

    const leftLocation = locationRank(left.in);
    const rightLocation = locationRank(right.in);
    if (leftLocation !== rightLocation) {
      return leftLocation - rightLocation;
    }

    return (left.orderIndex ?? 0) - (right.orderIndex ?? 0);
  });
}

function tagRequestBodyParameter(parameters: ParameterContext[], operation: OpenAPIOperation, resolvedType?: JavaResolvedType): void {
  const hasRequestBody = Boolean(operation.requestBodySchemaObject || operation.requestBodySchema);
  if (!hasRequestBody) {
    return;
  }

  const existingBody = parameters.find(param => param.in === 'body');
  if (existingBody) {
    if (resolvedType && !existingBody.resolvedType) {
      existingBody.resolvedType = resolvedType;
      existingBody.fullType = existingBody.fullType ?? resolvedType.fullType;
      existingBody.javaType = existingBody.javaType ?? resolvedType.baseType;
    }
    if (operation.requestBodyRequired !== undefined) {
      existingBody.required = operation.requestBodyRequired;
    }
    return;
  }

  const targetSimpleType = resolvedType?.baseType?.toLowerCase() ?? operation.requestBodySchema?.toLowerCase();
  const fallbackName = operation.requestBodySchema?.toLowerCase();

  const candidate = parameters.find(param => {
    const javaSimple = param.javaType?.split('.').pop()?.toLowerCase();
    if (targetSimpleType && javaSimple === targetSimpleType) {
      return true;
    }
    if (fallbackName && javaSimple === fallbackName) {
      return true;
    }
    const paramName = (param.name ?? param.varName)?.toLowerCase();
    return Boolean(fallbackName && paramName === fallbackName);
  });

  if (candidate) {
    candidate.in = 'body';
    if (operation.requestBodyRequired !== undefined) {
      candidate.required = operation.requestBodyRequired;
    }
    if (resolvedType) {
      candidate.resolvedType = resolvedType;
      candidate.fullType = candidate.fullType ?? resolvedType.fullType;
      candidate.javaType = candidate.javaType ?? resolvedType.baseType;
    }
  }
}
