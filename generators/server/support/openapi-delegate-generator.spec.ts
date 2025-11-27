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

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'esmocha';

import { generateOpenApiDelegates } from './openapi-delegate-generator.ts';

describe('OpenAPI delegate generator', () => {
  it('uses schema-level matches to select repositories and mappers per operation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /bookings:\n` +
          `    get:\n` +
          `      operationId: listBookings\n` +
          `      responses:\n` +
          `        '200':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                type: array\n` +
          `                items:\n` +
          `                  $ref: '#/components/schemas/Booking'\n` +
          `    post:\n` +
          `      operationId: createBooking\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/CreateBooking'\n` +
          `      responses:\n` +
          `        '201':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/CreateBookingResponse'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Booking:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n` +
          `    CreateBooking:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        booking:\n` +
          `          type: string\n` +
          `    CreateBookingResponse:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        bookingId:\n` +
          `          type: string\n`,
      );

      const interfaceDir = join(tempDir, 'src/main/java/com/example/web/api');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(
        join(interfaceDir, 'BookingApiDelegate.java'),
        `package com.example.web.api;\n\n` +
          `import java.util.List;\n` +
          `import org.springframework.http.ResponseEntity;\n` +
          `import org.springframework.web.bind.annotation.RequestBody;\n` +
          `import com.example.service.api.dto.Booking;\n` +
          `import com.example.service.api.dto.CreateBooking;\n` +
          `import com.example.service.api.dto.CreateBookingResponse;\n\n` +
          `public interface BookingApiDelegate {\n` +
          `    default ResponseEntity<List<Booking>> listBookings() {\n` +
          `        return ResponseEntity.ok(List.of());\n` +
          `    }\n\n` +
          `    default ResponseEntity<CreateBookingResponse> createBooking(@RequestBody CreateBooking createBooking) {\n` +
          `        return ResponseEntity.status(201).body(new CreateBookingResponse());\n` +
          `    }\n` +
          `}\n`,
      );

      const writes = new Map<string, string>();
      const currentDir = fileURLToPath(new URL('.', import.meta.url));
      const rootDir = resolve(currentDir, '../../..');
      const generator = {
        log: {
          debug: () => undefined,
          warn: () => undefined,
          ok: () => undefined,
        },
        destinationPath: (...paths: string[]) => join(tempDir, ...paths),
        readDestination: (relativePath: string) => {
          const absolute = join(tempDir, relativePath);
          return existsSync(absolute) ? readFileSync(absolute) : undefined;
        },
        fetchFromInstalledJHipster: (relativePath: string) => join(rootDir, 'generators', relativePath),
        fs: {
          write: (filePath: string, contents: string) => {
            writes.set(filePath, contents);
          },
          delete: () => undefined,
        },
        getExistingEntities: () => [
          {
            definition: {
              name: 'Booking',
              entityClass: 'Booking',
              entityAbsoluteClass: 'com.example.domain.Booking',
              entityInstance: 'booking',
              entityInstancePlural: 'bookings',
              entityNameCapitalized: 'Booking',
              entityNamePlural: 'Bookings',
              entityNameKebabCase: 'booking',
            },
          },
          {
            definition: {
              name: 'CreateBooking',
              entityClass: 'CreateBooking',
              entityAbsoluteClass: 'com.example.domain.CreateBooking',
              entityInstance: 'createBooking',
              entityInstancePlural: 'createBookings',
              entityNameCapitalized: 'CreateBooking',
            },
          },
          {
            definition: {
              name: 'CreateBookingResponse',
              entityClass: 'CreateBookingResponse',
              entityAbsoluteClass: 'com.example.domain.CreateBookingResponse',
              entityInstance: 'createBookingResponse',
            },
          },
        ],
      };

      const application = {
        enableSwaggerCodegen: true,
        packageName: 'com.example',
        packageNameWithSlashes: 'com/example',
        javaPackageSrcDir: join(tempDir, 'src/main/java/com/example'),
      };

      await generateOpenApiDelegates(generator, application as any);

      const outputPath = join(
        tempDir,
        'src/main/java/com/example/web/api/impl/BookingApiDelegateImpl.java',
      );
      const output = writes.get(outputPath);
      expect(output).toBeDefined();
      expect(output).toContain('private final BookingRepository repository;');
      expect(output).toContain('private final CreateBookingRepository createBookingRepository;');
      expect(output).toContain('private final CreateBookingMapper createBookingMapper;');
      expect(output).toContain('private final CreateBookingResponseMapper createBookingResponseMapper;');
      expect(output).toContain('this.createBookingRepository.save(entity)');
      expect(output).toContain(
        'return ResponseEntity.created(buildLocation(saved)).body(this.createBookingResponseMapper.toCreateBookingResponse(saved));',
      );
      expect(output).toContain('this.repository.findAll()');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
