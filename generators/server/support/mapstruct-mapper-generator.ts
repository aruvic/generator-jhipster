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

import { collectImports, generateMapperContexts } from './mapper-context-builder.ts';
import { generateUnifiedMappers } from './unified-mapper-generator.ts';
import { generateHybridMappers } from './hybrid-mapper-generator.ts';
import { OpenApiEntityMatcher } from './openapi-entity-matcher.ts';
import { normalizeTypeName, parseOpenAPISpec } from './openapi-mapper-generator.ts';

/**
 * Generate MapStruct mappers from OpenAPI spec
 */
export async function generateMapStructMappers(generator: any, application: SpringBootApplication): Promise<void> {
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

  try {
    generator.log.info('MapStruct: starting mapper generation from OpenAPI spec');

    const swaggerContent = generator.readDestination(swaggerRelativePath)?.toString();
    if (!swaggerContent) {
      generator.log.debug('Swagger API spec is not yet available for reading at:', swaggerPath);
      return;
    }

    // Parse OpenAPI spec
    const spec = parseOpenAPISpec(swaggerContent, { isFilePath: false });

    const entityMatcher = new OpenApiEntityMatcher(generator, application.packageName);
    const operationDescriptors = entityMatcher.describeOperations(spec);

    if (!spec.operations || spec.operations.length === 0) {
      generator.log.info('MapStruct: no operations found in OpenAPI spec');
      return;
    }

    generator.log.info(`MapStruct: found ${spec.operations.length} operations in OpenAPI spec`);

    const javaPackageDir =
      application.javaPackageSrcDir ??
      (application.srcMainJava && application.packageNameWithSlashes
        ? join(application.srcMainJava, application.packageNameWithSlashes)
        : undefined);

    const domainInspector = javaPackageDir ? (entityName: string) => inspectDomainClass(generator, javaPackageDir, entityName) : undefined;

    // Determine which mapper generation strategy to use
    // Hybrid: polymorphic helper mappers + per-entity mappers (RECOMMENDED for complex APIs)
    // Unified: 2 large Request/Response mappers (good for simple APIs)
    // Legacy: Per-operation mappers (original approach, not recommended)
    const strategy = 'hybrid'; // Options: 'hybrid', 'unified', 'legacy'

    let mapperContexts: any[];
    let templateFiles: Map<string, string> = new Map();

    if (strategy === 'hybrid') {
      generator.log.info('MapStruct: using hybrid mapper strategy (polymorphic helpers + per-entity)');
      const { helperMappers, entityMappers } = generateHybridMappers(spec, application.packageName!, operationDescriptors, domainInspector);

      mapperContexts = [];

      mapperContexts.push({
        mapperName: 'OpenApiPrimitiveMapper',
        packageName: `${application.packageName}.web.api.mapper`,
      });
      templateFiles.set('OpenApiPrimitiveMapper', 'openapi-primitive-mapper.java.ejs');

      for (const helperMapper of helperMappers) {
        mapperContexts.push(helperMapper);
        templateFiles.set(helperMapper.mapperName, 'polymorphic-helper-mapper.java.ejs');
      }

      for (const entityMapper of entityMappers) {
        mapperContexts.push(entityMapper);
        templateFiles.set(entityMapper.mapperName, 'entity-mapper.java.ejs');
      }
    } else if (strategy === 'unified') {
      // Generate unified Request/Response mappers with @SubclassMapping support
      generator.log.info('MapStruct: using unified mapper strategy with @SubclassMapping');
      mapperContexts = generateUnifiedMappers(spec, application.packageName!);
      for (const context of mapperContexts) {
        templateFiles.set(context.mapperName, 'unified-mapper.java.ejs');
      }
    } else {
      // Generate per-operation mappers (legacy approach)
      generator.log.info('MapStruct: using per-operation mapper strategy');
      mapperContexts = generateMapperContexts(spec, application.packageName!);
      for (const context of mapperContexts) {
        templateFiles.set(context.mapperName, 'mapper.java.ejs');
      }
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
      const templateFileName = templateFiles.get(context.mapperName) || 'mapper.java.ejs';
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

    generator.log.ok(`MapStruct: successfully generated ${mapperContexts.length} MapStruct mappers`);
  } catch (error: any) {
    generator.log.warn('Failed to generate MapStruct mappers from OpenAPI spec:');
    generator.log.warn(error.message || error);
    generator.log.debug(error.stack);
    // Continue with normal generation - don't fail the entire process
  }
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
