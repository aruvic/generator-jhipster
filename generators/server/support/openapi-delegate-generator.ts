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
import { join } from 'node:path';

import ejs from 'ejs';

import {
  type JavaResolvedType,
  type JavaTypeResolverContext,
  type JavaTypeResolverOptions,
  camelize,
  resolveJavaType,
  singularize,
  toJavaOperationName,
  toJavaParamName,
} from '../../type-utils.ts';
import type { Application as SpringBootApplication } from '../types.ts';

import { type OpenAPIOperation, type OpenAPIParameter, parseOpenAPISpec } from './openapi-mapper-generator.ts';
import { OpenApiEntityMatcher, type OperationDescriptor } from './openapi-entity-matcher.ts';

const CRUD_PREFIXES = ['create', 'list', 'retrieve', 'delete', 'patch'] as const;
type CrudPrefix = (typeof CRUD_PREFIXES)[number];

const CRUD_SUFFIX_MAPPINGS: Record<string, CrudPrefix> = {
  Delete: 'delete',
  Create: 'create',
  Retrieve: 'retrieve',
  List: 'list',
  Patch: 'patch',
};

const BASE_TEMPLATE_IMPORTS = new Set([
  'java.lang.reflect.InvocationTargetException',
  'java.lang.reflect.Method',
  'java.net.URI',
  'java.util.HashMap',
  'java.util.Map',
  'java.util.Objects',
  'java.util.Optional',
  'java.util.UUID',
  'org.springframework.http.HttpStatus',
  'org.springframework.http.ResponseEntity',
  'org.springframework.stereotype.Service',
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
};

type OperationContext = {
  kind: CrudPrefix;
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
  responseMapperField?: string;
  responseMapperMethod?: string;
  responseEntityName?: string;
  responseEntityFqcn?: string;
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
  kind: CrudPrefix;
  operationIdFragment?: string;
};

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

function classifyCrudOperation(
  operation: OpenAPIOperation,
  descriptor?: OperationDescriptor,
): { kind: CrudPrefix; operationIdFragment?: string } | undefined {
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

  const entityMatcher = new OpenApiEntityMatcher(generator, application.packageName);
  const operationDescriptors = entityMatcher.describeOperations(spec);

  const operations: OpenAPIOperation[] = spec.operations || [];
  const crudOperations: CrudOperationMatch[] = operations.flatMap(operation => {
    const descriptor = operationDescriptors.get(operation);
    const classification = classifyCrudOperation(operation, descriptor);
    if (!classification) {
      return [] as CrudOperationMatch[];
    }
    const result: CrudOperationMatch = {
      operation,
      descriptor,
      kind: classification.kind,
      operationIdFragment: classification.operationIdFragment,
    };
    return [result];
  });

  if (crudOperations.length === 0) {
    generator.log.debug('No CRUD-style OpenAPI operations found, skipping delegate implementation generation');
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

  const contexts: ResourceContext[] = [];
  const toDependencyKey = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

  const ensureRepositoryDependency = (
    ctx: ResourceContext,
    entityName: string,
    options: { primary?: boolean } = {},
  ): DependencyDescriptor => {
    const normalized = entityName || 'Resource';
    if (!ctx.repositoryMap) {
      ctx.repositoryMap = new Map();
    }
    const key = toDependencyKey(normalized);
    let dependency = ctx.repositoryMap.get(key);
    if (!dependency) {
      const simpleName = `${normalized}Repository`;
      const fieldName = options.primary ? 'repository' : `${camelize(normalized, { lowerFirst: true })}Repository`;
      dependency = {
        key,
        fieldName,
        simpleName,
        import: `${application.packageName}.repository.${simpleName}`,
        order: ctx.injections.length,
      } satisfies DependencyDescriptor;
      ctx.repositoryMap.set(key, dependency);
      ctx.repositories.push(dependency);
      ctx.injections.push(dependency);
    }
    return dependency;
  };

  const ensureMapperDependency = (
    ctx: ResourceContext,
    typeName: string,
    options: { primary?: boolean } = {},
  ): DependencyDescriptor => {
    const normalized = typeName || 'Resource';
    if (!ctx.mapperMap) {
      ctx.mapperMap = new Map();
    }
    const key = toDependencyKey(normalized);
    let dependency = ctx.mapperMap.get(key);
    if (!dependency) {
      const simpleName = `${normalized}Mapper`;
      const fieldName = options.primary ? 'mapper' : `${camelize(normalized, { lowerFirst: true })}Mapper`;
      dependency = {
        key,
        fieldName,
        simpleName,
        import: `${application.packageName}.web.api.mapper.${simpleName}`,
        order: ctx.injections.length,
      } satisfies DependencyDescriptor;
      ctx.mapperMap.set(key, dependency);
      ctx.mappers.push(dependency);
      ctx.injections.push(dependency);
    }
    return dependency;
  };

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

  const dtoPackage = application.packageName ? `${application.packageName}.service.api.dto` : undefined;

  for (const { operation, descriptor, kind: prefix, operationIdFragment } of crudOperations) {
    const resourceName = deriveResourceName(operation, descriptor, operationIdFragment);
    const resourceSlugSource = descriptor?.resourceToken
      ? sanitizeResourceToken(descriptor.resourceToken)
      : resourceName;
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
        domainFqcn: descriptor?.matchedEntity?.fqcn ?? `${application.packageName}.domain.${resourceName}`,
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

    ensureRepositoryDependency(context, resourceName, { primary: true });
    ensureMapperDependency(context, resourceName, { primary: true });

    if (descriptor?.matchedEntity?.fqcn) {
      context.domainFqcn = descriptor.matchedEntity.fqcn;
    }

    if (!context.idParamName && descriptor?.pathParameters?.length) {
      context.idParamName = descriptor.pathParameters[0]?.name;
    }

    if (resourceSlug && context.resourceSlug !== resourceSlug) {
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
      ? { name: descriptor.matchedEntity.name, fqcn: descriptor.matchedEntity.fqcn }
      : undefined;
    const primaryEntity: EntityInfo = matchedEntityInfo ?? {
      name: resourceName,
      fqcn: descriptor?.matchedEntity?.fqcn ?? `${application.packageName}.domain.${resourceName}`,
    };

    const requestEntityInfo: EntityInfo | undefined = descriptor?.requestEntityMatch
      ? { name: descriptor.requestEntityMatch.name, fqcn: descriptor.requestEntityMatch.fqcn }
      : undefined;
    const responseEntityInfo: EntityInfo | undefined = descriptor?.responseEntityMatch
      ? { name: descriptor.responseEntityMatch.name, fqcn: descriptor.responseEntityMatch.fqcn }
      : undefined;

    const isMutation = prefix === 'create' || prefix === 'patch';
    const persistenceEntity = isMutation && requestEntityInfo ? requestEntityInfo : primaryEntity;
    const persistenceRepository = ensureRepositoryDependency(context, persistenceEntity.name, {
      primary: persistenceEntity.name === context.resourceName,
    });

    opContext.persistenceEntityName = persistenceEntity.name;
    opContext.persistenceEntityFqcn = persistenceEntity.fqcn;
    opContext.persistenceRepositoryField = persistenceRepository.fieldName;

    const bodyParam = opContext.parameters.find(param => param.in === 'body');
    if (bodyParam && isMutation) {
      const requestMapperType = operation.requestBodySchema ?? persistenceEntity.name;
      const requestMapper = ensureMapperDependency(context, requestMapperType, {
        primary: requestMapperType === context.resourceName,
      });
      opContext.requestMapperField = requestMapper.fieldName;
      opContext.requestMapperMethod = `to${persistenceEntity.name}`;
      opContext.willPersist = true;
    } else {
      opContext.willPersist = false;
    }

    if (opContext.responseType) {
      const responseEntity = responseEntityInfo ?? primaryEntity;
      const responseMapper = ensureMapperDependency(context, responseEntity.name, {
        primary: responseEntity.name === context.resourceName,
      });
      opContext.responseMapperField = responseMapper.fieldName;
      opContext.responseEntityName = responseEntity.name;
      opContext.responseEntityFqcn = responseEntity.fqcn;
      opContext.responseMapperMethod = responseEntity.name === persistenceEntity.name ? `to${responseEntity.name}Dto` : `to${responseEntity.name}`;
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
      packageName: `${application.packageName}.web.api.impl`,
      basePackage: application.packageName,
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

function deriveInterfaceBase(
  operation: OpenAPIOperation,
  resourceName: string,
  descriptor?: OperationDescriptor,
): string {
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
  while (
    normalizedTokens.length > 1 &&
    RESOURCE_SUFFIXES_TO_STRIP.has(normalizedTokens[normalizedTokens.length - 1].toLowerCase())
  ) {
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
  kind: CrudPrefix,
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
      parameterContexts.push({
        name: param.name,
        varName: sanitizedVarName,
        javaType,
        fullType: cleanedType,
        in: location,
        signatureFragment: replaceVarNameInDeclaration(param.declaration, sanitizedVarName),
        annotations: param.annotations,
        resolvedType,
      });
    }
  } else {
    const pathParams = parameters.filter(param => param.in === 'path');
    const otherParams = parameters.filter(param => param.in !== 'path');

    for (const param of [...pathParams, ...otherParams]) {
      const sanitizedVarName = toJavaParamName(param.name ?? 'param', { usedNames: paramNameSet });
      const resolvedType = param.schema ? resolveJavaType(param.schema, resolverContext, resolverOptions) : undefined;
      parameterContexts.push({
        name: param.name,
        varName: sanitizedVarName,
        javaType: resolvedType?.baseType ?? 'Object',
        fullType: resolvedType?.fullType ?? 'Object',
        in: param.in,
        resolvedType,
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
      });
    }
  }

  const bodyParam = parameterContexts.find(param => param.in === 'body');
  const requestBodyResolvedType = bodyParam?.resolvedType;
  const requestBodyType = requestBodyResolvedType?.baseType;

  const responseSchema = operation.responseSchemaObject;
  const responseResolvedType = responseSchema ? resolveJavaType(responseSchema, resolverContext, resolverOptions) : undefined;
  const responseType = responseResolvedType?.baseType;

  const defaultReturnType = responseResolvedType ? `ResponseEntity<${responseResolvedType.fullType}>` : 'ResponseEntity<Void>';

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
