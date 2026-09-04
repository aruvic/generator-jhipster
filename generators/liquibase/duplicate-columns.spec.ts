import { before, describe, it } from 'esmocha';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';
import type { ConfigAll } from '../../lib/types/command-all.d.ts';
import { SERVER_MAIN_RES_DIR } from '../generator-constants.ts';

const GENERATOR = 'jhipster:liquibase';

const applicationConfig = {
  baseName: 'duplicates',
  applicationType: 'monolith',
  authenticationType: 'jwt',
  databaseType: 'sql',
  devDatabaseType: 'h2Disk',
  prodDatabaseType: 'postgresql',
  buildTool: 'maven',
  cacheProvider: 'ehcache',
  enableHibernateCache: true,
  packageName: 'com.mycompany.myapp',
  packageFolder: 'com/mycompany/myapp',
  nativeLanguage: 'en',
  languages: ['en'],
  skipClient: true,
} satisfies Partial<ConfigAll>;

const duplicateColumnEntity = {
  name: 'TypeCarrier',
  changelogDate: '20240202000000',
  entityTableName: 'type_carrier',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  fields: [
    { fieldName: 'typeKey', fieldType: 'String', fieldValidateRules: ['required'] },
    { fieldName: 'typeKeyAlias', fieldType: 'String', fieldNameAsDatabaseColumn: 'type_key' },
    { fieldName: 'status', fieldType: 'CarrierStatus', fieldValues: 'ACTIVE,INACTIVE' },
  ],
  relationships: [],
};

const discriminatorColumnEntity = {
  name: 'EntityRefOrValue',
  changelogDate: '20240203000000',
  entityTableName: 'entity_ref_or_value',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  abstract: true,
  discriminator: {
    column: 'atType',
    type: 'String',
    values: 'ConcreteRef->ConcreteRef, ExternalRef->ExternalRef',
  },
  fields: [
    { fieldName: 'atType', fieldType: 'String', fieldValidateRules: ['required'] },
    { fieldName: 'description', fieldType: 'String' },
  ],
  relationships: [],
};

const discriminatorChildEntity = {
  name: 'ConcreteRef',
  changelogDate: '20240203000100',
  entityTableName: 'concrete_ref',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  extends: 'EntityRefOrValue',
  annotations: {
    discriminatorValue: {
      value: 'ConcreteRef',
    },
  },
  fields: [],
  relationships: [],
};

describe(`generator - ${GENERATOR} duplicate columns`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [
        duplicateColumnEntity as any,
        discriminatorColumnEntity as any,
        discriminatorChildEntity as any,
      ]);
  });

  it('writes each mirrored column only once', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240202000000_added_entity_TypeCarrier.xml`;
    runResult.assertFileContent(changelogPath, '<column name="type_key"');
    runResult.assertNoFileContent(
      changelogPath,
      /<createTable[^>]*>[\s\S]*<column name="type_key"[\s\S]*<column name="type_key"[\s\S]*<\/createTable>/,
    );
    runResult.assertNoFileContent(
      changelogPath,
      /<loadData[\s\S]*<column name="type_key"[\s\S]*<column name="type_key"[\s\S]*<\/loadData>/,
    );
  });

  it('adds database checks for enum columns', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240202000000_added_entity_TypeCarrier.xml`;
    runResult.assertFileContent(
      changelogPath,
      /ADD CONSTRAINT .* CHECK \(status IN \((?:'|&#39;)ACTIVE(?:'|&#39;), (?:'|&#39;)INACTIVE(?:'|&#39;)\)\)/,
    );
  });

  it('does not duplicate discriminator columns', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240203000000_added_entity_EntityRefOrValue.xml`;
    runResult.assertFileContent(changelogPath, '<column name="at_type"');
    runResult.assertNoFileContent(
      changelogPath,
      /<createTable[^>]*>[\s\S]*<column name="at_type"[\s\S]*<column name="at_type"[\s\S]*<\/createTable>/,
    );
    runResult.assertNoFileContent(changelogPath, /<loadData[\s\S]*<column name="at_type"[\s\S]*<column name="at_type"[\s\S]*<\/loadData>/);
    runResult.assertFileContent(changelogPath, /<column name="at_type" type="varchar\(31\)">/);
  });

  it('includes configured discriminator literals even when direct child entities are present', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240203000000_added_entity_EntityRefOrValue.xml`;
    runResult.assertFileContent(
      changelogPath,
      /CHECK \(at_type IN \((?:'|&#39;)ConcreteRef(?:'|&#39;), (?:'|&#39;)ExternalRef(?:'|&#39;)\)\)/,
    );
  });

  it('writes a parent foreign key for joined-inheritance children without relationships', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240203000100_added_entity_constraints_ConcreteRef.xml`;
    runResult.assertFileContent(changelogPath, '<addForeignKeyConstraint baseColumnNames="id"');
    runResult.assertFileContent(changelogPath, 'baseTableName="concrete_ref"');
    runResult.assertFileContent(changelogPath, 'referencedTableName="entity_ref_or_value"');
  });
});
