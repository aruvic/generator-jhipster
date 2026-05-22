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

import { readFileSync } from 'node:fs';

import ejs from 'ejs';
import { describe, expect, it } from 'esmocha';

describe('MapStruct mapper generator', () => {
  it('registers OpenAPI oneOf Jackson support as an additive module bean', () => {
    const template = readFileSync(new URL('../templates/openapi-oneof-deserializer-configuration.java.ejs', import.meta.url), 'utf-8');
    const rendered = ejs.render(template, { packageName: 'com.example' });

    expect(rendered).toContain('public Module openApiOneOfDeserializersModule()');
    expect(rendered).toContain('return module;');
    expect(rendered).not.toContain('Jackson2ObjectMapperBuilderCustomizer');
    expect(rendered).not.toContain('modulesToInstall');
  });
});
