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

import { OpenApiEntityMatcher } from './openapi-entity-matcher.ts';
import { parseOpenAPISpec } from './openapi-mapper-generator.ts';

describe('OpenAPI entity matcher', () => {
  it('keeps composed response aliases anchored to the matched resource entity', () => {
    const spec = parseOpenAPISpec(
      `openapi: 3.0.1
paths:
  /resource:
    post:
      operationId: createResource
      tags:
        - resource
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Resource_FVO'
      responses:
        '201':
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Resource_RES'
components:
  schemas:
    Resource:
      type: object
      properties:
        id:
          type: string
    Resource_FVO:
      type: object
      properties:
        name:
          type: string
    Resource_RES:
      type: object
      allOf:
        - $ref: '#/components/schemas/Resource'
`,
      { isFilePath: false },
    );

    const generator = {
      getExistingEntities: () =>
        ['Resource', 'ResourceRes'].map(name => ({
          definition: {
            name,
            entityClass: name,
            entityAbsoluteClass: `com.example.domain.${name}`,
            entityInstance: name.charAt(0).toLowerCase() + name.slice(1),
            entityNameCapitalized: name,
          },
        })),
    };
    const matcher = new OpenApiEntityMatcher(generator, 'com.example');
    const operation = spec.operations.find(candidate => candidate.operationId === 'createResource');
    const descriptor = operation ? matcher.describeOperations(spec).get(operation) : undefined;

    expect(matcher.matchSchemaName('Resource_RES')?.name).toBe('Resource');
    expect(descriptor?.matchedEntity?.name).toBe('Resource');
    expect(descriptor?.responseEntityMatch?.name).toBe('Resource');
  });
});
