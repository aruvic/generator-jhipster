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

import { GRADLE_BUILD_SRC_MAIN_DIR } from '../../../generator-constants.ts';
import { JavaApplicationGenerator } from '../../../java/generator.ts';
import { javaMainResourceTemplatesBlock } from '../../../java/support/files.ts';

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
        source.addJavaDefinitions!(
          {
            dependencies: [
              {
                groupId: 'org.openapitools',
                artifactId: 'jackson-databind-nullable',
                version: javaDependencies['jackson-databind-nullable'],
              },
            ],
          },
          {
            condition: addOpenapiGeneratorPlugin,
            mavenDefinition: {
              properties: [
                { property: 'openapi-generator-maven-plugin.version', value: javaDependencies['openapi-generator-maven-plugin'] },
              ],
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
                            <inputSpec>\${project.basedir}/${application.srcMainResources}swagger/api.yml</inputSpec>
                            <generatorName>spring</generatorName>
                            <apiPackage>${application.packageName}.web.api</apiPackage>
                            <modelPackage>${application.packageName}.service.api.dto</modelPackage>
                            <supportingFilesToGenerate>ApiUtil.java</supportingFilesToGenerate>
                            <skipValidateSpec>false</skipValidateSpec>
                            <configOptions>${
                              application.reactive ?
                                `
                                <reactive>true</reactive>
`
                              : ''
                            }
                                <delegatePattern>true</delegatePattern>
                                <title>${application.dasherizedBaseName}</title>
                                <useSpringBoot3>true</useSpringBoot3>
                                <useBeanValidation>false</useBeanValidation>
                                <performBeanValidation>false</performBeanValidation>
                            </configOptions>
                            <typeMappings>
                                <typeMapping>date=LocalDate</typeMapping>
                                <typeMapping>DateTime=Instant</typeMapping>
                                <typeMapping>Time=LocalTime</typeMapping>
                                <typeMapping>Duration=Duration</typeMapping>
                            </typeMappings>
                            <importMappings>
                                <importMapping>Instant=java.time.Instant</importMapping>
                                <importMapping>ZonedDateTime=java.time.ZonedDateTime</importMapping>
                                <importMapping>LocalDate=java.time.LocalDate</importMapping>
                                <importMapping>LocalTime=java.time.LocalTime</importMapping>
                                <importMapping>Duration=java.time.Duration</importMapping>
                            </importMappings>
                        </configuration>
                    </execution>
                </executions>
`,
                },
              ],
            },
          },
        );

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

  async copyProvidedOpenApiSpec(application: { oas3Input: string; srcMainResources: string }) {
    const resolvedInputPath = this.destinationPath(application.oas3Input);
    const candidatePaths = this.buildOpenApiSourceCandidates(resolvedInputPath);
    const failures: string[] = [];
    for (const candidate of candidatePaths) {
      try {
        const contents = await readFile(candidate, 'utf-8');
        this.writeDestination(
          `${application.srcMainResources}swagger/api.yml`,
          contents.endsWith('\n') ? contents : `${contents}\n`,
        );
        if (candidate !== resolvedInputPath) this.log.info(`Using OpenAPI specification at ${candidate}`);
        return;
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
