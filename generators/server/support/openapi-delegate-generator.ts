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

import type { Application as SpringBootApplication } from '../types.ts';
import { parseOpenAPISpec, type OpenAPIOperation, type OpenAPIParameter } from './openapi-mapper-generator.ts';

const CRUD_PREFIXES = ['create', 'list', 'retrieve', 'delete', 'patch'] as const;
type CrudPrefix = (typeof CRUD_PREFIXES)[number];

type ParameterContext = {
  name: string;
  varName: string;
  javaType: string;
  fullType: string; // Full type with generics, e.g., ResponseEntity<List<BookingDto>>
  in?: string;
  signatureFragment?: string; // Original declaration with annotations, modifiers, etc.
  annotations?: string[];
};

type OperationContext = {
  kind: CrudPrefix;
  methodName: string;
  parameters: ParameterContext[];
  requestBodyType?: string;
  responseType?: string;
  responseIsArray?: boolean;
  fullSignature?: string; // Full method signature from generated interface
  returnType?: string; // Full return type with generics
  throwsClause?: string;
};

type ResourceContext = {
  className: string;
  interfaceName: string;
  resourceName: string;
  resourceSlug: string;
  operations: OperationContext[];
  hasCreate: boolean;
  hasList: boolean;
  hasRetrieve: boolean;
  hasDelete: boolean;
  hasPatch: boolean;
  idParamName?: string;
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
  const methodRegex = /default\s+([\w<>.,\s]+?)\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:throws\s+([^\{]+))?\s*\{/g;
  
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

  function detectCrudOperation(opId: string): { kind: CrudPrefix; resource: string } | undefined {
    if (!opId) return undefined;

    const prefix = CRUD_PREFIXES.find(p => opId.startsWith(p));
    if (prefix) {
      const resource = opId.substring(prefix.length);
      if (resource) {
        return { kind: prefix, resource };
      }
    }

    // Fallback: some specs use resourceAction format (e.g., hubDelete).
    const suffixMappings: Record<string, CrudPrefix> = {
      Delete: 'delete',
      Create: 'create',
      Retrieve: 'retrieve',
      List: 'list',
      Patch: 'patch',
    };

    const suffix = Object.keys(suffixMappings).find(s => opId.endsWith(s));
    if (suffix) {
      const resource = opId.substring(0, opId.length - suffix.length);
      if (resource) {
        return { kind: suffixMappings[suffix], resource };
      }
    }

    return undefined;
  }

  const operations = spec.operations || [];
  const crudOperations = operations.filter(operation => detectCrudOperation(operation.operationId || ''));

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
      'api'
    );
    potentialInterfaceDirs.push(generatedApiDir);
  }

  const contexts: ResourceContext[] = [];
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

  for (const operation of crudOperations) {
    const opId = operation.operationId?.trim() || '';
    const detection = detectCrudOperation(opId);
    if (!detection) continue;
    const { kind: prefix, resource } = detection;
    const resourceName = deriveResourceName(operation, resource);

    const methodBinding = methodToInterface.get(opId);
    const fallbackInterfaceBase = deriveInterfaceBase(operation, resourceName);
    const interfaceName = methodBinding?.interfaceName ?? `${fallbackInterfaceBase}ApiDelegate`;
    const interfaceBase = methodBinding?.interfaceBase ?? fallbackInterfaceBase;

    let context = contexts.find(ctx => ctx.interfaceName === interfaceName);
    if (!context) {
      context = {
        className: `${interfaceBase}ApiDelegateImpl`,
        interfaceName,
        resourceName,
        resourceSlug: toKebabCase(resourceName),
        operations: [],
        hasCreate: false,
        hasList: false,
        hasRetrieve: false,
        hasDelete: false,
        hasPatch: false,
        idParamName: undefined,
      };
      contexts.push(context);
    } else if (context.resourceName !== resourceName) {
      generator.log.debug(
        `Interface ${interfaceName} already bound to resource ${context.resourceName}, ignoring alternate resource ${resourceName}`
      );
    }

    let parsedSignature = methodBinding?.parsedMethods.get(opId);
    if (!parsedSignature && !methodBinding) {
      const fallbackInterfacePath = generator.destinationPath(join(apiInterfaceDir, `${interfaceBase}ApiDelegate.java`));
      parsedSignature = parseApiDelegateInterface(fallbackInterfacePath).get(opId);
    }
    
    if (parsedSignature) {
      generator.log.debug(`Using parsed signature for ${opId}: ${parsedSignature.fullSignature}`);
    }

    const opContext = buildOperationContext(operation, prefix, parsedSignature);
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

    const idParam = operation.parameters?.find(param => param.in === 'path');
    if (idParam?.name) {
      context.idParamName = idParam.name;
    }
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

function deriveResourceName(operation: OpenAPIOperation, resource: string): string {
  const sanitizedResource = sanitizeResourceToken(resource);
  const tagCandidate = operation.tags?.find(tag => !isVersionTag(tag)) ?? operation.tags?.[0];
  const sanitizedTag = sanitizeResourceToken(tagCandidate);

  const baseToken = sanitizedResource || sanitizedTag || resource || tagCandidate || '';
  const capitalized = capitalizeFirst(baseToken);
  return singularizeName(capitalized);
}

function deriveInterfaceBase(operation: OpenAPIOperation, resourceName: string): string {
  const segments = operation.path?.split('/')?.filter(segment => segment.length > 0) ?? [];
  if (segments.length > 0) {
    const sanitized = sanitizeResourceToken(segments[0]);
    if (sanitized) {
      return singularizeName(capitalizeFirst(sanitized));
    }
  }
  return resourceName;
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

  return tokens.map(token => token.charAt(0).toUpperCase() + token.slice(1)).join('');
}

function isVersionTag(tag?: string): boolean {
  if (!tag) return false;
  const normalized = tag.trim();
  return /^v\d+(?:\.\d+)?$/i.test(normalized);
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

function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildOperationContext(
  operation: OpenAPIOperation, 
  kind: CrudPrefix,
  parsedSignature?: ParsedMethodSignature
): OperationContext {
  const parameters = operation.parameters || [];
  const specParametersByName = new Map<string, OpenAPIParameter>();
  for (const param of parameters) {
    if (param.name) {
      specParametersByName.set(param.name.toLowerCase(), param);
    }
  }

  const requestBodyType = normalizeSchemaName(operation.requestBodySchema);
  const responseType = normalizeSchemaName(operation.responseSchema);

  // If we have parsed signature from generated interface, use it for accurate types
  let paramContexts: ParameterContext[];
  let returnType: string | undefined;
  let throwsClause: string | undefined;
  let bodyParamAssigned = false;
  
  if (parsedSignature) {
    paramContexts = parsedSignature.parameters.map(p => {
      const cleanedType = removeModifiers(p.type);
      let location = determineParamLocation(p.annotations);

      if (location === 'body') {
        bodyParamAssigned = true;
      }

      const paramNameKey = p.name?.toLowerCase();
      if (!location && paramNameKey) {
        const specParam = specParametersByName.get(paramNameKey);
        if (specParam?.in) {
          location = specParam.in;
        }
      }

      if (!location && requestBodyType) {
        const normalizedType = cleanedType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (!bodyParamAssigned && normalizedType.includes(requestBodyType.toLowerCase())) {
          location = 'body';
          bodyParamAssigned = true;
        }
      }

      if (!location) {
        location = 'unknown';
      }

      const sanitizedVarName = sanitizeJavaIdentifier(p.name);
      const context: ParameterContext = {
        name: p.name,
        varName: sanitizedVarName,
        javaType: extractSimpleType(cleanedType),
        fullType: cleanedType,
        in: location,
        signatureFragment: replaceVarNameInDeclaration(p.declaration, sanitizedVarName),
        annotations: p.annotations,
      };
      return context;
    });
    returnType = parsedSignature.returnType;
    throwsClause = parsedSignature.throwsClause;
  } else {
    // Fallback to OpenAPI spec parsing while approximating OpenAPI generator ordering
    const pathParamContexts: ParameterContext[] = [];
    const otherParamContexts: ParameterContext[] = [];

    for (const param of parameters) {
      const context = toParameterContext(param);
      if (param.in === 'path') {
        pathParamContexts.push(context);
      } else {
        otherParamContexts.push(context);
      }
    }

    paramContexts = [...pathParamContexts];

    if (requestBodyType) {
      const bodyVarName = sanitizeJavaIdentifier(lowerFirst(requestBodyType));
      paramContexts.push({
        name: requestBodyType,
        varName: bodyVarName,
        javaType: requestBodyType,
        fullType: requestBodyType,
        in: 'body',
      });
    }

    paramContexts.push(...otherParamContexts);
  }

  return {
    kind,
    methodName: operation.operationId || '',
    parameters: paramContexts,
    requestBodyType,
    responseType,
    responseIsArray: operation.responseIsArray,
    fullSignature: parsedSignature?.fullSignature,
    returnType,
    throwsClause,
  };
}

function toParameterContext(param: OpenAPIParameter): ParameterContext {
  const javaType = toJavaType(param?.schema);
  const sanitizedVarName = sanitizeJavaIdentifier(param.name);
  return {
    name: param.name,
    varName: sanitizedVarName,
    javaType,
    fullType: javaType,
    in: param.in,
  };
}

function extractSimpleType(fullType: string): string {
  const sanitized = removeModifiers(fullType);
  // Extract simple type name from full type like "ResponseEntity<BookingDto>" -> "BookingDto"
  const match = sanitized.match(/<([^<>]+)>$/);
  if (match) {
    return match[1].replace(/^.*\./, ''); // Remove package prefix
  }
  const withoutGenerics = sanitized.replace(/<[^>]+>/g, '').trim();
  const tokens = withoutGenerics.split(/\s+/);
  return tokens[tokens.length - 1]?.replace(/^.*\./, '') ?? withoutGenerics;
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
  return type.replace(/\bfinal\b/g, '').replace(/\s+/g, ' ').trim();
}

function toJavaType(schema?: any): string {
  const type = schema?.type;
  if (type === 'integer' || type === 'number') {
    return 'Integer';
  }
  if (type === 'boolean') {
    return 'Boolean';
  }
  return 'String';
}

function lowerFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function normalizeSchemaName(name?: string): string | undefined {
  if (!name) return undefined;
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

const JAVA_KEYWORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'void',
  'volatile',
  'while',
]);

function sanitizeJavaIdentifier(name?: string, fallback = 'param'): string {
  if (!name) {
    return fallback;
  }

  const tokens = name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 0);

  if (tokens.length === 0) {
    tokens.push(fallback);
  }

  const camelCased = tokens
    .map((token, index) => {
      const lower = token.toLowerCase();
      return index === 0 ? lower : capitalizeFirst(lower);
    })
    .join('');

  let candidate = camelCased;
  if (!candidate) {
    candidate = fallback;
  }

  if (!/^[A-Za-z_]/.test(candidate)) {
    candidate = `${fallback}${capitalizeFirst(candidate)}`;
  }

  if (JAVA_KEYWORDS.has(candidate.toLowerCase())) {
    candidate = `${candidate}Param`;
  }

  return candidate;
}

function replaceVarNameInDeclaration(declaration: string, newName: string): string {
  const trimmed = declaration.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) {
    return newName;
  }
  return `${trimmed.substring(0, lastSpace + 1)}${newName}`;
}
