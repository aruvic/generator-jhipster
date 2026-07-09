import { describe, expect, it } from 'esmocha';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadOpenApiOperations } from './files-angular.ts';

const angularApplication = { angularLocaleId: 'en' } as any;

describe('angular OpenAPI operation metadata', () => {
  it('prefers concrete request-body discriminator values over inherited base mapping values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Discriminator metadata regression
  version: 1.0.0
paths:
  /resources:
    post:
      operationId: createResource
      tags: [resources]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ConcreteResource_FVO'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ConcreteResource'
components:
  schemas:
    Entity_FVO:
      type: object
      properties:
        '@type':
          type: string
    BaseResource_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          BaseResource: '#/components/schemas/BaseResource_FVO'
          ConcreteResource: '#/components/schemas/ConcreteResource_FVO'
      allOf:
        - $ref: '#/components/schemas/Entity_FVO'
        - type: object
          required: [name]
          properties:
            name:
              type: string
    ConcreteResource_FVO:
      allOf:
        - $ref: '#/components/schemas/BaseResource_FVO'
        - type: object
          properties:
            childValue:
              type: string
            relatedPartys:
              type: array
              minItems: 1
              items:
                $ref: '#/components/schemas/RelatedPartyRefOrPartyRoleRef_FVO'
            source:
              $ref: '#/components/schemas/EntityRef_FVO'
    Extensible_FVO:
      required: ['@type']
      type: object
      properties:
        '@type':
          type: string
          example: string
    EntityRef_FVO:
      allOf:
        - $ref: '#/components/schemas/Extensible_FVO'
        - type: object
          properties:
            href:
              type: string
            name:
              type: string
    RelatedPartyRefOrPartyRoleRef_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          RelatedPartyRefOrPartyRoleRef: '#/components/schemas/RelatedPartyRefOrPartyRoleRef_FVO'
      type: object
      properties:
        '@type':
          type: string
        role:
          type: string
        partyOrPartyRole:
          $ref: '#/components/schemas/PartyRefOrPartyRoleRef_FVO'
    PartyRefOrPartyRoleRef_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          PartyRef: '#/components/schemas/PartyRef_FVO'
          PartyRoleRef: '#/components/schemas/PartyRoleRef_FVO'
      oneOf:
        - $ref: '#/components/schemas/PartyRef_FVO'
        - $ref: '#/components/schemas/PartyRoleRef_FVO'
    PartyRef_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          PartyRef: '#/components/schemas/PartyRef_FVO'
      type: object
      properties:
        '@type':
          type: string
        name:
          type: string
    PartyRoleRef_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          PartyRoleRef: '#/components/schemas/PartyRoleRef_FVO'
      type: object
      properties:
        '@type':
          type: string
        name:
          type: string
    BaseResource:
      discriminator:
        propertyName: '@type'
        mapping:
          BaseResource: '#/components/schemas/BaseResource'
          ConcreteResource: '#/components/schemas/ConcreteResource'
      type: object
      properties:
        '@type':
          type: string
        name:
          type: string
    ConcreteResource:
      allOf:
        - $ref: '#/components/schemas/BaseResource'
        - type: object
          properties:
            childValue:
              type: string
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    const operation = operations.find(candidate => candidate.operationId === 'createResource');
    const discriminatorField = operation?.requestBodyFields?.find(field => field.name === '@type');
    const nestedUnionDiscriminator = operation?.requestBodyFields
      ?.find(field => field.name === 'relatedPartys')
      ?.items?.fields?.find(field => field.name === 'partyOrPartyRole')
      ?.fields?.find(field => field.name === '@type');
    const implicitReferenceDiscriminator = operation?.requestBodyFields
      ?.find(field => field.name === 'source')
      ?.fields?.find(field => field.name === '@type');

    expect(discriminatorField?.discriminatorValues?.[0]).toBe('ConcreteResource');
    expect(discriminatorField?.example).toBe('ConcreteResource');
    expect(nestedUnionDiscriminator?.discriminatorValues?.[0]).toBe('PartyRef');
    expect(nestedUnionDiscriminator?.example).toBe('PartyRef');
    expect(implicitReferenceDiscriminator?.discriminatorValues?.[0]).toBe('EntityRef');
    expect(implicitReferenceDiscriminator?.example).toBe('EntityRef');
  });

  it('merges concrete discriminator branch fields with parent-owned allOf properties for request forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Composed branch metadata regression
  version: 1.0.0
paths:
  /items:
    post:
      operationId: createItem
      tags: [items]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Item'
      responses:
        '201':
          description: Created
components:
  schemas:
    BaseItem:
      required: [name, kind]
      type: object
      properties:
        id:
          type: integer
          readOnly: true
        name:
          type: string
        kind:
          type: string
          enum: [specific]
    SpecificItem:
      allOf:
        - $ref: '#/components/schemas/BaseItem'
        - type: object
          properties:
            branchValue:
              type: string
    Item:
      allOf:
        - discriminator:
            propertyName: kind
            mapping:
              specific: '#/components/schemas/SpecificItem'
          oneOf:
            - $ref: '#/components/schemas/SpecificItem'
        - type: object
          properties:
            parentValue:
              type: string
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    const operation = operations.find(candidate => candidate.operationId === 'createItem');
    const fieldNames = operation?.requestBodyFields?.map(field => field.name) ?? [];

    expect(fieldNames).toEqual(expect.arrayContaining(['name', 'kind', 'branchValue', 'parentValue']));
    expect(fieldNames).not.toContain('id');
    expect(operation?.requestBodyFields?.find(field => field.name === 'name')?.required).toBe(true);
    expect(operation?.requestBodyFields?.find(field => field.name === 'kind')?.discriminatorValues).toContain('specific');
  });

  it('preserves bounded request body examples for compacted operation forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Request example metadata regression
  version: 1.0.0
paths:
  /orders:
    post:
      operationId: createOrder
      tags: [orders]
      requestBody:
        required: true
        content:
          application/json:
            example:
              items:
                - service:
                    serviceSpecification:
                      '@type': ServiceSpecificationRef
                      href: /serviceSpecification/1
                      name: Fiber
            schema:
              type: object
              required: [items]
              properties:
                items:
                  type: array
                  items:
                    type: object
                    properties:
                      service:
                        type: object
                        properties:
                          serviceSpecification:
                            type: object
      responses:
        '201':
          description: Created
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    expect(operations.find(candidate => candidate.operationId === 'createOrder')?.requestBodyExample).toEqual({
      items: [{ service: { serviceSpecification: { '@type': 'ServiceSpecificationRef', href: '/serviceSpecification/1', name: 'Fiber' } } }],
    });
  });

  it('preserves deep nested object fields and discriminator metadata for operation forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Deep form metadata regression
  version: 1.0.0
paths:
  /documents:
    post:
      operationId: createDocument
      tags: [documents]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DocumentRequest'
      responses:
        '201':
          description: Created
components:
  schemas:
    DocumentRequest:
      type: object
      properties:
        level1:
          $ref: '#/components/schemas/Level1'
    Level1:
      type: object
      properties:
        level2:
          $ref: '#/components/schemas/Level2'
    Level2:
      type: object
      properties:
        level3:
          $ref: '#/components/schemas/Level3'
    Level3:
      type: object
      properties:
        level4:
          $ref: '#/components/schemas/Level4'
    Level4:
      type: object
      properties:
        level5:
          $ref: '#/components/schemas/Level5'
    Level5:
      type: object
      properties:
        level6:
          $ref: '#/components/schemas/Level6'
    Level6:
      type: object
      properties:
        level7:
          $ref: '#/components/schemas/Level7'
    Level7:
      type: object
      properties:
        containers:
          type: array
          items:
            $ref: '#/components/schemas/Container'
    Container:
      type: object
      properties:
        cargoGrossWeight:
          $ref: '#/components/schemas/Measurement'
        characteristics:
          type: array
          items:
            $ref: '#/components/schemas/Characteristic'
    Measurement:
      type: object
      required: [value, unit]
      properties:
        value:
          type: number
        unit:
          type: string
    Characteristic:
      discriminator:
        propertyName: '@type'
        mapping:
          StringCharacteristic: '#/components/schemas/StringCharacteristic'
      oneOf:
        - $ref: '#/components/schemas/StringCharacteristic'
    StringCharacteristic:
      type: object
      properties:
        '@type':
          type: string
        name:
          type: string
        value:
          type: string
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    const container = operations
      .find(candidate => candidate.operationId === 'createDocument')
      ?.requestBodyFields?.find(field => field.name === 'level1')
      ?.fields?.find(field => field.name === 'level2')
      ?.fields?.find(field => field.name === 'level3')
      ?.fields?.find(field => field.name === 'level4')
      ?.fields?.find(field => field.name === 'level5')
      ?.fields?.find(field => field.name === 'level6')
      ?.fields?.find(field => field.name === 'level7')
      ?.fields?.find(field => field.name === 'containers')?.items;
    const weight = container?.fields?.find(field => field.name === 'cargoGrossWeight');
    const characteristicType = container?.fields
      ?.find(field => field.name === 'characteristics')
      ?.items?.fields?.find(field => field.name === '@type');

    expect(weight?.type).toBe('object');
    expect(weight?.fields?.map(field => field.name)).toEqual(expect.arrayContaining(['value', 'unit']));
    expect(characteristicType?.discriminatorValues).toContain('StringCharacteristic');
    expect(characteristicType?.example).toBe('StringCharacteristic');
  });

  it('preserves discriminator examples on recursive object references cut from operation forms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Recursive form metadata regression
  version: 1.0.0
paths:
  /nodes:
    post:
      operationId: createNode
      tags: [nodes]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Node'
      responses:
        '201':
          description: Created
components:
  schemas:
    Node:
      type: object
      required: ['@type']
      properties:
        '@type':
          type: string
        child:
          $ref: '#/components/schemas/Node'
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );
    let child = operations.find(candidate => candidate.operationId === 'createNode')?.requestBodyFields?.find(field => field.name === 'child');
    while (child?.fields?.some(field => field.name === 'child')) {
      child = child.fields.find(field => field.name === 'child');
    }

    expect(child?.type).toBe('object');
    expect(child?.fields).toBeUndefined();
    expect(child?.example).toEqual(expect.objectContaining({ '@type': 'Node' }));
  });

  it('uses concrete discriminator examples for oneOf wrapper references', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Polymorphic wrapper form metadata regression
  version: 1.0.0
paths:
  /orders:
    post:
      operationId: createOrder
      tags: [orders]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [target]
              properties:
                target:
                  $ref: '#/components/schemas/RefOrValue'
      responses:
        '201':
          description: Created
components:
  schemas:
    RefOrValue:
      type: object
      discriminator:
        propertyName: '@type'
        mapping:
          Ref: '#/components/schemas/Ref'
          Value: '#/components/schemas/Value'
      oneOf:
        - $ref: '#/components/schemas/Ref'
        - $ref: '#/components/schemas/Value'
    Ref:
      type: object
      required: ['@type']
      properties:
        '@type':
          type: string
        href:
          type: string
        next:
          $ref: '#/components/schemas/RefOrValue'
    Value:
      type: object
      required: ['@type']
      properties:
        '@type':
          type: string
        name:
          type: string
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );
    let target = operations.find(candidate => candidate.operationId === 'createOrder')?.requestBodyFields?.find(field => field.name === 'target');
    while (target?.fields?.some(field => field.name === 'next')) {
      target = target.fields.find(field => field.name === 'next');
    }

    expect(target?.type).toBe('object');
    expect(target?.example).toEqual(expect.objectContaining({ '@type': 'Ref' }));
  });
});
