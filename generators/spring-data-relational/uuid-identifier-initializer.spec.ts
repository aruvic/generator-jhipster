import { before, describe, it } from 'esmocha';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';

const GENERATOR = 'jhipster:spring-data-relational';

const applicationConfig = {
  baseName: 'uuididentifierinitializer',
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
};

const requiredIdentifierEntity = {
  name: 'EntityRefOrValue',
  changelogDate: '20250201000000',
  entityTableName: 'entity_ref_or_value',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  abstract: true,
  discriminator: {
    column: 'atType',
    type: 'String',
    values: 'EntityRefOrValue->EntityRefOrValue',
  },
  fields: [
    { fieldName: 'atType', fieldType: 'String', fieldValidateRules: ['required'] },
    { fieldName: 'externalId', fieldType: 'UUID', fieldValidateRules: ['required'] },
  ],
  relationships: [],
};

const optionalIdentifierEntity = {
  name: 'SampleEntity',
  changelogDate: '20250201000001',
  entityTableName: 'sample_entity',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  fields: [
    { fieldName: 'name', fieldType: 'String' },
    { fieldName: 'externalId', fieldType: 'UUID' },
  ],
  relationships: [],
};

const childWithInheritedIdentifierMetadata = {
  name: 'ChildEntityRef',
  changelogDate: '20250201000002',
  entityTableName: 'child_entity_ref',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  extends: requiredIdentifierEntity.name,
  fields: [
    { fieldName: 'externalId', fieldType: 'UUID', fieldValidateRules: ['required'] },
    { fieldName: 'description', fieldType: 'String' },
  ],
  relationships: [],
};

describe(`generator - ${GENERATOR} UUID identifier initializer`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [
        requiredIdentifierEntity as any,
        optionalIdentifierEntity as any,
        childWithInheritedIdentifierMetadata as any,
      ])
      .withMockedSource({ except: ['addTestSpringFactory'] });
  });

  it('initializes a required UUID identifier when it is missing', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/EntityRefOrValue.java';
    runResult.assertFileContent(
      entityPath,
      /@PrePersist\s+protected void ensureGeneratedUuidIdentifiers\(\) {\s+if \(this\.getExternalId\(\) == null\) {\s+this\.setExternalId\(java\.util\.UUID\.randomUUID\(\)\);\s+}\s+}/,
    );
  });

  it('uses accessors for inherited UUID identifier metadata', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/ChildEntityRef.java';
    runResult.assertFileContent(
      entityPath,
      /@PrePersist\s+protected void ensureGeneratedUuidIdentifiers\(\) {\s+if \(this\.getExternalId\(\) == null\) {\s+this\.setExternalId\(java\.util\.UUID\.randomUUID\(\)\);\s+}\s+}/,
    );
    runResult.assertNoFileContent(entityPath, /this\.externalId/);
  });

  it('does not emit the initializer when the UUID identifier is optional', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/SampleEntity.java';
    runResult.assertNoFileContent(entityPath, /@PrePersist\s+protected void ensureGeneratedUuidIdentifiers/);
  });
});
