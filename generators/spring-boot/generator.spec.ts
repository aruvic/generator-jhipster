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

    it('should generate EvoMaster white-box driver support for OpenAPI apps', () => {
      runResult.assertFile('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java');
      runResult.assertFile('src/main/java/com/mycompany/myapp/validation/PatternObjectValidator.java');
      runResult.assertFileContent('pom.xml', '<artifactId>evomaster-client-java-controller</artifactId>');
      runResult.assertFileContent('pom.xml', '<useBeanValidation>true</useBeanValidation>');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/OpenApiConfiguration.java', 'normalizeDiscriminatorSchemas');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/OpenApiConfiguration.java', 'JsonSubTypes');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/SecurityConfiguration.java', 'setAllowUrlEncodedPercent(true)');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/SecurityConfiguration.java', 'setAllowBackSlash(true)');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/SecurityConfiguration.java', 'setAllowSemicolon(true)');
      runResult.assertFileContent('src/main/java/com/mycompany/myapp/config/JacksonConfiguration.java', 'serializationInclusion(JsonInclude.Include.NON_NULL)');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'movePathParametersToOperations');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'normalizeDiscriminatorSubtypes');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'removeResponseContentWithoutSchemas');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'mergeResponseEntry(normalized, String.valueOf(key), value)');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'mergePropertySchema');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'uniqueStringList(target.get("enum"), value)');
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
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sanitizePrintableSqlTemporalLiteral');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SQL_TIMESTAMP_LITERAL');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SQL_INSERT_VALUES');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'SanitizingConnectionHandler');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'sanitizeSqlStatement');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_SANITIZE_SQL_STATEMENTS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'packagesToSkipInstrumentation');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'EVOMASTER_PACKAGES_TO_SKIP_INSTRUMENTATION',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'UnitsInfoRecorder.registerNewJpaConstraint');
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
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'content.put("application/problem+json", problemContent)');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'content.put("application/json", problemContent)');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_STRIP_SCHEMA_PATTERNS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'isOpenApiParameter');
      runResult.assertFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'operationParameter && "schema".equals(entry.getKey())',
      );
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_STRIP_UNSUPPORTED_FORMATS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'isUnsupportedEvoMasterStringFormat');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"email"');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"uri"');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', '"base64"');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_MERGE_COMPOSED_SCHEMAS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_FLATTEN_ALLOF_SCHEMAS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_BOUND_FREE_FORM_OBJECT_SCHEMAS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_INLINE_OPERATION_SCHEMAS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_STRIP_SCHEMA_DISCRIMINATORS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'EVOMASTER_RELAX_RESPONSE_DISCRIMINATOR_ENUMS');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'relaxResponseDiscriminatorEnums');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'property.remove("enum")');
      runResult.assertFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'property.putIfAbsent("default", discriminatorValue)');
      runResult.assertNoFileContent('src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java', 'property.putIfAbsent("example"');
      runResult.assertNoFileContent(
        'src/test/java/com/mycompany/myapp/evomaster/EvoMasterController.java',
        'property.put("enum", List.of(discriminatorValue));',
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
