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

import { collectImports, generateMapperContexts } from './mapper-context-builder.ts';
import { parseOpenAPISpec } from './openapi-mapper-generator.ts';

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
  const swaggerPath = generator.destinationPath('src/main/resources/swagger/api.yml');
  if (!existsSync(swaggerPath)) {
    generator.log.debug('Swagger API spec not found at:', swaggerPath);
    return;
  }

  try {
    generator.log.info('MapStruct: starting mapper generation from OpenAPI spec');

    // Parse OpenAPI spec
    const spec = parseOpenAPISpec(swaggerPath);

    if (!spec.operations || spec.operations.length === 0) {
      generator.log.info('MapStruct: no operations found in OpenAPI spec');
      return;
    }

    generator.log.info(`MapStruct: found ${spec.operations.length} operations in OpenAPI spec`);

    // Generate mapper contexts
    const mapperContexts = generateMapperContexts(spec, application.packageName!);

    if (mapperContexts.length === 0) {
      generator.log.info('MapStruct: no mappers generated from OpenAPI spec');
      return;
    }

    generator.log.info(`MapStruct: generated ${mapperContexts.length} mapper contexts`);

    // The template is located in the generators/server/templates directory
    // We read it from the source directory since this is during generation
    const templateFile = 'generators/server/templates/mapper.java.ejs';
    const templatePath = generator.destinationPath(templateFile).replace(/\.yo-rc\.json.*$/, '') + templateFile;
    const sourcePath = join(process.cwd(), templateFile);

    let actualTemplatePath = sourcePath;
    if (!existsSync(sourcePath) && existsSync(templatePath)) {
      actualTemplatePath = templatePath;
    }

    if (!existsSync(actualTemplatePath)) {
      generator.log.warn(`MapStruct: mapper template not found at ${actualTemplatePath} or ${sourcePath}`);
      return;
    }

    const templateContent = readFileSync(actualTemplatePath, 'utf-8');

    // Create mapper directory
    const mapperDir = join(application.srcMainJava, application.packageNameWithSlashes, 'web', 'mapper');

    const mapperDirFull = generator.destinationPath(mapperDir);
    mkdirSync(mapperDirFull, { recursive: true });

    // Write mapper files
    for (const context of mapperContexts) {
      const imports = collectImports(context);

      const mapperContent = ejs.render(templateContent, {
        ...context,
        importsSet: imports,
      });

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
