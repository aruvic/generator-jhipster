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
  /base-resources:
    post:
      operationId: createBaseResource
      tags: [resources]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BaseResource_FVO'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BaseResource'
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
          required: [childValue]
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
    expect(operation?.requestBodyExample).toEqual(
      expect.objectContaining({
        '@type': 'ConcreteResource',
        source: expect.objectContaining({ '@type': 'EntityRef' }),
      }),
    );
    expect(nestedUnionDiscriminator?.discriminatorValues?.[0]).toBe('PartyRef');
    expect(nestedUnionDiscriminator?.example).toBe('PartyRef');
    expect(implicitReferenceDiscriminator?.discriminatorValues?.[0]).toBe('EntityRef');
    expect(implicitReferenceDiscriminator?.example).toBe('EntityRef');
    expect(operation?.responseStatusCodes).toEqual(['201']);

    const baseOperation = operations.find(candidate => candidate.operationId === 'createBaseResource');
    expect(baseOperation?.requestBodyExample).toEqual(
      expect.objectContaining({
        '@type': 'ConcreteResource',
        childValue: 'string',
      }),
    );
    expect(baseOperation?.requestBodyFields?.find(field => field.name === '@type')?.example).toBe('ConcreteResource');
    expect(baseOperation?.requestBodyFields?.find(field => field.name === 'childValue')?.required).toBe(true);
  });

  it('uses a referenced concrete example to disambiguate an abstract request body and retains an ambiguous base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Abstract request metadata regression
  version: 1.0.0
paths:
  /resources:
    post:
      operationId: createResource
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Resource_FVO'
            examples:
              physical:
                $ref: '#/components/examples/CreatePhysicalResource'
      responses:
        '201':
          description: Created
  /ambiguous-resources:
    post:
      operationId: createAmbiguousResource
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Resource_FVO'
      responses:
        '201':
          description: Created
components:
  schemas:
    Entity:
      type: object
      properties:
        '@type':
          type: string
    Resource_FVO:
      discriminator:
        propertyName: '@type'
        mapping:
          Resource: '#/components/schemas/Resource_FVO'
          LogicalResource: '#/components/schemas/LogicalResource_FVO'
          PhysicalResource: '#/components/schemas/PhysicalResource_FVO'
      allOf:
        - $ref: '#/components/schemas/Entity'
        - type: object
          properties:
            name:
              type: string
    LogicalResource_FVO:
      allOf:
        - $ref: '#/components/schemas/Resource_FVO'
        - type: object
          properties:
            logicalId:
              type: string
    PhysicalResource_FVO:
      allOf:
        - $ref: '#/components/schemas/Resource_FVO'
        - type: object
          required: [serialNumber]
          properties:
            serialNumber:
              type: string
  examples:
    CreatePhysicalResource:
      value:
        '@type': PhysicalResource
        name: Router
        serialNumber: EQ-123
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    const concreteOperation = operations.find(candidate => candidate.operationId === 'createResource');
    expect(concreteOperation?.requestBodyExample).toEqual({
      '@type': 'PhysicalResource',
      name: 'Router',
      serialNumber: 'EQ-123',
    });
    expect(concreteOperation?.requestBodyFields?.find(field => field.name === '@type')?.example).toBe('PhysicalResource');
    expect(concreteOperation?.requestBodyFields?.find(field => field.name === 'serialNumber')?.required).toBe(true);
    expect(concreteOperation?.requestBodyFields?.map(field => field.name)).not.toContain('logicalId');

    const ambiguousOperation = operations.find(candidate => candidate.operationId === 'createAmbiguousResource');
    expect(ambiguousOperation?.requestBodyExample).toEqual(expect.objectContaining({ '@type': 'Resource', name: 'string' }));
    expect(ambiguousOperation?.requestBodyFields?.map(field => field.name)).not.toEqual(
      expect.arrayContaining(['logicalId', 'serialNumber']),
    );
  });

  it('sanitizes explicit request examples against the concrete schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Explicit example validation regression
  version: 1.0.0
paths:
  /events:
    post:
      operationId: createEvent
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CorrectEvent'
            example:
              '@type': WrongEvent
              title: Keep this title
              event: {}
      responses:
        '204':
          description: Accepted
components:
  schemas:
    BaseEvent:
      discriminator:
        propertyName: '@type'
        mapping:
          WrongEvent: '#/components/schemas/WrongEvent'
          CorrectEvent: '#/components/schemas/CorrectEvent'
      required: ['@type']
      type: object
      properties:
        '@type':
          type: string
        title:
          type: string
    WrongEvent:
      allOf:
        - $ref: '#/components/schemas/BaseEvent'
    CorrectEvent:
      allOf:
        - $ref: '#/components/schemas/BaseEvent'
        - type: object
          required: [event]
          properties:
            event:
              $ref: '#/components/schemas/CorrectPayload'
    CorrectPayload:
      required: [resource]
      type: object
      properties:
        resource:
          $ref: '#/components/schemas/ResourceFVO'
    ResourceFVO:
      discriminator:
        propertyName: '@type'
        mapping:
          Resource: '#/components/schemas/ResourceFVO'
      required: ['@type', name]
      type: object
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

    expect(operations.find(candidate => candidate.operationId === 'createEvent')?.requestBodyExample).toEqual({
      '@type': 'CorrectEvent',
      title: 'Keep this title',
      event: {
        resource: {
          '@type': 'Resource',
          name: 'string',
        },
      },
    });
  });

  it('uses typed explicit discriminators to select request example and field branches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Typed discriminator metadata regression
  version: 1.0.0
paths:
  /equipment:
    post:
      operationId: createEquipment
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [items]
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/EquipmentChoice'
            example:
              items:
                - isOwned: false
                  equipmentReference: EQ-123
      responses:
        '204':
          description: Accepted
  /targets:
    post:
      operationId: createTarget
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TargetChoice'
            example:
              kind: reference
              referenceValue: REF-123
      responses:
        '204':
          description: Accepted
components:
  schemas:
    EquipmentChoice:
      type: object
      discriminator:
        propertyName: isOwned
        mapping:
          'true': '#/components/schemas/OwnedEquipment'
          'false': '#/components/schemas/ReferencedEquipment'
      oneOf:
        - $ref: '#/components/schemas/OwnedEquipment'
        - $ref: '#/components/schemas/ReferencedEquipment'
    OwnedEquipment:
      type: object
      required: [isOwned, equipment]
      properties:
        isOwned:
          type: boolean
          example: true
        equipment:
          type: string
    ReferencedEquipment:
      type: object
      required: [isOwned, equipmentReference]
      properties:
        isOwned:
          type: boolean
          example: false
        equipmentReference:
          type: string
    TargetChoice:
      type: object
      discriminator:
        propertyName: kind
        mapping:
          inline: '#/components/schemas/InlineTarget'
          reference: '#/components/schemas/ReferenceTarget'
      anyOf:
        - $ref: '#/components/schemas/InlineTarget'
        - $ref: '#/components/schemas/ReferenceTarget'
    InlineTarget:
      type: object
      required: [kind, inlineValue]
      properties:
        kind:
          type: string
          example: inline
        inlineValue:
          type: string
    ReferenceTarget:
      type: object
      required: [kind, referenceValue]
      properties:
        kind:
          type: string
          example: reference
        referenceValue:
          type: string
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    const booleanOperation = operations.find(candidate => candidate.operationId === 'createEquipment');
    const itemFields = booleanOperation?.requestBodyFields?.find(field => field.name === 'items')?.items?.fields ?? [];
    const booleanDiscriminator = itemFields.find(field => field.name === 'isOwned');

    expect(booleanOperation?.requestBodyExample).toEqual({
      items: [{ isOwned: false, equipmentReference: 'EQ-123' }],
    });
    expect(booleanDiscriminator?.type).toBe('boolean');
    expect(booleanDiscriminator?.example).toBe(false);
    expect(itemFields.map(field => field.name)).toEqual(expect.arrayContaining(['isOwned', 'equipmentReference']));
    expect(itemFields.find(field => field.name === 'equipmentReference')?.required).toBe(true);
    expect(itemFields.map(field => field.name)).not.toContain('equipment');

    const stringOperation = operations.find(candidate => candidate.operationId === 'createTarget');
    const stringFieldNames = stringOperation?.requestBodyFields?.map(field => field.name) ?? [];

    expect(stringOperation?.requestBodyExample).toEqual({ kind: 'reference', referenceValue: 'REF-123' });
    expect(stringOperation?.requestBodyFields?.find(field => field.name === 'kind')?.example).toBe('reference');
    expect(stringFieldNames).toEqual(expect.arrayContaining(['kind', 'referenceValue']));
    expect(stringFieldNames).not.toContain('inlineValue');
  });

  it('sanitizes retained items after applying an explicit example array limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-operations-'));
    const apiPath = join(dir, 'api.yml');
    writeFileSync(
      apiPath,
      `
openapi: 3.0.3
info:
  title: Bounded array example regression
  version: 1.0.0
paths:
  /items:
    post:
      operationId: createItems
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: array
              maxItems: 1
              items:
                type: object
                required: [kind]
                properties:
                  id:
                    type: string
                    readOnly: true
                  kind:
                    type: string
                    enum: [valid]
            example:
              - id: server-owned
                kind: invalid
              - id: discarded
                kind: valid
      responses:
        '204':
          description: Accepted
`,
    );

    const operations = loadOpenApiOperations(
      { destinationPath: (value: string) => (value === 'src/main/resources/swagger/api.yml' ? apiPath : join(dir, value)) },
      angularApplication,
    );

    expect(operations.find(candidate => candidate.operationId === 'createItems')?.requestBodyExample).toEqual([{ kind: 'valid' }]);
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
      items: [
        { service: { serviceSpecification: { '@type': 'ServiceSpecificationRef', href: '/serviceSpecification/1', name: 'Fiber' } } },
      ],
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
    let child = operations
      .find(candidate => candidate.operationId === 'createNode')
      ?.requestBodyFields?.find(field => field.name === 'child');
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
    let target = operations
      .find(candidate => candidate.operationId === 'createOrder')
      ?.requestBodyFields?.find(field => field.name === 'target');
    while (target?.fields?.some(field => field.name === 'next')) {
      target = target.fields.find(field => field.name === 'next');
    }

    expect(target?.type).toBe('object');
    expect(target?.example).toEqual(expect.objectContaining({ '@type': 'Ref' }));
  });
});
