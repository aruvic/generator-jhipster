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
import { readFileSync } from 'node:fs';

import ejs from 'ejs';

import { generateHybridMappers } from './hybrid-mapper-generator.ts';
import type { OperationDescriptor } from './openapi-entity-matcher.ts';
import type { ParsedOpenAPISpec } from './openapi-mapper-generator.ts';

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
          allOf: [{ $ref: '#/components/schemas/Party' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        Individual: {
          allOf: [{ $ref: '#/components/schemas/Party' }, { type: 'object', properties: { givenName: { type: 'string' } } }],
        },
        Entity: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };

    const entityDefinitions = new Map<string, any>([
      [
        'Catalog',
        {
          name: 'Catalog',
          fields: [],
          relationships: [
            { relationshipName: 'relatedPartys', otherEntityName: 'RelatedPartyRefOrPartyRoleRef', relationshipType: 'one-to-many' },
            { relationshipName: 'auditEntries', otherEntityName: 'AuditEntry', relationshipType: 'one-to-many' },
          ],
        },
      ],
      ['ProductCatalog', { name: 'ProductCatalog', extends: 'Catalog', fields: [] }],
      ['RelatedPartyRefOrPartyRoleRef', { name: 'RelatedPartyRefOrPartyRoleRef', fields: [] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    expect(helperMappers.some(mapper => mapper.mapperName === 'PartyMapper')).toBe(true);
  });

  it('does not emit Java subclass mappings when JDL entities are not domain subtypes', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Catalog: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              ProductCatalog: '#/components/schemas/ProductCatalog',
            },
          },
          properties: {
            '@type': { type: 'string' },
          },
        },
        ProductCatalog: {
          allOf: [{ $ref: '#/components/schemas/Catalog' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Catalog', { name: 'Catalog', fields: [] }],
      ['ProductCatalog', { name: 'ProductCatalog', fields: [] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'Catalog');

    expect(helper).toBeDefined();
    expect(helper?.subtypes).toEqual([]);

    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      { ...helper!, locals: { baseMethodAnnotations: [] } },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );

    expect(rendered).toContain('return mapCatalogBaseDto(unwrapped);');
    expect(rendered).toContain(
      'protected abstract com.example.service.api.dto.Catalog mapCatalogBaseDto(com.example.domain.Catalog source);',
    );
    expect(rendered).toContain(
      'protected abstract void updateCatalogBaseFromCatalog(@MappingTarget com.example.domain.Catalog target, com.example.service.api.dto.Catalog source);',
    );
  });

  it('keeps Java subclass mappings when JDL entities declare domain inheritance', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Catalog: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              ProductCatalog: '#/components/schemas/ProductCatalog',
            },
          },
          properties: {
            '@type': { type: 'string' },
          },
        },
        ProductCatalog: {
          allOf: [{ $ref: '#/components/schemas/Catalog' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Catalog', { name: 'Catalog', fields: [] }],
      ['ProductCatalog', { name: 'ProductCatalog', extends: 'Catalog', fields: [] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'Catalog');

    expect(helper?.subtypes.map(subtype => subtype.domainSimpleName)).toEqual(['ProductCatalog']);
  });

  it('does not read a discriminator column when the JDL domain has no discriminator field accessor', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        PartyBase: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              PartyChild: '#/components/schemas/PartyChild',
            },
          },
          properties: {
            '@type': { type: 'string' },
          },
        },
        PartyChild: {
          allOf: [{ $ref: '#/components/schemas/PartyBase' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['PartyBase', { name: 'PartyBase', fields: [] }],
      ['PartyChild', { name: 'PartyChild', extends: 'PartyBase', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'PartyBase');

    expect(helper?.hasDomainDiscriminatorAccessor).toBe(false);
    expect(helper?.domainDiscriminatorAccessor).toBeUndefined();
  });

  it('uses the JDL discriminator field accessor when it exists on the domain base', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        PartyBase: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              PartyChild: '#/components/schemas/PartyChild',
            },
          },
          properties: {
            '@type': { type: 'string' },
          },
        },
        PartyChild: {
          allOf: [{ $ref: '#/components/schemas/PartyBase' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['PartyBase', { name: 'PartyBase', fields: [{ fieldName: 'atType', fieldType: 'String' }] }],
      ['PartyChild', { name: 'PartyChild', extends: 'PartyBase', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'PartyBase');

    expect(helper?.hasDomainDiscriminatorAccessor).toBe(true);
    expect(helper?.domainDiscriminatorAccessor).toBe('unwrapped.getAtType()');
  });

  it('renders domain discriminator dispatch with the declared discriminator literals', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Pet: {
          type: 'object',
          discriminator: {
            propertyName: 'type',
            mapping: {
              dog: '#/components/schemas/Dog',
              cat: '#/components/schemas/Cat',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Dog' }, { $ref: '#/components/schemas/Cat' }],
          properties: {
            type: { type: 'string' },
          },
        },
        Dog: {
          allOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'object', properties: { barkVolume: { type: 'integer' } } }],
        },
        Cat: {
          allOf: [{ $ref: '#/components/schemas/Pet' }, { type: 'object', properties: { livesLeft: { type: 'integer' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Pet',
        {
          name: 'Pet',
          fields: [{ fieldName: 'type', fieldType: 'String' }],
          annotations: {
            discriminator: { column: 'type', type: 'String', values: 'dog->Dog, cat->Cat' },
          },
        },
      ],
      [
        'Dog',
        {
          name: 'Dog',
          extends: 'Pet',
          fields: [{ fieldName: 'barkVolume', fieldType: 'Integer' }],
          annotations: { discriminatorValue: { value: 'dog' } },
        },
      ],
      [
        'Cat',
        {
          name: 'Cat',
          extends: 'Pet',
          fields: [{ fieldName: 'livesLeft', fieldType: 'Integer' }],
          annotations: { discriminatorValue: { value: 'cat' } },
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'Pet');
    expect(helper).toBeDefined();
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      { ...helper!, locals: { baseMethodAnnotations: [] } },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );

    expect(helper?.subtypes.find(subtype => subtype.domainSimpleName === 'Dog')?.discriminatorValue).toBe('dog');
    expect(helper?.requestDiscriminatorAccessor).toBeUndefined();
    expect(rendered).toContain('if ("dog".equals(discriminator))');
    expect(rendered).toContain('if ("cat".equals(discriminator))');
    expect(rendered).not.toContain('rawRequestDiscriminator');
    expect(rendered).toContain('updatePetBaseFromPet(target, source);');
    expect(rendered).not.toContain('if ("Dog".equals(discriminator))');
    expect(rendered).not.toContain('if ("Cat".equals(discriminator))');
  });

  it('uses a JDL discriminator property for request dispatch when the OAS schema omits the discriminator block', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        EquipmentRefOrValue: {
          type: 'object',
          properties: {
            isOwned: { type: 'boolean' },
          },
        },
        OwnedEquipment: {
          allOf: [{ $ref: '#/components/schemas/EquipmentRefOrValue' }, { type: 'object', properties: { serial: { type: 'string' } } }],
        },
        ReferencedEquipment: {
          allOf: [{ $ref: '#/components/schemas/EquipmentRefOrValue' }, { type: 'object', properties: { reference: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'EquipmentRefOrValue',
        {
          name: 'EquipmentRefOrValue',
          abstractClass: true,
          fields: [{ fieldName: 'isOwned', fieldType: 'Boolean' }],
          annotations: {
            discriminator: { column: 'isOwned', type: 'Boolean', values: 'true->OwnedEquipment, false->ReferencedEquipment' },
          },
        },
      ],
      [
        'OwnedEquipment',
        {
          name: 'OwnedEquipment',
          extends: 'EquipmentRefOrValue',
          fields: [{ fieldName: 'serial', fieldType: 'String' }],
          annotations: { discriminatorValue: { value: 'true' } },
        },
      ],
      [
        'ReferencedEquipment',
        {
          name: 'ReferencedEquipment',
          extends: 'EquipmentRefOrValue',
          fields: [{ fieldName: 'reference', fieldType: 'String' }],
          annotations: { discriminatorValue: { value: 'false' } },
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'EquipmentRefOrValue');

    expect(helper).toBeDefined();
    expect(helper?.requestDiscriminatorAccessor).toBe('source.getIsOwned()');
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      { ...helper!, locals: { baseMethodAnnotations: [] } },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );
    expect(rendered).toContain('final Object rawRequestDiscriminator = source.getIsOwned();');
    expect(rendered).toContain(
      'if ("false".equals(requestDiscriminator) && !(source instanceof com.example.service.api.dto.ReferencedEquipment))',
    );
  });

  it('does not emit a base-typed discriminator accessor when the base DTO is a oneOf composition interface', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Equipment: {
          type: 'object',
          oneOf: [{ $ref: '#/components/schemas/OwnedEquipment' }, { $ref: '#/components/schemas/ReferencedEquipment' }],
          properties: {
            isOwned: { type: 'boolean' },
          },
        },
        OwnedEquipment: {
          allOf: [{ $ref: '#/components/schemas/Equipment' }, { type: 'object', properties: { serial: { type: 'string' } } }],
        },
        ReferencedEquipment: {
          allOf: [{ $ref: '#/components/schemas/Equipment' }, { type: 'object', properties: { reference: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Equipment',
        {
          name: 'Equipment',
          abstractClass: true,
          fields: [{ fieldName: 'isOwned', fieldType: 'Boolean' }],
          annotations: {
            discriminator: { column: 'isOwned', type: 'Boolean', values: 'true->OwnedEquipment, false->ReferencedEquipment' },
          },
        },
      ],
      [
        'OwnedEquipment',
        {
          name: 'OwnedEquipment',
          extends: 'Equipment',
          fields: [{ fieldName: 'serial', fieldType: 'String' }],
          annotations: { discriminatorValue: { value: 'true' } },
        },
      ],
      [
        'ReferencedEquipment',
        {
          name: 'ReferencedEquipment',
          extends: 'Equipment',
          fields: [{ fieldName: 'reference', fieldType: 'String' }],
          annotations: { discriminatorValue: { value: 'false' } },
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'Equipment');

    expect(helper).toBeDefined();
    expect(helper?.requestDiscriminatorAccessor).toBeUndefined();
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      { ...helper!, locals: { baseMethodAnnotations: [] } },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );
    expect(rendered).not.toContain('rawRequestDiscriminator');
    expect(rendered).not.toContain('getIsOwned()');
    expect(rendered).toContain('if (source instanceof com.example.service.api.dto.OwnedEquipment)');
  });

  it('reads a JDL discriminator from concrete oneOf request variants when the base interface has no accessor', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Equipment: {
          type: 'object',
          oneOf: [{ $ref: '#/components/schemas/OwnedEquipment' }, { $ref: '#/components/schemas/ReferencedEquipment' }],
        },
        OwnedEquipment: { type: 'object', properties: { isOwned: { type: 'boolean' }, serial: { type: 'string' } } },
        ReferencedEquipment: { type: 'object', properties: { isOwned: { type: 'boolean' }, reference: { type: 'string' } } },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Equipment',
        {
          name: 'Equipment',
          abstractClass: true,
          annotations: {
            discriminator: { column: 'isOwned', type: 'Boolean', values: 'true->OwnedEquipment, false->ReferencedEquipment' },
          },
        },
      ],
      ['OwnedEquipment', { name: 'OwnedEquipment', extends: 'Equipment', annotations: { discriminatorValue: { value: 'true' } } }],
      [
        'ReferencedEquipment',
        { name: 'ReferencedEquipment', extends: 'Equipment', annotations: { discriminatorValue: { value: 'false' } } },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(mapper => mapper.baseType === 'Equipment');

    expect(helper?.requestDiscriminatorAccessor).toBe(
      'source instanceof com.example.service.api.dto.OwnedEquipment ? ((com.example.service.api.dto.OwnedEquipment) source).getIsOwned() : source instanceof com.example.service.api.dto.ReferencedEquipment ? ((com.example.service.api.dto.ReferencedEquipment) source).getIsOwned() : null',
    );
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

  it('keeps request mappings for schemas nested inside request payloads', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/products',
          method: 'POST',
          requestBodySchema: 'ProductFVO',
          responseSchema: 'Product',
        },
        {
          path: '/product-events',
          method: 'POST',
          requestBodySchema: 'ProductEventPayload',
          responseSchema: 'ProductEventPayload',
        },
      ],
      schemas: {
        Product: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        ProductFVO: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        ProductEventPayload: {
          type: 'object',
          properties: {
            product: { $ref: '#/components/schemas/Product' },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const productMapper = entityMappers.find(m => m.entityName === 'Product');
    const requestSources = productMapper?.requestMappings.map(m => m.sourceType) ?? [];

    expect(requestSources).toContain('eu.example.app.service.api.dto.ProductFVO');
    expect(requestSources).toContain('eu.example.app.service.api.dto.Product');
  });

  it('keeps request mappings for underscore role schemas nested inside allOf request payloads', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/characteristics',
          method: 'POST',
          requestBodySchema: 'Characteristic',
          responseSchema: 'Characteristic',
        },
        {
          path: '/events/{id}',
          method: 'GET',
          responseSchema: 'Event',
        },
      ],
      schemas: {
        Extensible: {
          type: 'object',
          properties: { '@type': { type: 'string' } },
        },
        Characteristic: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        Characteristic_FVO: {
          allOf: [{ $ref: '#/components/schemas/Extensible' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        Characteristic_MVO: {
          allOf: [{ $ref: '#/components/schemas/Extensible' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        Event: {
          type: 'object',
          properties: {
            analyticCharacteristics: {
              type: 'array',
              items: { $ref: '#/components/schemas/Characteristic' },
            },
          },
        },
        Event_FVO: {
          allOf: [
            { $ref: '#/components/schemas/Extensible' },
            {
              type: 'object',
              properties: {
                analyticCharacteristics: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Characteristic_FVO' },
                },
              },
            },
          ],
        },
        Event_MVO: {
          allOf: [
            { $ref: '#/components/schemas/Extensible' },
            {
              type: 'object',
              properties: {
                analyticCharacteristics: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Characteristic_MVO' },
                },
              },
            },
          ],
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const characteristicMapper = entityMappers.find(m => m.entityName === 'Characteristic');
    const requestSources = characteristicMapper?.requestMappings.map(m => m.sourceType) ?? [];

    expect(requestSources).toContain('eu.example.app.service.api.dto.Characteristic');
    expect(requestSources).toContain('eu.example.app.service.api.dto.CharacteristicFVO');
    expect(requestSources).toContain('eu.example.app.service.api.dto.CharacteristicMVO');
  });

  it('does not create DTO mappings for empty object marker schemas', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/cancel-service-orders',
          method: 'POST',
          requestBodySchema: 'CancelServiceOrderFVO',
          responseSchema: 'CancelServiceOrder',
        },
      ],
      schemas: {
        Addressable: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int64', readOnly: true },
            href: { type: 'string' },
          },
        },
        AddressableFVO: {
          type: 'object',
          description: 'Marker schema with no generated DTO class',
        },
        CancelServiceOrder: {
          allOf: [{ $ref: '#/components/schemas/Addressable' }, { type: 'object', properties: { reason: { type: 'string' } } }],
        },
        CancelServiceOrderFVO: {
          allOf: [{ $ref: '#/components/schemas/AddressableFVO' }, { type: 'object', properties: { reason: { type: 'string' } } }],
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const mapper = entityMappers.find(m => m.entityName === 'Addressable');
    const requestSources = mapper?.requestMappings.map(m => m.sourceType) ?? [];

    expect(requestSources).toContain('eu.example.app.service.api.dto.Addressable');
    expect(requestSources).not.toContain('eu.example.app.service.api.dto.AddressableFVO');
  });

  it('maps OpenAPI array fields to JSON text fields with generic list converters', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/value-specs',
          method: 'POST',
          requestBodySchema: 'BooleanArrayCharacteristicValueSpecification',
          responseSchema: 'BooleanArrayCharacteristicValueSpecification',
        },
      ],
      schemas: {
        BooleanArrayCharacteristicValueSpecification: {
          type: 'object',
          properties: {
            values: {
              type: 'array',
              items: { type: 'boolean' },
            },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'BooleanArrayCharacteristicValueSpecification',
        {
          name: 'BooleanArrayCharacteristicValueSpecification',
          fields: [{ fieldName: 'values', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'BooleanArrayCharacteristicValueSpecification');

    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "values", target = "values", qualifiedByName = "listToJsonString")',
    );
    expect(mapper?.responseMappings[0]?.annotations).toContain(
      '@Mapping(source = "values", target = "values", qualifiedByName = "jsonStringToList")',
    );
  });

  it('maps referenced OpenAPI array fields to JSON text fields', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/line-strings',
          method: 'POST',
          requestBodySchema: 'LineString',
          responseSchema: 'LineString',
        },
      ],
      schemas: {
        LineString: {
          type: 'object',
          properties: {
            coordinates: {
              $ref: '#/components/schemas/lineString',
            },
          },
        },
        lineString: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'LineString',
        {
          name: 'LineString',
          fields: [{ fieldName: 'coordinates', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'LineString');

    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "coordinates", target = "coordinates", qualifiedByName = "listToJsonString")',
    );
    expect(mapper?.responseMappings[0]?.annotations).toContain(
      '@Mapping(source = "coordinates", target = "coordinates", qualifiedByName = "jsonStringToList")',
    );
  });

  it('maps JSON text fields discovered through nested allOf oneOf composition', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/pets',
          method: 'POST',
          requestBodySchema: 'Pet',
          responseSchema: 'Pet',
        },
      ],
      schemas: {
        Animal: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              nullable: true,
              items: { type: 'string' },
            },
            attributes: {
              $ref: '#/components/schemas/PetAttributes',
            },
          },
        },
        Dog: {
          allOf: [{ $ref: '#/components/schemas/Animal' }, { type: 'object', properties: { barkVolume: { type: 'integer' } } }],
        },
        Cat: {
          allOf: [{ $ref: '#/components/schemas/Animal' }, { type: 'object', properties: { livesLeft: { type: 'integer' } } }],
        },
        Pet: {
          allOf: [
            {
              discriminator: {
                propertyName: 'type',
                mapping: {
                  dog: '#/components/schemas/Dog',
                  cat: '#/components/schemas/Cat',
                },
              },
              oneOf: [{ $ref: '#/components/schemas/Dog' }, { $ref: '#/components/schemas/Cat' }],
            },
            {
              type: 'object',
              properties: {
                ownerId: { type: 'integer', format: 'int64' },
              },
            },
          ],
        },
        PetAttributes: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Pet',
        {
          name: 'Pet',
          fields: [
            { fieldName: 'tags', fieldType: 'TextBlob' },
            { fieldName: 'attributes', fieldType: 'TextBlob' },
            { fieldName: 'ownerId', fieldType: 'Long' },
          ],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Pet');

    expect(mapper?.requestMappings[0]?.annotations).toEqual(
      expect.arrayContaining([
        '@Mapping(source = "tags", target = "tags", qualifiedByName = "listToJsonString")',
        '@Mapping(source = "attributes", target = "attributes", qualifiedByName = "mapToJsonString")',
      ]),
    );
    expect(mapper?.responseMappings[0]?.annotations).toEqual(
      expect.arrayContaining([
        '@Mapping(source = "tags", target = "tags", qualifiedByName = "jsonStringToList")',
        '@Mapping(source = "attributes", target = "attributes", qualifiedByName = "jsonStringToObject")',
      ]),
    );
  });

  it('prefers object schemas over same-base alias schemas when generating entity mappers', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        lineString: {
          type: 'array',
          items: { type: 'number' },
        },
        LineString: {
          type: 'object',
          properties: {
            coordinates: { $ref: '#/components/schemas/lineString' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'LineString',
        {
          name: 'LineString',
          fields: [{ fieldName: 'coordinates', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'LineString');

    expect(mapper?.requestMappings[0]?.sourceSchemaName).toBe('LineString');
    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "coordinates", target = "coordinates", qualifiedByName = "listToJsonString")',
    );
  });

  it('does not add alias ignores for JSON text fields that already have explicit converters', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        position: {
          type: 'array',
          items: { type: 'number' },
        },
        Point: {
          type: 'object',
          properties: {
            coordinates: { $ref: '#/components/schemas/position' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Point',
        {
          name: 'Point',
          fields: [{ fieldName: 'coordinates', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Point');

    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "coordinates", target = "coordinates", qualifiedByName = "listToJsonString")',
    );
    expect(mapper?.requestMappings[0]?.annotations).not.toContain('@Mapping(target = "coordinates", ignore = true)');
    expect(mapper?.responseMappings[0]?.annotations).not.toContain('@Mapping(target = "coordinates", ignore = true)');
  });

  it('maps untyped OpenAPI fields to native Jackson object JSON text fields', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/json-values',
          method: 'POST',
          requestBodySchema: 'JsonValue',
          responseSchema: 'JsonValue',
        },
      ],
      schemas: {
        JsonValue: {
          type: 'object',
          properties: {
            '@list': {
              description: 'Untyped JSON value',
            },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'JsonValue',
        {
          name: 'JsonValue',
          fields: [{ fieldName: 'atList', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'JsonValue');

    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "atList", target = "atList", qualifiedByName = "objectToJsonString")',
    );
    expect(mapper?.responseMappings[0]?.annotations).toContain(
      '@Mapping(source = "atList", target = "atList", qualifiedByName = "jsonStringToObject")',
    );
  });

  it('adds primitive conversion annotations to polymorphic helper base mappings', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        JsonValue: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              JsonValueChild: '#/components/schemas/JsonValueChild',
            },
          },
          properties: {
            '@id': { type: 'string', format: 'uri' },
            '@list': {},
            '@type': { type: 'string' },
          },
        },
        JsonValueChild: {
          allOf: [
            { $ref: '#/components/schemas/JsonValue' },
            {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          ],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'JsonValue',
        {
          name: 'JsonValue',
          fields: [
            { fieldName: 'atId', fieldType: 'String' },
            { fieldName: 'atList', fieldType: 'TextBlob' },
            { fieldName: 'atType', fieldType: 'String' },
          ],
        },
      ],
      [
        'JsonValueChild',
        {
          name: 'JsonValueChild',
          extends: 'JsonValue',
          fields: [{ fieldName: 'name', fieldType: 'String' }],
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(entry => entry.baseType === 'JsonValue');

    expect(helper?.baseMethodAnnotations).toContain(
      '@Mapping(source = "atList", target = "atList", qualifiedByName = "objectToJsonString")',
    );
    expect(helper?.baseMethodAnnotations).toContain('@Mapping(source = "atId", target = "atId", qualifiedByName = "uriToString")');
    expect(helper?.baseResponseMethodAnnotations).toContain(
      '@Mapping(source = "atList", target = "atList", qualifiedByName = "jsonStringToObject")',
    );
    expect(helper?.baseResponseMethodAnnotations).toContain('@Mapping(source = "atId", target = "atId", qualifiedByName = "stringToUri")');

    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      {
        ...helper,
        locals: {
          baseMethodAnnotations: helper?.baseMethodAnnotations,
          baseResponseMethodAnnotations: helper?.baseResponseMethodAnnotations,
        },
      },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );

    expect(rendered).toContain('@Named("mapJsonValueBaseDto")');
    expect(rendered).toContain('@Mapping(source = "atId", target = "atId", qualifiedByName = "stringToUri")');
    expect(rendered).toContain('@Named("updateJsonValueBaseFromJsonValue")');
    expect(rendered).toContain('@Mapping(source = "atId", target = "atId", qualifiedByName = "uriToString")');
  });

  it('does not add base conversion annotations when oneOf base DTO is generated as an interface', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        HazardousItem: {
          type: 'object',
          properties: {
            codes: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          oneOf: [
            {
              title: 'Hazardous By Code',
              type: 'object',
              properties: {
                code: { type: 'string' },
              },
            },
          ],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'HazardousItem',
        {
          name: 'HazardousItem',
          fields: [{ fieldName: 'codes', fieldType: 'TextBlob' }],
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(entry => entry.baseType === 'HazardousItem');

    expect(helper?.baseMethodAnnotations).toEqual([]);
    expect(helper?.baseResponseMethodAnnotations).toEqual([]);
  });

  it('renders FVO wrapper subtype mappings from schema DTOs without synthesizing missing suffix variants', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const subtype = (dtoSimpleName: string, domainSimpleName: string) => ({
      dtoType: `com.example.service.api.dto.${dtoSimpleName}`,
      dtoSimpleName,
      domainType: `com.example.domain.${domainSimpleName}`,
      domainSimpleName,
      isCompatible: true,
      isDtoSubtype: true,
      usesHelperMapper: false,
    });
    const attachment = subtype('Attachment', 'Attachment');
    const attachmentRef = subtype('AttachmentRef', 'AttachmentRef');
    const context = {
      mapperName: 'AttachmentRefOrValueMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'AttachmentRefOrValue',
      baseDtoType: 'com.example.service.api.dto.AttachmentRefOrValue',
      baseDomainType: 'com.example.domain.AttachmentRefOrValue',
      subtypes: [attachment, attachmentRef],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.AttachmentRefOrValueFVO',
          dtoSimpleName: 'AttachmentRefOrValueFVO',
          normalizedName: 'AttachmentRefOrValueFVO',
          isBase: false,
          isWrapper: false,
          subtypes: [subtype('AttachmentFVO', 'Attachment'), attachmentRef],
          targetDomainType: 'com.example.domain.AttachmentRefOrValue',
          targetDomainSimpleName: 'AttachmentRefOrValue',
          mappingMethodName: 'toAttachmentRefOrValueFVO',
          annotations: [],
          requiresHelperMapping: true,
        },
      ],
      usesMappers: [],
      isAbstract: true,
      baseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('source = com.example.service.api.dto.AttachmentRef.class');
    expect(rendered).not.toContain('AttachmentRefFVO');
  });

  it('does not dispatch non-assignable request role DTOs through base DTO instanceof checks', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'CatalogMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'Catalog',
      baseDtoType: 'com.example.service.api.dto.Catalog',
      baseDomainType: 'com.example.domain.Catalog',
      subtypes: [],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.CatalogFVO',
          dtoSimpleName: 'CatalogFVO',
          normalizedName: 'CatalogFVO',
          isBase: false,
          isWrapper: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.Catalog',
          targetDomainSimpleName: 'Catalog',
          mappingMethodName: 'toCatalogFVO',
          annotations: [],
          requiresHelperMapping: true,
          assignableToBaseDto: false,
        },
        {
          dtoType: 'com.example.service.api.dto.CatalogInlineSubtype',
          dtoSimpleName: 'CatalogInlineSubtype',
          normalizedName: 'CatalogInlineSubtype',
          isBase: false,
          isWrapper: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.Catalog',
          targetDomainSimpleName: 'Catalog',
          mappingMethodName: 'toCatalogInlineSubtype',
          annotations: [],
          requiresHelperMapping: true,
          assignableToBaseDto: true,
        },
      ],
      usesMappers: [],
      isAbstract: true,
      baseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).not.toContain('source instanceof com.example.service.api.dto.CatalogFVO');
    expect(rendered).toContain('public com.example.domain.Catalog toCatalogFVO(com.example.service.api.dto.CatalogFVO source)');
    expect(rendered).toContain('updateCatalogBaseFromCatalogFVO(unwrappedTarget, source);');
    expect(rendered).toContain('source instanceof com.example.service.api.dto.CatalogInlineSubtype');
  });

  it('does not dispatch concrete helper variants through unrelated base-family subtypes', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'EntityRefOrValueMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'EntityRefOrValue',
      baseDtoType: 'com.example.service.api.dto.EntityRefOrValue',
      baseDomainType: 'com.example.domain.EntityRefOrValue',
      subtypes: [
        {
          dtoType: 'com.example.service.api.dto.PaymentMethodRef',
          dtoSimpleName: 'PaymentMethodRef',
          domainType: 'com.example.domain.PaymentMethodRef',
          domainSimpleName: 'PaymentMethodRef',
          isCompatible: true,
          isDtoSubtype: true,
        },
        {
          dtoType: 'com.example.service.api.dto.EntityRef',
          dtoSimpleName: 'EntityRef',
          domainType: 'com.example.domain.EntityRef',
          domainSimpleName: 'EntityRef',
          isCompatible: true,
          isDtoSubtype: true,
        },
      ],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.Attachment',
          dtoSimpleName: 'Attachment',
          normalizedName: 'Attachment',
          isBase: false,
          isWrapper: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.EntityRefOrValue',
          targetDomainSimpleName: 'EntityRefOrValue',
          mappingMethodName: 'toAttachment',
          annotations: [],
          requiresHelperMapping: true,
          assignableToBaseDto: false,
        },
      ],
      usesMappers: [],
      isAbstract: true,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });
    const concreteUpdateMethod = rendered.slice(
      rendered.indexOf('public void updateEntityRefOrValueFromAttachment'),
      rendered.indexOf('@Named("updateEntityRefOrValueBaseFromAttachment")'),
    );

    expect(rendered).toContain('public void updateEntityRefOrValueFromAttachment');
    expect(concreteUpdateMethod).not.toContain('source instanceof com.example.service.api.dto.PaymentMethodRef');
    expect(concreteUpdateMethod).not.toContain('source instanceof com.example.service.api.dto.EntityRef');
  });

  it('uses the resolved concrete domain type for polymorphic response variant mapper methods', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'ResourceRefOrValueMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'ResourceRefOrValue',
      baseDtoType: 'com.example.service.api.dto.ResourceRefOrValue',
      baseDomainType: 'com.example.domain.ResourceRefOrValue',
      subtypes: [],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.ResourceRES',
          dtoSimpleName: 'ResourceRES',
          normalizedName: 'ResourceRES',
          isBase: false,
          isWrapper: false,
          isResponseVariant: true,
          isRequestVariant: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.Resource',
          targetDomainSimpleName: 'Resource',
          responseAnnotations: [
            '@Mapping(target = "alarmStatus", expression = "java(openApiPrimitiveMapper.enumToSingletonList(source.getAlarmStatus(), com.example.service.api.dto.ResourceAlarmStatusType.class))")',
          ],
          requiresHelperMapping: true,
        },
      ],
      usesMappers: [],
      isAbstract: true,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain(
      'public abstract com.example.service.api.dto.ResourceRES toResourceRES(com.example.domain.Resource source);',
    );
    expect(rendered).not.toContain('toResourceRES(com.example.domain.ResourceRefOrValue source)');
  });

  it('selects a concrete DTO fallback for flattened oneOf interface response mappings', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'PlaceMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'Place',
      baseDtoType: 'com.example.service.api.dto.Place',
      baseDomainType: 'com.example.domain.Place',
      subtypes: [
        {
          dtoType: 'com.example.service.api.dto.CodeBasedPlace',
          dtoSimpleName: 'CodeBasedPlace',
          domainType: 'com.example.domain.Place',
          domainSimpleName: 'Place',
          isCompatible: true,
          isDtoSubtype: true,
        },
        {
          dtoType: 'com.example.service.api.dto.NameBasedPlace',
          dtoSimpleName: 'NameBasedPlace',
          domainType: 'com.example.domain.Place',
          domainSimpleName: 'Place',
          isCompatible: true,
          isDtoSubtype: true,
        },
      ],
      variants: [],
      usesMappers: [],
      isAbstract: false,
      isCompositionInterface: true,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('return instantiatePlaceDtoFallback(source);');
    expect(rendered).toContain('private com.example.service.api.dto.Place instantiateBestMatchingPlaceDto(');
    expect(rendered).toContain('subtypeScore = countMappableNonNullProperties(source, subtypeCandidate.getClass());');
    expect(rendered).toContain('private boolean hasWritableProperty(Class<?> targetType, String propertySuffix)');
    expect(rendered).toContain('if (bestSubtypeCandidate != null)');
    expect(rendered).toContain('return null;');
    expect(rendered).not.toContain('Unable to resolve Place DTO subtype');
  });

  it('does not render child-target object factories that compete with child helper mappers', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const logicalResource = {
      dtoType: 'com.example.service.api.dto.LogicalResource',
      dtoSimpleName: 'LogicalResource',
      domainType: 'com.example.domain.LogicalResource',
      domainSimpleName: 'LogicalResource',
      isCompatible: true,
      isDtoSubtype: true,
      usesHelperMapper: true,
    };
    const context = {
      mapperName: 'ResourceRefOrValueMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'ResourceRefOrValue',
      baseDtoType: 'com.example.service.api.dto.ResourceRefOrValue',
      baseDomainType: 'com.example.domain.ResourceRefOrValue',
      subtypes: [logicalResource],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.LogicalResource',
          dtoSimpleName: 'LogicalResource',
          normalizedName: 'LogicalResource',
          isBase: false,
          isWrapper: false,
          subtypes: [logicalResource],
          targetDomainType: 'com.example.domain.LogicalResource',
          targetDomainSimpleName: 'LogicalResource',
          usesHelperMapper: true,
          mappingMethodName: 'toLogicalResource',
          annotations: [],
          requiresHelperMapping: true,
          generateObjectFactory: false,
        },
      ],
      usesMappers: ['com.example.web.api.mapper.LogicalResourceMapper'],
      isAbstract: true,
      baseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('public com.example.domain.LogicalResource toLogicalResource');
    expect(rendered).not.toContain('instantiateResourceRefOrValueFromLogicalResource');
  });

  it('delegates concrete polymorphic request variants to their entity mapper', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const dog = {
      dtoType: 'com.example.service.api.dto.Dog',
      dtoSimpleName: 'Dog',
      domainType: 'com.example.domain.Dog',
      domainSimpleName: 'Dog',
      isCompatible: true,
      isDtoSubtype: true,
      usesHelperMapper: false,
    };
    const context = {
      mapperName: 'PetMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'Pet',
      baseDtoType: 'com.example.service.api.dto.Pet',
      baseDomainType: 'com.example.domain.Pet',
      subtypes: [dog],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.Dog',
          dtoSimpleName: 'Dog',
          normalizedName: 'Dog',
          isBase: false,
          isWrapper: false,
          subtypes: [dog],
          targetDomainType: 'com.example.domain.Dog',
          targetDomainSimpleName: 'Dog',
          usesHelperMapper: false,
          mappingMethodName: 'toDog',
          annotations: [],
          requiresHelperMapping: true,
          generateObjectFactory: true,
        },
      ],
      usesMappers: ['com.example.web.api.mapper.DogMapper'],
      isAbstract: true,
      baseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('public com.example.domain.Dog toDog(com.example.service.api.dto.Dog source)');
    expect(rendered).toContain('return this.dogMapper.toDogEntity(source);');
    expect(rendered).not.toContain('public abstract com.example.domain.Dog toDog');
    expect(rendered).toContain('@Mapping(target = "id", ignore = true)');
  });

  it('does not delegate wrapper request variants to concrete mappers that do not accept them', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const entity = {
      dtoType: 'com.example.service.api.dto.Entity',
      dtoSimpleName: 'Entity',
      domainType: 'com.example.domain.Entity',
      domainSimpleName: 'Entity',
      isCompatible: true,
      isDtoSubtype: true,
      usesHelperMapper: false,
    };
    const context = {
      mapperName: 'EntityRefOrValueMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'EntityRefOrValue',
      baseDtoType: 'com.example.service.api.dto.EntityRefOrValue',
      baseDomainType: 'com.example.domain.EntityRefOrValue',
      subtypes: [entity],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.EntityMVO',
          dtoSimpleName: 'EntityMVO',
          normalizedName: 'Entity',
          isBase: false,
          isWrapper: false,
          subtypes: [entity],
          targetDomainType: 'com.example.domain.Entity',
          targetDomainSimpleName: 'Entity',
          usesHelperMapper: false,
          mappingMethodName: 'toEntityMVO',
          annotations: [],
          requiresHelperMapping: true,
          generateObjectFactory: true,
        },
      ],
      usesMappers: ['com.example.web.api.mapper.EntityMapper'],
      isAbstract: true,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [] },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('public com.example.domain.Entity toEntityMVO(com.example.service.api.dto.EntityMVO source)');
    expect(rendered).not.toContain('this.entityMapper.toEntityEntity(source)');
    expect(rendered).not.toContain('updateEntityEntityFromEntityMVO');
    expect(rendered).toContain('updateEntityRefOrValueBaseFromEntityMVO(unwrappedTarget, source);');
  });

  it('ignores reference ids for MVO polymorphic helper mappings to avoid detached update children', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'CategoryRefMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'CategoryRef',
      baseDtoType: 'com.example.service.api.dto.CategoryRef',
      baseDomainType: 'com.example.domain.CategoryRef',
      subtypes: [],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.CategoryRefMVO',
          dtoSimpleName: 'CategoryRefMVO',
          normalizedName: 'CategoryRef',
          isBase: false,
          isWrapper: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.CategoryRef',
          targetDomainSimpleName: 'CategoryRef',
          usesHelperMapper: false,
          mappingMethodName: 'toCategoryRefMVO',
          annotations: [],
          requiresHelperMapping: true,
          generateObjectFactory: true,
          generatedUuidFields: [{ fieldName: 'tmfId', accessor: 'TmfId' }],
        },
      ],
      usesMappers: [],
      isAbstract: false,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      preserveReferenceId: true,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [], preserveReferenceId: true },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('public com.example.domain.CategoryRef toCategoryRefMVO(com.example.service.api.dto.CategoryRefMVO source)');
    expect(rendered).toContain('@Mapping(target = "id", ignore = true)\n    public com.example.domain.CategoryRef toCategoryRef');
    expect(rendered).toContain('@Mapping(target = "id", ignore = true)\n    @Named("updateCategoryRefBaseFromCategoryRefMVO")');
    expect(rendered).toContain('initializeGeneratedFieldsAfterCategoryRefMVOMapping(target);');
    expect(rendered).toContain('if (target.getTmfId() == null) {\n            target.setTmfId(java.util.UUID.randomUUID());\n        }');
  });

  it('ignores reference ids for FVO polymorphic helper mappings to avoid detached create children', () => {
    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const context = {
      mapperName: 'ChannelRefMapper',
      packageName: 'com.example.web.api.mapper',
      baseType: 'ChannelRef',
      baseDtoType: 'com.example.service.api.dto.ChannelRef',
      baseDomainType: 'com.example.domain.ChannelRef',
      subtypes: [],
      variants: [
        {
          dtoType: 'com.example.service.api.dto.ChannelRefFVO',
          dtoSimpleName: 'ChannelRefFVO',
          normalizedName: 'ChannelRef',
          isBase: false,
          isWrapper: false,
          subtypes: [],
          targetDomainType: 'com.example.domain.ChannelRef',
          targetDomainSimpleName: 'ChannelRef',
          usesHelperMapper: false,
          mappingMethodName: 'toChannelRefFVO',
          annotations: [],
          requiresHelperMapping: true,
          generateObjectFactory: true,
        },
      ],
      usesMappers: [],
      isAbstract: false,
      baseMethodAnnotations: [],
      baseResponseMethodAnnotations: [],
      domainDiscriminatorAccessor: undefined,
      preserveReferenceId: true,
      locals: { baseMethodAnnotations: [], baseResponseMethodAnnotations: [], preserveReferenceId: true },
    };

    const rendered = ejs.render(template, context, { filename: 'polymorphic-helper-mapper.java.ejs' });

    expect(rendered).toContain('import org.mapstruct.Mapping;');
    expect(rendered).toContain('@Mapping(target = "id", ignore = true)\n    @Named("updateChannelRefBaseFromChannelRefFVO")');
  });

  it('maps OpenAPI enum arrays to scalar domain enum fields generically', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Resource: {
          type: 'object',
          properties: {
            alarmStatus: {
              type: 'array',
              items: { $ref: '#/components/schemas/ResourceAlarmStatusType' },
            },
          },
        },
        ResourceFVO: {
          type: 'object',
          properties: {
            alarmStatus: {
              type: 'array',
              items: { $ref: '#/components/schemas/ResourceAlarmStatusType' },
            },
          },
        },
        ResourceAlarmStatusType: {
          type: 'string',
          enum: ['cleared', 'critical'],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Resource',
        {
          name: 'Resource',
          fields: [{ fieldName: 'alarmStatus', fieldType: 'ResourceAlarmStatus' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Resource');

    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(target = "alarmStatus", expression = "java(openApiPrimitiveMapper.firstEnumFromList(source.getAlarmStatus(), com.example.domain.enumeration.ResourceAlarmStatus.class))")',
    );
    expect(mapper?.responseMappings[0]?.annotations).toContain(
      '@Mapping(target = "alarmStatus", expression = "java(openApiPrimitiveMapper.enumToSingletonList(source.getAlarmStatus(), com.example.service.api.dto.ResourceAlarmStatusType.class))")',
    );
  });

  it('filters polymorphic helper variant ignores to fields on the target domain type', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/services',
          method: 'POST',
          requestBodySchema: 'ServiceRefOrValueFVO',
          responseSchema: 'ServiceRefOrValue',
        },
      ],
      schemas: {
        ServiceRefOrValue: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              Service: '#/components/schemas/Service',
              ServiceRef: '#/components/schemas/ServiceRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Service' }, { $ref: '#/components/schemas/ServiceRef' }],
          properties: {
            id: { type: 'string' },
            '@type': { type: 'string' },
          },
        },
        ServiceRefOrValueFVO: {
          type: 'object',
          oneOf: [{ $ref: '#/components/schemas/ServiceFVO' }, { $ref: '#/components/schemas/ServiceRef' }],
        },
        Service: {
          allOf: [
            { $ref: '#/components/schemas/ServiceRefOrValue' },
            {
              type: 'object',
              properties: {
                features: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/FeatureRefOrValue' },
                },
              },
            },
          ],
        },
        ServiceFVO: {
          type: 'object',
          properties: {
            features: {
              type: 'array',
              items: { $ref: '#/components/schemas/FeatureRefOrValue' },
            },
          },
        },
        ServiceRef: {
          allOf: [{ $ref: '#/components/schemas/ServiceRefOrValue' }, { type: 'object', properties: { href: { type: 'string' } } }],
        },
        FeatureRefOrValue: {
          type: 'object',
          discriminator: { propertyName: '@type' },
          oneOf: [{ $ref: '#/components/schemas/FeatureRef' }],
        },
        FeatureRef: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['ServiceRefOrValue', { name: 'ServiceRefOrValue', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
      [
        'Service',
        {
          name: 'Service',
          fields: [{ fieldName: 'id', fieldType: 'String' }],
          relationships: [{ relationshipName: 'features', otherEntityName: 'FeatureRefOrValue', relationshipType: 'one-to-many' }],
        },
      ],
      ['ServiceRef', { name: 'ServiceRef', fields: [{ fieldName: 'href', fieldType: 'String' }] }],
      ['FeatureRefOrValue', { name: 'FeatureRefOrValue', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
      ['FeatureRef', { name: 'FeatureRef', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(entry => entry.baseType === 'ServiceRefOrValue');
    const wrapperVariant = helper?.variants.find(variant => variant.dtoSimpleName === 'ServiceRefOrValueFVO');

    expect(wrapperVariant?.targetDomainSimpleName).toBe('ServiceRefOrValue');
    expect(wrapperVariant?.annotations).not.toContain('@Mapping(target = "features", ignore = true)');
  });

  it('maps resolvable discriminator-bearing object fields in polymorphic helper variants', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/assets',
          method: 'POST',
          requestBodySchema: 'AssetFVO',
          responseSchema: 'AssetRES',
        },
      ],
      schemas: {
        Asset: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              Asset: '#/components/schemas/Asset',
              SpecializedAsset: '#/components/schemas/SpecializedAsset',
            },
          },
          properties: {
            '@type': { type: 'string' },
            specification: { $ref: '#/components/schemas/SpecificationRef' },
          },
        },
        AssetFVO: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              Asset: '#/components/schemas/AssetFVO',
              SpecializedAsset: '#/components/schemas/SpecializedAssetFVO',
            },
          },
          properties: {
            '@type': { type: 'string' },
            specification: { $ref: '#/components/schemas/SpecificationRefFVO' },
          },
        },
        AssetRES: {
          allOf: [{ $ref: '#/components/schemas/Asset' }],
        },
        SpecializedAsset: {
          allOf: [{ $ref: '#/components/schemas/Asset' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        SpecializedAssetFVO: {
          allOf: [{ $ref: '#/components/schemas/AssetFVO' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        SpecificationRef: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              SpecificationRef: '#/components/schemas/SpecificationRef',
            },
          },
          properties: {
            '@type': { type: 'string' },
            href: { type: 'string' },
          },
        },
        SpecificationRefFVO: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              SpecificationRef: '#/components/schemas/SpecificationRefFVO',
            },
          },
          properties: {
            '@type': { type: 'string' },
            href: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Asset',
        {
          name: 'Asset',
          fields: [{ fieldName: 'atType', fieldType: 'String' }],
          relationships: [{ relationshipName: 'specification', relationshipType: 'many-to-one', otherEntityName: 'SpecificationRef' }],
        },
      ],
      ['SpecializedAsset', { name: 'SpecializedAsset', extends: 'Asset', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
      [
        'SpecificationRef',
        {
          name: 'SpecificationRef',
          fields: [
            { fieldName: 'atType', fieldType: 'String' },
            { fieldName: 'href', fieldType: 'String' },
          ],
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const helper = helperMappers.find(entry => entry.baseType === 'Asset');
    const requestVariant = helper?.variants.find(entry => entry.dtoSimpleName === 'AssetFVO');
    const responseVariant = helper?.variants.find(entry => entry.dtoSimpleName === 'AssetRES');

    expect(requestVariant?.annotations).not.toContain('@Mapping(target = "specification", ignore = true)');
    expect(responseVariant?.responseAnnotations).not.toContain('@Mapping(target = "specification", ignore = true)');
    expect(helper?.usesMappers).toContain('com.example.web.api.mapper.SpecificationRefMapper');
  });

  it('filters abstract-field ignores through JavaBean relationship property names', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/addresses',
          method: 'POST',
          requestBodySchema: 'GeographicAddressFVO',
          responseSchema: 'GeographicAddress',
        },
      ],
      schemas: {
        GeographicAddress: {
          type: 'object',
          properties: {
            geographicSubAddress: {
              type: 'array',
              items: { $ref: '#/components/schemas/GeographicSubAddress' },
            },
          },
        },
        GeographicAddressFVO: {
          type: 'object',
          properties: {
            geographicSubAddress: {
              type: 'array',
              items: { $ref: '#/components/schemas/GeographicSubAddress' },
            },
          },
        },
        GeographicSubAddress: {
          type: 'object',
          discriminator: { propertyName: '@type' },
          oneOf: [{ $ref: '#/components/schemas/GeographicSubAddressRef' }],
        },
        GeographicSubAddressRef: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'GeographicAddress',
        {
          name: 'GeographicAddress',
          fields: [{ fieldName: 'id', fieldType: 'String' }],
          relationships: [
            {
              relationshipName: 'geographicSubAddress',
              relationshipType: 'one-to-many',
              relationshipFieldNamePlural: 'geographicSubAddresses',
              otherEntityName: 'GeographicSubAddress',
            },
          ],
        },
      ],
      ['GeographicSubAddress', { name: 'GeographicSubAddress', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
      ['GeographicSubAddressRef', { name: 'GeographicSubAddressRef', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'GeographicAddress');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('GeographicAddressFVO'));

    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "geographicSubAddress", ignore = true)');
  });

  it('does not treat descriptive schema titles as abstract relationship targets', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/bookings',
          method: 'POST',
          requestBodySchema: 'CreateBooking',
          responseSchema: 'Booking',
        },
      ],
      schemas: {
        CreateBooking: {
          type: 'object',
          properties: {
            documentParties: { $ref: '#/components/schemas/DocumentPartiesReq' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            documentParties: { $ref: '#/components/schemas/DocumentPartiesReq' },
          },
        },
        DocumentPartiesReq: {
          title: 'Document Parties (Shipper)',
          type: 'object',
          properties: {
            bookingAgent: { $ref: '#/components/schemas/BookingAgent' },
          },
        },
        BookingAgent: {
          type: 'object',
          properties: {
            partyName: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Booking',
        {
          name: 'Booking',
          fields: [],
          relationships: [{ relationshipName: 'documentParties', relationshipType: 'many-to-one', otherEntityName: 'DocumentPartiesReq' }],
        },
      ],
      [
        'CreateBooking',
        {
          name: 'CreateBooking',
          fields: [],
          relationships: [{ relationshipName: 'documentParties', relationshipType: 'many-to-one', otherEntityName: 'DocumentPartiesReq' }],
        },
      ],
      ['DocumentPartiesReq', { name: 'DocumentPartiesReq', fields: [], relationships: [] }],
      ['BookingAgent', { name: 'BookingAgent', fields: [{ fieldName: 'partyName', fieldType: 'String' }], relationships: [] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'CreateBooking');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('CreateBooking'));

    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "documentParties", ignore = true)');
  });

  it('maps renamed object relationships by schema target instead of inverse field name', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/service-relationships',
          method: 'POST',
          requestBodySchema: 'ServiceRelationshipFVO',
          responseSchema: 'ServiceRelationship',
        },
      ],
      schemas: {
        ServiceRelationship: {
          type: 'object',
          properties: {
            service: { $ref: '#/components/schemas/ServiceRefOrValue' },
          },
        },
        ServiceRelationshipFVO: {
          type: 'object',
          properties: {
            service: { $ref: '#/components/schemas/ServiceRefOrValueFVO' },
          },
        },
        ServiceRefOrValue: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        ServiceRefOrValueFVO: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        Service: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'ServiceRelationship',
        {
          name: 'ServiceRelationship',
          fields: [{ fieldName: 'relationshipType', fieldType: 'String' }],
          relationships: [
            { relationshipName: 'serviceRef', relationshipType: 'many-to-one', otherEntityName: 'ServiceRefOrValue' },
            { relationshipName: 'service', relationshipType: 'many-to-one', otherEntityName: 'Service' },
          ],
        },
      ],
      ['ServiceRefOrValue', { name: 'ServiceRefOrValue', fields: [{ fieldName: 'id', fieldType: 'String' }] }],
      ['Service', { name: 'Service', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'ServiceRelationship');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('ServiceRelationshipFVO'));
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('ServiceRelationship'));

    expect(requestMapping?.annotations).toContain('@Mapping(source = "service", target = "serviceRef")');
    expect(requestMapping?.annotations).toContain('@Mapping(target = "service", ignore = true)');
    expect(responseMapping?.annotations).toContain('@Mapping(source = "serviceRef", target = "service")');
  });

  it('adds response mappings for operation-specific response schemas', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/services',
          method: 'POST',
          requestBodySchema: 'ServiceFVO',
          responseSchema: 'Service_RES',
        },
      ],
      schemas: {
        Service: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        ServiceFVO: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        Service_RES: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Service', { name: 'Service', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Service');

    expect(mapper?.responseMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          methodName: 'toServiceRES',
          sourceType: 'com.example.domain.Service',
          targetType: 'com.example.service.api.dto.ServiceRES',
        }),
      ]),
    );
  });

  it('does not apply JSON text converters to relationship arrays', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/products',
          method: 'POST',
          requestBodySchema: 'ProductSpecification',
          responseSchema: 'ProductSpecification',
        },
      ],
      schemas: {
        ProductSpecification: {
          type: 'object',
          properties: {
            relatedPartys: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelatedPartyRef' },
            },
          },
        },
        RelatedPartyRef: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'ProductSpecification',
        {
          name: 'ProductSpecification',
          fields: [],
          relationships: [{ relationshipName: 'relatedPartys', otherEntityName: 'RelatedPartyRef' }],
        },
      ],
      ['RelatedPartyRef', { name: 'RelatedPartyRef', fields: [] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'ProductSpecification');

    expect(mapper?.requestMappings[0]?.annotations ?? []).not.toContain(
      '@Mapping(source = "relatedPartys", target = "relatedPartys", qualifiedByName = "listToJsonString")',
    );
    expect(mapper?.responseMappings[0]?.annotations ?? []).not.toContain(
      '@Mapping(source = "relatedPartys", target = "relatedPartys", qualifiedByName = "jsonStringToList")',
    );
  });

  it('maps URI-formatted OpenAPI strings to JDL string fields explicitly', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/jobs',
          method: 'POST',
          requestBodySchema: 'ExportJob',
          responseSchema: 'ExportJob',
        },
      ],
      schemas: {
        ExportJob: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri' },
            '@schemaLocation': { type: 'string', format: 'uri' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'ExportJob',
        {
          name: 'ExportJob',
          fields: [
            { fieldName: 'url', fieldType: 'String' },
            { fieldName: 'atSchemaLocation', fieldType: 'String' },
          ],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'ExportJob');

    expect(mapper?.requestMappings[0]?.annotations).toContain('@Mapping(source = "url", target = "url", qualifiedByName = "uriToString")');
    expect(mapper?.responseMappings[0]?.annotations).toContain('@Mapping(source = "url", target = "url", qualifiedByName = "stringToUri")');
    expect(mapper?.requestMappings[0]?.annotations).toContain(
      '@Mapping(source = "atSchemaLocation", target = "atSchemaLocation", qualifiedByName = "uriToString")',
    );
    expect(mapper?.responseMappings[0]?.annotations).toContain(
      '@Mapping(source = "atSchemaLocation", target = "atSchemaLocation", qualifiedByName = "stringToUri")',
    );
  });

  it('normalizes OpenAPI schema keys before using them in Java mapper method names', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/vessel-voyages',
          method: 'POST',
          requestBodySchema: 'Vessel Voyage FVO',
          responseSchema: 'Vessel Voyage',
        },
      ],
      schemas: {
        'Vessel Voyage': {
          type: 'object',
          properties: { id: { type: 'string' }, vesselName: { type: 'string' } },
        },
        'Vessel Voyage FVO': {
          type: 'object',
          properties: { vesselName: { type: 'string' } },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app');
    const mapper = entityMappers.find(m => m.entityName === 'VesselVoyage');

    expect(mapper).toBeDefined();
    expect(mapper?.requestMappings.map(mapping => mapping.methodName)).toContain('toVesselVoyageEntity');
    expect(mapper?.responseMappings.map(mapping => mapping.methodName)).toContain('toVesselVoyageDto');
    expect(mapper?.requestMappings.some(mapping => mapping.sourceType === 'eu.example.app.service.api.dto.VesselVoyageFVO')).toBe(true);
    expect(mapper?.responseMappings.some(mapping => mapping.targetType === 'eu.example.app.service.api.dto.VesselVoyage')).toBe(true);
  });

  it('resolves operation resources to exact generated entity names before singularizing', () => {
    const operation: ParsedOpenAPISpec['operations'][number] = {
      path: '/shipping-instructions',
      method: 'POST',
      requestBodySchema: 'CreateShippingInstructions',
      responseSchema: 'CreateShippingInstructionsResponse',
    };
    const spec: ParsedOpenAPISpec = {
      operations: [operation],
      schemas: {
        CreateShippingInstructions: {
          type: 'object',
          properties: { carrierBookingReference: { type: 'string' } },
        },
        CreateShippingInstructionsResponse: {
          type: 'object',
          properties: { shippingInstructionsReference: { type: 'string' } },
        },
        ShippingInstructions: {
          type: 'object',
          properties: { carrierBookingReference: { type: 'string' } },
        },
      },
    };
    const descriptors = new Map<ParsedOpenAPISpec['operations'][number], OperationDescriptor>([
      [
        operation,
        {
          operation,
          operationType: 'create',
          pathParameters: [],
          requestSchemaNames: ['CreateShippingInstructions'],
          responseSchemaNames: ['CreateShippingInstructionsResponse'],
          resourceName: 'ShippingInstruction',
        },
      ],
    ]);
    const entityDefinitions = new Map<string, any>([
      ['CreateShippingInstructions', { name: 'CreateShippingInstructions', fields: [] }],
      ['CreateShippingInstructionsResponse', { name: 'CreateShippingInstructionsResponse', fields: [] }],
      ['ShippingInstructions', { name: 'ShippingInstructions', fields: [] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'eu.example.app', descriptors, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'CreateShippingInstructions');
    const targetTypes = mapper?.requestMappings.map(mapping => mapping.targetType) ?? [];

    expect(targetTypes).toContain('eu.example.app.domain.ShippingInstructions');
    expect(targetTypes).not.toContain('eu.example.app.domain.ShippingInstruction');
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
    };

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
    };

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
      operationType: 'update',
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
    };

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
      expect.arrayContaining([expect.stringContaining('objectToJsonString')]),
    );
    expect(mapper?.responseMappings?.[0]?.annotations ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining('jsonStringToObject')]),
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
      '@Mapping(source = "hsCodes", target = "hsCodes", qualifiedByName = "objectToJsonString")',
    );
    expect(responseMapping?.annotations).toContain(
      '@Mapping(source = "hsCodes", target = "hsCodes", qualifiedByName = "jsonStringToObject")',
    );
  });

  it('keeps incoming key expressions for collection merges when identifier fields are present', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parents/{id}',
          method: 'PUT',
          requestBodySchema: 'ParentMVO',
          responseSchema: 'Parent',
        },
      ],
      schemas: {
        Child: {
          type: 'object',
          properties: {
            externalId: { type: 'string' },
            id: { type: 'string' },
          },
        },
        Parent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Child' } },
          },
        },
        ParentMVO: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/Child' } },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const mapper = entityMappers.find(entry => entry.entityName === 'Parent');
    expect(mapper).toBeDefined();
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('ParentMVO'));
    const childrenField = requestMapping?.collectionFields?.find(field => field.targetField === 'children');
    expect(childrenField?.existingKeyExpressions).toEqual(['{var}.getExternalId()', '{var}.getId()']);
    expect(childrenField?.incomingKeyExpressions).toEqual(['{var}.getExternalId()', '{var}.getId()']);

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...mapper }, { filename: 'entity-mapper.java.ejs' });
    expect(rendered).toContain('if (incoming == null)');
    expect(rendered).toContain('return existingItems;');
    expect(rendered).not.toContain('existingItems.subList');
    expect(rendered).not.toContain('merged.add(item);');
  });

  it('prefers stable reference identifiers over generated row id for collection merge keys', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/catalogs/{id}',
          method: 'PATCH',
          requestBodySchema: 'CatalogMVO',
          responseSchema: 'Catalog',
        },
        {
          path: '/catalogs',
          method: 'POST',
          requestBodySchema: 'CatalogFVO',
          responseSchema: 'Catalog',
        },
      ],
      schemas: {
        Reference: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int64' },
            tmfId: { type: 'string', format: 'uuid' },
            href: { type: 'string' },
            name: { type: 'string' },
          },
        },
        Catalog: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int64' },
            references: { type: 'array', items: { $ref: '#/components/schemas/Reference' } },
          },
        },
        CatalogMVO: {
          type: 'object',
          properties: {
            references: { type: 'array', items: { $ref: '#/components/schemas/Reference' } },
          },
        },
        CatalogFVO: {
          type: 'object',
          properties: {
            references: { type: 'array', items: { $ref: '#/components/schemas/Reference' } },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const mapper = entityMappers.find(entry => entry.entityName === 'Catalog');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('CatalogMVO'));
    const referencesField = requestMapping?.collectionFields?.find(field => field.targetField === 'references');

    expect(referencesField?.existingKeyExpressions).toEqual(['{var}.getTmfId()', '{var}.getHref()', '{var}.getId()']);
    expect(referencesField?.incomingKeyExpressions).toEqual(['{var}.getTmfId()', '{var}.getHref()', '{var}.getId()']);
    expect(referencesField?.preserveNewItemId).toBe(false);

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...mapper }, { filename: 'entity-mapper.java.ejs' });
    expect(rendered).toContain('Consumer<com.example.domain.Reference> referencesInitializer =\n            item -> item.setId(null);');
  });

  it('adds explicit response mappings for schema-backed child collections', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parents',
          method: 'GET',
          responseSchema: 'Parent',
        },
      ],
      schemas: {
        Child: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        Parent: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/Child' } },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Parent', { name: 'Parent', fields: [], relationships: [{ relationshipName: 'children', otherEntityName: 'Child' }] }],
      ['Child', { name: 'Child', fields: [] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Parent');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Parent'));
    const childrenField = responseMapping?.responseCollectionFields?.find(field => field.targetField === 'children');

    expect(mapper?.usesMappers).toContain('com.example.web.api.mapper.ChildMapper');
    expect(childrenField?.responseMapMethod).toBe('toChildDto');
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "children", expression = "java(mapChildrenToChildrenDto(source.getChildren()))")',
    );

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...mapper }, { filename: 'entity-mapper.java.ejs' });
    expect(rendered).toContain('import org.mapstruct.Named;');
    expect(rendered).toContain('@Named("ParentMapper.mapChildrenToChildrenDto")');
  });

  it('keeps response mappings for reference collection fields in cyclic schema graphs', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/catalogs/{id}',
          method: 'PATCH',
          requestBodySchema: 'ProductCatalogMVO',
          responseSchema: 'ProductCatalog',
        },
      ],
      schemas: {
        ProductCatalog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            categorys: { type: 'array', items: { $ref: '#/components/schemas/CategoryRef' } },
          },
        },
        ProductCatalogMVO: {
          type: 'object',
          properties: {
            categorys: { type: 'array', items: { $ref: '#/components/schemas/CategoryRefMVO' } },
          },
        },
        CategoryRef: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            name: { type: 'string' },
            productCatalog: { $ref: '#/components/schemas/ProductCatalog' },
          },
        },
        CategoryRefMVO: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'ProductCatalog',
        {
          name: 'ProductCatalog',
          fields: [{ fieldName: 'id', fieldType: 'String' }],
          relationships: [{ relationshipName: 'categorys', relationshipType: 'one-to-many', otherEntityName: 'CategoryRef' }],
        },
      ],
      [
        'CategoryRef',
        {
          name: 'CategoryRef',
          fields: [
            { fieldName: 'href', fieldType: 'String' },
            { fieldName: 'name', fieldType: 'String' },
          ],
          relationships: [{ relationshipName: 'productCatalog', relationshipType: 'many-to-one', otherEntityName: 'ProductCatalog' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'ProductCatalog');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('ProductCatalog'));
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('ProductCatalogMVO'));
    const categorysField = requestMapping?.collectionFields?.find(field => field.sourceField === 'categorys');

    expect(categorysField?.preserveNewItemId).toBe(false);
    expect(responseMapping?.responseCollectionFields?.some(field => field.sourceField === 'categorys')).toBe(true);
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "categorys", expression = "java(mapCategorysToCategorysDto(source.getCategorys()))")',
    );

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...mapper }, { filename: 'entity-mapper.java.ejs' });
    expect(rendered).toContain('Consumer<com.example.domain.CategoryRef> categorysInitializer =\n            item -> item.setId(null);');
  });

  it('keeps response mappings for shallow Reference collection fields in cyclic schema graphs', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/orders/{id}',
          method: 'PATCH',
          requestBodySchema: 'OrderMVO',
          responseSchema: 'Order',
        },
      ],
      schemas: {
        Order: {
          type: 'object',
          properties: {
            externalReferences: { type: 'array', items: { $ref: '#/components/schemas/ExternalReference' } },
          },
        },
        OrderMVO: {
          type: 'object',
          properties: {
            externalReferences: { type: 'array', items: { $ref: '#/components/schemas/ExternalReferenceMVO' } },
          },
        },
        ExternalReference: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            name: { type: 'string' },
            order: { $ref: '#/components/schemas/Order' },
          },
        },
        ExternalReferenceMVO: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Order',
        {
          name: 'Order',
          fields: [],
          relationships: [
            { relationshipName: 'externalReferences', relationshipType: 'one-to-many', otherEntityName: 'ExternalReference' },
          ],
        },
      ],
      [
        'ExternalReference',
        {
          name: 'ExternalReference',
          fields: [
            { fieldName: 'href', fieldType: 'String' },
            { fieldName: 'name', fieldType: 'String' },
          ],
          relationships: [{ relationshipName: 'order', relationshipType: 'many-to-one', otherEntityName: 'Order' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Order');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Order'));

    expect(responseMapping?.responseCollectionFields?.some(field => field.sourceField === 'externalReferences')).toBe(true);
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "externalReferences", expression = "java(mapExternalReferencesToExternalReferencesDto(source.getExternalReferences()))")',
    );
  });

  it('does not treat shared schema inheritance as a relationship cycle', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parents/{id}',
          method: 'PATCH',
          requestBodySchema: 'ParentMVO',
          responseSchema: 'Parent',
        },
      ],
      schemas: {
        Extensible: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              Parent: '#/components/schemas/Parent',
              Child: '#/components/schemas/Child',
            },
          },
          properties: {
            '@type': { type: 'string' },
          },
        },
        Parent: {
          allOf: [
            { $ref: '#/components/schemas/Extensible' },
            {
              type: 'object',
              properties: {
                children: { type: 'array', items: { $ref: '#/components/schemas/Child' } },
              },
            },
          ],
        },
        ParentMVO: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/ChildMVO' } },
          },
        },
        Child: {
          allOf: [{ $ref: '#/components/schemas/Extensible' }, { type: 'object', properties: { value: { type: 'string' } } }],
        },
        ChildMVO: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Extensible', { name: 'Extensible', fields: [{ fieldName: 'atType', fieldType: 'String' }] }],
      [
        'Parent',
        {
          name: 'Parent',
          extends: 'Extensible',
          fields: [],
          relationships: [{ relationshipName: 'children', relationshipType: 'one-to-many', otherEntityName: 'Child' }],
        },
      ],
      ['Child', { name: 'Child', extends: 'Extensible', fields: [{ fieldName: 'value', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Parent');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Parent'));

    expect(responseMapping?.responseCollectionFields?.some(field => field.sourceField === 'children')).toBe(true);
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "children", expression = "java(mapChildrenToChildrenDto(source.getChildren()))")',
    );
  });

  it('keeps response mappings for structured relationship collection fields in cyclic schema graphs', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/products/{id}',
          method: 'PATCH',
          requestBodySchema: 'ProductMVO',
          responseSchema: 'Product',
        },
      ],
      schemas: {
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            productRelationships: { type: 'array', items: { $ref: '#/components/schemas/ProductRelationship' } },
          },
        },
        ProductMVO: {
          type: 'object',
          properties: {
            productRelationships: { type: 'array', items: { $ref: '#/components/schemas/ProductRelationshipMVO' } },
          },
        },
        ProductRelationship: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            relationshipType: { type: 'string' },
            product: { $ref: '#/components/schemas/ProductRefOrValue' },
          },
        },
        ProductRelationshipMVO: {
          allOf: [{ $ref: '#/components/schemas/ProductRelationship' }, { type: 'object', properties: { changedBy: { type: 'string' } } }],
        },
        ProductRefOrValue: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              Product: '#/components/schemas/Product',
              ProductRef: '#/components/schemas/ProductRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/Product' }, { $ref: '#/components/schemas/ProductRef' }],
        },
        ProductRef: {
          type: 'object',
          properties: { href: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Product',
        {
          name: 'Product',
          fields: [{ fieldName: 'id', fieldType: 'String' }],
          relationships: [
            { relationshipName: 'productRelationships', relationshipType: 'one-to-many', otherEntityName: 'ProductRelationship' },
          ],
        },
      ],
      [
        'ProductRelationship',
        {
          name: 'ProductRelationship',
          fields: [
            { fieldName: 'href', fieldType: 'String' },
            { fieldName: 'relationshipType', fieldType: 'String' },
          ],
          relationships: [
            {
              relationshipName: 'product',
              relationshipType: 'many-to-one',
              relationshipSide: 'right',
              otherEntityName: 'Product',
              otherEntityRelationshipName: 'productRelationships',
            },
          ],
        },
      ],
    ]);

    const { entityMappers, helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Product');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Product'));

    expect(responseMapping?.responseCollectionFields?.some(field => field.sourceField === 'productRelationships')).toBe(true);
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "productRelationships", expression = "java(mapProductRelationshipsToProductRelationshipsDto(source.getProductRelationships()))")',
    );
    expect(responseMapping?.annotations).not.toContain('@Mapping(target = "productRelationships", ignore = true)');

    const relationshipHelper = helperMappers.find(entry => entry.baseType === 'ProductRelationship');
    expect(relationshipHelper?.baseResponseMethodAnnotations).toContain('@Mapping(target = "product", ignore = true)');
  });

  it('preserves cyclic scalar references that are not inverse domain relationships', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/links/{id}',
          method: 'GET',
          responseSchema: 'ChildLink',
        },
      ],
      schemas: {
        Parent: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/ChildLink' } },
          },
        },
        ChildLink: {
          type: 'object',
          properties: {
            selected: { $ref: '#/components/schemas/Parent' },
            parent: { $ref: '#/components/schemas/Parent' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Parent',
        {
          name: 'Parent',
          fields: [],
          relationships: [
            {
              relationshipName: 'children',
              relationshipType: 'one-to-many',
              relationshipSide: 'left',
              otherEntityName: 'ChildLink',
              otherEntityRelationshipName: 'parent',
            },
          ],
        },
      ],
      [
        'ChildLink',
        {
          name: 'ChildLink',
          fields: [],
          relationships: [
            { relationshipName: 'selected', relationshipType: 'many-to-one', relationshipSide: 'left', otherEntityName: 'Parent' },
            {
              relationshipName: 'parent',
              relationshipType: 'many-to-one',
              relationshipSide: 'right',
              otherEntityName: 'Parent',
              otherEntityRelationshipName: 'children',
            },
          ],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'ChildLink');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('ChildLink'));

    expect(responseMapping?.annotations).not.toContain('@Mapping(target = "selected", ignore = true)');
    expect(responseMapping?.annotations).toContain('@Mapping(target = "parent", ignore = true)');
  });

  it('keeps response mappings for collection fields whose item schema derives from a reference schema', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/offerings/{id}',
          method: 'PATCH',
          requestBodySchema: 'OfferingMVO',
          responseSchema: 'Offering',
        },
      ],
      schemas: {
        EntityRef: {
          type: 'object',
          properties: {
            href: { type: 'string' },
            id: { type: 'integer', format: 'int64' },
            name: { type: 'string' },
          },
        },
        OfferingRef: {
          allOf: [{ $ref: '#/components/schemas/EntityRef' }, { type: 'object', properties: { version: { type: 'string' } } }],
        },
        BundledOffering: {
          allOf: [{ $ref: '#/components/schemas/OfferingRef' }, { type: 'object', properties: { minimum: { type: 'integer' } } }],
        },
        Offering: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int64' },
            bundledOfferings: { type: 'array', items: { $ref: '#/components/schemas/BundledOffering' } },
          },
        },
        OfferingMVO: {
          type: 'object',
          properties: {
            bundledOfferings: { type: 'array', items: { $ref: '#/components/schemas/BundledOffering' } },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Offering',
        {
          name: 'Offering',
          fields: [{ fieldName: 'id', fieldType: 'Long' }],
          relationships: [{ relationshipName: 'bundledOfferings', relationshipType: 'one-to-many', otherEntityName: 'BundledOffering' }],
        },
      ],
      [
        'EntityRef',
        {
          name: 'EntityRef',
          fields: [
            { fieldName: 'href', fieldType: 'String' },
            { fieldName: 'name', fieldType: 'String' },
          ],
        },
      ],
      ['OfferingRef', { name: 'OfferingRef', fields: [{ fieldName: 'version', fieldType: 'String' }] }],
      [
        'BundledOffering',
        {
          name: 'BundledOffering',
          fields: [{ fieldName: 'minimum', fieldType: 'Integer' }],
          relationships: [{ relationshipName: 'offering', relationshipType: 'many-to-one', otherEntityName: 'Offering' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Offering');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('OfferingMVO'));
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Offering'));
    const requestField = requestMapping?.collectionFields?.find(field => field.sourceField === 'bundledOfferings');

    expect(requestField?.preserveNewItemId).toBe(false);
    expect(responseMapping?.responseCollectionFields?.some(field => field.sourceField === 'bundledOfferings')).toBe(true);
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "bundledOfferings", expression = "java(mapBundledOfferingsToBundledOfferingsDto(source.getBundledOfferings()))")',
    );
    expect(responseMapping?.annotations).not.toContain('@Mapping(target = "bundledOfferings", ignore = true)');
  });

  it('renders recursive collection mappers without self autowiring', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/packagings',
          method: 'POST',
          requestBodySchema: 'InnerPackaging',
          responseSchema: 'InnerPackaging',
        },
      ],
      schemas: {
        InnerPackaging: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            innerPackagings: { type: 'array', items: { $ref: '#/components/schemas/InnerPackaging' } },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'InnerPackaging',
        {
          name: 'InnerPackaging',
          fields: [{ fieldName: 'id', fieldType: 'String' }],
          relationships: [{ relationshipName: 'innerPackagings', otherEntityName: 'InnerPackaging' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'InnerPackaging');
    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...mapper }, { filename: 'entity-mapper.java.ejs' });

    expect(mapper?.usesMappers).not.toContain('com.example.web.api.mapper.InnerPackagingMapper');
    expect(rendered).not.toContain('protected com.example.web.api.mapper.InnerPackagingMapper innerPackagingMapper;');
    expect(rendered).toContain('collectionMappingStrategy = CollectionMappingStrategy.TARGET_IMMUTABLE');
    expect(rendered).toContain('.map(this::toInnerPackagingDto)');
    expect(rendered).toContain(
      '(existingItem, incomingItem) -> this.updateInnerPackagingEntityFromInnerPackaging(existingItem, incomingItem)',
    );
    expect(rendered).toContain('incomingItem -> this.toInnerPackagingEntity(incomingItem)');
  });

  it('uses JDL collection relationship names when the OpenAPI array property is singular', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/geographic-addresses',
          method: 'POST',
          requestBodySchema: 'GeographicAddressFVO',
          responseSchema: 'GeographicAddress',
        },
      ],
      schemas: {
        GeographicSubAddress: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        GeographicAddress: {
          type: 'object',
          properties: {
            geographicSubAddress: {
              type: 'array',
              items: { $ref: '#/components/schemas/GeographicSubAddress' },
            },
          },
        },
        GeographicAddressFVO: {
          type: 'object',
          properties: {
            geographicSubAddress: {
              type: 'array',
              items: { $ref: '#/components/schemas/GeographicSubAddress' },
            },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'GeographicAddress',
        {
          name: 'GeographicAddress',
          fields: [],
          relationships: [
            {
              relationshipName: 'geographicSubAddress',
              relationshipType: 'one-to-many',
              otherEntityName: 'GeographicSubAddress',
            },
          ],
        },
      ],
      ['GeographicSubAddress', { name: 'GeographicSubAddress', fields: [{ fieldName: 'value', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'GeographicAddress');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('GeographicAddressFVO'));
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('GeographicAddress'));
    const requestField = requestMapping?.collectionFields?.find(field => field.sourceField === 'geographicSubAddress');
    const responseField = responseMapping?.responseCollectionFields?.find(field => field.sourceField === 'geographicSubAddress');

    expect(requestField?.targetField).toBe('geographicSubAddresses');
    expect(responseField?.targetField).toBe('geographicSubAddresses');
    expect(requestMapping?.annotations).toContain('@Mapping(target = "geographicSubAddresses", ignore = true)');
    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "geographicSubAddress", ignore = true)');
    expect(responseMapping?.annotations).toContain(
      '@Mapping(target = "geographicSubAddress", expression = "java(mapGeographicSubAddressesToGeographicSubAddressDto(source.getGeographicSubAddresses()))")',
    );
  });

  it('does not pluralize collection relationship names that are already plural', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/characteristics',
          method: 'POST',
          requestBodySchema: 'StringCharacteristic',
          responseSchema: 'StringCharacteristic',
        },
      ],
      schemas: {
        CharacteristicRelationship: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        StringCharacteristic: {
          type: 'object',
          properties: {
            characteristicRelationships: {
              type: 'array',
              items: { $ref: '#/components/schemas/CharacteristicRelationship' },
            },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'StringCharacteristic',
        {
          name: 'StringCharacteristic',
          fields: [],
          relationships: [
            {
              relationshipName: 'characteristicRelationships',
              relationshipType: 'one-to-many',
              otherEntityName: 'CharacteristicRelationship',
            },
          ],
        },
      ],
      ['CharacteristicRelationship', { name: 'CharacteristicRelationship', fields: [{ fieldName: 'value', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'StringCharacteristic');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('StringCharacteristic'));
    const requestField = requestMapping?.collectionFields?.find(field => field.sourceField === 'characteristicRelationships');

    expect(requestField?.targetField).toBe('characteristicRelationships');
    expect(requestMapping?.annotations).toContain('@Mapping(target = "characteristicRelationships", ignore = true)');
    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "characteristicRelationshipses", ignore = true)');
  });

  it('does not emit request collection ignores for schema-inherited fields absent from the domain entity', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/organizations',
          method: 'POST',
          requestBodySchema: 'Organization',
          responseSchema: 'Organization',
        },
      ],
      schemas: {
        ExternalIdentifier: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        OtherNameOrganization: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
        Party: {
          type: 'object',
          properties: {
            externalReferences: {
              type: 'array',
              items: { $ref: '#/components/schemas/ExternalIdentifier' },
            },
          },
        },
        Organization: {
          allOf: [
            { $ref: '#/components/schemas/Party' },
            {
              type: 'object',
              properties: {
                otherNames: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/OtherNameOrganization' },
                },
              },
            },
          ],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Party',
        {
          name: 'Party',
          fields: [],
          relationships: [
            {
              relationshipName: 'externalReferences',
              relationshipType: 'one-to-many',
              otherEntityName: 'ExternalIdentifier',
            },
          ],
        },
      ],
      ['PartyOrPartyRole', { name: 'PartyOrPartyRole', fields: [], relationships: [] }],
      [
        'Organization',
        {
          name: 'Organization',
          extends: 'PartyOrPartyRole',
          fields: [],
          relationships: [
            {
              relationshipName: 'otherNames',
              relationshipType: 'one-to-many',
              otherEntityName: 'OtherNameOrganization',
            },
          ],
        },
      ],
      ['ExternalIdentifier', { name: 'ExternalIdentifier', fields: [{ fieldName: 'value', fieldType: 'String' }] }],
      ['OtherNameOrganization', { name: 'OtherNameOrganization', fields: [{ fieldName: 'name', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Organization');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('Organization'));

    expect(requestMapping?.collectionFields?.map(field => field.targetField)).toEqual(['otherNames']);
    expect(requestMapping?.annotations).toContain('@Mapping(target = "otherNames", ignore = true)');
    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "externalReferences", ignore = true)');
  });

  it('uses the DTO schema mapper for collection fields whose domain relationship target has a different name', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parents',
          method: 'GET',
          responseSchema: 'Parent',
        },
      ],
      schemas: {
        ChildModel: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        Parent: {
          type: 'object',
          properties: {
            children: { type: 'array', items: { $ref: '#/components/schemas/ChildModel' } },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Parent', { name: 'Parent', fields: [], relationships: [{ relationshipName: 'children', otherEntityName: 'Child' }] }],
      ['Child', { name: 'Child', fields: [] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Parent');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Parent'));
    const childrenField = responseMapping?.responseCollectionFields?.find(field => field.targetField === 'children');

    expect(mapper?.usesMappers).toContain('com.example.web.api.mapper.ChildModelMapper');
    expect(childrenField?.mapperField).toBe('childModelMapper');
    expect(childrenField?.elementDomainSimple).toBe('Child');
    expect(childrenField?.responseMapMethod).toBe('toChildModelDto');
  });

  it('ignores response object properties backed by scalar domain fields', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/legs',
          method: 'GET',
          responseSchema: 'Leg',
        },
      ],
      schemas: {
        Leg: {
          type: 'object',
          properties: {
            transport: {
              oneOf: [{ $ref: '#/components/schemas/VesselTransport' }, { $ref: '#/components/schemas/BargeTransport' }],
            },
          },
        },
        VesselTransport: {
          type: 'object',
          properties: { vesselName: { type: 'string' } },
        },
        BargeTransport: {
          type: 'object',
          properties: { bargeName: { type: 'string' } },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      ['Leg', { name: 'Leg', fields: [{ fieldName: 'transport', fieldType: 'String' }], relationships: [] }],
      ['VesselTransport', { name: 'VesselTransport', fields: [{ fieldName: 'vesselName', fieldType: 'String' }] }],
      ['BargeTransport', { name: 'BargeTransport', fields: [{ fieldName: 'bargeName', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Leg');
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('Leg'));

    expect(responseMapping?.annotations).toContain('@Mapping(target = "transport", ignore = true)');
  });

  it('uses domain JavaBean property names for acronym-leading relationships', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/issuance-requests',
          method: 'POST',
          requestBodySchema: 'IssuanceRequest',
          responseSchema: 'IssuanceRequest',
        },
      ],
      schemas: {
        IssuanceRequest: {
          type: 'object',
          properties: {
            eBLVisualisationByCarrier: { $ref: '#/components/schemas/SupportingDocument' },
          },
        },
        SupportingDocument: {
          type: 'object',
          properties: {
            content: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'IssuanceRequest',
        {
          name: 'IssuanceRequest',
          fields: [],
          relationships: [
            {
              relationshipName: 'eBLVisualisationByCarrier',
              relationshipFieldName: 'eBLVisualisationByCarrier',
              otherEntityName: 'SupportingDocument',
            },
          ],
        },
      ],
      ['SupportingDocument', { name: 'SupportingDocument', fields: [{ fieldName: 'content', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'IssuanceRequest');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('IssuanceRequest'));
    const responseMapping = mapper?.responseMappings.find(entry => entry.targetType.endsWith('IssuanceRequest'));

    expect(requestMapping?.annotations).not.toContain(
      '@Mapping(source = "eBLVisualisationByCarrier", target = "EBLVisualisationByCarrier")',
    );
    expect(requestMapping?.annotations).not.toContain('@Mapping(target = "eBLVisualisationByCarrier", ignore = true)');
    expect(responseMapping?.annotations).not.toContain(
      '@Mapping(source = "EBLVisualisationByCarrier", target = "eBLVisualisationByCarrier")',
    );
  });

  it('preserves inherited read-only required UUID fields during updates', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/services/{id}',
          method: 'PATCH',
          requestBodySchema: 'ServiceMVO',
          responseSchema: 'Service',
        },
      ],
      schemas: {
        ServiceRefOrValue: {
          type: 'object',
          required: ['tmfId'],
          properties: {
            tmfId: { type: 'string', format: 'uuid', readOnly: true },
          },
        },
        Service: {
          allOf: [{ $ref: '#/components/schemas/ServiceRefOrValue' }, { type: 'object', properties: { description: { type: 'string' } } }],
        },
        ServiceMVO: {
          allOf: [{ $ref: '#/components/schemas/ServiceRefOrValue' }, { type: 'object', properties: { description: { type: 'string' } } }],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'ServiceRefOrValue',
        {
          name: 'ServiceRefOrValue',
          fields: [{ fieldName: 'tmfId', fieldType: 'UUID', fieldValidateRules: ['required'] }],
        },
      ],
      ['Service', { name: 'Service', extends: 'ServiceRefOrValue', fields: [{ fieldName: 'description', fieldType: 'String' }] }],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'Service');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('ServiceMVO'));

    expect(requestMapping?.generatedUuidFields).toContainEqual({ fieldName: 'tmfId', accessor: 'TmfId' });
  });

  it('initializes hidden JHipster blob content type fields from schema media type properties', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/supporting-documents',
          method: 'POST',
          requestBodySchema: 'SupportingDocument',
          responseSchema: 'SupportingDocument',
        },
      ],
      schemas: {
        SupportingDocument: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', format: 'byte' },
            contentType: { type: 'string', default: 'application/pdf' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'SupportingDocument',
        {
          name: 'SupportingDocument',
          fields: [
            { fieldName: 'content', fieldType: 'Blob', fieldValidateRules: ['required'] },
            { fieldName: 'contentType', fieldType: 'String' },
          ],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const mapper = entityMappers.find(entry => entry.entityName === 'SupportingDocument');
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('SupportingDocument'));
    const generatedField = requestMapping?.generatedDefaultFields?.find(field => field.fieldName === 'contentContentType');

    expect(generatedField).toMatchObject({
      accessor: 'ContentContentType',
      presenceAccessor: 'Content',
      valueExpression: 'source != null && source.getContentType() != null ? source.getContentType() : "application/octet-stream"',
    });
  });

  it('derives merge keys from referenced identifier fields when element has none', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/parents/{id}',
          method: 'PATCH',
          requestBodySchema: 'ParentMVO',
          responseSchema: 'Parent',
        },
      ],
      schemas: {
        ReferenceObject: {
          type: 'object',
          properties: {
            externalId: { type: 'string' },
          },
        },
        Association: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            referenceObject: { $ref: '#/components/schemas/ReferenceObject' },
          },
        },
        Parent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            associations: { type: 'array', items: { $ref: '#/components/schemas/Association' } },
          },
        },
        ParentMVO: {
          type: 'object',
          properties: {
            associations: { type: 'array', items: { $ref: '#/components/schemas/Association' } },
          },
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'eu.example');
    const mapper = entityMappers.find(entry => entry.entityName === 'Parent');
    expect(mapper).toBeDefined();
    const requestMapping = mapper?.requestMappings.find(entry => entry.sourceType.endsWith('ParentMVO'));
    const associationsField = requestMapping?.collectionFields?.find(field => field.targetField === 'associations');
    const expectedExpr = '{var}.getReferenceObject() != null ? {var}.getReferenceObject().getExternalId() : null';
    expect(associationsField?.existingKeyExpressions).toEqual([expectedExpr]);
    expect(associationsField?.incomingKeyExpressions).toEqual([expectedExpr]);
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

  it('adds helper dependencies for entity mappers that touch abstract targets', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        PartyRole: {
          type: 'object',
          properties: {
            paymentMethods: {
              type: 'array',
              items: { $ref: '#/components/schemas/PaymentMethodRef' },
            },
            engagedParty: { $ref: '#/components/schemas/PartyRef' },
          },
        },
        PaymentMethodRef: {
          allOf: [{ $ref: '#/components/schemas/EntityRefOrValue' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        EntityRefOrValue: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              payment: '#/components/schemas/PaymentMethodRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/EntityRef' }],
        },
        EntityRef: {
          type: 'object',
          properties: { externalId: { type: 'string' } },
        },
        PartyRef: {
          allOf: [{ $ref: '#/components/schemas/PartyRefOrPartyRoleRef' }, { type: 'object', properties: { id: { type: 'string' } } }],
        },
        PartyRoleRef: {
          allOf: [{ $ref: '#/components/schemas/PartyRefOrPartyRoleRef' }, { type: 'object', properties: { role: { type: 'string' } } }],
        },
        PartyRefOrPartyRoleRef: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              party: '#/components/schemas/PartyRef',
              partyRole: '#/components/schemas/PartyRoleRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/PartyRef' }, { $ref: '#/components/schemas/PartyRoleRef' }],
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const partyRoleMapper = entityMappers.find(entry => entry.entityName === 'PartyRole');
    expect(partyRoleMapper).toBeDefined();
    expect(partyRoleMapper?.usesMappers).toEqual(
      expect.arrayContaining([
        'com.example.web.api.mapper.EntityRefOrValueMapper',
        'com.example.web.api.mapper.PartyRefOrPartyRoleRefMapper',
      ]),
    );
  });

  it('keeps mapper dependencies for concrete collections with nested polymorphic references', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/catalogs',
          method: 'POST',
          requestBodySchema: 'CatalogFVO',
          responseSchema: 'Catalog',
        },
      ],
      schemas: {
        Catalog: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            relatedPartys: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelatedPartyRefOrPartyRoleRef' },
            },
          },
        },
        CatalogFVO: {
          type: 'object',
          properties: {
            relatedPartys: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelatedPartyRefOrPartyRoleRef' },
            },
          },
        },
        RelatedPartyRefOrPartyRoleRef: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            partyOrPartyRole: { $ref: '#/components/schemas/PartyRefOrPartyRoleRef' },
          },
        },
        PartyRef: {
          allOf: [{ $ref: '#/components/schemas/PartyRefOrPartyRoleRef' }, { type: 'object', properties: { id: { type: 'string' } } }],
        },
        PartyRoleRef: {
          allOf: [{ $ref: '#/components/schemas/PartyRefOrPartyRoleRef' }, { type: 'object', properties: { role: { type: 'string' } } }],
        },
        PartyRefOrPartyRoleRef: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              PartyRef: '#/components/schemas/PartyRef',
              PartyRoleRef: '#/components/schemas/PartyRoleRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/PartyRef' }, { $ref: '#/components/schemas/PartyRoleRef' }],
        },
      },
    };

    const { entityMappers } = generateHybridMappers(spec, 'com.example');
    const catalogMapper = entityMappers.find(entry => entry.entityName === 'Catalog');
    const relatedPartyMapper = entityMappers.find(entry => entry.entityName === 'RelatedPartyRefOrPartyRoleRef');

    expect(catalogMapper?.usesMappers).toEqual(expect.arrayContaining(['com.example.web.api.mapper.RelatedPartyRefOrPartyRoleRefMapper']));
    expect(relatedPartyMapper?.usesMappers).toEqual(expect.arrayContaining(['com.example.web.api.mapper.PartyRefOrPartyRoleRefMapper']));
  });

  it('ignores object collections on polymorphic base helper methods instead of inline abstract mapping', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        Catalog: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              ProductCatalog: '#/components/schemas/ProductCatalog',
            },
          },
          properties: {
            relatedPartys: {
              type: 'array',
              items: { $ref: '#/components/schemas/RelatedPartyRefOrPartyRoleRef' },
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            auditEntries: {
              type: 'array',
              items: { $ref: '#/components/schemas/AuditEntry' },
            },
          },
        },
        ProductCatalog: {
          allOf: [{ $ref: '#/components/schemas/Catalog' }, { type: 'object', properties: { name: { type: 'string' } } }],
        },
        ProductCatalogFVO: {
          allOf: [
            { $ref: '#/components/schemas/ProductCatalog' },
            {
              type: 'object',
              properties: {
                relatedPartys: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/RelatedPartyRefOrPartyRoleRef' },
                },
              },
            },
          ],
        },
        ProductCatalogConcreteChild: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
        AuditEntry: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            sequence: { type: 'integer' },
          },
        },
        ProductCatalogMVO: {
          allOf: [
            { $ref: '#/components/schemas/ProductCatalog' },
            {
              type: 'object',
              properties: {
                concreteChildren: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ProductCatalogConcreteChild' },
                },
              },
            },
          ],
        },
        RelatedPartyRefOrPartyRoleRef: {
          type: 'object',
          properties: {
            partyOrPartyRole: { $ref: '#/components/schemas/PartyRefOrPartyRoleRef' },
          },
        },
        PartyRefOrPartyRoleRef: {
          type: 'object',
          discriminator: {
            propertyName: '@type',
            mapping: {
              PartyRef: '#/components/schemas/PartyRef',
            },
          },
          oneOf: [{ $ref: '#/components/schemas/PartyRef' }],
        },
        PartyRef: {
          allOf: [{ $ref: '#/components/schemas/PartyRefOrPartyRoleRef' }, { type: 'object', properties: { id: { type: 'string' } } }],
        },
      },
    };

    const entityDefinitions = new Map<string, any>([
      [
        'Catalog',
        {
          name: 'Catalog',
          fields: [],
          relationships: [
            { relationshipName: 'relatedPartys', otherEntityName: 'RelatedPartyRefOrPartyRoleRef', relationshipType: 'one-to-many' },
          ],
        },
      ],
      ['ProductCatalog', { name: 'ProductCatalog', extends: 'Catalog', fields: [] }],
      ['RelatedPartyRefOrPartyRoleRef', { name: 'RelatedPartyRefOrPartyRoleRef', fields: [] }],
      ['ProductCatalogConcreteChild', { name: 'ProductCatalogConcreteChild', fields: [] }],
      [
        'AuditEntry',
        {
          name: 'AuditEntry',
          fields: [
            { fieldName: 'code', fieldType: 'String' },
            { fieldName: 'sequence', fieldType: 'Integer' },
          ],
        },
      ],
    ]);

    const { helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const catalogHelper = helperMappers.find(entry => entry.baseType === 'Catalog');

    expect(catalogHelper?.baseMethodAnnotations).toContain('@Mapping(target = "relatedPartys", ignore = true)');
    expect(catalogHelper?.baseResponseMethodAnnotations).toContain('@Mapping(target = "relatedPartys", ignore = true)');
    expect(catalogHelper?.baseMethodAnnotations).not.toContain('@Mapping(target = "tags", ignore = true)');
    expect(catalogHelper?.baseMethodAnnotations).not.toContain('@Mapping(target = "auditEntries", ignore = true)');
    expect(catalogHelper?.baseResponseMethodAnnotations).not.toContain('@Mapping(target = "auditEntries", ignore = true)');
    const productCatalogFvo = catalogHelper?.variants.find(variant => variant.dtoSimpleName === 'ProductCatalogFVO');
    expect(productCatalogFvo?.annotations).toContain('@Mapping(target = "relatedPartys", ignore = true)');
    const productCatalogMvo = catalogHelper?.variants.find(variant => variant.dtoSimpleName === 'ProductCatalogMVO');
    expect(productCatalogMvo?.annotations).not.toContain('@Mapping(target = "concreteChildren", ignore = true)');

    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      {
        ...catalogHelper!,
        locals: {
          baseMethodAnnotations: catalogHelper?.baseMethodAnnotations,
          baseResponseMethodAnnotations: catalogHelper?.baseResponseMethodAnnotations,
        },
      },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );
    expect(rendered).toContain('@Named("updateCatalogBaseFromProductCatalogFVO")');
    expect(rendered).toContain('collectionMappingStrategy = CollectionMappingStrategy.TARGET_IMMUTABLE');
    expect(rendered).toContain('@Mapping(target = "relatedPartys", ignore = true)\n    @Named("updateCatalogBaseFromProductCatalogFVO")');

    const renderedWithCanonicalDto = ejs.render(
      template,
      {
        ...catalogHelper!,
        canonicalBaseDtoType: 'com.example.service.api.dto.Catalog',
        locals: {
          baseMethodAnnotations: catalogHelper?.baseMethodAnnotations,
          baseResponseMethodAnnotations: catalogHelper?.baseResponseMethodAnnotations,
        },
      },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );
    expect(renderedWithCanonicalDto).toContain(
      '@Mapping(target = "relatedPartys", ignore = true)\n    @Named("mapCatalogCanonicalBaseDto")',
    );
    expect(renderedWithCanonicalDto).toContain(
      '@Mapping(target = "relatedPartys", ignore = true)\n    @Mapping(target = "id", ignore = true)\n    @Named("updateCatalogBaseFromCatalog")',
    );
  });

  it('treats bases with only allOf-derived variants as polymorphic for helper generation', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [],
      schemas: {
        EntityRefOrValue: {
          type: 'object',
          properties: {
            externalId: { type: 'string' },
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

  it('renders polymorphic helper mapper dependencies as lazy injection points', () => {
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
      expect.arrayContaining(['com.example.web.api.mapper.ContactPointMapper', 'com.example.web.api.mapper.RelatedPartyRefOrValueMapper']),
    );

    const template = readFileSync(new URL('../templates/polymorphic-helper-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(
      template,
      {
        ...partyHelper!,
        locals: {
          baseMethodAnnotations: partyHelper?.baseMethodAnnotations,
          baseResponseMethodAnnotations: partyHelper?.baseResponseMethodAnnotations,
        },
      },
      { filename: 'polymorphic-helper-mapper.java.ejs' },
    );
    expect(rendered).toContain('@Autowired\n    @Lazy\n    protected com.example.web.api.mapper.ContactPointMapper contactPointMapper;');
  });

  it('generates direct collection replace semantics with a lazy nested mapper dependency', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/shipments',
          method: 'POST',
          requestBodySchema: 'ShipmentDTO',
          responseSchema: 'ShipmentDTO',
        },
      ],
      schemas: {
        ShipmentDTO: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/ShipmentItemDTO' },
            },
          },
        },
        ShipmentItemDTO: {
          type: 'object',
          properties: {
            isSpecial: { type: 'boolean' },
          },
        },
      },
    };

    const entityDefinitions = new Map<string, any>([
      [
        'Shipment',
        {
          name: 'Shipment',
          fields: [],
          relationships: [
            {
              relationshipName: 'items',
              relationshipType: 'one-to-many',
              otherEntityName: 'ShipmentItem',
            },
          ],
        },
      ],
      [
        'ShipmentItem',
        {
          name: 'ShipmentItem',
          fields: [{ fieldName: 'isSpecial', fieldType: 'Boolean' }],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const shipmentMapper = entityMappers.find(entry => entry.entityName === 'Shipment');
    expect(shipmentMapper).toBeDefined();

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...shipmentMapper }, { filename: 'entity-mapper.java.ejs' });

    expect(rendered).not.toContain('itemsExistingKey');
    expect(rendered).not.toContain('itemsIncomingKey');
    expect(rendered).not.toContain('mergedItems = mergeCollection(');
    expect(rendered).toContain('List<com.example.domain.ShipmentItem> replacedItems = new ArrayList<>();');
    expect(rendered).toContain('for (com.example.service.api.dto.ShipmentItemDTO incomingItem : source.getItems())');
    expect(rendered).toContain('target.setItems(replacedItems);');
    expect(rendered).toContain('@Autowired\n    @Lazy\n    protected com.example.web.api.mapper.ShipmentItemMapper shipmentItemMapper;');
  });

  it('preserves existing entity values when a PATCH request omits properties', () => {
    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/owners/{id}',
          method: 'PATCH',
          requestBodySchema: 'OwnerMVO',
          responseSchema: 'Owner',
        },
      ],
      schemas: {
        Owner: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        OwnerMVO: {
          type: 'object',
          properties: {
            firstName: { type: 'string' },
          },
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Owner',
        {
          name: 'Owner',
          fields: [
            { fieldName: 'firstName', fieldType: 'String' },
            { fieldName: 'lastName', fieldType: 'String' },
          ],
        },
      ],
    ]);

    const { entityMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const ownerMapper = entityMappers.find(entry => entry.entityName === 'Owner');
    const patchMapping = ownerMapper?.requestMappings.find(entry => entry.sourceSchemaName === 'OwnerMVO');
    expect(patchMapping?.ignoreNullsOnUpdate).toBe(true);

    const template = readFileSync(new URL('../templates/entity-mapper.java.ejs', import.meta.url), 'utf8');
    const rendered = ejs.render(template, { ...ownerMapper }, { filename: 'entity-mapper.java.ejs' });
    expect(rendered).toContain('@BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)');
  });
});
