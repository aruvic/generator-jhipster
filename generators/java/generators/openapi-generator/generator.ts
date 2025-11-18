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
import { readFile } from 'node:fs/promises';

import { GRADLE_BUILD_SRC_MAIN_DIR } from '../../../generator-constants.js';
import { JavaApplicationGenerator } from '../../generator.ts';
import { javaMainResourceTemplatesBlock } from '../../support/files.ts';

export default class OpenapiGeneratorGenerator extends JavaApplicationGenerator {
  async beforeQueue() {
    if (!this.fromBlueprint) {
      await this.composeWithBlueprints();
    }

    if (!this.delegateToBlueprint) {
      await this.dependsOnBootstrap('java');
      await this.dependsOnJHipster('jhipster:java:build-tool');
    }
  }

  get writing() {
    return this.asWritingTaskGroup({
      async cleanup({ application, control }) {
        await control.cleanupFiles({
          '8.6.1': [[application.buildToolGradle!, 'gradle/swagger.gradle']],
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
                version: javaDependencies!['jackson-databind-nullable'],
              },
            ],
          },
          {
            condition: addOpenapiGeneratorPlugin,
            mavenDefinition: {
              properties: [
                { property: 'openapi-generator-maven-plugin.version', value: javaDependencies!['openapi-generator-maven-plugin'] },
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
                              application.reactive
                                ? `
                                <reactive>true</reactive>
`
                                : ''
                            }
                                <delegatePattern>true</delegatePattern>
                                <title>${application.dasherizedBaseName}</title>
                                <useSpringBoot3>true</useSpringBoot3>
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

        if (addOpenapiGeneratorPlugin) {
          if (buildToolGradle) {
            source.addGradleBuildSrcDependencyCatalogLibraries?.([
              {
                libraryName: 'openapi-generator',
                module: 'org.openapitools:openapi-generator-gradle-plugin',
                version: javaDependencies!['gradle-openapi-generator'],
                scope: 'implementation',
              },
            ]);
            source.addGradlePlugin?.({ id: 'jhipster.openapi-generator-conventions' });
          }
        }
      },
    });
  }

  get [JavaApplicationGenerator.POST_WRITING]() {
    return this.delegateTasksToBlueprint(() => this.postWriting);
  }

  async copyProvidedOpenApiSpec(application: any) {
    const resolvedInputPath = this.destinationPath(application.oas3Input);
    const candidatePaths = this.buildOpenApiSourceCandidates(resolvedInputPath);
    const failedCandidates: string[] = [];
    let specContents: string | undefined;
    let usedPath: string | undefined;
    for (const candidate of candidatePaths) {
      try {
        specContents = await readFile(candidate, 'utf-8');
        usedPath = candidate;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedCandidates.push(`${candidate}: ${message}`);
      }
    }
    if (!specContents || !usedPath) {
      const errorDetails = failedCandidates.length > 0 ? `\n${failedCandidates.join('\n')}` : '';
      throw new Error(`Unable to read OpenAPI specification from ${resolvedInputPath}.${errorDetails}`);
    }
    if (usedPath !== resolvedInputPath) {
      this.log.info(`Using OpenAPI specification at ${usedPath}`);
    }
    const destination = `${application.srcMainResources}swagger/api.yml`;
    const finalContents = specContents.endsWith('\n') ? specContents : `${specContents}\n`;
    this.writeDestination(destination, finalContents);
  }

  buildOpenApiSourceCandidates(resolvedInputPath: string) {
    const candidates: string[] = [];
    const addCandidate = (candidate: string) => {
      if (candidate && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };
    const lowerCasePath = resolvedInputPath.toLowerCase();
    if (lowerCasePath.endsWith('.jdl')) {
      const basePath = resolvedInputPath.slice(0, -4);
      ['.yaml', '.yml', '.json'].forEach(extension => addCandidate(`${basePath}${extension}`));
    }
    addCandidate(resolvedInputPath);
    return candidates;
  }
}
