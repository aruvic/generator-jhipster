import { before, describe, expect, it } from 'esmocha';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';
import { SERVER_MAIN_RES_DIR } from '../generator-constants.js';

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

const readChangelog = (relativePath: string) => readFileSync(join(runResult.cwd, relativePath), 'utf-8');
const countColumnOccurrences = (content: string, columnName: string) =>
  (content.match(new RegExp(`<column name="${columnName}"`, 'g')) ?? []).length;

describe(`generator - ${GENERATOR} duplicate columns`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [duplicateColumnEntity as any, discriminatorColumnEntity as any]);
  });

  it('writes each mirrored column only once', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240202000000_added_entity_TypeCarrier.xml`;
    const changelogContent = readChangelog(changelogPath);
    expect(countColumnOccurrences(changelogContent, 'type_key')).to.equal(1);
  });

  it('does not duplicate discriminator columns', () => {
    const changelogPath = `${SERVER_MAIN_RES_DIR}config/liquibase/changelog/20240203000000_added_entity_EntityRefOrValue.xml`;
    const changelogContent = readChangelog(changelogPath);
    expect(countColumnOccurrences(changelogContent, 'at_type')).to.equal(1);
    expect(changelogContent).to.match(/<column name="at_type" type="varchar\(31\)">/);
  });
});
