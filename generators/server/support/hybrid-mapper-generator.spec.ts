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

describe('Hybrid mapper generator', () => {
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
});
