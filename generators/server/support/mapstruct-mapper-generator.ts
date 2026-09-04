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

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import ejs from 'ejs';

import type { Application as SpringBootApplication } from '../types.ts';

import { generateHybridMappers } from './hybrid-mapper-generator.ts';
import { collectImports, generateMapperContexts } from './mapper-context-builder.ts';
import { OpenApiEntityMatcher } from './openapi-entity-matcher.ts';
import {
  clearDomainNameOverrides,
  clearDtoNameOverrides,
  getOpenApiModelNameMappings,
  normalizeTypeName,
  parseOpenAPISpec,
  registerDomainNameOverride,
  registerDtoNameOverride,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';
import { generateUnifiedMappers } from './unified-mapper-generator.ts';

/**
 * Generate MapStruct mappers from OpenAPI spec
 */
export async function generateMapStructMappers(generator: any, application: SpringBootApplication): Promise<void> {
  clearDtoNameOverrides();
  clearDomainNameOverrides();
  // Only generate if enableSwaggerCodegen is true
  if (!application.enableSwaggerCodegen) {
    generator.log.debug('enableSwaggerCodegen is false, skipping mapper generation');
    return;
  }

  // Check if swagger/api.yml exists
  const swaggerRelativePath = 'src/main/resources/swagger/api.yml';
  const swaggerPath = generator.destinationPath(swaggerRelativePath);
  if (!generator.fs.exists(swaggerPath)) {
    generator.log.debug('Swagger API spec not found at:', swaggerPath);
    return;
  }

  generator.log.info('MapStruct: starting mapper generation from OpenAPI spec');

  const swaggerContent = generator.readDestination(swaggerRelativePath)?.toString();
  if (!swaggerContent) {
    generator.log.debug('Swagger API spec is not yet available for reading at:', swaggerPath);
    return;
  }

  // Parse OpenAPI spec
  const spec = parseOpenAPISpec(swaggerContent, { isFilePath: false });
  for (const mapping of getOpenApiModelNameMappings(Object.keys(spec.schemas ?? {}))) {
    registerDtoNameOverride(mapping.sourceName, mapping.targetName);
  }

  const entityMatcher = new OpenApiEntityMatcher(generator, application.packageName);
  const operationDescriptors = entityMatcher.describeOperations(spec);

  if (!spec.operations || spec.operations.length === 0) {
    generator.log.info('MapStruct: no operations found in OpenAPI spec');
    return;
  }

  generator.log.info(`MapStruct: found ${spec.operations.length} operations in OpenAPI spec`);

  const javaPackageDir =
    application.javaPackageSrcDir ??
    (application.srcMainJava && application.packageNameWithSlashes ?
      join(application.srcMainJava, application.packageNameWithSlashes)
    : undefined);

  const domainInspector = javaPackageDir ? (entityName: string) => inspectDomainClass(generator, javaPackageDir, entityName) : undefined;

  const existingEntities: { name?: string; definition?: any }[] = generator.getExistingEntities?.() ?? [];
  const existingEntityNames = new Set<string>();
  const entityDefinitionsByName = new Map<string, any>();
  for (const entry of existingEntities) {
    const entityDef = entry?.definition ?? entry;
    const candidates = [entry?.name, entityDef?.entityClass, entityDef?.name, entityDef?.entityNameCapitalized];
    for (const candidate of candidates) {
      const normalized = candidate ? normalizeTypeName(candidate) : undefined;
      if (normalized) {
        existingEntityNames.add(normalized);
        if (!entityDefinitionsByName.has(normalized)) {
          entityDefinitionsByName.set(normalized, entityDef);
        }
      }
    }
  }

  const schemaDomainOverrides = new Map<string, string>();
  for (const schemaName of Object.keys(spec.schemas ?? {})) {
    const baseName = stripDtoSuffix(schemaName);
    if (!baseName || schemaDomainOverrides.has(baseName)) {
      continue;
    }
    const match = entityMatcher.matchSchemaName(schemaName);
    const mappedName = match?.name ? normalizeTypeName(match.name) : undefined;
    if (mappedName && mappedName !== baseName) {
      schemaDomainOverrides.set(baseName, mappedName);
    }
  }

  const hasExistingEntities = existingEntityNames.size > 0;
  for (const [schemaBase, domainName] of schemaDomainOverrides) {
    if (!hasExistingEntities || existingEntityNames.has(domainName) || domainName === schemaBase) {
      registerDomainNameOverride(schemaBase, domainName);
    }
  }

  const abstractSchemas = new Set<string>();
  if (hasExistingEntities) {
    const schemaBaseNames = new Set<string>(Object.keys(spec.schemas ?? {}).map(name => stripDtoSuffix(name)));
    for (const baseName of schemaBaseNames) {
      const targetDomain = schemaDomainOverrides.get(baseName) ?? baseName;
      if (!existingEntityNames.has(targetDomain)) {
        abstractSchemas.add(baseName);
      }
    }
  }

  // Determine which mapper generation strategy to use
  // Hybrid: polymorphic helper mappers + per-entity mappers (RECOMMENDED for complex APIs)
  // Unified: 2 large Request/Response mappers (good for simple APIs)
  // Legacy: Per-operation mappers (original approach, not recommended)
  const strategy = 'hybrid'; // Options: 'hybrid', 'unified', 'legacy'

  let mapperContexts: any[];

  if (strategy === 'hybrid') {
    generator.log.info('MapStruct: using hybrid mapper strategy (polymorphic helpers + per-entity)');
    const { helperMappers, entityMappers } = generateHybridMappers(
      spec,
      application.packageName!,
      operationDescriptors,
      domainInspector,
      abstractSchemas,
      entityDefinitionsByName,
    );

    mapperContexts = [];

    mapperContexts.push({
      mapperName: 'OpenApiPrimitiveMapper',
      packageName: `${application.packageName}.web.api.mapper`,
      templateFileName: 'openapi-primitive-mapper.java.ejs',
    });

    for (const helperMapper of helperMappers) {
      mapperContexts.push({ ...helperMapper, templateFileName: 'polymorphic-helper-mapper.java.ejs' });
    }

    for (const entityMapper of entityMappers) {
      mapperContexts.push({ ...entityMapper, templateFileName: 'entity-mapper.java.ejs' });
    }
  } else if (strategy === 'unified') {
    // Generate unified Request/Response mappers with @SubclassMapping support
    generator.log.info('MapStruct: using unified mapper strategy with @SubclassMapping');
    mapperContexts = generateUnifiedMappers(spec, application.packageName!).map(context => ({
      ...context,
      templateFileName: 'unified-mapper.java.ejs',
    }));
  } else {
    // Generate per-operation mappers (legacy approach)
    generator.log.info('MapStruct: using per-operation mapper strategy');
    mapperContexts = generateMapperContexts(spec, application.packageName!).map(context => ({
      ...context,
      templateFileName: 'mapper.java.ejs',
    }));
  }

  if (mapperContexts.length === 0) {
    generator.log.info('MapStruct: no mappers generated from OpenAPI spec');
    return;
  }

  generator.log.info(`MapStruct: generated ${mapperContexts.length} mapper contexts`);

  // Determine the Java package source directory
  if (!javaPackageDir) {
    generator.log.warn('MapStruct: unable to resolve Java package directory, skipping mapper generation');
    return;
  }

  // Create mapper directory inside the Java package source tree
  const mapperDir = join(javaPackageDir, 'web', 'api', 'mapper');
  const mapperDirFull = generator.destinationPath(mapperDir);
  mkdirSync(mapperDirFull, { recursive: true });

  // Remove existing mapper files to avoid stale classes lingering between generations
  try {
    const existingEntries = readdirSync(mapperDirFull, { withFileTypes: true });
    for (const entry of existingEntries) {
      if (entry.isFile() && entry.name.endsWith('Mapper.java')) {
        unlinkSync(join(mapperDirFull, entry.name));
      }
    }
  } catch (cleanupError) {
    generator.log.warn(`MapStruct: unable to clean mapper directory ${mapperDirFull}: ${cleanupError}`);
  }

  // Write mapper files
  for (const context of mapperContexts) {
    // Get the appropriate template for this mapper
    const templateFileName = context.templateFileName || 'mapper.java.ejs';
    const relativeTemplatePath = join('server', 'templates', templateFileName);

    // Try to load template (blueprint first, then bundled)
    let templatePath: string | undefined;

    // Try blueprint generators
    if (generator.blueprintGenerators) {
      for (const bp of generator.blueprintGenerators) {
        if (bp.generatorPath) {
          const bpPath = join(bp.generatorPath, relativeTemplatePath);
          if (existsSync(bpPath)) {
            templatePath = bpPath;
            break;
          }
        }
      }
    }

    // If not found in blueprint, use bundled template
    if (!templatePath) {
      const bundledPath = generator.fetchFromInstalledJHipster(relativeTemplatePath);
      if (bundledPath && existsSync(bundledPath)) {
        templatePath = bundledPath;
      }
    }

    if (!templatePath) {
      generator.log.warn(`MapStruct: could not resolve template at ${relativeTemplatePath}, skipping ${context.mapperName}`);
      continue;
    }

    const templateContent = readFileSync(templatePath, 'utf-8');
    let mapperContent: string;

    if (strategy !== 'hybrid' && strategy !== 'unified') {
      // Legacy per-operation mapper: collect imports and handle collisions
      const collectedImports = collectImports(context);

      const simpleNameCount: Record<string, number> = {};
      for (const imp of collectedImports) {
        const simple = imp.split('.').pop() || imp;
        simpleNameCount[simple] = (simpleNameCount[simple] || 0) + 1;
      }

      const collidingNames = new Set<string>(
        Object.entries(simpleNameCount)
          .filter(([, c]) => c > 1)
          .map(([n]) => n),
      );

      const importsForTemplate = collectedImports.filter(imp => !collidingNames.has(imp.split('.').pop() || ''));

      const methodsForTemplate = (context.methods || []).map((m: any) => {
        const srcSimple = m.sourceType.split('.').pop() || m.sourceName;
        const tgtSimple = m.targetType.split('.').pop() || m.targetName;

        return {
          ...m,
          sourceName: collidingNames.has(srcSimple) ? m.sourceType : srcSimple,
          targetName: collidingNames.has(tgtSimple) ? m.targetType : tgtSimple,
        };
      });

      mapperContent = ejs.render(templateContent, {
        ...context,
        importsSet: importsForTemplate,
        methods: methodsForTemplate,
      });
    } else {
      // Hybrid or unified mapper: render directly
      mapperContent = ejs.render(templateContent, context);
    }

    const filePath = join(mapperDirFull, `${context.mapperName}.java`);
    generator.fs.write(filePath, mapperContent);

    generator.log.ok(`MapStruct: generated mapper: ${context.mapperName}`);
  }

  writeOpenApiOneOfDeserializerConfiguration(generator, javaPackageDir, application.packageName!);

  generator.log.ok(`MapStruct: successfully generated ${mapperContexts.length} MapStruct mappers`);
}

function writeOpenApiOneOfDeserializerConfiguration(generator: any, javaPackageDir: string, packageName: string): void {
  const relativeTemplatePath = join('server', 'templates', 'openapi-oneof-deserializer-configuration.java.ejs');
  let templatePath: string | undefined;

  if (generator.blueprintGenerators) {
    for (const bp of generator.blueprintGenerators) {
      if (bp.generatorPath) {
        const bpPath = join(bp.generatorPath, relativeTemplatePath);
        if (existsSync(bpPath)) {
          templatePath = bpPath;
          break;
        }
      }
    }
  }

  if (!templatePath) {
    const bundledPath = generator.fetchFromInstalledJHipster(relativeTemplatePath);
    if (bundledPath && existsSync(bundledPath)) {
      templatePath = bundledPath;
    }
  }

  if (!templatePath) {
    generator.log.warn(
      `MapStruct: could not resolve template at ${relativeTemplatePath}, skipping OpenAPI oneOf deserializer configuration`,
    );
    return;
  }

  const configDirFull = generator.destinationPath(join(javaPackageDir, 'config'));
  mkdirSync(configDirFull, { recursive: true });
  const templateContent = readFileSync(templatePath, 'utf-8');
  const rendered = ejs.render(templateContent, { packageName });
  generator.fs.write(join(configDirFull, 'OpenApiOneOfDeserializerConfiguration.java'), rendered);
  generator.log.ok('MapStruct: generated OpenAPI oneOf deserializer configuration');
}

function inspectDomainClass(generator: any, javaPackageDir: string, entityName: string): { isAbstract?: boolean } | undefined {
  const normalized = normalizeTypeName(entityName);
  const domainPath = generator.destinationPath(join(javaPackageDir, 'domain', `${normalized}.java`));
  if (!existsSync(domainPath)) {
    return undefined;
  }
  try {
    const contents = readFileSync(domainPath, 'utf-8');
    const abstractRegex = new RegExp(`\\babstract\\s+class\\s+${normalized}\\b`);
    if (abstractRegex.test(contents)) {
      return { isAbstract: true };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
