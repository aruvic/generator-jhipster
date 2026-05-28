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

import { ensureMapperDependency, generateOpenApiDelegates } from './openapi-delegate-generator.ts';

describe('OpenAPI delegate generator', () => {
  it('uses schema-level matches to select repositories and mappers per operation while avoiding duplicate primaries', async () => {
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
          `  /bookings/{bookingId}:\n` +
          `    delete:\n` +
          `      operationId: cancelBooking\n` +
          `      parameters:\n` +
          `        - name: bookingId\n` +
          `          in: path\n` +
          `          required: true\n` +
          `          schema:\n` +
          `            type: string\n` +
          `      responses:\n` +
          `        '202':\n` +
          `          description: Accepted for asynchronous deletion\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Booking:\n` +
          `      discriminator:\n` +
          `        propertyName: kind\n` +
          `        mapping:\n` +
          `          Booking: '#/components/schemas/Booking'\n` +
          `      type: object\n` +
          `      required:\n` +
          `        - kind\n` +
          `      properties:\n` +
          `        kind:\n` +
          `          type: string\n` +
          `        id:\n` +
          `          type: string\n` +
          `        agreements:\n` +
          `          type: array\n` +
          `          items:\n` +
          `            $ref: '#/components/schemas/AgreementRef'\n` +
          `    AgreementRef:\n` +
          `      discriminator:\n` +
          `        propertyName: kind\n` +
          `        mapping:\n` +
          `          AgreementRef: '#/components/schemas/AgreementRef'\n` +
          `      type: object\n` +
          `      required:\n` +
          `        - kind\n` +
          `      properties:\n` +
          `        kind:\n` +
          `          type: string\n` +
          `        id:\n` +
          `          type: string\n` +
          `    CreateBooking:\n` +
          `      discriminator:\n` +
          `        propertyName: kind\n` +
          `        mapping:\n` +
          `          CreateBooking: '#/components/schemas/CreateBooking'\n` +
          `      type: object\n` +
          `      required:\n` +
          `        - kind\n` +
          `      properties:\n` +
          `        kind:\n` +
          `          type: string\n` +
          `        booking:\n` +
          `          type: string\n` +
          `        equipment:\n` +
          `          $ref: '#/components/schemas/ShipperOwnedEquipment'\n` +
          `    ShipperOwnedEquipment:\n` +
          `      discriminator:\n` +
          `        propertyName: isShipperOwned\n` +
          `      type: object\n` +
          `      required:\n` +
          `        - isShipperOwned\n` +
          `      properties:\n` +
          `        isShipperOwned:\n` +
          `          type: boolean\n` +
          `          enum:\n` +
          `            - false\n` +
          `            - true\n` +
          `    CreateBookingResponse:\n` +
          `      discriminator:\n` +
          `        propertyName: kind\n` +
          `        mapping:\n` +
          `          CreateBookingResponse: '#/components/schemas/CreateBookingResponse'\n` +
          `      type: object\n` +
          `      required:\n` +
          `        - kind\n` +
          `      properties:\n` +
          `        kind:\n` +
          `          type: string\n` +
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
          `\n` +
          `    default ResponseEntity<Void> cancelBooking(String bookingId) {\n` +
          `        return ResponseEntity.accepted().build();\n` +
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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

      const outputPath = join(tempDir, 'src/main/java/com/example/web/api/impl/BookingApiDelegateImpl.java');
      const output = writes.get(outputPath) ?? '';
      expect(output).toContain('private final BookingRepository repository;');
      expect(output).toContain('private final BookingMapper mapper;');
      expect(output).toContain('private final CreateBookingMapper createBookingMapper;');
      expect(output).toContain('private final CreateBookingResponseMapper createBookingResponseMapper;');
      expect(output).not.toContain('CreateBookingRepository');
      expect(output).toContain('validatePayload(createBooking);');
      expect(output).toContain(
        'validatePayloadDiscriminators(createBooking, List.of(new DiscriminatorRule("", "kind", Set.of("CreateBooking")), new DiscriminatorRule("/equipment", "isShipperOwned", Set.of("false", "true"))));',
      );
      expect(output).toContain('return value != null && value.isValueNode() && allowedValues.contains(value.asText());');
      expect(output.indexOf('validatePayload(createBooking);')).toBeLessThan(
        output.indexOf('com.example.domain.Booking entity = this.createBookingMapper.toBookingEntity(createBooking);'),
      );
      expect(output).toContain('com.example.domain.Booking entity = this.createBookingMapper.toBookingEntity(createBooking);');
      expect(output).toContain('CreateBookingResponse responseBody = mapResponseBody(() -> this.createBookingResponseMapper.toCreateBookingResponse(saved));');
      expect(output).toContain(
        'requireValidResponseDiscriminators(responseBody, List.of(new DiscriminatorRule("", "kind", Set.of("CreateBookingResponse"))));',
      );
      expect(output).toContain('List<Booking> body = mapValidResponseBodies(entities, this.mapper::toBookingDto);');
      expect(output).toContain(
        'body = filterValidResponseDiscriminators(body, List.of(new DiscriminatorRule("", "kind", Set.of("Booking")), new DiscriminatorRule("/agreements/*", "kind", Set.of("AgreementRef"))));',
      );
      expect(output).toContain('private List<JsonNode> discriminatorTargets(JsonNode root, String pointer)');
      expect(output).toContain('this.objectMapper.writeValueAsBytes(body);');
      expect(output).toContain('return isValidResponseBody(filtered) ? filtered : value;');
      expect(output).toContain('final HttpStatus successStatus = resolveSuccessStatus(202, HttpStatus.NO_CONTENT);');
      expect(output).toContain('if (successStatus == HttpStatus.ACCEPTED) {\n                return ResponseEntity.accepted().build();');
      expect(output).not.toContain('successStatus = HttpStatus.NO_CONTENT;');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the persistence mapper when an operation response DTO differs from the persisted entity', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
          `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /services:\n` +
          `    get:\n` +
          `      operationId: listService\n` +
          `      responses:\n` +
          `        '200':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                type: array\n` +
          `                items:\n` +
          `                  $ref: '#/components/schemas/Service_RES'\n` +
          `    post:\n` +
          `      operationId: createService\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/Service_FVO'\n` +
          `      responses:\n` +
          `        '201':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/Service_RES'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Service:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n` +
          `    Service_FVO:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n` +
          `    Service_RES:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n`,
      );

      const interfaceDir = join(tempDir, 'src/main/java/com/example/web/api');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(
        join(interfaceDir, 'ServiceApiDelegate.java'),
        `package com.example.web.api;\n\n` +
          `import java.util.List;\n` +
          `import org.springframework.http.ResponseEntity;\n` +
          `import org.springframework.web.bind.annotation.RequestBody;\n` +
          `import com.example.service.api.dto.ServiceFVO;\n` +
          `import com.example.service.api.dto.ServiceRES;\n\n` +
          `public interface ServiceApiDelegate {\n` +
          `    default ResponseEntity<List<ServiceRES>> listService() {\n` +
          `        return ResponseEntity.ok(List.of());\n` +
          `    }\n\n` +
          `    default ResponseEntity<ServiceRES> createService(@RequestBody ServiceFVO serviceFVO) {\n` +
          `        return ResponseEntity.status(201).body(new ServiceRES());\n` +
          `    }\n` +
          `}\n`,
      );

      const mapperDir = join(tempDir, 'src/main/java/com/example/web/api/mapper');
      mkdirSync(mapperDir, { recursive: true });
      writeFileSync(
        join(mapperDir, 'ServiceMapper.java'),
        `package com.example.web.api.mapper;\n\n` +
          `public abstract class ServiceMapper {\n` +
          `    public abstract com.example.domain.Service toServiceEntity(com.example.service.api.dto.ServiceFVO source);\n` +
          `    public abstract com.example.service.api.dto.ServiceRES toServiceRES(com.example.domain.Service source);\n` +
          `}\n`,
      );
      writeFileSync(
        join(mapperDir, 'ServiceResMapper.java'),
        `package com.example.web.api.mapper;\n\n` +
          `public abstract class ServiceResMapper {\n` +
          `    public abstract com.example.service.api.dto.ServiceRES toServiceResDto(com.example.domain.ServiceRes source);\n` +
          `    public abstract com.example.service.api.dto.ServiceRES instantiateServiceResDtoFallback();\n` +
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
              name: 'Service',
              entityClass: 'Service',
              entityAbsoluteClass: 'com.example.domain.Service',
              entityInstance: 'service',
              entityNameCapitalized: 'Service',
            },
          },
          {
            definition: {
              name: 'ServiceRes',
              entityClass: 'ServiceRes',
              entityAbsoluteClass: 'com.example.domain.ServiceRes',
              entityInstance: 'serviceRes',
              entityNameCapitalized: 'ServiceRes',
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

      const outputPath = join(tempDir, 'src/main/java/com/example/web/api/impl/ServiceApiDelegateImpl.java');
      const output = writes.get(outputPath) ?? '';
      expect(output).toContain('private final ServiceMapper mapper;');
      expect(output).not.toContain('private final ServiceResMapper serviceResMapper;');
      expect(output).toContain('ServiceRES responseBody = mapResponseBody(() -> this.mapper.toServiceRES(saved));');
      expect(output).toContain('List<ServiceRES> body = mapValidResponseBodies(entities, this.mapper::toServiceRES);');
      expect(output).not.toContain('this.serviceResMapper.toServiceResDto(saved)');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves non-numeric path identifiers through matching scalar entity fields', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /bookings/{bookingReference}:\n` +
          `    get:\n` +
          `      operationId: getBooking\n` +
          `      parameters:\n` +
          `        - name: bookingReference\n` +
          `          in: path\n` +
          `          required: true\n` +
          `          schema:\n` +
          `            type: string\n` +
          `      responses:\n` +
          `        '200':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/Booking'\n` +
          `    put:\n` +
          `      operationId: updateBooking\n` +
          `      parameters:\n` +
          `        - name: bookingReference\n` +
          `          in: path\n` +
          `          required: true\n` +
          `          schema:\n` +
          `            type: string\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/UpdateBooking'\n` +
          `      responses:\n` +
          `        '202':\n` +
          `          description: accepted\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Booking:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        carrierBookingRequestReference:\n` +
          `          type: string\n` +
          `    UpdateBooking:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        carrierBookingRequestReference:\n` +
          `          type: string\n`,
      );

      const interfaceDir = join(tempDir, 'src/main/java/com/example/web/api');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(
        join(interfaceDir, 'BookingApiDelegate.java'),
        `package com.example.web.api;\n\n` +
          `import org.springframework.http.ResponseEntity;\n` +
          `import org.springframework.web.bind.annotation.PathVariable;\n` +
          `import com.example.service.api.dto.Booking;\n\n` +
          `import com.example.service.api.dto.UpdateBooking;\n\n` +
          `public interface BookingApiDelegate {\n` +
          `    default ResponseEntity<Booking> getBooking(@PathVariable("bookingReference") String bookingReference) {\n` +
          `        return ResponseEntity.ok(new Booking());\n` +
          `    }\n` +
          `    default ResponseEntity<Void> updateBooking(@PathVariable("bookingReference") String bookingReference, UpdateBooking updateBooking) {\n` +
          `        return ResponseEntity.accepted().build();\n` +
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
        ],
      };

      const application = {
        enableSwaggerCodegen: true,
        packageName: 'com.example',
        packageNameWithSlashes: 'com/example',
        javaPackageSrcDir: join(tempDir, 'src/main/java/com/example'),
      };

      await generateOpenApiDelegates(generator, application as any);

      const outputPath = join(tempDir, 'src/main/java/com/example/web/api/impl/BookingApiDelegateImpl.java');
      const output = writes.get(outputPath) ?? '';
      expect(output).toContain(
        'findByResourceIdentifier(this.repository, bookingReference, "bookingReference", com.example.domain.Booking.class)',
      );
      expect(output).not.toContain('Optional<Long> parsedId = parseId(bookingReference);');
      expect(output).toContain('private <T> Optional<T> findByResourceIdentifier(');
      expect(output).toContain('public ResponseEntity<Void> updateBooking(');
      expect(output).toContain('UpdateBooking updateBooking)');
      expect(output).toContain('return ResponseEntity.status(successStatus).body((Void) null);');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves OpenAPI parameter order when generated delegate signatures are not available yet', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /v1/port-schedules:\n` +
          `    get:\n` +
          `      operationId: getV1PortSchedules\n` +
          `      parameters:\n` +
          `        - name: UNLocationCode\n` +
          `          in: query\n` +
          `          required: true\n` +
          `          schema:\n` +
          `            type: string\n` +
          `        - name: API-Version\n` +
          `          in: header\n` +
          `          required: false\n` +
          `          schema:\n` +
          `            type: string\n` +
          `        - name: limit\n` +
          `          in: query\n` +
          `          required: false\n` +
          `          schema:\n` +
          `            type: integer\n` +
          `            format: int32\n` +
          `      responses:\n` +
          `        '200':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                type: array\n` +
          `                items:\n` +
          `                  $ref: '#/components/schemas/PortSchedule'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    PortSchedule:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n`,
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
              name: 'PortSchedule',
              entityClass: 'PortSchedule',
              entityAbsoluteClass: 'com.example.domain.PortSchedule',
              entityInstance: 'portSchedule',
              entityInstancePlural: 'portSchedules',
              entityNameCapitalized: 'PortSchedule',
              entityNamePlural: 'PortSchedules',
              entityNameKebabCase: 'port-schedule',
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

      const output = Array.from(writes.values()).join('\n');
      const signatureStart = output.indexOf('public ResponseEntity<List<PortSchedule>> getV1PortSchedules(');
      expect(signatureStart).toBeGreaterThanOrEqual(0);
      const signature = output.slice(signatureStart, output.indexOf(') {', signatureStart));
      expect(signature.indexOf('String unlocationCode')).toBeLessThan(signature.indexOf('String apiVersion'));
      expect(signature.indexOf('String apiVersion')).toBeLessThan(signature.indexOf('Integer limit'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('places required request bodies before optional parameters when generated delegate signatures are not available yet', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /bookings:\n` +
          `    post:\n` +
          `      operationId: createBookings\n` +
          `      parameters:\n` +
          `        - name: API-Version\n` +
          `          in: header\n` +
          `          required: false\n` +
          `          schema:\n` +
          `            type: string\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/CreateBooking'\n` +
          `      responses:\n` +
          `        '202':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/CreateBookingResponse'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    CreateBooking:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        carrierBookingRequestReference:\n` +
          `          type: string\n` +
          `    CreateBookingResponse:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        carrierBookingRequestReference:\n` +
          `          type: string\n`,
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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

      const output = Array.from(writes.values()).join('\n');
      const signatureStart = output.indexOf('public ResponseEntity<CreateBookingResponse> createBookings(');
      expect(signatureStart).toBeGreaterThanOrEqual(0);
      const signature = output.slice(signatureStart, output.indexOf(') {', signatureStart));
      expect(signature.indexOf('CreateBooking createBooking')).toBeLessThan(signature.indexOf('String apiVersion'));
      expect(output).toContain('validatePayload(createBooking);');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('maps create and update operations using the expected MapStruct method names', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /references:\n` +
          `    post:\n` +
          `      operationId: createReference\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/Reference'\n` +
          `      responses:\n` +
          `        '201':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/Reference'\n` +
          `  /references/{referenceId}:\n` +
          `    patch:\n` +
          `      operationId: updateReference\n` +
          `      parameters:\n` +
          `        - name: referenceId\n` +
          `          in: path\n` +
          `          required: true\n` +
          `          schema:\n` +
          `            type: string\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/Reference'\n` +
          `      responses:\n` +
          `        '200':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/Reference'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Reference:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n` +
          `        status:\n` +
          `          type: string\n`,
      );

      const interfaceDir = join(tempDir, 'src/main/java/com/example/web/api');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(
        join(interfaceDir, 'ReferenceApiDelegate.java'),
        `package com.example.web.api;\n\n` +
          `import java.util.UUID;\n` +
          `import org.springframework.http.ResponseEntity;\n` +
          `import org.springframework.web.bind.annotation.PathVariable;\n` +
          `import org.springframework.web.bind.annotation.RequestBody;\n` +
          `import com.example.service.api.dto.Reference;\n\n` +
          `public interface ReferenceApiDelegate {\n` +
          `    default ResponseEntity<Reference> createReference(@RequestBody Reference reference) {\n` +
          `        return ResponseEntity.status(201).body(reference);\n` +
          `    }\n\n` +
          `    default ResponseEntity<Reference> updateReference(@PathVariable UUID referenceId, @RequestBody Reference reference) {\n` +
          `        return ResponseEntity.ok(reference);\n` +
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
              name: 'Reference',
              entityClass: 'Reference',
              entityAbsoluteClass: 'com.example.domain.Reference',
              entityInstance: 'reference',
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

      const outputPath = join(tempDir, 'src/main/java/com/example/web/api/impl/ReferenceApiDelegateImpl.java');
      const output = writes.get(outputPath) ?? '';
      expect(output).toContain('private final ReferenceRepository repository;');
      expect(output).toContain('private final ReferenceMapper mapper;');
      expect(output).toContain('validatePayload(reference);');
      expect(output.indexOf('validatePayload(reference);')).toBeLessThan(output.indexOf('Reference entity = this.mapper.toReferenceEntity(reference);'));
      expect(output).toContain('Reference entity = this.mapper.toReferenceEntity(reference);');
      expect(output).toContain('Reference responseBody = mapResponseBody(() -> this.mapper.toReferenceDto(saved));');
      expect(output).toContain('return ResponseEntity.created(buildLocation(saved != null ? saved.getId() : null)).body(responseBody);');
      expect(output).toContain('ServletUriComponentsBuilder builder = ServletUriComponentsBuilder.fromCurrentRequestUri();');
      expect(output).toContain('String.format("/%s/%s", "reference", idValue)');
      expect(output).toContain('this.mapper.toReferenceEntity(reference)');
      expect(output).toContain('JsonNode baseNode = normalizePatchDiscriminators(toJsonObject(() -> this.mapper.toReferenceDto(existing)));');
      expect(output).toContain('convertAndValidate(patchedNode, Reference.class);');
      expect(output).toContain(
        'Reference mergedPayload = convertValue(pruneUnpatchedComplexFields(patchedNode, patchNode, patchFormat), Reference.class);',
      );
      expect(output).toContain('validatePayload(mergedPayload);');
      expect(output).toContain('Reference responseBody = mapResponseBody(() -> this.mapper.toReferenceDto(saved));');
      expect(output).toContain('return ResponseEntity.status(successStatus).body(responseBody);');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists no-id PUT request bodies as create-style mutations', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /v3/issuance-requests:\n` +
          `    put:\n` +
          `      operationId: putIssuanceRequests\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/IssuanceRequest'\n` +
          `      responses:\n` +
          `        '204':\n` +
          `          description: accepted\n` +
          `components:\n` +
          `  schemas:\n` +
          `    IssuanceRequest:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        documentReference:\n` +
          `          type: string\n`,
      );

      const interfaceDir = join(tempDir, 'src/main/java/com/example/web/api');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(
        join(interfaceDir, 'V3ApiDelegate.java'),
        `package com.example.web.api;\n\n` +
          `import org.springframework.http.ResponseEntity;\n` +
          `import org.springframework.web.bind.annotation.RequestBody;\n` +
          `import com.example.service.api.dto.IssuanceRequest;\n\n` +
          `public interface V3ApiDelegate {\n` +
          `    default ResponseEntity<Void> putIssuanceRequests(@RequestBody IssuanceRequest issuanceRequest) {\n` +
          `        return ResponseEntity.status(501).build();\n` +
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
              name: 'IssuanceRequest',
              entityClass: 'IssuanceRequest',
              entityAbsoluteClass: 'com.example.domain.IssuanceRequest',
              entityInstance: 'issuanceRequest',
              entityInstancePlural: 'issuanceRequests',
              entityNameCapitalized: 'IssuanceRequest',
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

      const outputPath = join(tempDir, 'src/main/java/com/example/web/api/impl/V3ApiDelegateImpl.java');
      const output = writes.get(outputPath) ?? '';
      expect(output).toContain('private final IssuanceRequestRepository repository;');
      expect(output).toContain('private final IssuanceRequestMapper mapper;');
      expect(output).toContain('public ResponseEntity<Void> putIssuanceRequests(@RequestBody IssuanceRequest issuanceRequest)');
      expect(output).toContain('validatePayload(issuanceRequest);');
      expect(output).toContain('com.example.domain.IssuanceRequest entity = this.mapper.toIssuanceRequestEntity(issuanceRequest);');
      expect(output).toContain('com.example.domain.IssuanceRequest saved;');
      expect(output).toContain('saved = this.repository.saveAndFlush(entity);');
      expect(output).toContain('return ResponseEntity.status(resolvedStatus).body((Void) null);');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to operationId-based method names when generated interfaces are unavailable', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jhipster-openapi-delegate-'));
    try {
      const swaggerDir = join(tempDir, 'src/main/resources/swagger');
      mkdirSync(swaggerDir, { recursive: true });
      writeFileSync(
        join(swaggerDir, 'api.yml'),
        `openapi: 3.0.1\n` +
          `paths:\n` +
          `  /parties:\n` +
          `    post:\n` +
          `      operationId: createParty\n` +
          `      requestBody:\n` +
          `        required: true\n` +
          `        content:\n` +
          `          application/json:\n` +
          `            schema:\n` +
          `              $ref: '#/components/schemas/Party'\n` +
          `      responses:\n` +
          `        '201':\n` +
          `          content:\n` +
          `            application/json:\n` +
          `              schema:\n` +
          `                $ref: '#/components/schemas/Party'\n` +
          `components:\n` +
          `  schemas:\n` +
          `    Party:\n` +
          `      type: object\n` +
          `      properties:\n` +
          `        id:\n` +
          `          type: string\n`,
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
        destinationPath: (...paths: string[]) => resolve(tempDir, ...paths),
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
              name: 'Party',
              entityClass: 'Party',
              entityAbsoluteClass: 'com.example.domain.Party',
              entityInstance: 'party',
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

      const output = writes.size > 0 ? [...writes.values()][0] : '';
      expect(output).toContain('createParty(');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('ensureMapperDependency helper', () => {
  const baseContext = (): any => ({
    className: 'TestApiDelegateImpl',
    interfaceName: 'TestApiDelegate',
    resourceName: 'Test',
    resourceSlug: 'test',
    domainFqcn: 'com.example.domain.Test',
    operations: [],
    imports: [],
    hasCreate: false,
    hasList: false,
    hasRetrieve: false,
    hasDelete: false,
    hasPatch: false,
    repositories: [],
    mappers: [],
    injections: [],
  });

  it('normalizes DTO suffixes when registering mapper dependencies', () => {
    const context = baseContext();
    const dependency = ensureMapperDependency(context, 'HubFVO', 'com.example', {});
    expect(dependency.simpleName).toBe('HubMapper');
    expect(dependency.fieldName).toBe('hubMapper');
    expect(dependency.import).toBe('com.example.web.api.mapper.HubMapper');
    expect(context.mappers).toHaveLength(1);
    expect(context.injections[0]).toBe(dependency);
  });

  it('reuses mapper dependencies for subsequent lookups and honors primary flag', () => {
    const context = baseContext();
    const primary = ensureMapperDependency(context, 'PartyInteraction', 'com.example', { primary: true });
    const secondary = ensureMapperDependency(context, 'PartyInteractionDTO', 'com.example', {});
    expect(primary).toBe(secondary);
    expect(primary.fieldName).toBe('mapper');
    expect(context.mappers).toHaveLength(1);
  });
});
