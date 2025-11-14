import { before, describe, it } from 'esmocha';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';

const GENERATOR = 'jhipster:spring-data-relational';

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
};

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
  ],
  relationships: [],
};

describe(`generator - ${GENERATOR} duplicate columns`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [duplicateColumnEntity as any])
      .withMockedSource({ except: ['addTestSpringFactory'] });
  });

  it('marks duplicate column mappings as read-only mirrors', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/TypeCarrier.java';
    runResult.assertNoFileContent(
      entityPath,
      /@Column\(\s+name = "type_key"[\s\S]+insertable = false[\s\S]+private String typeKey;/,
    );
    runResult.assertFileContent(
      entityPath,
      /@Column\(\s+name = "type_key"[\s\S]+insertable = false[\s\S]+updatable = false[\s\S]+private String typeKeyAlias;/,
    );
  });
});
