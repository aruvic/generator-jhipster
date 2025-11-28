/**
 * Copyright 2013-2025 the original author or authors from the JHipster project.
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

import { describe, expect, it } from 'esmocha';

import { generateHybridMappers } from './hybrid-mapper-generator.ts';
import type { ParsedOpenAPISpec } from './openapi-mapper-generator.ts';
import type { OperationDescriptor } from './openapi-entity-matcher.ts';

describe('Hybrid mapper generator', () => {
  it('creates helper mappers for discriminator-only polymorphic schemas', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Party: {
          discriminator: {
            propertyName: '@type',
            mapping: {
              Party: '#/components/schemas/Party',
              Organization: '#/components/schemas/Organization',
              Individual: '#/components/schemas/Individual',
            },
          },
          allOf: [
            { $ref: '#/components/schemas/Entity' },
            {
              type: 'object',
              properties: {
                relatedPartys: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Party' },
                },
              },
            },
          ],
        },
        Organization: {
          allOf: [
            { $ref: '#/components/schemas/Party' },
            { type: 'object', properties: { name: { type: 'string' } } },
          ],
        },
        Individual: {
          allOf: [
            { $ref: '#/components/schemas/Party' },
            { type: 'object', properties: { givenName: { type: 'string' } } },
          ],
        },
        Entity: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };

    const { helperMappers } = generateHybridMappers(spec, 'com.example');
    expect(helperMappers.some(mapper => mapper.mapperName === 'PartyMapper')).toBe(true);
  });

  it('maps FVO and MVO requests to domain and responds with base DTO only', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/party-interactions',
          method: 'POST',
          requestBodySchema: 'PartyInteractionFVO',
          responseSchema: 'PartyInteraction',
        },
        {
          path: '/party-interactions/{id}',
          method: 'PUT',
          requestBodySchema: 'PartyInteractionMVO',
          responseSchema: 'PartyInteraction',
        },
      ],
      schemas: {
        PartyInteraction: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        PartyInteractionFVO: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        PartyInteractionMVO: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const mapper = entityMappers.find(m => m.entityName === 'PartyInteraction');

    expect(mapper).toBeDefined();
    const requestSources = mapper?.requestMappings.map(m => m.sourceType) ?? [];
    expect(requestSources).toContain('eu.example.app.service.api.dto.PartyInteractionFVO');
    expect(requestSources).toContain('eu.example.app.service.api.dto.PartyInteractionMVO');
    expect(requestSources).not.toContain('eu.example.app.service.api.dto.PartyInteraction');

    const fvoMapping = mapper?.requestMappings.find(m => m.sourceType.endsWith('PartyInteractionFVO'));
    expect(fvoMapping?.annotations?.some(a => a.includes('id'))).toBe(true);

    const responseTargets = mapper?.responseMappings.map(m => m.targetType) ?? [];
    expect(responseTargets).toEqual(['eu.example.app.service.api.dto.PartyInteraction']);
  });

  it('injects referenced entity mappers so nested payloads are mapped', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/party-interaction-events',
          method: 'POST',
          requestBodySchema: 'PartyInteractionCreateEvent',
          responseSchema: 'PartyInteractionCreateEvent',
        },
      ],
      schemas: {
        PartyInteractionCreateEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            event: { $ref: '#/components/schemas/PartyInteractionCreateEventPayload' },
          },
        },
        PartyInteractionCreateEventPayload: {
          type: 'object',
          properties: {
            partyInteraction: { type: 'string' },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const payloadMapper = entityMappers.find(m => m.entityName === 'PartyInteractionCreateEventPayload');
    expect(payloadMapper).toBeDefined();

    const mapper = entityMappers.find(m => m.entityName === 'PartyInteractionCreateEvent');
    expect(mapper?.usesMappers).toContain('eu.example.app.web.api.mapper.PartyInteractionCreateEventPayloadMapper');
  });

  it('attaches object factories for abstract domain targets using discriminator metadata', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/events',
          method: 'POST',
          requestBodySchema: 'BaseEventFVO',
          responseSchema: 'BaseEvent',
        },
      ],
      schemas: {
        BaseEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            eventType: { type: 'string' },
          },
        },
        BaseEventFVO: {
          type: 'object',
          properties: {
            eventType: { type: 'string' },
            event: { type: 'object' },
          },
          discriminator: {
            propertyName: 'eventType',
          },
        },
      },
    };

    const operation = spec.operations[0];
    const descriptor: OperationDescriptor = {
      operation,
      operationType: 'create',
      pathParameters: [],
      requestSchemaNames: ['BaseEventFVO'],
      responseSchemaNames: ['BaseEvent'],
      matchedEntity: {
        name: 'BaseEvent',
        fqcn: 'com.example.domain.BaseEvent',
        entity: {
          name: 'BaseEvent',
          abstract: true,
          discriminator: { property: 'eventType' },
          discriminatorColumn: {
            values: {
              CreateEvent: 'create',
              UpdateEvent: 'update',
            },
          },
          childEntities: [
            { name: 'CreateEvent', discriminatorValue: 'create' },
            { name: 'UpdateEvent', discriminatorValue: 'update' },
          ],
        },
      },
      requestEntityMatch: undefined,
      responseEntityMatch: undefined,
      resourceName: 'BaseEvent',
    } as OperationDescriptor;

    const descriptors = new Map([[operation, descriptor]]);
    const { entityMappers } = generateHybridMappers(spec, 'com.example', descriptors);
    const mapper = entityMappers.find(m => m.entityName === 'BaseEvent');
    expect(mapper).toBeDefined();
    expect(mapper?.objectFactories?.length).toBeGreaterThan(0);
    expect(mapper?.objectFactories?.[0].variants).toHaveLength(2);
    const variantNames = mapper?.objectFactories?.[0].variants.map(v => v.instantiationType) ?? [];
    expect(variantNames).toContain('com.example.domain.CreateEvent');
    expect(mapper?.objectFactories?.[0].discriminatorAccessor).toBe('source.getEventType()');
    expect(mapper?.objectFactories?.[0].defaultVariant.instantiationType).toBe('com.example.domain.CreateEvent');
  });

  it('normalizes discriminator accessor names so generated code remains valid Java', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/events',
          method: 'POST',
          requestBodySchema: 'PolymorphicEventFVO',
          responseSchema: 'PolymorphicEvent',
        },
      ],
      schemas: {
        PolymorphicEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            '@type': { type: 'string' },
          },
        },
        PolymorphicEventFVO: {
          type: 'object',
          properties: {
            '@type': { type: 'string' },
            payload: { type: 'object' },
          },
          discriminator: {
            propertyName: '@type',
          },
        },
      },
    };

    const operation = spec.operations[0];
    const descriptor: OperationDescriptor = {
      operation,
      operationType: 'create',
      pathParameters: [],
      requestSchemaNames: ['PolymorphicEventFVO'],
      responseSchemaNames: ['PolymorphicEvent'],
      matchedEntity: {
        name: 'PolymorphicEvent',
        fqcn: 'com.example.domain.PolymorphicEvent',
        entity: {
          name: 'PolymorphicEvent',
          abstract: true,
          discriminator: { property: '@type' },
          discriminatorColumn: {
            values: {
              ConcreteEvent: 'concrete',
            },
          },
          childEntities: [{ name: 'ConcreteEvent', discriminatorValue: 'concrete' }],
        },
      },
      resourceName: 'PolymorphicEvent',
    } as OperationDescriptor;

    const descriptors = new Map([[operation, descriptor]]);
    const { entityMappers } = generateHybridMappers(spec, 'com.example', descriptors);
    const mapper = entityMappers.find(m => m.entityName === 'PolymorphicEvent');
    expect(mapper).toBeDefined();
    const discriminatorAccessor = mapper?.objectFactories?.[0]?.discriminatorAccessor;
    expect(discriminatorAccessor).toBe('source.getType()');
  });

  it('derives abstract target factories from schema discriminators when entity metadata lacks children', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/pets/{id}',
          method: 'PATCH',
          requestBodySchema: 'PetUpdate',
          responseSchema: 'Pet',
        },
      ],
      schemas: {
        Pet: {
          description: 'Pet base type',
          discriminator: {
            propertyName: 'type',
            mapping: {
              dog: 'components.schemas.Dog',
              cat: 'components.schemas.Cat',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Dog' }, { $ref: '#/components/schemas/Cat' }],
        },
        Dog: {
          type: 'object',
          properties: { type: { type: 'string' } },
        },
        Cat: {
          type: 'object',
          properties: { type: { type: 'string' } },
        },
        PetUpdate: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    };

    const operation = spec.operations[0];
    const descriptor: OperationDescriptor = {
      operation,
      operationType: 'patch',
      pathParameters: [],
      requestSchemaNames: ['PetUpdate'],
      responseSchemaNames: ['Pet'],
      matchedEntity: {
        name: 'Pet',
        fqcn: 'com.example.domain.Pet',
        entity: {
          name: 'Pet',
          abstract: true,
        },
      },
      resourceName: 'Pet',
    } as OperationDescriptor;

    const descriptors = new Map([[operation, descriptor]]);
    const { entityMappers } = generateHybridMappers(spec, 'com.example', descriptors);
    const mapper = entityMappers.find(m => m.entityName === 'PetUpdate');
    expect(mapper).toBeDefined();
    const factories = mapper?.objectFactories ?? [];
    expect(factories.length).toBeGreaterThan(0);
    const petFactory = factories.find(factory => factory.returnType === 'com.example.domain.Pet');
    expect(petFactory).toBeDefined();
    expect(petFactory?.variants.map(v => v.instantiationType)).toEqual(
      expect.arrayContaining(['com.example.domain.Dog', 'com.example.domain.Cat']),
    );
    expect(petFactory?.discriminatorAccessor).toBeUndefined();
  });

  it('adds JSON conversion mappings when DTO properties use object payloads', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/party-interaction-events',
          method: 'POST',
          requestBodySchema: 'PartyInteractionEventFVO',
          responseSchema: 'PartyInteractionEvent',
        },
      ],
      schemas: {
        PartyInteractionEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            event: { type: 'object' },
          },
        },
        PartyInteractionEventFVO: {
          type: 'object',
          properties: {
            event: { type: 'object' },
            description: { type: 'string' },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const mapper = entityMappers.find(m => m.entityName === 'PartyInteractionEvent');
    expect(mapper).toBeDefined();
    expect(mapper?.requestMappings?.[0]?.annotations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('mapToJsonString')]),
    );
    expect(mapper?.responseMappings?.[0]?.annotations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('jsonStringToMap')]),
    );
  });

  it('adds JSON conversion mappings using normalized domain property names', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/commodities',
          method: 'POST',
          requestBodySchema: 'CommodityFVO',
          responseSchema: 'Commodity',
        },
      ],
      schemas: {
        Commodity: {
          type: 'object',
          properties: {
            HSCodes: { type: 'object' },
          },
        },
        CommodityFVO: {
          type: 'object',
          properties: {
            HSCodes: { type: 'object' },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const commodityMapper = entityMappers.find(mapper => mapper.entityName === 'Commodity');
    expect(commodityMapper).toBeDefined();
    const requestMapping = commodityMapper?.requestMappings[0];
    const responseMapping = commodityMapper?.responseMappings[0];
    expect(requestMapping?.annotations).toContain(
      '@Mapping(source = "HSCodes", target = "hSCodes", qualifiedByName = "mapToJsonString")',
    );
    expect(responseMapping?.annotations).toContain(
      '@Mapping(source = "hSCodes", target = "HSCodes", qualifiedByName = "jsonStringToMap")',
    );
  });

  it('ignores nested fields backed by abstract RefOrValue schemas so MapStruct compiles', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/certificates',
          method: 'POST',
          requestBodySchema: 'CertificateFVO',
          responseSchema: 'Certificate',
        },
      ],
      schemas: {
        Certificate: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            attachment: { $ref: '#/components/schemas/AttachmentRefOrValue' },
          },
        },
        CertificateFVO: {
          type: 'object',
          properties: {
            attachment: { $ref: '#/components/schemas/AttachmentRefOrValue' },
          },
        },
        AttachmentRefOrValue: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const mapper = entityMappers.find(entry => entry.entityName === 'Certificate');
    expect(mapper).toBeDefined();
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('CertificateFVO'));
    expect(requestMapping?.annotations).toContain('@Mapping(target = "attachment", ignore = true)');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Certificate'));
    expect(responseMapping?.annotations).toContain('@Mapping(target = "attachment", ignore = true)');
  });

    it('generates helper variants for schemas extending polymorphic bases through allOf', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [],
        schemas: {
          EntityRefOrValue: {
            type: 'object',
            discriminator: {
              propertyName: '@type',
              mapping: {
                PaymentMethodRef: '#/components/schemas/PaymentMethodRef',
              },
            },
          },
          PaymentMethodRef: {
            allOf: [{ $ref: '#/components/schemas/EntityRefOrValue' }, { type: 'object', properties: { name: { type: 'string' } } }],
          },
          PaymentMethodRefFVO: {
            allOf: [{ $ref: '#/components/schemas/PaymentMethodRef' }, { type: 'object', properties: { id: { type: 'string' } } }],
          },
        },
      };

      const { helperMappers } = generateHybridMappers(spec, 'com.example');
      const helper = helperMappers.find(entry => entry.baseType === 'EntityRefOrValue');
      expect(helper).toBeDefined();
      expect(helper?.subtypes.map(sub => sub.domainSimpleName)).toEqual(expect.arrayContaining(['PaymentMethodRef']));
      expect(helper?.variants.map(variant => variant.dtoSimpleName)).toEqual(
        expect.arrayContaining(['PaymentMethodRef', 'PaymentMethodRefFVO']),
      );
      expect(helper?.usesMappers).toEqual(expect.arrayContaining(['com.example.web.api.mapper.PaymentMethodRefMapper']));
    });

  it('links polymorphic helper mappers to referenced entity and helper mappers', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parties',
          method: 'POST',
          requestBodySchema: 'PartyCreate',
          responseSchema: 'Party',
        },
      ],
      schemas: {
        Party: {
          type: 'object',
          discriminator: {
            propertyName: 'partyType',
            mapping: {
              individual: '#/components/schemas/Individual',
              organization: '#/components/schemas/Organization',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Individual' }, { $ref: '#/components/schemas/Organization' }],
          properties: {
            preferredContactPoint: { $ref: '#/components/schemas/ContactPoint' },
            relatedParty: { $ref: '#/components/schemas/RelatedPartyRefOrValue' },
          },
        },
        PartyCreate: {
          type: 'object',
          properties: {
            party: { $ref: '#/components/schemas/Party' },
          },
        },
        Individual: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        Organization: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        ContactPoint: {
          type: 'object',
          properties: {
            medium: { type: 'string' },
          },
        },
        RelatedPartyRefOrValue: {
          type: 'object',
          discriminator: {
            propertyName: 'kind',
            mapping: {
              individual: '#/components/schemas/Individual',
              organization: '#/components/schemas/Organization',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Individual' }, { $ref: '#/components/schemas/Organization' }],
        },
      },
    };

    const { helperMappers } = generateHybridMappers(spec, 'com.example');
    const partyHelper = helperMappers.find(helper => helper.baseType === 'Party');
    expect(partyHelper).toBeDefined();
    expect(partyHelper?.usesMappers).toEqual(
      expect.arrayContaining([
        'com.example.web.api.mapper.ContactPointMapper',
        'com.example.web.api.mapper.RelatedPartyRefOrValueMapper',
      ]),
    );
  });
});
