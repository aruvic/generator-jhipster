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

import { collectImports, generateMapperContexts } from './mapper-context-builder.ts';
import type { MapperContext, ParsedOpenAPISpec } from './openapi-mapper-generator.ts';

describe('Mapper Context Builder', () => {
  describe('generateMapperContexts', () => {
    it('should generate mapper context for create operation', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties',
            method: 'POST',
            operationId: 'createParty',
            requestBodySchema: 'PartyFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyFVO: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
          Party: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');

      expect(contexts.length).toBeGreaterThan(0);
      const createMapper = contexts.find(c => c.mapperName.includes('Create'));
      expect(createMapper).toBeDefined();
      expect(createMapper?.methods.some(m => m.isCreate)).toBe(true);
    });

    it('should generate mapper context for update operation', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties/{id}',
            method: 'PUT',
            operationId: 'updateParty',
            requestBodySchema: 'PartyFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyFVO: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
          Party: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');

      expect(contexts.length).toBeGreaterThan(0);
      const updateMapper = contexts.find(c => c.mapperName.includes('Update'));
      expect(updateMapper).toBeDefined();
      expect(updateMapper?.methods.some(m => m.isUpdate)).toBe(true);
    });

    it('should generate mapper context for read operation', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties/{id}',
            method: 'GET',
            operationId: 'getPartyById',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          Party: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');

      expect(contexts.length).toBeGreaterThan(0);
      const readMapper = contexts.find(c => c.mapperName.includes('Response'));
      expect(readMapper).toBeDefined();
    });

    it('should handle nested objects', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties',
            method: 'POST',
            operationId: 'createParty',
            requestBodySchema: 'PartyFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyFVO: {
            type: 'object',
            properties: {
              contact: { $ref: '#/components/schemas/ContactFVO' },
            },
          },
          ContactFVO: {
            type: 'object',
            properties: {
              email: { type: 'string' },
            },
          },
          Party: {
            type: 'object',
            properties: {
              contact: { $ref: '#/components/schemas/Contact' },
            },
          },
          Contact: {
            type: 'object',
            properties: {
              email: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');

      // Should generate mappers for both PartyFVO and ContactFVO
      expect(contexts.length).toBeGreaterThan(0);
      const hasContactMapping = contexts.some(c => c.methods.some(m => m.methodName.includes('Contact')));
      expect(hasContactMapping).toBe(true);
    });

    it('should apply ID ignore mapping for create operations', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties',
            method: 'POST',
            operationId: 'createParty',
            requestBodySchema: 'PartyFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyFVO: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
          Party: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');
      const createMapper = contexts.find(c => c.mapperName.includes('Create'));

      expect(createMapper).toBeDefined();
      const dtoToDomainMethod = createMapper?.methods.find(m => m.methodName.includes('Entity'));
      expect(dtoToDomainMethod?.annotations.some(a => a.includes('id'))).toBe(true);
    });

    it('should handle polymorphic types with oneOf', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties',
            method: 'POST',
            operationId: 'createParty',
            requestBodySchema: 'PartyRefOrValueFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyRefOrValueFVO: {
            oneOf: [{ $ref: '#/components/schemas/PartyFVO' }, { $ref: '#/components/schemas/PartyRefFVO' }],
          },
          PartyFVO: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
          PartyRefFVO: {
            type: 'object',
            properties: { ref: { type: 'string' } },
          },
          Party: {
            type: 'object',
            properties: { id: { type: 'string' } },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');
      const createMapper = contexts.find(c => c.mapperName.includes('Create'));

      expect(createMapper?.polymorphicTypes).toBeDefined();
      expect(createMapper?.polymorphicTypes?.length).toBeGreaterThan(0);
    });

    it('should ignore abstract properties inherited through allOf fragments', () => {
      const spec: ParsedOpenAPISpec = {
        operations: [
          {
            path: '/parties',
            method: 'POST',
            operationId: 'createParty',
            requestBodySchema: 'PartyFVO',
            responseSchema: 'Party',
          },
        ],
        schemas: {
          PartyFVO: {
            type: 'object',
            properties: {
              taxExemptionCertificates: {
                type: 'array',
                items: { $ref: '#/components/schemas/TaxExemptionCertificateFVO' },
              },
            },
          },
          TaxExemptionCertificateFVO: {
            allOf: [
              { $ref: '#/components/schemas/BaseTaxCertificateFVO' },
              {
                type: 'object',
                properties: {
                  certificateId: { type: 'string' },
                },
              },
            ],
          },
          BaseTaxCertificateFVO: {
            type: 'object',
            properties: {
              attachment: { $ref: '#/components/schemas/AttachmentRefOrValue' },
            },
          },
          AttachmentRefOrValue: {
            oneOf: [{ $ref: '#/components/schemas/AttachmentRef' }],
          },
          AttachmentRef: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
          Party: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      };

      const contexts = generateMapperContexts(spec, 'eu.example.app');
      const taxCertificateMethod = contexts.flatMap(c => c.methods).find(m => m.methodName === 'toTaxExemptionCertificateEntity');

      expect(taxCertificateMethod).toBeDefined();
      expect(taxCertificateMethod?.annotations).toContain('@Mapping(target = "attachment", ignore = true)');
    });
  });

  describe('collectImports', () => {
    it('should collect MapStruct imports', () => {
      const context: MapperContext = {
        mapperName: 'TestMapper',
        packageName: 'eu.example.app.web.api.mapper',
        methods: [],
      };

      const imports = collectImports(context);

      expect(imports).toContain('org.mapstruct.Mapper');
      expect(imports).toContain('org.mapstruct.Mapping');
      expect(imports).toContain('org.mapstruct.ReportingPolicy');
    });

    it('should include UUID import if needed', () => {
      const context: MapperContext = {
        mapperName: 'TestMapper',
        packageName: 'eu.example.app.web.api.mapper',
        methods: [
          {
            methodName: 'test',
            sourceType: 'eu.example.app.service.api.dto.PartyFVO',
            sourceName: 'PartyFVO',
            targetType: 'eu.example.app.domain.Party',
            targetName: 'Party',
            annotations: ['@Mapping(target = "uuid", expression = "java(java.util.UUID.randomUUID())")'],
          },
        ],
      };

      const imports = collectImports(context);

      expect(imports).toContain('java.util.UUID');
    });

    it('should include type imports from methods', () => {
      const context: MapperContext = {
        mapperName: 'TestMapper',
        packageName: 'eu.example.app.web.api.mapper',
        methods: [
          {
            methodName: 'test',
            sourceType: 'eu.example.app.service.api.dto.PartyFVO',
            sourceName: 'PartyFVO',
            targetType: 'eu.example.app.domain.Party',
            targetName: 'Party',
            annotations: [],
          },
        ],
      };

      const imports = collectImports(context);

      expect(imports).toContain('eu.example.app.service.api.dto.PartyFVO');
      expect(imports).toContain('eu.example.app.domain.Party');
    });

    it('should include polymorphic mapping imports', () => {
      const context: MapperContext = {
        mapperName: 'TestMapper',
        packageName: 'eu.example.app.web.api.mapper',
        methods: [],
        polymorphicTypes: [
          {
            baseType: 'eu.example.app.domain.PartyRefOrValue',
            direction: 'domain-to-dto',
            subtypes: [
              {
                sourceType: 'eu.example.app.domain.Party',
                targetType: 'eu.example.app.service.api.dto.PartyFVO',
              },
            ],
          },
        ],
      };

      const imports = collectImports(context);

      expect(imports).toContain('eu.example.app.domain.PartyRefOrValue');
      expect(imports).toContain('org.mapstruct.SubclassMapping');
    });

    it('should not include java package imports except specific ones', () => {
      const context: MapperContext = {
        mapperName: 'TestMapper',
        packageName: 'eu.example.app.web.api.mapper',
        methods: [
          {
            methodName: 'test',
            sourceType: 'java.lang.String',
            sourceName: 'String',
            targetType: 'java.lang.String',
            targetName: 'String',
            annotations: [],
          },
        ],
      };

      const imports = collectImports(context);

      // Should not include java.lang.String
      expect(imports.filter(i => i.startsWith('java.'))).not.toContain('java.lang.String');
    });
  });
});
