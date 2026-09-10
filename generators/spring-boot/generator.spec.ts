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
import { basename } from 'node:path';

import { PRIORITY_NAMES } from '../base-application/priorities.ts';
import { asPostWritingTask } from '../base-application/support/task-type-inference.ts';
import { SERVER_MAIN_SRC_DIR } from '../generator-constants.ts';
import { filterBasicServerGenerators } from '../server/__test-support/index.ts';

import Generator from './generator.ts';

import { checkEnforcements, shouldSupportFeatures, testBlueprintSupport } from '#test-support';
import { defaultHelpers as helpers, runResult } from '#testing';

const generator = basename(import.meta.dirname);

describe(`generator - ${generator}`, () => {
  shouldSupportFeatures(Generator);
  describe('blueprint support', () => testBlueprintSupport(generator));
  checkEnforcements({}, generator);

  describe('addTestSpringFactory', () => {
    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig()
        .withMockedJHipsterGenerators()
        .withSkipWritingPriorities()
        .withTask(
          'postWriting',
          asPostWritingTask(function ({ source }) {
            source.addTestSpringFactory!({ key: 'key', value: 'first.value' });
            source.addTestSpringFactory!({ key: 'key', value: 'second.value' });
            // Existing value should not be added again
            source.addTestSpringFactory!({ key: 'key', value: 'second.value' });
          }),
        );
    });

    it('should add a test spring factory', () => {
      expect(runResult.getSnapshot('**/spring.factories')).toMatchSnapshot();
    });
  });

  describe('with jwt', () => {
    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig({ authenticationType: 'jwt' })
        .withMockedSource({ except: ['addTestSpringFactory'] })
        .withMockedJHipsterGenerators({ filter: filterBasicServerGenerators });
    });

    it('should match generated files snapshot', () => {
      expect(runResult.getStateSnapshot()).toMatchSnapshot();
    });

    it('should use the supported prometheus registry dependency', () => {
      const javaDefinitions = runResult.sourceCallsArg.addJavaDefinitions.flat();
      const dependencies = javaDefinitions.flatMap(definition => {
        if (definition && typeof definition === 'object' && 'dependencies' in definition && Array.isArray(definition.dependencies)) {
          return definition.dependencies;
        }
        return [];
      });

      expect(dependencies).toEqual(
        expect.arrayContaining([expect.objectContaining({ groupId: 'io.micrometer', artifactId: 'micrometer-registry-prometheus' })]),
      );
      expect(dependencies).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupId: 'io.micrometer', artifactId: 'micrometer-registry-prometheus-simpleclient' }),
        ]),
      );
    });

    it('should match application snapshot', () => {
      expect(runResult.application).toMatchSnapshot({
        user: expect.any(Object),
        authority: expect.any(Object),
        userManagement: expect.any(Object),
        jhipsterPackageJson: expect.any(Object),
        jwtSecretKey: expect.any(String),
        springBootDependencies: expect.any(Object),
        addLanguageCallbacks: expect.any(Array),
        supportedLanguages: expect.any(Array),
      });
    });
  });

  describe('with oauth2', () => {
    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig({ authenticationType: 'oauth2' })
        .withMockedSource({ except: ['addTestSpringFactory'] })
        .withMockedJHipsterGenerators({ filter: filterBasicServerGenerators });
    });

    it('should match generated files snapshot', () => {
      expect(runResult.getStateSnapshot()).toMatchSnapshot();
    });

    it('should match application snapshot', () => {
      expect(runResult.application).toMatchSnapshot({
        jhipsterPackageJson: expect.any(Object),
        springBootDependencies: expect.any(Object),
        addLanguageCallbacks: expect.any(Array),
        supportedLanguages: expect.any(Array),
      });
    });
  });

  describe('with eager load relationship and no pagination', () => {
    before(async () => {
      await helpers.runJHipster(generator).withJHipsterConfig({ skipClient: true }, [
        { name: 'Parent', changelogDate: '20160926101210', fields: [{ fieldName: 'name', fieldType: 'String' }] },
        {
          name: 'ServicedChild',
          changelogDate: '20160926101212',
          service: 'serviceImpl',
          fields: [{ fieldName: 'name', fieldType: 'String' }],
          relationships: [
            { relationshipName: 'parent', otherEntityName: 'Parent', relationshipType: 'many-to-one', otherEntityField: 'name' },
          ],
        },
        {
          name: 'Child',
          changelogDate: '20160926101211',
          fields: [{ fieldName: 'name', fieldType: 'String' }],
          relationships: [
            { relationshipName: 'parent', otherEntityName: 'Parent', relationshipType: 'many-to-one', otherEntityField: 'name' },
          ],
        },
      ]);
    });

    it('should eagerly load the relationships from the repository', () => {
      runResult.assertFileContent(
        `${SERVER_MAIN_SRC_DIR}com/mycompany/myapp/web/rest/ChildResource.java`,
        `        if (eagerload) {
            return childRepository.findAllWithEagerRelationships();
        } else {
            return childRepository.findAll();
        }`,
      );
    });

    it('should eagerly load the relationships from the service', () => {
      runResult.assertFileContent(
        `${SERVER_MAIN_SRC_DIR}com/mycompany/myapp/web/rest/ServicedChildResource.java`,
        `        if (eagerload) {
            return servicedChildService.findAllWithEagerRelationships();
        } else {
            return servicedChildService.findAll();
        }`,
      );
      runResult.assertFileContent(
        `${SERVER_MAIN_SRC_DIR}com/mycompany/myapp/service/ServicedChildService.java`,
        'List<ServicedChild> findAllWithEagerRelationships();',
      );
      runResult.assertFileContent(
        `${SERVER_MAIN_SRC_DIR}com/mycompany/myapp/service/impl/ServicedChildServiceImpl.java`,
        `    public List<ServicedChild> findAllWithEagerRelationships() {
        return servicedChildRepository.findAllWithEagerRelationships();
    }`,
      );
    });
  });

  describe('openapi delegate alignment', () => {
    const openApiSpec = `openapi: 3.0.1\ninfo:\n  title: Pet API\n  version: 1.0.0\npaths:\n  /pets:\n    post:\n      operationId: create-pet-entry\n      tags:\n        - Pet\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema:\n              $ref: '#/components/schemas/PetCreate'\n      responses:\n        '201':\n          description: Created\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Pet'\n    get:\n      operationId: listPets\n      tags:\n        - Pet\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                type: array\n                items:\n                  $ref: '#/components/schemas/Pet'\n  /pets/{pet-id}:\n    get:\n      summary: Retrieve a pet\n      tags:\n        - Pet\n      parameters:\n        - name: pet-id\n          in: path\n          required: true\n          schema:\n            type: string\n        - name: include-history\n          in: query\n          schema:\n            type: boolean\n        - name: since\n          in: query\n          schema:\n            type: string\n            format: date-time\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/Pet'\n    delete:\n      operationId: deletePet\n      tags:\n        - Pet\n      parameters:\n        - name: pet-id\n          in: path\n          required: true\n          schema:\n            type: integer\n            format: int64\n        - name: return\n          in: query\n          schema:\n            type: string\n      responses:\n        '204':\n          description: No Content\n    patch:\n      operationId: patchPet\n      tags:\n        - Pet\n      parameters:\n        - name: pet-id\n          in: path\n          required: true\n          schema:\n            type: string\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema:\n              type: object\n              additionalProperties:\n                type: string\n      responses:\n        '200':\n          description: OK\n          content:\n            application/json:\n              schema:\n                type: object\n                additionalProperties:\n                  $ref: '#/components/schemas/PetStatus'\ncomponents:\n  schemas:\n    PetCreate:\n      type: object\n      properties:\n        name:\n          type: string\n        birthDate:\n          type: string\n          format: date\n    Pet:\n      type: object\n      properties:\n        id:\n          type: integer\n          format: int64\n        name:\n          type: string\n        registeredAt:\n          type: string\n          format: date-time\n    PetStatus:\n      type: object\n      additionalProperties:\n        type: string\n`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig({ baseName: 'petstore', enableSwaggerCodegen: true, skipClient: true })
        .withMockedSource({ except: ['addTestSpringFactory'] })
        .withMockedJHipsterGenerators({ filter: filterBasicServerGenerators })
        .withFiles({ 'src/main/resources/swagger/api.yml': openApiSpec });
    });

    it('should align delegate methods and types with OpenAPI generator conventions', () => {
      expect(runResult.getSnapshot('src/main/java/**/web/api/impl/*ApiDelegateImpl.java')).toMatchSnapshot();
    });

    it('should not cascade bean validation on UUID model properties', () => {
      runResult.assertFileContent('src/main/openapi-templates/beanValidation.mustache', '{{^isUuid}}@Valid');
    });

    it('should omit null properties from OpenAPI responses', () => {
      runResult.assertFileContent(
        'src/main/java/com/mycompany/myapp/config/JacksonConfiguration.java',
        'changeDefaultPropertyInclusion(inclusion -> inclusion.withValueInclusion(JsonInclude.Include.NON_NULL))',
      );
      expect(runResult.getSnapshot('**/src/main/java/**/config/JacksonConfiguration.java')).toMatchSnapshot();
    });

    it('should generate EvoMaster white-box driver support for OpenAPI apps', () => {
      runResult.assertFile('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java');
      runResult.assertFile('src/main/java/com/mycompany/myapp/validation/PatternObjectValidator.java');
      const javaDefinitions = runResult.sourceCallsArg.addJavaDefinitions.flat();
      const dependencies = javaDefinitions.flatMap(definition => {
        if (definition && typeof definition === 'object' && 'dependencies' in definition && Array.isArray(definition.dependencies)) {
          return definition.dependencies;
        }
        return [];
      });
      expect(dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupId: 'org.evomaster',
            artifactId: 'evomaster-client-java-controller',
            scope: 'test',
          }),
        ]),
      );
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/OpenApiConfiguration.java', 'normalizeDiscriminatorSchemas');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/OpenApiConfiguration.java', 'JsonSubTypes');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'movePathParametersToOperations');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'normalizeDiscriminatorSubtypes');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'removeResponseContentWithoutSchemas',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'mergeResponseEntry(normalized, String.valueOf(key), value)',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'mergePropertySchema');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'uniqueStringList(target.get("enum"), value)',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'registerLiquibaseCheckEnumConstraintsForEvoMaster',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'registerDatabaseCheckEnumConstraintsForEvoMaster',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_REGISTER_DATABASE_CHECK_ENUM_CONSTRAINTS',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'checkEnumValuesForSqlColumn');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sqlTableNameCandidates');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sqlColumnNameCandidates');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'camelCaseToSnakeCase');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'findPostgreSqlCheckEnumValues');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'sanitizePrintableSqlTemporalLiteral',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SQL_TIMESTAMP_LITERAL');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SQL_INSERT_VALUES');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SanitizingConnectionHandler');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sanitizeSqlStatement');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_SANITIZE_SQL_STATEMENTS',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'packagesToSkipInstrumentation');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_PACKAGES_TO_SKIP_INSTRUMENTATION',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'UnitsInfoRecorder.registerNewJpaConstraint',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sanitizeSqlCheckEnumInsertions');
      runResult.assertNoFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        '|| liquibaseCheckEnumConstraints.isEmpty()',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_SANITIZE_SQL_CHECK_ENUM_INSERTIONS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_ALLOW_CIRCULAR_REFERENCES',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '!map.containsKey("$ref")');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'response.remove("$ref")');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'content.put("application/problem+json", problemContent)',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'content.put("application/json", problemContent)',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_STRIP_SCHEMA_PATTERNS',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'isOpenApiParameter');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'operationParameter && "schema".equals(entry.getKey())',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_STRIP_UNSUPPORTED_FORMATS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'isUnsupportedEvoMasterStringFormat',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"email"');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"uri"');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"base64"');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_MERGE_COMPOSED_SCHEMAS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_FLATTEN_ALLOF_SCHEMAS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_BOUND_FREE_FORM_OBJECT_SCHEMAS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_INLINE_OPERATION_SCHEMAS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_STRIP_SCHEMA_DISCRIMINATORS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_RELAX_RESPONSE_DISCRIMINATOR_ENUMS',
      );
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'relaxResponseDiscriminatorEnums',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'property.remove("enum")');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'property.putIfAbsent("default", discriminatorValue)',
      );
      runResult.assertNoFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'property.putIfAbsent("example"',
      );
      runResult.assertNoFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        /private static void relaxDiscriminatorEnumProperties\([^)]*\) \{(?:(?!\n {4}private static ).)*property\.put\("enum"/s,
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"406", "Not Acceptable"');
    });
  });

  describe('source api', () => {
    describe('editJavaFile with springBeans', () => {
      before(async () => {
        await helpers
          .runJHipster(generator)
          .withJHipsterConfig({ skipClient: true })
          .withTask(
            'postWriting',
            asPostWritingTask(function ({ source }) {
              source.addApplicationPropertiesClass!({
                propertyType: 'SomeNestedProperties',
                classStructure: { enabled: ['Boolean', 'true'], tag: 'String' },
              });
            }),
          );
      });

      it('should match file content snapshot', () => {
        expect(runResult.getSnapshot('**/ApplicationProperties.java')).toMatchSnapshot();
      });
    });

    describe('addApplicationYamlDocument', () => {
      const content = `spring:\n  application:\n    name: myApp`;

      before(async () => {
        await helpers
          .runJHipster(generator)
          .withJHipsterConfig({ skipClient: true })
          .withTask(
            PRIORITY_NAMES.POST_WRITING,
            asPostWritingTask(function ({ source }) {
              source.addApplicationYamlDocument!(content);
            }),
          );
      });

      it('should inject content', () => {
        runResult.assertFileContent('src/main/resources/config/application.yml', `---\n${content}`);
      });
    });
  });
});
