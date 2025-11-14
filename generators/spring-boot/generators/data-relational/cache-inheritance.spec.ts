import { before, describe, it } from 'esmocha';

import { defaultHelpers as helpers, runResult } from '../../lib/testing/index.ts';

const GENERATOR = 'jhipster:spring-data-relational';

const applicationConfig = {
  baseName: 'inheritance',
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

const attachmentRoot = {
  name: 'AttachmentRefOrValue',
  changelogDate: '20240201000000',
  entityTableName: 'attachment_ref_or_value',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  abstract: true,
  discriminator: {
    column: 'atType',
    type: 'String',
    values: 'Attachment->Attachment, AttachmentRef->AttachmentRef',
  },
  fields: [
    { fieldName: 'tmfId', fieldType: 'UUID', fieldValidateRules: ['required'] },
    { fieldName: 'name', fieldType: 'String' },
  ],
  relationships: [],
};

const attachmentChild = {
  name: 'Attachment',
  changelogDate: '20240201000001',
  entityTableName: 'attachment',
  dto: 'no',
  service: 'no',
  pagination: 'no',
  applications: [applicationConfig.baseName],
  extends: attachmentRoot.name,
  discriminatorValue: 'Attachment',
  fields: [{ fieldName: 'content', fieldType: 'String' }],
  relationships: [],
};

describe(`generator - ${GENERATOR} hibernate cache inheritance`, () => {
  before(async () => {
    await helpers
      .runJHipster(GENERATOR)
      .withJHipsterConfig(applicationConfig, [attachmentRoot as any, attachmentChild as any])
      .withMockedSource({ except: ['addTestSpringFactory'] });
  });

  it('only emits @Cache on the inheritance root', () => {
    const rootPath = 'src/main/java/com/mycompany/myapp/domain/AttachmentRefOrValue.java';
    const childPath = 'src/main/java/com/mycompany/myapp/domain/Attachment.java';

    runResult.assertFileContent(rootPath, '@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)');
    const childSnapshotMap = runResult.getStateSnapshot('src/main/java/**/Attachment.java');
    const childSnapshot = Object.values(childSnapshotMap)[0];
    if (childSnapshot) {
      // eslint-disable-next-line no-console
      console.log(childSnapshot.contents);
    }
    if (runResult.entities?.Attachment) {
      // eslint-disable-next-line no-console
      console.log(
        'extends',
        runResult.entities.Attachment.extends,
        'parent',
        runResult.entities.Attachment.parentEntity?.name,
        'polymorphicChild',
        runResult.entities.Attachment.polymorphicChild,
        'hasParentEntity',
        runResult.entities.Attachment.hasParentEntity,
      );
    }
    runResult.assertNoFileContent(childPath, '@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)');
  });
});
