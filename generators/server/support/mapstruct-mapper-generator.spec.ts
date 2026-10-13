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
import type { ParsedOpenAPISpec } from './openapi-mapper-generator.ts';

describe('MapStruct mapper generator', () => {
  const renderOneOfDeserializer = () => {
    const template = readFileSync(new URL('../templates/openapi-oneof-deserializer-configuration.java.ejs', import.meta.url), 'utf-8');
    return ejs.render(template, { packageName: 'com.example' });
  };

  it('registers OpenAPI oneOf support as a native Jackson 3 module bean', () => {
    const rendered = renderOneOfDeserializer();

    expect(rendered).toContain('public JacksonModule openApiOneOfDeserializersModule()');
    expect(rendered).toContain('import tools.jackson.databind.ValueDeserializer;');
    expect(rendered).toContain('return module;');
    expect(rendered).not.toContain('com.fasterxml.jackson.databind');
  });

  it('selects a single evidenced subtype for a sparse UPDATE payload without requiring omitted properties', () => {
    const rendered = renderOneOfDeserializer();

    expect(rendered).toContain('if (incomingProperties.isEmpty()) {\n                return null;\n            }');
    expect(rendered).toContain('!candidateProperties.containsAll(incomingProperties)');
    expect(rendered).toContain('Class<?> exactMatch = selectClosestType(incomingProperties);');
    expect(rendered).toContain('if (value == null || value.isNull()) {');
    expect(rendered).toContain('return selectClosestType(evidencedProperties);');
    expect(rendered).toContain('return context.readTreeAsValue(node, targetType);');
    expect(rendered).not.toContain('candidateProperties.properties().size()');
    expect(rendered).not.toContain('requiredProperties');
    expect(rendered).not.toContain('NotNull');
  });

  it('selects the unique closest oneOf shape while rejecting ties and invalid payloads', () => {
    const rendered = renderOneOfDeserializer();

    expect(rendered).toContain('candidateProperties == null || !candidateProperties.containsAll(incomingProperties)');
    expect(rendered).toContain('int additionalProperties = candidateProperties.size() - incomingProperties.size();');
    expect(rendered).toContain('if (additionalProperties < fewestAdditionalProperties) {');
    expect(rendered).toContain('} else if (additionalProperties == fewestAdditionalProperties) {');
    expect(rendered).toContain('return ambiguous ? null : matchingType;');
    expect(rendered).toContain('if (Modifier.isStatic(field.getModifiers())) {');
    expect(rendered).toContain('if (!node.isObject()) {\n                return null;\n            }');
    expect(rendered).toContain('if (incomingProperties.isEmpty()) {\n                return null;\n            }');
    expect(rendered).not.toContain('bestScore');
    expect(rendered).not.toContain('bestType');

    const selectClosestShape = (payload: Record<string, unknown>, candidates: Map<string, Set<string>>) => {
      const selectClosestType = (incomingProperties: string[]) => {
        if (incomingProperties.length === 0) {
          return undefined;
        }
        const compatibleCandidates = [...candidates].filter(([, properties]) =>
          incomingProperties.every(property => properties.has(property)),
        );
        const fewestAdditionalProperties = Math.min(
          ...compatibleCandidates.map(([, properties]) => properties.size - incomingProperties.length),
        );
        const closestCandidates = compatibleCandidates.filter(
          ([, properties]) => properties.size - incomingProperties.length === fewestAdditionalProperties,
        );
        return closestCandidates.length === 1 ? closestCandidates[0][0] : undefined;
      };

      const exactMatch = selectClosestType(Object.keys(payload));
      if (exactMatch) {
        return exactMatch;
      }
      const candidateProperties = new Set([...candidates.values()].flatMap(properties => [...properties]));
      return selectClosestType(
        Object.entries(payload)
          .filter(([property, value]) => value !== null && candidateProperties.has(property))
          .map(([property]) => property),
      );
    };

    expect(
      selectClosestShape(
        { code: 'ABC' },
        new Map([
          ['CodeOption', new Set(['code'])],
          ['DetailedOption', new Set(['code', 'name', 'description'])],
        ]),
      ),
    ).toBe('CodeOption');
    expect(
      selectClosestShape(
        { code: 'ABC' },
        new Map([
          ['FirstOption', new Set(['code', 'name'])],
          ['SecondOption', new Set(['code', 'description'])],
        ]),
      ),
    ).toBeUndefined();
    expect(
      selectClosestShape(
        { persistenceId: 42, displayName: 'Example port', accessorCode: 'EXPRT', countryCode: null, WIRECode: 'EXPRT' },
        new Map([
          ['ExternalCodeOption', new Set(['displayName', 'accessorCode', 'WIRECode'])],
          ['CountryCodeOption', new Set(['displayName', 'countryCode'])],
        ]),
      ),
    ).toBe('ExternalCodeOption');
    expect(
      selectClosestShape(
        { id: 1701 },
        new Map([
          ['FirstOption', new Set(['code'])],
          ['SecondOption', new Set(['name'])],
        ]),
      ),
    ).toBeUndefined();
  });

  it('deserializes and maps a nested oneOf request property with inherited fields', () => {
    const rendered = renderOneOfDeserializer();
    expect(rendered).toContain(
      'for (Class<?> currentType = type; currentType != null && currentType != Object.class; currentType = currentType.getSuperclass())',
    );
    expect(rendered).toContain('for (Field field : currentType.getDeclaredFields())');

    const nestedPayload = { displayName: 'Example port', locationCode: 'EXPRT' };
    const inheritedProperties = ['displayName'];
    const candidateProperties = new Map([
      ['CodedPlace', new Set([...inheritedProperties, 'locationCode'])],
      ['NamedPlace', new Set([...inheritedProperties, 'locationName'])],
    ]);
    const matchingTypes = [...candidateProperties]
      .filter(([, properties]) => Object.keys(nestedPayload).every(property => properties.has(property)))
      .map(([type]) => type);
    expect(matchingTypes).toEqual(['CodedPlace']);

    const spec: ParsedOpenAPISpec = {
      operations: [
        {
          path: '/documents/{id}',
          method: 'PATCH',
          requestBodySchema: 'DocumentMVO',
          responseSchema: 'Document',
        },
      ],
      schemas: {
        Document: {
          type: 'object',
          properties: {
            issuePlace: { $ref: '#/components/schemas/PlaceChoice' },
          },
        },
        DocumentMVO: {
          type: 'object',
          properties: {
            issuePlace: { $ref: '#/components/schemas/PlaceChoice' },
          },
        },
        PlaceChoice: {
          oneOf: [{ $ref: '#/components/schemas/CodedPlace' }, { $ref: '#/components/schemas/NamedPlace' }],
        },
        PlaceDetails: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
          },
        },
        CodedPlace: {
          allOf: [
            { $ref: '#/components/schemas/PlaceDetails' },
            {
              type: 'object',
              required: ['locationCode'],
              properties: {
                locationCode: { type: 'string' },
              },
            },
          ],
        },
        NamedPlace: {
          allOf: [
            { $ref: '#/components/schemas/PlaceDetails' },
            {
              type: 'object',
              required: ['locationName'],
              properties: {
                locationName: { type: 'string' },
              },
            },
          ],
        },
      },
    };
    const entityDefinitions = new Map<string, any>([
      [
        'Document',
        {
          name: 'Document',
          fields: [],
          relationships: [{ relationshipName: 'issuePlace', relationshipType: 'many-to-one', otherEntityName: 'PlaceChoice' }],
        },
      ],
      ['PlaceChoice', { name: 'PlaceChoice', abstractClass: true, fields: [] }],
      [
        'CodedPlace',
        {
          name: 'CodedPlace',
          extends: 'PlaceChoice',
          fields: [{ fieldName: 'locationCode', fieldType: 'String' }],
        },
      ],
      [
        'NamedPlace',
        {
          name: 'NamedPlace',
          extends: 'PlaceChoice',
          fields: [{ fieldName: 'locationName', fieldType: 'String' }],
        },
      ],
    ]);

    const { entityMappers, helperMappers } = generateHybridMappers(spec, 'com.example', undefined, undefined, undefined, entityDefinitions);
    const placeMapper = helperMappers.find(mapper => mapper.baseType === 'PlaceChoice');
    const documentMapper = entityMappers.find(mapper => mapper.entityName === 'Document');
    const updateMapping = documentMapper?.requestMappings.find(mapping => mapping.sourceType.endsWith('.DocumentMVO'));

    expect(placeMapper?.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dtoSimpleName: matchingTypes[0],
          mappingMethodName: 'toCodedPlace',
          targetDomainSimpleName: 'CodedPlace',
        }),
      ]),
    );
    expect(documentMapper?.usesMappers).toContain('com.example.web.api.mapper.PlaceChoiceMapper');
    expect(updateMapping?.annotations).not.toContain('@Mapping(target = "issuePlace", ignore = true)');
  });

  it('renders primitive mappings without the Jackson 2 nullable bridge', () => {
    const template = readFileSync(new URL('../templates/openapi-primitive-mapper.java.ejs', import.meta.url), 'utf-8');
    const rendered = ejs.render(template, { packageName: 'com.example.web.api.mapper' });

    expect(rendered).toContain('import tools.jackson.databind.ObjectMapper;');
    expect(rendered).toContain('import tools.jackson.core.JacksonException;');
    expect(rendered).toContain('@Named("jsonStringToArrayWrapper")');
    expect(rendered).toContain('T wrapper = targetType.getDeclaredConstructor().newInstance();');
    expect(rendered).toContain('OBJECT_MAPPER.getTypeFactory().constructType(targetType.getGenericSuperclass())');
    expect(rendered).toContain('((Collection<Object>) target).addAll(values);');
    expect(rendered).not.toContain('com.fasterxml.jackson.databind');
    expect(rendered).not.toContain('JsonNullable');
  });
});
