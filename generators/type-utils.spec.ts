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

import { resolveJavaType } from './type-utils.ts';

const dtoPackage = 'com.example.service.api.dto';

const schemas = {
  Hub: {
    allOf: [
      { $ref: '#/components/schemas/Entity' },
      {
        type: 'object',
        required: ['callback'],
        properties: {
          callback: { type: 'string' },
          query: { type: 'string' },
        },
      },
    ],
  },
  Entity: {
    allOf: [
      { $ref: '#/components/schemas/Extensible' },
      {
        type: 'object',
        properties: {
          id: { type: 'integer', format: 'int64' },
          externalId: { type: 'string', format: 'uuid' },
        },
      },
    ],
  },
  Extensible: {
    type: 'object',
    required: ['@type'],
    properties: {
      '@type': { type: 'string' },
      '@baseType': { type: 'string' },
      '@schemaLocation': { type: 'string' },
    },
  },
  Hub_FVO: {
    allOf: [
      { $ref: '#/components/schemas/Extensible_FVO' },
      {
        type: 'object',
        required: ['callback'],
        properties: {
          callback: { type: 'string' },
          query: { type: 'string' },
        },
      },
    ],
  },
  Extensible_FVO: {
    type: 'object',
    required: ['@type'],
    properties: {
      '@type': { type: 'string' },
      '@baseType': { type: 'string' },
      '@schemaLocation': { type: 'string' },
    },
  },
} as const;

describe('resolveJavaType', () => {
  it('resolves composed entity to the referenced model name', () => {
    const resolved = resolveJavaType({ $ref: '#/components/schemas/Hub' }, { schemas }, { dtoPackage });
    expect(resolved.baseType).toBe('Hub');
    expect(resolved.fullType).toBe('Hub');
    expect(resolved.imports.has(`${dtoPackage}.Hub`)).toBe(true);
  });

  it('resolves composed FVO entity to the referenced model name', () => {
    const resolved = resolveJavaType({ $ref: '#/components/schemas/Hub_FVO' }, { schemas }, { dtoPackage });
    expect(resolved.baseType).toBe('HubFVO');
    expect(resolved.fullType).toBe('HubFVO');
    expect(resolved.imports.has(`${dtoPackage}.HubFVO`)).toBe(true);
  });
});
