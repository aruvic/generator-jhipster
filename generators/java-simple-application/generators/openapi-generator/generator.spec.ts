/**
 * Copyright 2013-2026 the original author or authors from the JHipster project.
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
import { before, describe, expect, it } from 'esmocha';
import { basename, resolve } from 'node:path';

import { shouldSupportFeatures, testBlueprintSupport } from '../../../../test/support/tests.ts';

import { normalizeOpenApiSpecForGenerator } from './generator.ts';
import Generator from './index.ts';

import { defaultHelpers as helpers, fromMatrix, result } from '#testing';

const generator = `${basename(resolve(import.meta.dirname, '../../'))}:${basename(import.meta.dirname)}`;

describe(`generator - ${generator}`, () => {
  shouldSupportFeatures(Generator);
  describe('blueprint support', () => testBlueprintSupport(generator));

  it('normalizes conditional anyOf requirements without changing the source contract', () => {
    const source = {
      components: {
        schemas: {
          Contact: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
            anyOf: [
              { required: ['phone'], properties: { phone: { type: 'string' } } },
              { required: ['email'], properties: { email: { type: 'string' } } },
            ],
          },
          Union: {
            anyOf: [{ required: ['left'] }, { required: ['right'] }],
          },
        },
      },
    };

    expect(normalizeOpenApiSpecForGenerator(source)).toEqual({
      components: {
        schemas: {
          Contact: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
            anyOf: [{ properties: { phone: { type: 'string' } } }, { properties: { email: { type: 'string' } } }],
          },
          Union: {
            anyOf: [{ required: ['left'] }, { required: ['right'] }],
          },
        },
      },
    });
    expect(source.components.schemas.Contact.anyOf[0].required).toEqual(['phone']);
  });

  describe('Gradle API-first conventions', () => {
    const conventionsFile = 'buildSrc/src/main/groovy/jhipster.openapi-generator-conventions.gradle';

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({
          addOpenapiGeneratorPlugin: true,
          openApiGeneratorInputFile: 'api-codegen.yml',
          openApiModelNameMappings: [{ sourceName: 'legacy_name', targetName: 'LegacyName' }],
        })
        .withJHipsterConfig({ buildTool: 'gradle' });
    });

    it('uses Gradle 9 APIs while preserving API-first options', () => {
      result.assertFileContent(conventionsFile, 'inputSpec = "$rootDir/src/main/resources/swagger/api-codegen.yml".toString()');
      result.assertFileContent(conventionsFile, 'templateDir = "$rootDir/src/main/openapi-templates".toString()');
      result.assertFileContent(conventionsFile, 'outputDir = layout.buildDirectory.dir("openapi").get().asFile.toString()');
      result.assertFileContent(conventionsFile, 'configOptions = [delegatePattern: "true"');
      result.assertFileContent(conventionsFile, 'generateJsonIncludeAnnotations: "true"');
      result.assertFileContent(conventionsFile, 'validateSpec = false');
      result.assertFileContent(conventionsFile, 'modelNameMappings = [legacy_name: "LegacyName"]');
      result.assertFileContent(conventionsFile, 'srcDir(layout.buildDirectory.dir("openapi/src/main/java"))');
      result.assertFileContent(conventionsFile, `tasks.named('compileJava').configure { dependsOn("openApiGenerate") }`);
      result.assertNoFileContent(conventionsFile, /\$buildDir|project\.buildDir|compileJava\.dependsOn/);
    });
  });

  for (const [name, config] of Object.entries(
    fromMatrix({ buildTool: ['maven' as const, 'gradle' as const], addOpenapiGeneratorPlugin: [true, false] }),
  )) {
    describe(name, () => {
      before(async () => {
        await helpers
          .runJHipster(generator)
          .withMockedJHipsterGenerators()
          .withMockedSource()
          .withSharedApplication({})
          .withJHipsterConfig(config);
      });

      it('should match files snapshot', () => {
        expect(result.getStateSnapshot()).toMatchSnapshot();
      });

      it('should call source snapshot', () => {
        expect(result.sourceCallsArg).toMatchSnapshot();
      });

      it('should configure spec-honest JSON serialization', () => {
        expect(JSON.stringify(result.sourceCallsArg)).toContain('<generateJsonIncludeAnnotations>true</generateJsonIncludeAnnotations>');
      });

      it('should compose with generators', () => {
        expect(result.getComposedGenerators()).toMatchSnapshot();
      });
    });
  }
});
