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

import Generator from './index.ts';

import { defaultHelpers as helpers, typedResult } from '#testing';

const generator = `${basename(resolve(import.meta.dirname, '../../'))}:${basename(import.meta.dirname)}`;
const result = typedResult<Generator>();

describe(`generator - ${generator}`, () => {
  shouldSupportFeatures(Generator);
  describe('blueprint support', () => testBlueprintSupport(generator));

  describe('with default config', () => {
    before(async () => {
      await helpers.runJHipster(generator).withJHipsterConfig({}, [
        {
          name: 'Foo',
          fields: [
            { fieldName: 'name', documentation: 'My Name', fieldType: 'String', fieldValidateRules: ['required'] },
            { fieldName: 'myEnum', fieldType: 'MyEnum', fieldValues: 'FRENCH,ENGLISH', fieldTypeDocumentation: 'Enum Doc' },
          ],
        },
        {
          name: 'Bar',
          documentation: 'Custom Bar',
          fields: [{ fieldName: 'name2', fieldType: 'String', fieldValidateRules: ['required'] }],
        },
      ]);
    });

    it('should match files snapshot', () => {
      expect(result.getStateSnapshot()).toMatchSnapshot();
    });

    it('should generate entities containing jakarta', () => {
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Foo.java', 'jakarta');
    });

    it('should generate javadocs', () => {
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Foo.java', '* A Foo');
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Foo.java', '* My Name');
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Bar.java', '* Custom Bar');
    });

    it('should generate openapi @Schema', () => {
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Bar.java', '@Schema(description = "Custom Bar")');
    });

    it('should write enum files', () => {
      result.assertFile('src/main/java/com/mycompany/myapp/domain/enumeration/MyEnum.java');
      expect(Object.keys(result.getStateSnapshot('**/enumeration/**'))).toHaveLength(1);
    });

    it('should generate enum javadoc', () => {
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/enumeration/MyEnum.java', '* Enum Doc');
    });

    it('should have options defaults set', () => {
      const { generator } = result;
      expect(generator.generateEntities).toBe(true);
      expect(generator.generateEnums).toBe(true);
      expect(generator.useJakartaValidation).toBe(true);
    });
  });

  describe('with required blob fields', () => {
    before(async () => {
      await helpers.runJHipster(generator).withJHipsterConfig({}, [
        {
          name: 'Document',
          fields: [
            { fieldName: 'description', fieldType: 'TextBlob', fieldValidateRules: ['required'] },
            { fieldName: 'content', fieldType: 'Blob', fieldValidateRules: ['required'] },
          ],
        },
      ]);
    });

    it('should add bean validation before database null constraints', () => {
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Document.java', '@NotNull');
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Document.java', 'private String description;');
      result.assertFileContent('src/main/java/com/mycompany/myapp/domain/Document.java', 'private byte[] content;');
    });
  });

  describe('with JavaBean acronym-style properties', () => {
    before(async () => {
      await helpers.runJHipster(generator).withJHipsterConfig({}, [
        {
          name: 'SupportingDocument',
          fields: [{ fieldName: 'name', fieldType: 'String' }],
        },
        {
          name: 'IssuanceManifest',
          fields: [{ fieldName: 'eBLVisualisationByCarrierChecksum', fieldType: 'String' }],
        },
        {
          name: 'IssuanceRequest',
          relationships: [
            {
              relationshipType: 'many-to-one',
              relationshipName: 'eBLVisualisationByCarrier',
              otherEntityName: 'SupportingDocument',
            },
          ],
        },
      ]);
    });

    it('should use generated JavaBean accessor suffixes in domain test helpers', () => {
      result.assertFileContent('src/test/java/com/mycompany/myapp/domain/IssuanceManifestTestSamples.java', 'seteBLVisualisationByCarrierChecksum');
      result.assertNoFileContent('src/test/java/com/mycompany/myapp/domain/IssuanceManifestTestSamples.java', 'setEBLVisualisationByCarrierChecksum');
      result.assertFileContent('src/test/java/com/mycompany/myapp/domain/IssuanceRequestAsserts.java', 'getEBLVisualisationByCarrier');
      result.assertNoFileContent('src/test/java/com/mycompany/myapp/domain/IssuanceRequestAsserts.java', 'geteBLVisualisationByCarrier');
    });
  });

  describe('with jakarta and enums disabled', () => {
    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig({}, [
          {
            name: 'Foo',
            fields: [
              { fieldName: 'name', fieldType: 'String', fieldValidateRules: ['required'] },
              { fieldName: 'myEnum', fieldType: 'MyEnum', fieldValues: 'FRENCH,ENGLISH' },
            ],
          },
        ])
        .withOptions({ useJakartaValidation: false, generateEnums: false });
    });

    it('should generate entities not containing jakarta', () => {
      result.assertNoFileContent('src/main/java/com/mycompany/myapp/domain/Foo.java', 'jakarta');
    });

    it('should not write enum files', () => {
      expect(Object.keys(result.getStateSnapshot('**/enumeration/**'))).toHaveLength(0);
    });
  });

  describe('with entities disabled', () => {
    before(async () => {
      await helpers
        .runJHipster(generator)
        .withJHipsterConfig({}, [
          {
            name: 'Foo',
            fields: [
              { fieldName: 'name', fieldType: 'String', fieldValidateRules: ['required'] },
              { fieldName: 'myEnum', fieldType: 'MyEnum', fieldValues: 'FRENCH,ENGLISH' },
            ],
          },
        ])
        .withOptions({ generateEntities: false });
    });

    it('should not contain jakarta', () => {
      result.assertNoFile('src/main/java/com/mycompany/myapp/domain/Foo.java');
    });
  });

  describe('with custom properties values', () => {
    before(async () => {
      await helpers
        .runJHipster<Generator>(generator)
        .withJHipsterConfig({})
        .onGenerator(generator => {
          generator.generateEntities = false;
          generator.generateEnums = false;
          generator.useJakartaValidation = false;
        });
    });

    it('should not override custom values', () => {
      const { generator } = result;
      expect(generator.generateEntities).toBe(false);
      expect(generator.generateEnums).toBe(false);
      expect(generator.useJakartaValidation).toBe(false);
    });
  });
});
