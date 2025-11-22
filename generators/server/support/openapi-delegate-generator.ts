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

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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
  in?: string;
};

type OperationContext = {
  kind: CrudPrefix;
  methodName: string;
  parameters: ParameterContext[];
  requestBodyType?: string;
  responseType?: string;
  responseIsArray?: boolean;
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

  const contexts: ResourceContext[] = [];
  for (const operation of crudOperations) {
    const opId = operation.operationId?.trim() || '';
    const detection = detectCrudOperation(opId);
    if (!detection) continue;
    const { kind: prefix, resource } = detection;

    const resourceName = resource.charAt(0).toUpperCase() + resource.slice(1);
    let context = contexts.find(ctx => ctx.resourceName === resourceName);
    if (!context) {
      context = {
        className: `${resourceName}ApiDelegateImpl`,
        interfaceName: `${resourceName}ApiDelegate`,
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
    }

    const opContext = buildOperationContext(operation, prefix);
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

  const javaPackageDir =
    application.javaPackageSrcDir ??
    (application.srcMainJava && application.packageNameWithSlashes
      ? join(application.srcMainJava, application.packageNameWithSlashes)
      : undefined);

  if (!javaPackageDir) {
    generator.log.warn('Unable to resolve Java package directory for delegate implementations');
    return;
  }

  const implDir = join(javaPackageDir, 'web', 'api', 'impl');
  mkdirSync(generator.destinationPath(implDir), { recursive: true });

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

function buildOperationContext(operation: OpenAPIOperation, kind: CrudPrefix): OperationContext {
  const parameters = operation.parameters || [];
  const pathParams = parameters.filter(param => param.in === 'path');
  const queryParams = parameters.filter(param => param.in === 'query');

  const requestBodyType = normalizeSchemaName(operation.requestBodySchema);
  const responseType = normalizeSchemaName(operation.responseSchema);

  const paramContexts: ParameterContext[] = [
    ...pathParams.map(toParameterContext),
    ...(requestBodyType
      ? [
          {
            name: requestBodyType,
            varName: lowerFirst(requestBodyType),
            javaType: requestBodyType,
            in: 'body',
          },
        ]
      : []),
    ...queryParams.map(toParameterContext),
  ];

  return {
    kind,
    methodName: operation.operationId || '',
    parameters: paramContexts,
    requestBodyType,
    responseType,
    responseIsArray: operation.responseIsArray,
  };
}

function toParameterContext(param: OpenAPIParameter): ParameterContext {
  const javaType = toJavaType(param?.schema);
  return {
    name: param.name,
    varName: lowerFirst(param.name),
    javaType,
    in: param.in,
  };
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
