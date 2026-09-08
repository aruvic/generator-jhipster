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
import { readFile } from 'node:fs/promises';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { GRADLE_BUILD_SRC_MAIN_DIR } from '../../../generator-constants.ts';
import { JavaApplicationGenerator } from '../../../java/generator.ts';
import { javaMainResourceTemplatesBlock } from '../../../java/support/files.ts';
import { getOpenApiModelNameMappings } from '../../../server/support/openapi-mapper-generator.ts';

type PreparedOpenApiSpec = {
  specContents: string;
  generatorSpecContents?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeOpenApiSpecForGenerator<T>(document: T): T {
  const normalized = structuredClone(document);

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) return;

    const anyOf = node.anyOf;
    const hasBaseObjectShape = isRecord(node.properties) || (Array.isArray(node.required) && node.required.length > 0);
    if (hasBaseObjectShape && Array.isArray(anyOf)) {
      for (const variant of anyOf) {
        if (isRecord(variant) && Array.isArray(variant.required)) {
          delete variant.required;
        }
      }
    }

    Object.values(node).forEach(visit);
  };

  visit(normalized);
  return normalized;
}

export default class OpenapiGeneratorGenerator extends JavaApplicationGenerator {
  async beforeQueue() {
    if (!this.fromBlueprint) {
      await this.composeWithBlueprints();
    }

    if (!this.delegateToBlueprint) {
      await this.dependsOnBootstrap('java');
      await this.dependsOnJHipster('jhipster:java-simple-application:build-tool');
    }
  }

  get writing() {
    return this.asWritingTaskGroup({
      async cleanup({ application, control }) {
        await control.cleanupFiles({
          '8.6.1': [[application.buildToolGradle, 'gradle/swagger.gradle']],
        });
      },
      async writing({ application }) {
        if (application.oas3Input) {
          await this.prepareProvidedOpenApiSpec(application);
        }

        await this.writeFiles({
          blocks: [
            { templates: ['README.md.jhi.openapi-generator'] },
            javaMainResourceTemplatesBlock({ templates: ['swagger/api.yml'] }),
            {
              condition: ctx => ctx.buildToolGradle && ctx.addOpenapiGeneratorPlugin,
              templates: [`${GRADLE_BUILD_SRC_MAIN_DIR}/jhipster.openapi-generator-conventions.gradle`],
            },
          ],
          context: application,
        });

        if (application.oas3Input) {
          await this.copyProvidedOpenApiSpec(application);
        }
      },
    });
  }

  get [JavaApplicationGenerator.WRITING]() {
    return this.delegateTasksToBlueprint(() => this.writing);
  }

  get postWriting() {
    return this.asPostWritingTaskGroup({
      addDependencies({ source, application }) {
        const { addOpenapiGeneratorPlugin, buildToolGradle, javaDependencies } = application;
        const modelNameMappings = application.openApiModelNameMappings
          ?.map(
            mapping => `                                <modelNameMapping>${mapping.sourceName}=${mapping.targetName}</modelNameMapping>`,
          )
          .join('\n');
        source.addJavaDefinitions!({
          condition: addOpenapiGeneratorPlugin,
          mavenDefinition: {
            properties: [{ property: 'openapi-generator-maven-plugin.version', value: javaDependencies['openapi-generator-maven-plugin'] }],
            plugins: [{ groupId: 'org.openapitools', artifactId: 'openapi-generator-maven-plugin' }],
            pluginManagement: [
              {
                groupId: 'org.openapitools',
                artifactId: 'openapi-generator-maven-plugin',
                // eslint-disable-next-line no-template-curly-in-string
                version: '${openapi-generator-maven-plugin.version}',
                additionalContent: `                <executions>
                    <execution>
                        <goals>
                            <goal>generate</goal>
                        </goals>
                        <configuration>
                            <inputSpec>\${project.basedir}/${application.srcMainResources}swagger/${application.openApiGeneratorInputFile ?? 'api.yml'}</inputSpec>
                            <templateDirectory>\${project.basedir}/src/main/openapi-templates</templateDirectory>
                            <generatorName>spring</generatorName>
                            <apiPackage>${application.packageName}.web.api</apiPackage>
                            <modelPackage>${application.packageName}.service.api.dto</modelPackage>
                            <supportingFilesToGenerate>ApiUtil.java</supportingFilesToGenerate>
                            <!-- The source OpenAPI document is copied verbatim. OpenAPI Generator's
                                 component-name convention is stricter than OAS and must not cause the
                                 generator to rewrite or reject an otherwise usable contract. -->
                            <skipValidateSpec>true</skipValidateSpec>
                            <generateAliasAsModel>true</generateAliasAsModel>
${
  modelNameMappings ?
    `                            <modelNameMappings>
${modelNameMappings}
                            </modelNameMappings>
`
  : ''
}                            <configOptions>${
                  application.reactive ?
                    `
                                <reactive>true</reactive>
`
                  : ''
                }
                                <delegatePattern>true</delegatePattern>
                                <documentationProvider>none</documentationProvider>
                                <title>${application.dasherizedBaseName}</title>
                                <useSpringBoot4>true</useSpringBoot4>
                                <useJackson3>true</useJackson3>
                                <openApiNullable>false</openApiNullable>
                                <useBeanValidation>true</useBeanValidation>
                                <performBeanValidation>true</performBeanValidation>
                                <containerDefaultToNull>true</containerDefaultToNull>
                            </configOptions>
                            <typeMappings>
                                <typeMapping>date=LocalDate</typeMapping>
                                <typeMapping>DateTime=Instant</typeMapping>
                                <typeMapping>Time=LocalTime</typeMapping>
                            </typeMappings>
                            <importMappings>
                                <importMapping>Instant=java.time.Instant</importMapping>
                                <importMapping>ZonedDateTime=java.time.ZonedDateTime</importMapping>
                                <importMapping>LocalDate=java.time.LocalDate</importMapping>
                                <importMapping>LocalTime=java.time.LocalTime</importMapping>
                            </importMappings>
                        </configuration>
                    </execution>
                </executions>
`,
              },
            ],
          },
        });

        if (addOpenapiGeneratorPlugin && buildToolGradle) {
          source.addGradleBuildSrcDependencyCatalogLibraries?.([
            {
              libraryName: 'openapi-generator',
              module: 'org.openapitools:openapi-generator-gradle-plugin',
              version: javaDependencies['gradle-openapi-generator'],
              scope: 'implementation',
            },
          ]);
          source.addGradlePlugin?.({ id: 'jhipster.openapi-generator-conventions' });
        }
      },
    });
  }

  get [JavaApplicationGenerator.POST_WRITING]() {
    return this.delegateTasksToBlueprint(() => this.postWriting);
  }

  async copyProvidedOpenApiSpec(application: { oas3Input?: string; srcMainResources: string; preparedOpenApiSpec?: PreparedOpenApiSpec }) {
    const preparedSpec = await this.prepareProvidedOpenApiSpec(application);
    if (!preparedSpec) return;
    this.writeDestination(
      `${application.srcMainResources}swagger/api.yml`,
      preparedSpec.specContents.endsWith('\n') ? preparedSpec.specContents : `${preparedSpec.specContents}\n`,
    );
    if (preparedSpec.generatorSpecContents) {
      this.writeDestination(
        `${application.srcMainResources}swagger/api-codegen.yml`,
        preparedSpec.generatorSpecContents.endsWith('\n') ? preparedSpec.generatorSpecContents : `${preparedSpec.generatorSpecContents}\n`,
      );
    }
  }

  async prepareProvidedOpenApiSpec(application: {
    oas3Input?: string;
    preparedOpenApiSpec?: PreparedOpenApiSpec;
    openApiGeneratorInputFile?: string;
    openApiModelNameMappings?: { sourceName: string; targetName: string }[];
  }): Promise<PreparedOpenApiSpec | undefined> {
    if (!application.oas3Input) return undefined;
    if (application.preparedOpenApiSpec) return application.preparedOpenApiSpec;
    const resolvedInputPath = this.destinationPath(application.oas3Input);
    const candidatePaths = this.buildOpenApiSourceCandidates(resolvedInputPath);
    const failures: string[] = [];
    for (const candidate of candidatePaths) {
      try {
        const contents = await readFile(candidate, 'utf-8');
        if (candidate !== resolvedInputPath) this.log.info(`Using OpenAPI specification at ${candidate}`);
        const parsed = parseYaml(contents) as { components?: { schemas?: Record<string, unknown> } };
        const generatorSpec = normalizeOpenApiSpecForGenerator(parsed);
        const generatorSpecChanged = JSON.stringify(generatorSpec) !== JSON.stringify(parsed);
        application.openApiModelNameMappings = getOpenApiModelNameMappings(Object.keys(parsed?.components?.schemas ?? {}));
        application.openApiGeneratorInputFile = generatorSpecChanged ? 'api-codegen.yml' : 'api.yml';
        application.preparedOpenApiSpec = {
          specContents: contents,
          generatorSpecContents: generatorSpecChanged ? stringifyYaml(generatorSpec, { lineWidth: 0 }) : undefined,
        };
        return application.preparedOpenApiSpec;
      } catch (error) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`Unable to read OpenAPI specification from ${resolvedInputPath}.\n${failures.join('\n')}`);
  }

  private buildOpenApiSourceCandidates(resolvedInputPath: string): string[] {
    if (!resolvedInputPath.toLowerCase().endsWith('.jdl')) return [resolvedInputPath];
    const basePath = resolvedInputPath.slice(0, -4);
    return [`${basePath}.yaml`, `${basePath}.yml`, `${basePath}.json`, resolvedInputPath];
  }
}
