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

import {
  buildDomainFqcn,
  buildDtoFqcn,
  buildSchemaGraph,
  extractSchemaRef,
  findNestedSchemas,
  getOperationType,
  isEnumSchema,
  isPolymorphicSchema,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

describe('OpenAPI Mapper Generator', () => {
  describe('extractSchemaRef', () => {
    it('should extract schema name from $ref', () => {
      const result = extractSchemaRef({
        $ref: '#/components/schemas/PartyInteractionFVO',
      });
      expect(result).toBe('PartyInteractionFVO');
    });

    it('should return undefined for objects without $ref', () => {
      const result = extractSchemaRef({ type: 'object' });
      expect(result).toBeUndefined();
    });

    it('should handle empty $ref', () => {
      const result = extractSchemaRef({ $ref: '' });
      expect(result).toBeUndefined();
    });
  });

  describe('stripDtoSuffix', () => {
    it('should strip FVO suffix', () => {
      expect(stripDtoSuffix('PartyInteractionFVO')).toBe('PartyInteraction');
    });

    it('should strip MVO suffix', () => {
      expect(stripDtoSuffix('PartyRoleMVO')).toBe('PartyRole');
    });

    it('should strip separated response DTO role suffix', () => {
      expect(stripDtoSuffix('Resource_RES')).toBe('Resource');
    });

    it('should strip DTO suffix', () => {
      expect(stripDtoSuffix('PartyDTO')).toBe('Party');
    });

    it('should strip Dto suffix', () => {
      expect(stripDtoSuffix('PartyDto')).toBe('Party');
    });

    it('should leave names without suffixes unchanged', () => {
      expect(stripDtoSuffix('PartyInteraction')).toBe('PartyInteraction');
    });
  });

  describe('buildDtoFqcn', () => {
    it('should build correct DTO FQCN', () => {
      const result = buildDtoFqcn('PartyInteractionFVO', 'eu.example.app');
      expect(result).toBe('eu.example.app.service.api.dto.PartyInteractionFVO');
    });
  });

  describe('buildDomainFqcn', () => {
    it('should build correct domain FQCN', () => {
      const result = buildDomainFqcn('PartyInteraction', 'eu.example.app');
      expect(result).toBe('eu.example.app.domain.PartyInteraction');
    });
  });

  describe('buildSchemaGraph', () => {
    it('should build graph with direct property references', () => {
      const schemas = {
        PartyInteractionFVO: {
          type: 'object',
          properties: {
            relatedParty: { $ref: '#/components/schemas/RelatedPartyFVO' },
            name: { type: 'string' },
          },
        },
        RelatedPartyFVO: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      };

      const graph = buildSchemaGraph(schemas);
      expect(graph.size).toBe(2);
      expect(graph.get('PartyInteractionFVO')?.references).toContain('RelatedPartyFVO');
    });

    it('should handle array item references', () => {
      const schemas = {
        PartyInteractionFVO: {
          type: 'object',
          properties: {
            attachments: {
              type: 'array',
              items: { $ref: '#/components/schemas/AttachmentFVO' },
            },
          },
        },
        AttachmentFVO: {
          type: 'object',
        },
      };

      const graph = buildSchemaGraph(schemas);
      expect(graph.get('PartyInteractionFVO')?.references).toContain('AttachmentFVO');
    });

    it('should handle allOf composition', () => {
      const schemas = {
        ExtendedParty: {
          allOf: [{ $ref: '#/components/schemas/Party' }, { properties: { extra: { type: 'string' } } }],
        },
        Party: {
          type: 'object',
        },
      };

      const graph = buildSchemaGraph(schemas);
      expect(graph.get('ExtendedParty')?.allOfRefs).toContain('Party');
    });

    it('should handle oneOf polymorphism', () => {
      const schemas = {
        AttachmentRefOrValue: {
          oneOf: [{ $ref: '#/components/schemas/AttachmentFVO' }, { $ref: '#/components/schemas/AttachmentRef' }],
        },
        AttachmentFVO: { type: 'object' },
        AttachmentRef: { type: 'object' },
      };

      const graph = buildSchemaGraph(schemas);
      expect(graph.get('AttachmentRefOrValue')?.oneOfRefs).toEqual(['AttachmentFVO', 'AttachmentRef']);
    });
  });

  describe('findNestedSchemas', () => {
    it('should find all nested schemas reachable from root', () => {
      const schemas = {
        PartyInteractionFVO: {
          type: 'object',
          properties: {
            party: { $ref: '#/components/schemas/PartyFVO' },
          },
        },
        PartyFVO: {
          type: 'object',
          properties: {
            contact: { $ref: '#/components/schemas/ContactFVO' },
          },
        },
        ContactFVO: {
          type: 'object',
        },
      };

      const graph = buildSchemaGraph(schemas);
      const nested = findNestedSchemas('PartyInteractionFVO', graph);

      expect(nested).toContain('PartyInteractionFVO');
      expect(nested).toContain('PartyFVO');
      expect(nested).toContain('ContactFVO');
    });

    it('should handle circular references', () => {
      const schemas = {
        PartyA: {
          type: 'object',
          properties: {
            relatedB: { $ref: '#/components/schemas/PartyB' },
          },
        },
        PartyB: {
          type: 'object',
          properties: {
            relatedA: { $ref: '#/components/schemas/PartyA' },
          },
        },
      };

      const graph = buildSchemaGraph(schemas);
      const nested = findNestedSchemas('PartyA', graph);

      // Should contain both but not infinitely recurse
      expect(nested).toContain('PartyA');
      expect(nested).toContain('PartyB');
      expect(nested.size).toBe(2);
    });
  });

  describe('getOperationType', () => {
    it('should identify create operation from POST method', () => {
      expect(getOperationType({ path: '/parties', method: 'POST' })).toBe('create');
    });

    it('should identify create operation from operationId', () => {
      expect(
        getOperationType({
          path: '/parties',
          method: 'POST',
          operationId: 'createParty',
        }),
      ).toBe('create');
    });

    it('should identify update operation from PUT method', () => {
      expect(getOperationType({ path: '/parties/{id}', method: 'PUT' })).toBe('update');
    });

    it('should identify update operation from PATCH method', () => {
      expect(getOperationType({ path: '/parties/{id}', method: 'PATCH' })).toBe('update');
    });

    it('should identify read operation from GET method', () => {
      expect(getOperationType({ path: '/parties/{id}', method: 'GET' })).toBe('read');
    });

    it('should identify read operation from get operationId', () => {
      expect(
        getOperationType({
          path: '/parties/{id}',
          method: 'GET',
          operationId: 'getPartyById',
        }),
      ).toBe('read');
    });

    it('should identify delete operation from DELETE method', () => {
      expect(getOperationType({ path: '/parties/{id}', method: 'DELETE' })).toBe('delete');
    });
  });

  describe('isEnumSchema', () => {
    it('should identify string enum', () => {
      expect(
        isEnumSchema({
          type: 'string',
          enum: ['ACTIVE', 'INACTIVE'],
        }),
      ).toBe(true);
    });

    it('should identify integer enum', () => {
      expect(
        isEnumSchema({
          type: 'integer',
          enum: [1, 2, 3],
        }),
      ).toBe(true);
    });

    it('should return false for non-enum', () => {
      expect(isEnumSchema({ type: 'string' })).toBe(false);
    });

    it('should return false for empty enum', () => {
      expect(
        isEnumSchema({
          type: 'string',
          enum: [],
        }),
      ).toBe(false);
    });
  });

  describe('isPolymorphicSchema', () => {
    it('should identify oneOf polymorphism', () => {
      expect(
        isPolymorphicSchema({
          oneOf: [{ $ref: '#/components/schemas/Type1' }, { $ref: '#/components/schemas/Type2' }],
        }),
      ).toBe(true);
    });

    it('should identify anyOf polymorphism', () => {
      expect(
        isPolymorphicSchema({
          anyOf: [{ $ref: '#/components/schemas/Type1' }, { $ref: '#/components/schemas/Type2' }],
        }),
      ).toBe(true);
    });

    it('should return false for non-polymorphic', () => {
      expect(isPolymorphicSchema({ type: 'object' })).toBe(false);
    });

    it('should return false for empty oneOf', () => {
      expect(isPolymorphicSchema({ oneOf: [] })).toBe(false);
    });
  });
});
