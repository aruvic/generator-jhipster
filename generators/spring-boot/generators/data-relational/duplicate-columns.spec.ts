import { before, describe, it } from 'esmocha';

import type { ConfigAll } from '../../../../lib/types/command-all.d.ts';

import { defaultHelpers as helpers, runResult } from '#testing';

const GENERATOR = 'jhipster:spring-boot:data-relational';

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
    values: 'EntityRefOrValue->EntityRefOrValue',
  },
  fields: [
    { fieldName: 'atType', fieldType: 'String', fieldValidateRules: ['required'] },
    { fieldName: 'description', fieldType: 'String' },
  ],
  relationships: [],
};

const booleanDiscriminatorEntity = {
  name: 'UtilizedTransportEquipment',
  changelogDate: '20240204000000',
  entityTableName: 'utilized_transport_equipment',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  abstract: true,
  discriminator: {
    column: 'isShipperOwned',
    type: 'Boolean',
    values: 'true->UtEquipment, false->UtEquipmentReference',
  },
  fields: [
    { fieldName: 'isShipperOwned', fieldType: 'Boolean', fieldValidateRules: ['required'] },
    { fieldName: 'description', fieldType: 'String' },
  ],
  relationships: [],
};

describe(`generator - ${GENERATOR} duplicate columns`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [
        duplicateColumnEntity as any,
        discriminatorColumnEntity as any,
        booleanDiscriminatorEntity as any,
      ])
      .withMockedSource({ except: ['addTestSpringFactory'] });
  });

  it('marks duplicate column mappings as read-only mirrors', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/TypeCarrier.java';
    runResult.assertNoFileContent(entityPath, /@Column\(\s+name = "type_key"[\s\S]+insertable = false[\s\S]+private String typeKey;/);
    runResult.assertFileContent(
      entityPath,
      /@Column\(\s+name = "type_key"[\s\S]+insertable = false[\s\S]+updatable = false[\s\S]+private String typeKeyAlias;/,
    );
  });

  it('marks explicit discriminator column fields as read-only mirrors', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/EntityRefOrValue.java';
    runResult.assertFileContent(
      entityPath,
      /@Column\(\s+name = "at_type"[\s\S]+nullable = false[\s\S]+insertable = false[\s\S]+updatable = false[\s\S]+private String atType;/,
    );
  });

  it('keeps a declared field writable and relocates the discriminator column when the field cannot carry type tags', () => {
    const entityPath = 'src/main/java/com/mycompany/myapp/domain/UtilizedTransportEquipment.java';
    runResult.assertFileContent(entityPath, /@DiscriminatorColumn\(\s+name = "dtype"/);
    runResult.assertNoFileContent(entityPath, /@DiscriminatorColumn\(\s+name = "is_shipper_owned"/);
    runResult.assertNoFileContent(
      entityPath,
      /@Column\(\s+name = "is_shipper_owned"[\s\S]+insertable = false[\s\S]+private Boolean isShipperOwned;/,
    );
    runResult.assertFileContent(entityPath, /private Boolean isShipperOwned;/);
  });
});
