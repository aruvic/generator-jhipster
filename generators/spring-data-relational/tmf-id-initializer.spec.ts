import { before, describe, it } from 'esmocha';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';

const GENERATOR = 'jhipster:spring-data-relational';

const applicationConfig = {
  baseName: 'tmfidinitializer',
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

const tmfEntity = {
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
    { fieldName: 'tmfId', fieldType: 'UUID', fieldValidateRules: ['required'] },
  ],
  relationships: [],
};

const optionalTmfEntity = {
  name: 'SampleEntity',
  changelogDate: '20250201000001',
  entityTableName: 'sample_entity',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  fields: [
    { fieldName: 'name', fieldType: 'String' },
    { fieldName: 'tmfId', fieldType: 'UUID' },
  ],
  relationships: [],
};

describe(`generator - ${GENERATOR} tmfId initializer`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [tmfEntity as any, optionalTmfEntity as any])
      .withMockedSource({ except: ['addTestSpringFactory'] });
  });

  it('initializes tmfId when the required UUID is missing', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/EntityRefOrValue.java';
    runResult.assertFileContent(
      entityPath,
      /@PrePersist\s+protected void ensureTmfId\(\) {\s+if \(this\.tmfId == null\) {\s+this\.tmfId = java\.util\.UUID\.randomUUID\(\);\s+}\s+}/,
    );
  });

  it('does not emit the initializer when tmfId is optional', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/SampleEntity.java';
    runResult.assertNoFileContent(entityPath, /@PrePersist\s+protected void ensure/);
  });
});
