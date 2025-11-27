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
