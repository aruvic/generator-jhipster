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
import { existsSync, readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import { asWriteFilesSection, asWritingTask } from '../base-application/support/index.ts';
import { clientApplicationTemplatesBlock, clientRootTemplatesBlock, clientSrcTemplatesBlock } from '../client/support/files.ts';

import type {
  Application as AngularApplication,
  Entity as AngularEntity,
  OpenApiOperationDefinition,
  OpenApiSchemaField,
} from './types.ts';

export const files = asWriteFilesSection({
  jhipsterProject: [
    {
      templates: ['README.md.jhi.client.angular'],
    },
  ],
  common: [
    clientRootTemplatesBlock({
      templates: [
        { sourceFile: 'eslint.config.js.jhi.angular', destinationFile: ctx => `${ctx.eslintConfigFile}.jhi.angular` },
        'ngsw-config.json',
        'package.json',
        'tsconfig.json',
        'tsconfig.app.json',
        'tsconfig.spec.json',
      ],
    }),
    clientRootTemplatesBlock({
      condition: ctx => ctx.enableTranslation && ctx.enableI18nRTL,
      templates: ['postcss.config.json'],
    }),
  ],
  jest: [
    clientRootTemplatesBlock({
      condition: ctx => ctx.clientTestFrameworkJest,
      templates: ['jest.conf.js', 'setup-jest.ts'],
    }),
  ],
  vitest: [
    clientSrcTemplatesBlock({
      condition: ctx => ctx.clientTestFrameworkVitest,
      templates: ['default-test-providers.ts'],
    }),
  ],
  webpack: [
    clientRootTemplatesBlock({
      condition: ctx => ctx.clientBundlerWebpack,
      templates: [
        'angular.json',
        'webpack/environment.js',
        'webpack/proxy.conf.js',
        'webpack/webpack.custom.js',
        'webpack/logo-jhipster.png',
      ],
    }),
  ],
  esbuild: [
    clientRootTemplatesBlock({
      condition: ctx => ctx.clientBundlerEsbuild,
      templates: [
        { sourceFile: 'angular.json.esbuild', destinationFile: 'angular.json' },
        'proxy.config.mjs',
        'build-plugins/define-esbuild.ts',
      ],
    }),
    clientRootTemplatesBlock({
      condition: ctx => ctx.clientBundlerEsbuild && ctx.enableTranslation,
      templates: ['build-plugins/i18n-esbuild.ts'],
    }),
    clientSrcTemplatesBlock({
      condition: ctx => ctx.clientBundlerEsbuild && ctx.enableTranslation,
      templates: ['i18n/index.ts'],
    }),
  ],
  sass: [
    {
      ...clientSrcTemplatesBlock(),
      templates: [
        'content/scss/_bootstrap-variables.scss',
        'content/scss/global.scss',
        'content/scss/vendor.scss',
        'environments/environment.ts',
        'environments/environment.development.ts',
      ],
    },
  ],
  angularApp: [
    {
      ...clientSrcTemplatesBlock(),
      templates: ['main.ts', 'bootstrap.ts', 'declarations.d.ts'],
    },
    {
      ...clientApplicationTemplatesBlock(),
      templates: ['app.config.ts', 'app.ts', 'app.routes.ts', 'app-page-title-strategy.ts'],
    },
  ],
  microfrontend: [
    clientRootTemplatesBlock({
      condition: generator => generator.clientBundlerWebpack && generator.microfrontend,
      templates: ['webpack/webpack.microfrontend.js'],
    }),
    clientApplicationTemplatesBlock({
      condition: data => data.microfrontend && data.applicationTypeGateway,
      templates: ['core/microfrontend/index.ts'],
    }),
    clientApplicationTemplatesBlock({
      condition: data => data.microfrontend && data.applicationTypeMicroservice,
      templates: ['entities/entity-navbar-items.ts'],
    }),
  ],
  angularMain: [
    {
      ...clientApplicationTemplatesBlock(),
      templates: [
        // entities
        'entities/entity.routes.ts',
        // home module
        'home/home.ts',
        'home/home.html',
        // layouts
        'layouts/profiles/page-ribbon.ts',
        'layouts/profiles/profile.service.ts',
        'layouts/profiles/profile-info.model.ts',
        'layouts/main/main.ts',
        'layouts/main/main.html',
        'layouts/navbar/navbar-item.model.d.ts',
        'layouts/navbar/navbar.ts',
        'layouts/navbar/navbar.html',
        'layouts/footer/footer.ts',
        'layouts/footer/footer.html',
        'layouts/error/error.route.ts',
        'layouts/error/error.ts',
        'layouts/error/error.html',
        // login
        'login/login.service.ts',
      ],
    },
    {
      condition: generator => generator.enableTranslation,
      ...clientApplicationTemplatesBlock(),
      templates: ['layouts/navbar/active-menu.directive.ts'],
    },
    {
      ...clientApplicationTemplatesBlock(),
      templates: ['layouts/profiles/page-ribbon.scss', 'layouts/navbar/navbar.scss', 'home/home.scss'],
    },
    {
      condition: generator => Boolean((generator as AngularApplication<AngularEntity>).openApiOperations?.length),
      ...clientApplicationTemplatesBlock(),
      templates: [
        'openapi-operations/openapi-operations.model.ts',
        'openapi-operations/openapi-operations.ts',
        'openapi-operations/openapi-operations.html',
        'openapi-operations/openapi-operations.spec.ts',
        'form-crud/form-crud.ts',
        'form-crud/form-crud.html',
        'form-crud/form-crud.spec.ts',
        'admin/form-crud-reference-pickers/form-crud-reference-pickers.ts',
        'admin/form-crud-reference-pickers/form-crud-reference-pickers.html',
        'admin/form-crud-reference-pickers/form-crud-reference-pickers.spec.ts',
      ],
    },
    // login
    {
      ...clientApplicationTemplatesBlock(),
      condition: generator => !generator.authenticationTypeOauth2,
      templates: ['login/login.ts', 'login/login.html', 'login/login.model.ts'],
    },
    {
      ...clientApplicationTemplatesBlock(),
      condition: generator => generator.authenticationTypeOauth2,
      templates: ['login/logout.model.ts'],
    },
  ],
  angularAccountModule: [
    {
      ...clientApplicationTemplatesBlock(),
      condition: generator => generator.generateUserManagement,
      templates: [
        'account/account.route.ts',
        'account/activate/activate.route.ts',
        'account/activate/activate.ts',
        'account/activate/activate.html',
        'account/activate/activate.service.ts',
        'account/password/password.route.ts',
        'account/password/password-strength-bar/password-strength-bar.ts',
        'account/password/password-strength-bar/password-strength-bar.html',
        'account/password/password-strength-bar/password-strength-bar.scss',
        'account/password/password.ts',
        'account/password/password.html',
        'account/password/password.service.ts',
        'account/register/register.route.ts',
        'account/register/register.ts',
        'account/register/register.html',
        'account/register/register.service.ts',
        'account/register/register.model.ts',
        'account/password-reset/init/password-reset-init.route.ts',
        'account/password-reset/init/password-reset-init.ts',
        'account/password-reset/init/password-reset-init.html',
        'account/password-reset/init/password-reset-init.service.ts',
        'account/password-reset/finish/password-reset-finish.route.ts',
        'account/password-reset/finish/password-reset-finish.ts',
        'account/password-reset/finish/password-reset-finish.html',
        'account/password-reset/finish/password-reset-finish.service.ts',
        'account/settings/settings.route.ts',
        'account/settings/settings.ts',
        'account/settings/settings.html',
      ],
    },
    {
      condition: generator => generator.authenticationTypeSession && generator.generateUserManagement,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'account/sessions/sessions.route.ts',
        'account/sessions/session.model.ts',
        'account/sessions/sessions.ts',
        'account/sessions/sessions.html',
        'account/sessions/sessions.service.ts',
      ],
    },
  ],
  angularAdminModule: [
    {
      condition: generator => !generator.applicationTypeMicroservice,
      ...clientApplicationTemplatesBlock(),
      templates: ['admin/admin.routes.ts', 'admin/docs/docs.ts', 'admin/docs/docs.html', 'admin/docs/docs.scss'],
    },
    {
      condition: generator => generator.withAdminUi,
      ...clientApplicationTemplatesBlock(),
      templates: [
        // admin modules
        'admin/configuration/configuration.ts',
        'admin/configuration/configuration.html',
        'admin/configuration/configuration.service.ts',
        'admin/configuration/configuration.model.ts',
        'admin/health/health.ts',
        'admin/health/health.html',
        'admin/health/modal/health-modal.ts',
        'admin/health/modal/health-modal.html',
        'admin/health/health.service.ts',
        'admin/health/health.model.ts',
        'admin/logs/log.model.ts',
        'admin/logs/logs.ts',
        'admin/logs/logs.html',
        'admin/logs/logs.service.ts',
        'admin/metrics/metrics.ts',
        'admin/metrics/metrics.html',
        'admin/metrics/metrics.service.ts',
        'admin/metrics/metrics.model.ts',
        'admin/metrics/blocks/jvm-memory/jvm-memory.ts',
        'admin/metrics/blocks/jvm-memory/jvm-memory.html',
        'admin/metrics/blocks/jvm-threads/jvm-threads.ts',
        'admin/metrics/blocks/jvm-threads/jvm-threads.html',
        'admin/metrics/blocks/metrics-cache/metrics-cache.ts',
        'admin/metrics/blocks/metrics-cache/metrics-cache.html',
        'admin/metrics/blocks/metrics-datasource/metrics-datasource.ts',
        'admin/metrics/blocks/metrics-datasource/metrics-datasource.html',
        'admin/metrics/blocks/metrics-endpoints-requests/metrics-endpoints-requests.ts',
        'admin/metrics/blocks/metrics-endpoints-requests/metrics-endpoints-requests.html',
        'admin/metrics/blocks/metrics-garbagecollector/metrics-garbagecollector.ts',
        'admin/metrics/blocks/metrics-garbagecollector/metrics-garbagecollector.html',
        'admin/metrics/blocks/metrics-modal-threads/metrics-modal-threads.ts',
        'admin/metrics/blocks/metrics-modal-threads/metrics-modal-threads.html',
        'admin/metrics/blocks/metrics-request/metrics-request.ts',
        'admin/metrics/blocks/metrics-request/metrics-request.html',
        'admin/metrics/blocks/metrics-system/metrics-system.ts',
        'admin/metrics/blocks/metrics-system/metrics-system.html',
      ],
    },
    {
      condition: generator => generator.communicationSpringWebsocket,
      ...clientSrcTemplatesBlock(),
      templates: ['sockjs-client.polyfill.ts'],
    },
    {
      condition: generator => generator.communicationSpringWebsocket,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'admin/tracker/tracker.ts',
        'admin/tracker/tracker.html',
        'core/tracker/tracker-activity.model.ts',
        'core/tracker/tracker.service.ts',
      ],
    },
    {
      condition: ctx => ctx.applicationTypeGateway && ctx.gatewayServicesApiAvailable,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'admin/gateway/gateway-route.model.ts',
        'admin/gateway/gateway.ts',
        'admin/gateway/gateway.html',
        'admin/gateway/gateway-routes.service.ts',
      ],
    },
  ],
  angularCore: [
    {
      ...clientApplicationTemplatesBlock(),
      templates: [
        'core/config/application-config.service.ts',
        'core/config/application-config.service.spec.ts',

        'core/util/data-util.service.ts',
        'core/util/parse-links.service.ts',
        'core/util/alert.service.ts',
        'core/util/event-manager.service.ts',
        'core/util/operators.spec.ts',
        'core/util/operators.ts',

        // config
        'config/uib-pagination.config.ts',
        'config/dayjs.ts',
        'config/datepicker-adapter.ts',
        'config/font-awesome-icons.ts',
        'config/error.constants.ts',
        'config/input.constants.ts',
        'config/navigation.constants.ts',
        'config/pagination.constants.ts',
        'config/authority.constants.ts',

        // interceptors
        'core/interceptor/error-handler.interceptor.ts',
        'core/interceptor/notification.interceptor.ts',
        'core/interceptor/auth-expired.interceptor.ts',
        'core/interceptor/index.ts',

        // request
        'core/request/request-util.ts',
        'core/request/request.model.ts',
      ],
    },
    {
      condition: generator => generator.authenticationTypeJwt,
      ...clientApplicationTemplatesBlock(),
      templates: ['core/interceptor/auth.interceptor.ts'],
    },
    {
      condition: generator => generator.enableTranslation,
      ...clientApplicationTemplatesBlock(),
      templates: ['config/language.constants.ts', 'config/translation.config.ts'],
    },
  ],
  angularShared: [
    {
      ...clientApplicationTemplatesBlock(),
      templates: [
        'shared/shared.module.ts',
        'shared/date/index.ts',
        'shared/date/duration.pipe.ts',
        'shared/date/format-medium-date.pipe.ts',
        'shared/date/format-medium-datetime.pipe.ts',
        'shared/sort/index.ts',
        'shared/sort/sort-by.directive.ts',
        'shared/sort/sort-by.directive.spec.ts',
        'shared/sort/sort-state.ts',
        'shared/sort/sort.directive.spec.ts',
        'shared/sort/sort.directive.ts',
        'shared/sort/sort.service.spec.ts',
        'shared/sort/sort.service.ts',
        'shared/pagination/index.ts',
        'shared/pagination/item-count.ts',
        // alert service code
        'shared/alert/alert.ts',
        'shared/alert/alert.html',
        'shared/alert/alert-error.ts',
        'shared/alert/alert-error.html',
        'shared/alert/alert-error.model.ts',
        // filtering options
        'shared/filter/index.ts',
        'shared/filter/filter.html',
        'shared/filter/filter.ts',
        'shared/filter/filter.model.spec.ts',
        'shared/filter/filter.model.ts',
      ],
    },
    {
      condition: generator => generator.enableTranslation,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'shared/language/index.ts',
        'shared/language/translation.module.ts',
        'shared/language/find-language-from-key.pipe.ts',
        'shared/language/translate.directive.ts',
      ],
    },
  ],
  angularAuthService: [
    {
      ...clientApplicationTemplatesBlock(),
      templates: [
        'core/auth/state-storage.service.ts',
        'shared/auth/has-any-authority.directive.ts',
        'core/auth/account.model.ts',
        'core/auth/account.service.ts',
        'core/auth/account.service.spec.ts',
        'core/auth/user-route-access.service.ts',
      ],
    },
    {
      condition: generator => generator.authenticationTypeJwt,
      ...clientApplicationTemplatesBlock(),
      templates: ['core/auth/auth-jwt.service.ts', 'core/auth/auth-jwt.service.spec.ts'],
    },
    {
      condition: generator => generator.authenticationUsesCsrf,
      ...clientApplicationTemplatesBlock(),
      templates: ['core/auth/auth-session.service.ts'],
    },
    {
      condition: generator => generator.authenticationTypeSession && generator.communicationSpringWebsocket,
      ...clientApplicationTemplatesBlock(),
      templates: ['core/auth/csrf.service.ts'],
    },
  ],
  clientTestFw: [
    {
      condition: generator => generator.withAdminUi,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'admin/configuration/configuration.spec.ts',
        'admin/configuration/configuration.service.spec.ts',
        'admin/health/modal/health-modal.spec.ts',
        'admin/health/health.spec.ts',
        'admin/health/health.service.spec.ts',
        'admin/logs/logs.spec.ts',
        'admin/logs/logs.service.spec.ts',
        'admin/metrics/metrics.spec.ts',
        'admin/metrics/metrics.service.spec.ts',
        'admin/metrics/blocks/metrics-modal-threads/metrics-modal-threads.spec.ts',
      ],
    },
    {
      ...clientApplicationTemplatesBlock(),
      templates: [
        'shared/auth/has-any-authority.directive.spec.ts',
        'core/util/event-manager.service.spec.ts',
        'core/util/data-util.service.spec.ts',
        'core/util/parse-links.service.spec.ts',
        'core/util/alert.service.spec.ts',
        'home/home.spec.ts',
        'layouts/main/main.spec.ts',
        'layouts/navbar/navbar.spec.ts',
        'layouts/profiles/page-ribbon.spec.ts',
        'shared/alert/alert.spec.ts',
        'shared/alert/alert-error.spec.ts',
        'shared/date/format-medium-date.pipe.spec.ts',
        'shared/date/format-medium-datetime.pipe.spec.ts',
        'shared/pagination/item-count.spec.ts',
      ],
    },
    {
      condition: generator => generator.enableTranslation,
      ...clientApplicationTemplatesBlock(),
      templates: ['shared/language/translate.directive.spec.ts'],
    },
    {
      condition: generator => generator.generateUserManagement,
      ...clientApplicationTemplatesBlock(),
      templates: [
        'account/activate/activate.spec.ts',
        'account/activate/activate.service.spec.ts',
        'account/password/password.spec.ts',
        'account/password/password.service.spec.ts',
        'account/password/password-strength-bar/password-strength-bar.spec.ts',
        'account/password-reset/init/password-reset-init.spec.ts',
        'account/password-reset/init/password-reset-init.service.spec.ts',
        'account/password-reset/finish/password-reset-finish.spec.ts',
        'account/password-reset/finish/password-reset-finish.service.spec.ts',
        'account/register/register.spec.ts',
        'account/register/register.service.spec.ts',
        'account/settings/settings.spec.ts',
      ],
    },
    {
      condition: generator => !generator.authenticationTypeOauth2,
      ...clientApplicationTemplatesBlock(),
      templates: ['login/login.spec.ts'],
    },
    {
      condition: generator => generator.authenticationTypeSession && generator.generateUserManagement,
      ...clientApplicationTemplatesBlock(),
      templates: ['account/sessions/sessions.spec.ts'],
    },
  ],
});

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);
const MAX_OPERATION_FORM_SCHEMA_DEPTH = 16;
const MAX_OPERATION_FORM_EXAMPLE_DEPTH = 4;
const MAX_COMPACT_OPERATION_FORM_SCHEMA_DEPTH = 12;
const MAX_COMPACT_OPERATION_FORM_SCHEMA_NODES = 2500;
const MAX_COMPACT_OPERATION_FORM_EXAMPLE_DEPTH = 8;
const MAX_COMPACT_OPERATION_FORM_EXAMPLE_NODES = 800;

function decodePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveOpenApiRef(openApi: any, value: any): any {
  if (!value?.$ref || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
  return value.$ref
    .slice(2)
    .split('/')
    .map(decodePointer)
    .reduce((current: any, segment: string) => current?.[segment], openApi);
}

function schemaType(schema: any): string {
  schema = schema ?? {};
  const rawType = Array.isArray(schema.type) ? schema.type.find((item: string) => item !== 'null') : schema.type;
  if (rawType) return String(rawType);
  if (schema.properties || schema.allOf || schema.oneOf || schema.anyOf) return 'object';
  if (schema.items) return 'array';
  return 'string';
}

function schemaEnumValues(schema: any): string[] | undefined {
  return Array.isArray(schema?.enum) ? schema.enum.map(String) : undefined;
}

function extractSchemaRef(schema: any): string | undefined {
  if (typeof schema?.$ref !== 'string') return undefined;
  const prefix = '#/components/schemas/';
  return schema.$ref.startsWith(prefix) ? decodePointer(schema.$ref.slice(prefix.length)) : undefined;
}

function mergeAllOfSchema(openApi: any, schema: any, seen: Set<string>): any {
  if (!Array.isArray(schema?.allOf)) return schema;
  const merged = { ...schema, allOf: undefined, properties: { ...(schema.properties ?? {}) }, required: [...(schema.required ?? [])] };
  for (const branch of schema.allOf) {
    let branchSeen = seen;
    if (typeof branch?.$ref === 'string') {
      if (seen.has(branch.$ref)) continue;
      branchSeen = new Set([...seen, branch.$ref]);
    }
    const resolvedBranch = mergeAllOfSchema(openApi, resolveOpenApiRef(openApi, branch), branchSeen);
    merged.properties = { ...merged.properties, ...(resolvedBranch?.properties ?? {}) };
    merged.required = [...new Set([...merged.required, ...(resolvedBranch?.required ?? [])])];
    for (const [key, value] of Object.entries(resolvedBranch ?? {})) {
      if (!['allOf', 'properties', 'required'].includes(key) && merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function schemaPointerPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function schemaPointer(path: string[]): string {
  return path.length ? `/${path.map(schemaPointerPart).join('/')}` : '';
}

function firstObjectExample(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!Array.isArray(value)) return undefined;
  return value.find(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown> | undefined;
}

function inferredSchemaFieldFromExample(name: string, path: string[], value: unknown): OpenApiSchemaField {
  const pointer = schemaPointer(path);
  if (Array.isArray(value)) {
    const sample = value.find(item => item !== undefined && item !== null);
    return {
      name,
      pointer,
      path,
      required: false,
      nullable: false,
      type: 'array',
      example: value,
      items: inferredSchemaFieldFromExample(`${name} item`, [...path, '0'], sample),
    };
  }
  if (value && typeof value === 'object') {
    return {
      name,
      pointer,
      path,
      required: false,
      nullable: false,
      type: 'object',
      example: value,
      fields: Object.entries(value as Record<string, unknown>).map(([propertyName, propertyValue]) =>
        inferredSchemaFieldFromExample(propertyName, [...path, propertyName], propertyValue),
      ),
    };
  }
  return {
    name,
    pointer,
    path,
    required: false,
    nullable: value === null,
    type: inferredScalarTypeFromExample(value),
    example: value,
  };
}

function inferredScalarTypeFromExample(value: unknown): OpenApiSchemaField['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function schemaNullable(schema: any): boolean {
  return Boolean(schema?.nullable || (Array.isArray(schema?.type) && schema.type.includes('null')));
}

function schemaNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function schemaReferenceExample(openApi: any, schema: any, refName: string | undefined): Record<string, unknown> | undefined {
  if (!refName) return undefined;
  const resolved = resolveOpenApiRef(openApi, schema);
  const discriminatorProperty =
    typeof resolved?.discriminator?.propertyName === 'string'
      ? resolved.discriminator.propertyName
      : resolved?.properties?.['@type']
        ? '@type'
        : undefined;
  if (!discriminatorProperty) return undefined;
  return { [discriminatorProperty]: discriminatorExampleValue(openApi, resolved, refName, discriminatorProperty) };
}

function discriminatorExampleValue(openApi: any, schema: any, refName: string | undefined, propertyName: string): string {
  const mapping = schema?.discriminator?.mapping;
  const mappingEntries =
    mapping && typeof mapping === 'object'
      ? Object.entries(mapping)
          .filter((entry): entry is [string, unknown] => Boolean(entry[0]))
          .map(([value, ref]) => [value, typeof ref === 'string' ? ref : undefined] as const)
      : [];
  const schemaDiscriminatorValue = refName ? stripDtoSuffix(refName) : undefined;
  if (schemaDiscriminatorValue && mappingEntries.some(([value]) => value === schemaDiscriminatorValue)) {
    return schemaDiscriminatorValue;
  }
  for (const branch of [...(Array.isArray(schema?.oneOf) ? schema.oneOf : []), ...(Array.isArray(schema?.anyOf) ? schema.anyOf : [])]) {
    const branchRef = typeof branch?.$ref === 'string' ? branch.$ref : undefined;
    const mappedValue = mappingEntries.find(([, ref]) => ref === branchRef)?.[0];
    if (mappedValue) return mappedValue;
    const branchRefName = branchRef ? extractSchemaRef(branch) : undefined;
    if (branchRefName) return stripDtoSuffix(branchRefName);
  }
  if (mappingEntries.length) return mappingEntries[0][0];
  const propertySchema = findDiscriminatorPropertySchema(openApi, schema, propertyName);
  if (propertySchema?.const !== undefined) return String(propertySchema.const);
  if (Array.isArray(propertySchema?.enum) && propertySchema.enum.length) return String(propertySchema.enum[0]);
  return schemaDiscriminatorValue ?? '';
}

function normalizeSchemaForFields(openApi: any, schema: any, seen = new Set<string>()): any {
  if (!schema || typeof schema !== 'object') return {};
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return {};
    return normalizeSchemaForFields(openApi, resolveOpenApiRef(openApi, schema), new Set([...seen, schema.$ref]));
  }
  schema = mergeAllOfSchema(openApi, schema, seen);
  const choice = [...(Array.isArray(schema.oneOf) ? schema.oneOf : []), ...(Array.isArray(schema.anyOf) ? schema.anyOf : [])].find(
    (candidate: any) => schemaType(resolveOpenApiRef(openApi, candidate)) !== 'null',
  );
  if (choice) {
    const resolvedChoice = normalizeSchemaForFields(openApi, choice, seen);
    return {
      ...resolvedChoice,
      ...schema,
      oneOf: undefined,
      anyOf: undefined,
      discriminator: schema.discriminator ?? resolvedChoice.discriminator,
      properties: { ...(resolvedChoice.properties ?? {}), ...(schema.properties ?? {}) },
      required: [...new Set([...(resolvedChoice.required ?? []), ...(schema.required ?? [])])],
    };
  }
  return schema;
}

function schemaField(
  openApi: any,
  name: string,
  path: string[],
  schema: any,
  required = false,
  mode: 'request' | 'response' = 'request',
  seen = new Set<string>(),
  depth = 0,
): OpenApiSchemaField {
  const refName = extractSchemaRef(schema);
  if (typeof schema?.$ref === 'string') {
    if (seen.has(schema.$ref)) {
      const pointer = path.length ? `/${path.map(schemaPointerPart).join('/')}` : '';
      return {
        name,
        pointer,
        path,
        required,
        nullable: false,
        type: 'object',
        example: schemaReferenceExample(openApi, schema, refName),
      };
    }
  }
  const originalSchema = schema;
  schema = normalizeSchemaForFields(openApi, schema, seen);
  const type = schemaType(schema);
  const pointer = schemaPointer(path);
  const field: OpenApiSchemaField = {
    name,
    pointer,
    path,
    required,
    nullable: schemaNullable(schema),
    type,
    format: schema.format,
    enumValues: schemaEnumValues(schema),
    description: typeof schema.description === 'string' ? schema.description : undefined,
    defaultValue: schema.default,
    example: schemaExample(openApi, schema, seen),
    minLength: schemaNumber(schema.minLength),
    maxLength: schemaNumber(schema.maxLength),
    minimum: schemaNumber(schema.minimum),
    maximum: schemaNumber(schema.maximum),
    pattern: typeof schema.pattern === 'string' ? schema.pattern : undefined,
    minItems: schemaNumber(schema.minItems),
    maxItems: schemaNumber(schema.maxItems),
    readOnly: Boolean(schema.readOnly),
    writeOnly: Boolean(schema.writeOnly),
  };
  if (type === 'object') {
    const referenceExample = schemaReferenceExample(openApi, originalSchema, refName);
    if (referenceExample) {
      field.example =
        field.example && typeof field.example === 'object' && !Array.isArray(field.example)
          ? { ...(field.example as Record<string, unknown>), ...referenceExample }
          : referenceExample;
    }
  }

  if (depth >= MAX_OPERATION_FORM_SCHEMA_DEPTH) {
    return field;
  }

  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    const requiredProperties = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    field.fields = Object.entries(schema.properties)
      .filter(([, propertySchema]) => {
        const resolvedProperty = resolveOpenApiRef(openApi, propertySchema) as any;
        return mode === 'request' ? !resolvedProperty?.readOnly : !resolvedProperty?.writeOnly;
      })
      .map(([propertyName, propertySchema]) =>
        schemaField(
          openApi,
          propertyName,
          [...path, propertyName],
          propertySchema,
          requiredProperties.has(propertyName),
          mode,
          new Set(seen),
          depth + 1,
        ),
      );
    const discriminatorProperty = typeof schema.discriminator?.propertyName === 'string' ? schema.discriminator.propertyName : undefined;
    const discriminatorValues = discriminatorProperty ? discriminatorAllowedValues(openApi, schema, refName, discriminatorProperty) : [];
    const implicitTypeValues = !discriminatorProperty && refName ? [stripDtoSuffix(refName)] : [];
    const typeDiscriminatorValues = discriminatorProperty ? discriminatorValues : implicitTypeValues;
    if (typeDiscriminatorValues.length) {
      field.fields = field.fields.map(child =>
        (discriminatorProperty && child.name === discriminatorProperty) || (!discriminatorProperty && child.name === '@type')
          ? {
              ...child,
              discriminatorValues: typeDiscriminatorValues,
              enumValues: child.enumValues?.length ? child.enumValues : typeDiscriminatorValues,
              example: typeDiscriminatorValues.includes(String(child.example)) ? child.example : typeDiscriminatorValues[0],
            }
          : child,
      );
    }
  } else if (type === 'array') {
    field.items = schemaField(openApi, `${name} item`, [...path, '0'], schema.items ?? {}, false, mode, new Set(seen), depth + 1);
    const objectExample = firstObjectExample(field.example);
    if (objectExample && (field.items.type !== 'object' || !field.items.fields?.length)) {
      field.items = inferredSchemaFieldFromExample(`${name} item`, [...path, '0'], objectExample);
    }
  } else if (type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    field.additionalProperties = schemaField(
      openApi,
      `${name} value`,
      [...path, 'additionalProperty'],
      schema.additionalProperties,
      false,
      mode,
      new Set(seen),
      depth + 1,
    );
  }

  return field;
}

function discriminatorAllowedValues(openApi: any, schema: any, schemaName: string | undefined, propertyName: string): string[] {
  const values = new Set<string>();
  const mapping = schema?.discriminator?.mapping;
  const mappingValues = mapping && typeof mapping === 'object' ? Object.keys(mapping).filter(Boolean) : [];
  if (schemaName) {
    const schemaDiscriminatorValue = stripDtoSuffix(schemaName);
    if (mappingValues.length === 0 || mappingValues.includes(schemaDiscriminatorValue)) {
      values.add(schemaDiscriminatorValue);
    }
  }
  const propertySchema = findDiscriminatorPropertySchema(openApi, schema, propertyName);
  if (propertySchema?.const !== undefined) values.add(String(propertySchema.const));
  if (Array.isArray(propertySchema?.enum))
    propertySchema.enum
      .filter((value: unknown) => value !== undefined && value !== null)
      .forEach((value: unknown) => values.add(String(value)));
  mappingValues.forEach(value => values.add(value));
  return [...values].filter(Boolean);
}

function findDiscriminatorPropertySchema(openApi: any, schema: any, propertyName: string, seen = new Set<string>()): any {
  if (!schema || typeof schema !== 'object') return undefined;
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return undefined;
    return findDiscriminatorPropertySchema(openApi, resolveOpenApiRef(openApi, schema), propertyName, new Set([...seen, schema.$ref]));
  }
  if (schema.properties?.[propertyName]) return resolveOpenApiRef(openApi, schema.properties[propertyName]);
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    for (const fragment of schema[key] ?? []) {
      const found = findDiscriminatorPropertySchema(openApi, fragment, propertyName, new Set(seen));
      if (found) return found;
    }
  }
  return undefined;
}

function stripDtoSuffix(value: string): string {
  return value.replace(/_?(?:FVO|MVO|RES)$/u, '');
}

function schemaFields(openApi: any, schema: any, required: boolean, mode: 'request' | 'response'): OpenApiSchemaField[] {
  if (!schema) return [];
  const root = schemaField(openApi, 'body', [], schema, required, mode);
  if (root.type === 'object' && root.fields?.length) return [...root.fields];
  return [root];
}

function requestBodyFields(openApi: any, schema: any, required: boolean): OpenApiSchemaField[] {
  return schemaFields(openApi, schema, required, 'request');
}

function responseBodyFields(openApi: any, schema: any): OpenApiSchemaField[] {
  return schemaFields(openApi, schema, false, 'response');
}

function schemaExample(openApi: any, schema: any, seen = new Set<string>(), depth = 0): unknown {
  if (!schema || typeof schema !== 'object') return undefined;
  if (depth > MAX_OPERATION_FORM_EXAMPLE_DEPTH) return undefined;
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return undefined;
    return schemaExample(openApi, resolveOpenApiRef(openApi, schema), new Set([...seen, schema.$ref]), depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  const enumValues = schemaEnumValues(schema);
  if (enumValues?.length) return enumValues[0];
  schema = mergeAllOfSchema(openApi, schema, seen);
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const branch = schema.oneOf.find((candidate: any) => resolveOpenApiRef(openApi, candidate)?.type !== 'null') ?? schema.oneOf[0];
    const value = schemaExample(openApi, branch, seen, depth + 1);
    const discriminatorProperty = schema.discriminator?.propertyName;
    const mapping = schema.discriminator?.mapping;
    if (
      value &&
      typeof value === 'object' &&
      discriminatorProperty &&
      mapping &&
      typeof mapping === 'object' &&
      typeof branch?.$ref === 'string'
    ) {
      const discriminatorValue = Object.entries(mapping).find(([, ref]) => ref === branch.$ref)?.[0];
      if (discriminatorValue) {
        (value as Record<string, unknown>)[discriminatorProperty] = discriminatorValue;
      }
    }
    return value;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length && !schema.properties) {
    const branch = schema.anyOf.find((candidate: any) => resolveOpenApiRef(openApi, candidate)?.type !== 'null') ?? schema.anyOf[0];
    return schemaExample(openApi, branch, seen, depth + 1);
  }
  switch (schemaType(schema)) {
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return false;
    case 'array':
      if (schema.maxItems === 0) return [];
      return [schemaExample(openApi, schema.items, seen, depth + 1)].filter(value => value !== undefined);
    case 'object':
      if (schema.properties && typeof schema.properties === 'object') {
        const value: Record<string, unknown> = {};
        for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
          if ((propertySchema as any)?.readOnly) continue;
          const propertyExample = schemaExample(openApi, propertySchema, seen, depth + 1);
          if (propertyExample !== undefined) value[propertyName] = propertyExample;
        }
        return value;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const additionalValue = schemaExample(openApi, schema.additionalProperties, seen, depth + 1);
        return additionalValue === undefined ? {} : { additionalProperty: additionalValue };
      }
      return {};
    default:
      if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
      if (schema.format === 'date') return '2026-01-01';
      if (schema.format === 'date-time') return '2026-01-01T00:00:00Z';
      if (schema.format === 'email') return 'user@example.com';
      return schema.minLength && schema.minLength > 0 ? 'x'.repeat(schema.minLength) : 'string';
  }
}

function operationIdFor(method: string, path: string, operation: any): string {
  if (operation?.operationId) return String(operation.operationId);
  const suffix = path
    .split('/')
    .filter(Boolean)
    .map(segment => segment.replace(/[{}]/g, ''))
    .map(segment => segment.replace(/[^A-Za-z0-9]+(.)/g, (_, chr: string) => chr.toUpperCase()))
    .join('');
  return `${method}${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`;
}

function safeOperationId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function requestBodyDefinition(
  openApi: any,
  operation: any,
): Pick<OpenApiOperationDefinition, 'requestBodyRequired' | 'requestContentType' | 'requestBodyExample' | 'requestBodyFields'> {
  const requestBody = resolveOpenApiRef(openApi, operation?.requestBody);
  const content = requestBody?.content;
  if (!content || typeof content !== 'object') {
    return { requestBodyRequired: false };
  }
  const contentEntry =
    Object.entries(content).find(([mediaType]) => mediaType === 'application/json') ??
    Object.entries(content).find(([mediaType]) => mediaType.includes('json')) ??
    Object.entries(content)[0];
  if (!contentEntry) {
    return { requestBodyRequired: Boolean(requestBody?.required) };
  }
  const [requestContentType, mediaTypeSpec] = contentEntry as [string, any];
  const schema = mediaTypeSpec?.schema;
  const requestBodyRequired = Boolean(requestBody?.required);
  return {
    requestBodyRequired,
    requestContentType,
    requestBodyExample:
      mediaTypeSpec?.example ?? (Object.values(mediaTypeSpec?.examples ?? {})[0] as any)?.value ?? schemaExample(openApi, schema),
    requestBodyFields: requestBodyFields(openApi, schema, requestBodyRequired),
  };
}

function responseDefinition(openApi: any, operation: any): Pick<OpenApiOperationDefinition, 'responseContentType' | 'responseBodyFields'> {
  const responses = operation?.responses;
  if (!responses || typeof responses !== 'object') return {};
  const responseEntry =
    Object.entries(responses).find(([status]) => status.startsWith('2')) ??
    Object.entries(responses).find(([status]) => status === 'default') ??
    Object.entries(responses)[0];
  const response = resolveOpenApiRef(openApi, responseEntry?.[1]);
  const content = response?.content;
  if (!content || typeof content !== 'object') return {};
  const contentEntry =
    Object.entries(content).find(([mediaType]) => mediaType === 'application/json') ??
    Object.entries(content).find(([mediaType]) => mediaType.includes('json')) ??
    Object.entries(content)[0];
  if (!contentEntry) return {};
  const [responseContentType, mediaTypeSpec] = contentEntry as [string, any];
  const schema = mediaTypeSpec?.schema;
  return {
    responseContentType,
    responseBodyFields: responseBodyFields(openApi, schema),
  };
}

function collectOperationParameters(openApi: any, pathItem: any, operation: any): OpenApiOperationDefinition['parameters'] {
  const parameters = [
    ...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation?.parameters) ? operation.parameters : []),
  ];
  const byKey = new Map<string, OpenApiOperationDefinition['parameters'][number]>();
  for (const rawParameter of parameters) {
    const parameter = resolveOpenApiRef(openApi, rawParameter);
    const location = parameter?.in;
    if (!['path', 'query', 'header', 'cookie'].includes(location)) continue;
    const schema = resolveOpenApiRef(openApi, parameter.schema) ?? {};
    const name = String(parameter.name ?? '');
    byKey.set(`${location}:${name}`, {
      name,
      location,
      required: Boolean(parameter.required || location === 'path'),
      type: schemaType(schema),
      format: schema.format,
      enumValues: schemaEnumValues(schema),
      description:
        typeof parameter.description === 'string'
          ? parameter.description
          : typeof schema.description === 'string'
            ? schema.description
            : undefined,
      defaultValue: schema.default,
      example: parameter.example ?? (parameter.required || location === 'path' ? schemaExample(openApi, schema) : undefined),
      minLength: schemaNumber(schema.minLength),
      maxLength: schemaNumber(schema.maxLength),
      minimum: schemaNumber(schema.minimum),
      maximum: schemaNumber(schema.maximum),
      pattern: typeof schema.pattern === 'string' ? schema.pattern : undefined,
    });
  }
  return [...byKey.values()];
}

export function loadOpenApiOperations(generator: any, application: AngularApplication<AngularEntity>): OpenApiOperationDefinition[] {
  const swaggerPath = generator.destinationPath('src/main/resources/swagger/api.yml');
  const sourcePath = application.oas3Input ? generator.destinationPath(application.oas3Input) : undefined;
  const openApiPath = [swaggerPath, sourcePath].find(path => path && existsSync(path));
  if (!openApiPath) return [];
  const openApi = parseYaml(readFileSync(openApiPath, 'utf8'));
  const operations: OpenApiOperationDefinition[] = [];
  for (const [path, pathItem] of Object.entries(openApi?.paths ?? {}) as [string, any][]) {
    for (const [method, operation] of Object.entries(pathItem ?? {}) as [string, any][]) {
      if (!HTTP_METHODS.has(method)) continue;
      const operationId = operationIdFor(method, path, operation);
      const body = requestBodyDefinition(openApi, operation);
      const response = responseDefinition(openApi, operation);
      operations.push({
        id: `${method}-${safeOperationId(operationId || path)}`,
        operationId,
        method: method.toUpperCase(),
        path,
        tag: String(operation?.tags?.[0] ?? 'Operations'),
        summary: String(operation?.summary ?? operationId),
        parameters: collectOperationParameters(openApi, pathItem, operation),
        ...body,
        ...response,
      });
    }
  }
  //return operations.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  return compactOpenApiOperations(
    operations.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
  );
}

function compactOpenApiOperations(operations: OpenApiOperationDefinition[]): OpenApiOperationDefinition[] {
  return operations.map(operation => ({
    ...operation,
    parameters: compactOpenApiParameters(operation.parameters),
    requestBodyExample: compactOpenApiExample(operation.requestBodyExample),
    requestBodyFields: compactOpenApiSchemaFields(operation.requestBodyFields),
    responseBodyFields: compactOpenApiSchemaFields(operation.responseBodyFields),
  }));
}

function compactOpenApiExample(value: unknown, depth = 0, budget = { remaining: MAX_COMPACT_OPERATION_FORM_EXAMPLE_NODES }): unknown {
  if (value === undefined || budget.remaining <= 0 || depth > MAX_COMPACT_OPERATION_FORM_EXAMPLE_DEPTH) return undefined;
  budget.remaining -= 1;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 1)
      .map(item => compactOpenApiExample(item, depth + 1, budget))
      .filter(item => item !== undefined);
    return items.length ? items : [];
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const compacted = compactOpenApiExample(child, depth + 1, budget);
      if (compacted !== undefined) output[key] = compacted;
      if (budget.remaining <= 0) break;
    }
    return output;
  }
  return value;
}

function compactOpenApiParameters(parameters: OpenApiOperationDefinition['parameters']): OpenApiOperationDefinition['parameters'] {
  return parameters.map(parameter => ({
    name: parameter.name,
    location: parameter.location,
    required: parameter.required,
    type: parameter.type,
    format: parameter.format,
    enumValues: parameter.enumValues,
    discriminatorValues: parameter.discriminatorValues,
    description: parameter.description,
    defaultValue: compactOpenApiExample(parameter.defaultValue, 0, { remaining: 64 }),
    example: compactOpenApiExample(parameter.example, 0, { remaining: 64 }),
    minLength: parameter.minLength,
    maxLength: parameter.maxLength,
    minimum: parameter.minimum,
    maximum: parameter.maximum,
    pattern: parameter.pattern,
  }));
}

function compactOpenApiSchemaFields(
  fields: OpenApiOperationDefinition['requestBodyFields'],
): OpenApiOperationDefinition['requestBodyFields'] {
  const budget = { remaining: MAX_COMPACT_OPERATION_FORM_SCHEMA_NODES };
  return fields?.map(field => compactOpenApiSchemaField(field, 0, budget));
}

function compactOpenApiSchemaField(
  field: NonNullable<OpenApiOperationDefinition['requestBodyFields']>[number],
  depth = 0,
  budget = { remaining: MAX_COMPACT_OPERATION_FORM_SCHEMA_NODES },
): NonNullable<OpenApiOperationDefinition['requestBodyFields']>[number] {
  budget.remaining -= 1;
  const compacted: NonNullable<OpenApiOperationDefinition['requestBodyFields']>[number] = {
    name: field.name,
    pointer: field.pointer,
    path: field.path,
    required: field.required,
    nullable: field.nullable,
    type: field.type,
    format: field.format,
    enumValues: field.enumValues,
    discriminatorValues: field.discriminatorValues,
    minLength: field.minLength,
    maxLength: field.maxLength,
    minimum: field.minimum,
    maximum: field.maximum,
    pattern: field.pattern,
    minItems: field.minItems,
    maxItems: field.maxItems,
    readOnly: field.readOnly,
    writeOnly: field.writeOnly,
  };
  if (field.type !== 'object' && field.type !== 'array') {
    compacted.defaultValue = field.defaultValue;
    compacted.example = field.example;
  } else if (!field.fields?.length && !field.items && !field.additionalProperties) {
    compacted.defaultValue = compactOpenApiExample(field.defaultValue, 0, { remaining: 64 });
    compacted.example = compactOpenApiExample(field.example, 0, { remaining: 64 });
  }
  if (depth >= MAX_COMPACT_OPERATION_FORM_SCHEMA_DEPTH || budget.remaining <= 0) {
    if (field.type === 'object' || field.type === 'array') {
      compacted.defaultValue = compactOpenApiExample(field.defaultValue, 0, { remaining: 64 });
      compacted.example = compactOpenApiExample(field.example, 0, { remaining: 64 });
    }
    return compacted;
  }
  if (field.fields?.length) {
    compacted.fields = field.fields.map(child => compactOpenApiSchemaField(child, depth + 1, budget));
  }
  if (field.items) {
    compacted.items = compactOpenApiSchemaField(field.items, depth + 1, budget);
  }
  if (field.additionalProperties) {
    compacted.additionalProperties = compactOpenApiSchemaField(field.additionalProperties, depth + 1, budget);
  }
  return compacted;
}

export const writeFiles = asWritingTask<AngularEntity, AngularApplication<AngularEntity>>(async function writeFiles({ application }) {
  if (!application.clientFrameworkAngular) return;
  if (application.enableSwaggerCodegen) {
    application.openApiOperations = loadOpenApiOperations(this, application);
  }

  await this.writeFiles({
    sections: files,
    context: application,
  });
});
