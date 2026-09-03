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
import { before, describe, expect, it } from 'esmocha';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultHelpers as helpers, fromMatrix, result } from '../../../../lib/testing/index.ts';
import { shouldSupportFeatures, testBlueprintSupport } from '../../../../test/support/tests.js';

import Generator from './index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const generator = `${basename(resolve(__dirname, '../../'))}:${basename(__dirname)}`;

describe(`generator - ${generator}`, () => {
  shouldSupportFeatures(Generator);
  describe('blueprint support', () => testBlueprintSupport(generator));

  it('configures the generated-model template directory for Gradle', async () => {
    const convention = await readFile(
      join(__dirname, 'templates/buildSrc/src/main/groovy/jhipster.openapi-generator-conventions.gradle.ejs'),
      'utf8',
    );

    expect(convention).toContain('templateDir = "$rootDir/src/main/openapi-templates".toString()');
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

      it('should compose with generators', () => {
        expect(result.getComposedGenerators()).toMatchSnapshot();
      });
    });
  }

  describe('with custom oas3 input', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Custom External API
  version: 1.2.3
paths:
  /sample:
    get:
      operationId: getSample
      responses:
        '200':
          description: ok
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'external-api.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'external-api.yaml' });
    });

    it('should copy the provided specification to api.yml without altering its contents', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
      result.assertNoFileContent('src/main/resources/swagger/api.yml', '<% if (authenticationTypeJwt) { %>');
    });

    it('should configure the generated-model template directory', () => {
      expect(JSON.stringify(result.sourceCallsArg)).toContain(
        '<templateDirectory>${project.basedir}/src/main/openapi-templates</templateDirectory>',
      );
    });
  });

  describe('with custom oas3 input referencing a .jdl file', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: External Sibling API
  version: 9.9.9
paths: {}
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'external-sibling.oas.yaml'), customSpec);
        })
        .withJHipsterConfig({
          buildTool: 'maven',
          addOpenapiGeneratorPlugin: true,
          oas3Input: 'external-sibling.oas.jdl',
        });
    });

    it('should resolve the sibling OpenAPI specification file', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', 'title: External Sibling API');
    });
  });

  describe('with custom oas3 input containing component schema names rejected by OpenAPI Generator', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Spaced Schemas
  version: 1.0.0
paths:
  /vessel-voyages:
    get:
      operationId: listVesselVoyages
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Vessel Voyage'
components:
  schemas:
    Vessel Voyage:
      title: Vessel Voyage
      type: object
      properties:
        vesselName:
          type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'spaced.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'spaced.yaml' });
    });

    it('should preserve component keys and matching refs in the copied api.yml', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });

  describe('with custom oas3 input containing component schema names that collide with generated Java types', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Type Collision Schemas
  version: 1.0.0
paths:
  /schedules:
    get:
      operationId: listSchedules
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Schedule'
components:
  schemas:
    Schedule:
      type: object
      properties:
        timestamps:
          type: array
          items:
            $ref: '#/components/schemas/Timestamp'
    Timestamp:
      title: Timestamp
      type: object
      properties:
        eventDateTime:
          type: string
          format: date-time
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'collision.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'collision.yaml' });
    });

    it('should preserve colliding component keys and matching refs in the copied api.yml', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });

    it('should configure a Java model mapping without changing the OpenAPI contract', () => {
      expect(JSON.stringify(result.sourceCallsArg)).toContain('<modelNameMapping>Timestamp=TimestampModel</modelNameMapping>');
    });
  });

  describe('with custom oas3 input whose discriminator property is declared on variants', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Variant Discriminator Property
  version: 1.0.0
paths:
  /items:
    post:
      operationId: createItem
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/OwnedItem'
      responses:
        '201':
          description: created
components:
  schemas:
    OwnedItem:
      type: object
      properties:
        label:
          type: string
      discriminator:
        propertyName: owned
        mapping:
          'true': '#/components/schemas/OwnedVariant'
          'false': '#/components/schemas/ReferencedVariant'
      oneOf:
        - $ref: '#/components/schemas/OwnedVariant'
        - $ref: '#/components/schemas/ReferencedVariant'
    OwnedVariant:
      type: object
      required:
        - owned
      properties:
        owned:
          type: boolean
        name:
          type: string
    ReferencedVariant:
      type: object
      required:
        - owned
      properties:
        owned:
          type: boolean
        reference:
          type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'variant-discriminator.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'variant-discriminator.yaml' });
    });

    it('should preserve a discriminator property declared on variants', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });

  describe('with custom oas3 input whose discriminator variants narrow a string property with enum values', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Enum Discriminator Variant
  version: 1.0.0
paths:
  /places:
    get:
      operationId: listPlaces
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PlaceRefOrValue'
components:
  schemas:
    PlaceRefOrValue:
      type: object
      discriminator:
        propertyName: '@type'
        mapping:
          GeographicLocation: '#/components/schemas/GeographicLocation'
      oneOf:
        - $ref: '#/components/schemas/GeographicLocation'
    Place:
      type: object
      properties:
        '@type':
          type: string
    GeographicLocation:
      allOf:
        - $ref: '#/components/schemas/Place'
        - type: object
          properties:
            '@type':
              type: string
              enum:
                - GeoJsonPoint
            bbox:
              type: array
              items:
                type: number
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'enum-discriminator-variant.yaml'), customSpec);
        })
        .withJHipsterConfig({
          buildTool: 'maven',
          addOpenapiGeneratorPlugin: true,
          oas3Input: 'enum-discriminator-variant.yaml',
        });
    });

    it('should preserve discriminator property types and enum values', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });

  describe('with custom oas3 input containing discriminator oneOf references', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Discriminator OneOf Base
  version: 1.0.0
paths:
  /references:
    get:
      operationId: listReferences
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ReferenceOrValue'
components:
  schemas:
    ReferenceOrValue:
      type: object
      discriminator:
        propertyName: '@type'
        mapping:
          Reference: '#/components/schemas/Reference'
          Value: '#/components/schemas/Value'
      properties:
        '@type':
          type: string
      required:
        - '@type'
      oneOf:
        - $ref: '#/components/schemas/Reference'
        - $ref: '#/components/schemas/Value'
    Reference:
      type: object
      properties:
        '@type':
          type: string
          enum:
            - Reference
        href:
          type: string
    Value:
      type: object
      properties:
        '@type':
          type: string
          enum:
            - Value
        name:
          type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'discriminator-oneof.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'discriminator-oneof.yaml' });
    });

    it('should preserve oneOf bases and discriminator-only base properties', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });

  describe('with custom oas3 input whose allOf child repeats compatible inherited properties', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Inherited Property Overrides
  version: 1.0.0
paths:
  /children:
    get:
      operationId: listChildren
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Child'
components:
  schemas:
    Base:
      type: object
      required:
        - id
      properties:
        id:
          type: string
          format: uuid
          readOnly: true
        href:
          type: string
    Child:
      allOf:
        - $ref: '#/components/schemas/Base'
        - type: object
          required:
            - id
            - childOnly
          properties:
            id:
              type: string
              format: uuid
              readOnly: true
              description: Duplicate inherited id
            href:
              type: string
              description: Duplicate inherited href
            childOnly:
              type: integer
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'inherited-overrides.yaml'), customSpec);
        })
        .withJHipsterConfig({
          buildTool: 'gradle',
          addOpenapiGeneratorPlugin: true,
          oas3Input: 'inherited-overrides.yaml',
        });
    });

    it('should preserve compatible duplicated child properties in the public contract', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });

    it('should use a private compatibility input for Java generation', () => {
      result.assertFileContent('src/main/resources/swagger/api.generator.yml', 'childOnly:\n              type: integer');
      result.assertNoFileContent('src/main/resources/swagger/api.generator.yml', 'description: Duplicate inherited id');
      result.assertNoFileContent('src/main/resources/swagger/api.generator.yml', 'description: Duplicate inherited href');
      result.assertFileContent(
        'buildSrc/src/main/groovy/jhipster.openapi-generator-conventions.gradle',
        'inputSpec = "$rootDir/src/main/resources/swagger/api.generator.yml".toString()',
      );
    });
  });

  describe('with custom oas3 input containing inline anyOf required alternatives', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Inline Alternative Required
  version: 1.0.0
paths:
  /contacts:
    post:
      operationId: createContact
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Contact'
      responses:
        '201':
          description: created
components:
  schemas:
    Contact:
      type: object
      required:
        - name
      properties:
        name:
          type: string
      anyOf:
        - type: object
          required:
            - phone
          properties:
            phone:
              type: string
        - type: object
          required:
            - email
          properties:
            email:
              type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'inline-anyof.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'inline-anyof.yaml' });
    });

    it('should preserve inline anyOf required alternatives in the public contract', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });

    it('should remove inline alternative requirements only from the private Java generator input', () => {
      result.assertFileContent('src/main/resources/swagger/api.generator.yml', 'anyOf:');
      result.assertNoFileContent('src/main/resources/swagger/api.generator.yml', 'required:\n          - phone');
      result.assertNoFileContent('src/main/resources/swagger/api.generator.yml', 'required:\n          - email');
    });
  });

  describe('with custom oas3 input containing ambiguous JSON Patch response schemas', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: JSON Patch Response
  version: 1.0.0
paths:
  /items/{id}:
    patch:
      operationId: patchItem
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: updated
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
            application/json-patch+json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/Item'
                  - type: array
                    items:
                      $ref: '#/components/schemas/Item'
                  - type: string
                    nullable: true
components:
  schemas:
    Item:
      type: object
      properties:
        name:
          type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'json-patch-response.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'json-patch-response.yaml' });
    });

    it('should preserve JSON Patch response schemas', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });

  describe('with custom oas3 input containing concrete event payload schemas', () => {
    const customSpec = `openapi: 3.0.3
info:
  title: Concrete Events
  version: 1.0.0
paths:
  /listener/itemCreateEvent:
    post:
      operationId: listenItemCreateEvent
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ItemCreateEvent'
      responses:
        '204':
          description: accepted
components:
  schemas:
    Extensible:
      type: object
      properties:
        '@type':
          type: string
    Event:
      allOf:
        - $ref: '#/components/schemas/Extensible'
        - type: object
          properties:
            event:
              type: object
            eventId:
              type: string
    ItemCreateEvent:
      allOf:
        - $ref: '#/components/schemas/Event'
        - type: object
          description: Item create event
    ItemCreateEventPayload:
      type: object
      properties:
        item:
          $ref: '#/components/schemas/Item'
    Item:
      type: object
      properties:
        name:
          type: string
`;

    before(async () => {
      await helpers
        .runJHipster(generator)
        .withMockedJHipsterGenerators()
        .withMockedSource()
        .withSharedApplication({})
        .inTmpDir(async dir => {
          await writeFile(join(dir, 'concrete-events.yaml'), customSpec);
        })
        .withJHipsterConfig({ buildTool: 'maven', addOpenapiGeneratorPlugin: true, oas3Input: 'concrete-events.yaml' });
    });

    it('should preserve concrete event payload schemas', () => {
      result.assertFileContent('src/main/resources/swagger/api.yml', customSpec);
    });
  });
});
