import { before, describe, expect, it } from 'esmocha';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';
import { checkEnforcements, shouldSupportFeatures, testBlueprintSupport } from '../../test/support/index.ts';
import { PRIORITY_NAMES } from '../base-application/priorities.ts';
import { asPostWritingTask } from '../base-application/support/task-type-inference.ts';
import { filterBasicServerGenerators } from '../server/__test-support/index.ts';

import Generator from './generator.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const generator = basename(__dirname);

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
