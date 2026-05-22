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
import { readFile } from 'node:fs/promises';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { GRADLE_BUILD_SRC_MAIN_DIR } from '../../../generator-constants.js';
import { JavaApplicationGenerator } from '../../generator.ts';
import { javaMainResourceTemplatesBlock } from '../../support/files.ts';

export default class OpenapiGeneratorGenerator extends JavaApplicationGenerator {
  async beforeQueue() {
    if (!this.fromBlueprint) {
      await this.composeWithBlueprints();
    }

    if (!this.delegateToBlueprint) {
      await this.dependsOnBootstrap('java');
      await this.dependsOnJHipster('jhipster:java:build-tool');
    }
  }

  get writing() {
    return this.asWritingTaskGroup({
      async cleanup({ application, control }) {
        await control.cleanupFiles({
          '8.6.1': [[application.buildToolGradle!, 'gradle/swagger.gradle']],
        });
      },
      async writing({ application }) {
        await this.writeFiles({
          blocks: [
            { templates: ['README.md.jhi.openapi-generator'] },
            javaMainResourceTemplatesBlock({ templates: ['swagger/api.yml'] }),
            {
              condition: ctx => ctx.buildToolGradle && ctx.addOpenapiGeneratorPlugin,
              templates: [`${GRADLE_BUILD_SRC_MAIN_DIR}/jhipster.openapi-generator-conventions.gradle`],
            },
          ],
          context: application,
        });

        if (application.oas3Input) {
          await this.copyProvidedOpenApiSpec(application);
        }
      },
    });
  }

  get [JavaApplicationGenerator.WRITING]() {
    return this.delegateTasksToBlueprint(() => this.writing);
  }

  get postWriting() {
    return this.asPostWritingTaskGroup({
      addDependencies({ source, application }) {
        const { addOpenapiGeneratorPlugin, buildToolGradle, javaDependencies } = application;
        source.addJavaDefinitions!(
          {
            dependencies: [
              {
                groupId: 'org.openapitools',
                artifactId: 'jackson-databind-nullable',
                version: javaDependencies!['jackson-databind-nullable'],
              },
            ],
          },
          {
            condition: addOpenapiGeneratorPlugin,
            mavenDefinition: {
              properties: [
                { property: 'openapi-generator-maven-plugin.version', value: javaDependencies!['openapi-generator-maven-plugin'] },
              ],
              plugins: [{ groupId: 'org.openapitools', artifactId: 'openapi-generator-maven-plugin' }],
              pluginManagement: [
                {
                  groupId: 'org.openapitools',
                  artifactId: 'openapi-generator-maven-plugin',
                  // eslint-disable-next-line no-template-curly-in-string
                  version: '${openapi-generator-maven-plugin.version}',
                  additionalContent: `                <executions>
                    <execution>
                        <goals>
                            <goal>generate</goal>
                        </goals>
                        <configuration>
                            <inputSpec>\${project.basedir}/${application.srcMainResources}swagger/api.yml</inputSpec>
                            <generatorName>spring</generatorName>
                            <apiPackage>${application.packageName}.web.api</apiPackage>
                            <modelPackage>${application.packageName}.service.api.dto</modelPackage>
                            <supportingFilesToGenerate>ApiUtil.java</supportingFilesToGenerate>
                            <skipValidateSpec>false</skipValidateSpec>
                            <configOptions>${
                              application.reactive
                                ? `
                                <reactive>true</reactive>
`
                                : ''
                            }
                                <delegatePattern>true</delegatePattern>
                                <title>${application.dasherizedBaseName}</title>
                                <useSpringBoot3>true</useSpringBoot3>
                                <useBeanValidation>false</useBeanValidation>
                                <performBeanValidation>false</performBeanValidation>
                            </configOptions>
                            <typeMappings>
                                <typeMapping>date=LocalDate</typeMapping>
                                <typeMapping>DateTime=Instant</typeMapping>
                                <typeMapping>Time=LocalTime</typeMapping>
                                <typeMapping>Duration=Duration</typeMapping>
                            </typeMappings>
                            <importMappings>
                                <importMapping>Instant=java.time.Instant</importMapping>
                                <importMapping>ZonedDateTime=java.time.ZonedDateTime</importMapping>
                                <importMapping>LocalDate=java.time.LocalDate</importMapping>
                                <importMapping>LocalTime=java.time.LocalTime</importMapping>
                                <importMapping>Duration=java.time.Duration</importMapping>
                            </importMappings>
                        </configuration>
                    </execution>
                </executions>
`,
                },
              ],
            },
          },
        );

        if (addOpenapiGeneratorPlugin) {
          if (buildToolGradle) {
            source.addGradleBuildSrcDependencyCatalogLibraries?.([
              {
                libraryName: 'openapi-generator',
                module: 'org.openapitools:openapi-generator-gradle-plugin',
                version: javaDependencies!['gradle-openapi-generator'],
                scope: 'implementation',
              },
            ]);
            source.addGradlePlugin?.({ id: 'jhipster.openapi-generator-conventions' });
          }
        }
      },
    });
  }

  get [JavaApplicationGenerator.POST_WRITING]() {
    return this.delegateTasksToBlueprint(() => this.postWriting);
  }

  async copyProvidedOpenApiSpec(application: any) {
    const resolvedInputPath = this.destinationPath(application.oas3Input);
    const candidatePaths = this.buildOpenApiSourceCandidates(resolvedInputPath);
    const failedCandidates: string[] = [];
    let specContents: string | undefined;
    let usedPath: string | undefined;
    for (const candidate of candidatePaths) {
      try {
        specContents = await readFile(candidate, 'utf-8');
        usedPath = candidate;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failedCandidates.push(`${candidate}: ${message}`);
      }
    }
    if (!specContents || !usedPath) {
      const errorDetails = failedCandidates.length > 0 ? `\n${failedCandidates.join('\n')}` : '';
      throw new Error(`Unable to read OpenAPI specification from ${resolvedInputPath}.${errorDetails}`);
    }
    if (usedPath !== resolvedInputPath) {
      this.log.info(`Using OpenAPI specification at ${usedPath}`);
    }
    const destination = `${application.srcMainResources}swagger/api.yml`;
    const finalContents = sanitizeOpenApiSpec(specContents);
    this.writeDestination(destination, finalContents);
  }

  buildOpenApiSourceCandidates(resolvedInputPath: string) {
    const candidates: string[] = [];
    const addCandidate = (candidate: string) => {
      if (candidate && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };
    const lowerCasePath = resolvedInputPath.toLowerCase();
    if (lowerCasePath.endsWith('.jdl')) {
      const basePath = resolvedInputPath.slice(0, -4);
      ['.yaml', '.yml', '.json'].forEach(extension => addCandidate(`${basePath}${extension}`));
    }
    addCandidate(resolvedInputPath);
    return candidates;
  }
}

/**
 * Sanitize and normalize external OpenAPI specs so downstream generators (OpenAPI Generator, MapStruct)
 * don't choke on overly complex example payloads, invalid component keys, or inconsistent line endings.
 *
 * - Parses YAML/JSON content
 * - Strips `example`/`examples` blocks (they often contain unescaped quotes/newlines that break Java annotation generation)
 * - Renames component schema keys that OpenAPI Generator rejects and rewrites internal refs to match
 * - Writes back as YAML with a trailing newline
 */
function sanitizeOpenApiSpec(rawContents: string): string {
  try {
    const specObject = parseYaml(rawContents);
    normalizeComponentSchemaNames(specObject);
    reconcileDiscriminatorProperties(specObject);
    const stripExamples = (node: any) => {
      if (!node || typeof node !== 'object') return;

      if ('example' in node) {
        delete node.example;
      }
      if ('examples' in node) {
        delete node.examples;
      }

      for (const value of Object.values(node)) {
        stripExamples(value);
      }
    };

    stripExamples(specObject);
    const normalized = stringifyYaml(specObject, { lineWidth: 0 });
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  } catch (error) {
    // If parsing fails, fall back to original content but keep newline termination
    return rawContents.endsWith('\n') ? rawContents : `${rawContents}\n`;
  }
}

const validOpenApiGeneratorSchemaName = /^[a-zA-Z0-9._-]+$/;

const openApiGeneratorModelNameCollisions = new Set([
  'BigDecimal',
  'BigInteger',
  'Boolean',
  'Byte',
  'Character',
  'Date',
  'Double',
  'Duration',
  'File',
  'Float',
  'Instant',
  'Integer',
  'List',
  'LocalDate',
  'LocalDateTime',
  'LocalTime',
  'Long',
  'Map',
  'Object',
  'OffsetDateTime',
  'Optional',
  'Problem',
  'Set',
  'Short',
  'String',
  'Time',
  'Timestamp',
  'URI',
  'UUID',
  'ZonedDateTime',
]);

function normalizeComponentSchemaNames(specObject: any): void {
  const schemas = specObject?.components?.schemas;
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
    return;
  }

  const usedNames = new Set(Object.keys(schemas).filter(name => validOpenApiGeneratorSchemaName.test(name)));
  const renamedSchemas = new Map<string, string>();
  for (const schemaName of Object.keys(schemas)) {
    if (!shouldRenameComponentSchema(schemaName)) {
      continue;
    }
    const normalized = uniqueSchemaName(toSafeSchemaComponentName(schemaName), usedNames);
    renamedSchemas.set(schemaName, normalized);
    usedNames.add(normalized);
  }

  if (renamedSchemas.size === 0) {
    return;
  }

  const normalizedSchemas: Record<string, any> = {};
  for (const [schemaName, schema] of Object.entries(schemas)) {
    const normalizedName = renamedSchemas.get(schemaName) ?? schemaName;
    const schemaObject = schema as any;
    if (schemaObject && typeof schemaObject === 'object' && !Array.isArray(schemaObject) && schemaObject.title === schemaName) {
      schemaObject.title = normalizedName;
    }
    normalizedSchemas[normalizedName] = schemaObject;
  }
  specObject.components.schemas = normalizedSchemas;
  rewriteComponentSchemaRefs(specObject, renamedSchemas);
}

function reconcileDiscriminatorProperties(specObject: any): void {
  const schemas = specObject?.components?.schemas;
  if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) {
    return;
  }

  for (const schema of Object.values(schemas)) {
    if (!isObjectRecord(schema)) {
      continue;
    }
    const propertyName = schema.discriminator?.propertyName;
    if (typeof propertyName !== 'string' || !propertyName) {
      continue;
    }

    const properties = isObjectRecord(schema.properties) ? schema.properties : {};
    let discriminatorProperty = isObjectRecord(properties[propertyName]) && hasSchemaType(properties[propertyName]) ? properties[propertyName] : undefined;

    const inferredProperty = discriminatorProperty ? undefined : inferDiscriminatorPropertySchema(schema, propertyName, schemas);
    if (!discriminatorProperty && !inferredProperty) {
      continue;
    }

    if (!discriminatorProperty && inferredProperty) {
      schema.properties = properties;
      properties[propertyName] = inferredProperty;
      discriminatorProperty = inferredProperty;
    }

    const variantRefs = collectDiscriminatorVariantRefs(schema);
    if (variantRefs.length > 0 && variantRefs.every(ref => schemaRequiresProperty(ref, propertyName, schemas))) {
      const required = Array.isArray(schema.required) ? schema.required : [];
      if (!required.includes(propertyName)) {
        schema.required = [...required, propertyName];
      }
    }

    if (discriminatorProperty && isStringDiscriminatorProperty(discriminatorProperty, schemas)) {
      normalizeStringDiscriminatorPropertyForJava(discriminatorProperty);
      for (const variantRef of variantRefs) {
        const variantProperty = findMutableSchemaProperty(variantRef, propertyName, schemas);
        if (variantProperty && isStringDiscriminatorProperty(variantProperty, schemas)) {
          normalizeStringDiscriminatorPropertyForJava(variantProperty);
        }
        removeInheritedStringDiscriminatorPropertyOverride(variantRef, propertyName, schemas);
      }
    } else if (discriminatorProperty) {
      delete schema.discriminator;
    }
  }
}

function inferDiscriminatorPropertySchema(schema: Record<string, any>, propertyName: string, schemas: Record<string, any>): any | undefined {
  const variantRefs = collectDiscriminatorVariantRefs(schema);
  const variantProperties = variantRefs
    .map(ref => findSchemaProperty(ref, propertyName, schemas))
    .filter((property): property is Record<string, any> => isObjectRecord(property) && hasSchemaType(property));

  if (variantProperties.length === 0) {
    return undefined;
  }

  const [firstProperty, ...otherProperties] = variantProperties;
  const firstSignature = schemaTypeSignature(firstProperty);
  if (!firstSignature || otherProperties.some(property => schemaTypeSignature(property) !== firstSignature)) {
    return undefined;
  }

  const inferred = copySchemaShape(firstProperty);
  return inferred;
}

function collectDiscriminatorVariantRefs(schema: Record<string, any>): string[] {
  const refs = new Set<string>();
  for (const variant of [...asArray(schema.oneOf), ...asArray(schema.anyOf), ...asArray(schema.allOf)]) {
    const ref = extractLocalComponentSchemaRef(variant);
    if (ref) {
      refs.add(ref);
    }
  }
  const mapping = schema.discriminator?.mapping;
  if (isObjectRecord(mapping)) {
    for (const mappedRef of Object.values(mapping)) {
      const ref = extractLocalComponentSchemaRef(mappedRef);
      if (ref) {
        refs.add(ref);
      }
    }
  }
  return Array.from(refs);
}

function findSchemaProperty(
  schemaName: string,
  propertyName: string,
  schemas: Record<string, any>,
  visiting = new Set<string>(),
): Record<string, any> | undefined {
  if (visiting.has(schemaName)) {
    return undefined;
  }
  visiting.add(schemaName);

  const schema = schemas[schemaName];
  if (!isObjectRecord(schema)) {
    return undefined;
  }

  const properties = schema.properties;
  if (isObjectRecord(properties) && isObjectRecord(properties[propertyName])) {
    return properties[propertyName];
  }

  for (const composedSchema of [...asArray(schema.allOf), ...asArray(schema.oneOf), ...asArray(schema.anyOf)]) {
    const ref = extractLocalComponentSchemaRef(composedSchema);
    const property = ref
      ? findSchemaProperty(ref, propertyName, schemas, visiting)
      : isObjectRecord(composedSchema?.properties?.[propertyName])
        ? composedSchema.properties[propertyName]
        : undefined;
    if (property) {
      return property;
    }
  }

  return undefined;
}

function findMutableSchemaProperty(schemaName: string, propertyName: string, schemas: Record<string, any>): Record<string, any> | undefined {
  const schema = schemas[schemaName];
  if (!isObjectRecord(schema)) {
    return undefined;
  }
  if (isObjectRecord(schema.properties) && isObjectRecord(schema.properties[propertyName])) {
    return schema.properties[propertyName];
  }
  for (const composedSchema of [...asArray(schema.allOf), ...asArray(schema.oneOf), ...asArray(schema.anyOf)]) {
    if (isObjectRecord(composedSchema?.properties?.[propertyName])) {
      return composedSchema.properties[propertyName];
    }
  }
  return undefined;
}

function removeInheritedStringDiscriminatorPropertyOverride(
  schemaName: string,
  propertyName: string,
  schemas: Record<string, any>,
): void {
  const schema = schemas[schemaName];
  if (!isObjectRecord(schema) || !hasAllOfInheritedStringProperty(schema, propertyName, schemas)) {
    return;
  }

  removePropertyOverride(schema, propertyName);
  for (const composedSchema of asArray(schema.allOf)) {
    if (isObjectRecord(composedSchema)) {
      removePropertyOverride(composedSchema, propertyName);
    }
  }
}

function hasAllOfInheritedStringProperty(
  schema: Record<string, any>,
  propertyName: string,
  schemas: Record<string, any>,
  visiting = new Set<string>(),
): boolean {
  for (const composedSchema of asArray(schema.allOf)) {
    const ref = extractLocalComponentSchemaRef(composedSchema);
    if (!ref || visiting.has(ref)) {
      continue;
    }
    const inheritedProperty = findSchemaProperty(ref, propertyName, schemas, new Set(visiting));
    if (inheritedProperty && isStringDiscriminatorProperty(inheritedProperty, schemas)) {
      return true;
    }
    visiting.add(ref);
  }
  return false;
}

function removePropertyOverride(schema: Record<string, any>, propertyName: string): void {
  if (isObjectRecord(schema.properties) && isObjectRecord(schema.properties[propertyName])) {
    delete schema.properties[propertyName];
    if (Object.keys(schema.properties).length === 0) {
      delete schema.properties;
    }
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((property: unknown) => property !== propertyName);
    if (schema.required.length === 0) {
      delete schema.required;
    }
  }
}

function schemaRequiresProperty(schemaName: string, propertyName: string, schemas: Record<string, any>, visiting = new Set<string>()): boolean {
  if (visiting.has(schemaName)) {
    return false;
  }
  visiting.add(schemaName);

  const schema = schemas[schemaName];
  if (!isObjectRecord(schema)) {
    return false;
  }
  if (Array.isArray(schema.required) && schema.required.includes(propertyName)) {
    return true;
  }

  return asArray(schema.allOf).some(composedSchema => {
    const ref = extractLocalComponentSchemaRef(composedSchema);
    if (ref) {
      return schemaRequiresProperty(ref, propertyName, schemas, visiting);
    }
    return Array.isArray(composedSchema?.required) && composedSchema.required.includes(propertyName);
  });
}

function isStringDiscriminatorProperty(schema: Record<string, any>, schemas: Record<string, any>, visiting = new Set<string>()): boolean {
  if (schema.type === 'string') {
    return true;
  }
  if (!schema.type && Array.isArray(schema.enum) && schema.enum.every(value => typeof value === 'string')) {
    return true;
  }
  const ref = extractLocalComponentSchemaRef(schema);
  if (ref && !visiting.has(ref)) {
    visiting.add(ref);
    const referenced = schemas[ref];
    return isObjectRecord(referenced) ? isStringDiscriminatorProperty(referenced, schemas, visiting) : false;
  }
  return false;
}

function normalizeStringDiscriminatorPropertyForJava(schema: Record<string, any>): void {
  if (schema.$ref) {
    delete schema.$ref;
    schema.type = 'string';
  } else if (!schema.type && (Array.isArray(schema.enum) || schema.const !== undefined)) {
    schema.type = 'string';
  }
  delete schema.enum;
  delete schema.const;
  delete schema['x-enum-varnames'];
  delete schema['x-enumNames'];
}

function hasSchemaType(schema: any): boolean {
  return (
    isObjectRecord(schema) &&
    (typeof schema.type === 'string' ||
      typeof schema.$ref === 'string' ||
      Array.isArray(schema.oneOf) ||
      Array.isArray(schema.anyOf) ||
      Array.isArray(schema.allOf))
  );
}

function schemaTypeSignature(schema: Record<string, any>): string | undefined {
  if (typeof schema.$ref === 'string') {
    return `ref:${schema.$ref}`;
  }
  if (typeof schema.type === 'string') {
    return `type:${schema.type};format:${schema.format ?? ''}`;
  }
  if (Array.isArray(schema.oneOf)) {
    return `oneOf:${schema.oneOf.map(extractLocalComponentSchemaRef).join('|')}`;
  }
  if (Array.isArray(schema.anyOf)) {
    return `anyOf:${schema.anyOf.map(extractLocalComponentSchemaRef).join('|')}`;
  }
  if (Array.isArray(schema.allOf)) {
    return `allOf:${schema.allOf.map(extractLocalComponentSchemaRef).join('|')}`;
  }
  return undefined;
}

function copySchemaShape(schema: Record<string, any>): Record<string, any> {
  const copied: Record<string, any> = {};
  for (const key of [
    '$ref',
    'type',
    'format',
    'nullable',
    'items',
    'additionalProperties',
    'oneOf',
    'anyOf',
    'allOf',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'pattern',
    'description',
  ]) {
    if (schema[key] !== undefined) {
      copied[key] = schema[key];
    }
  }
  return copied;
}

function extractLocalComponentSchemaRef(value: any): string | undefined {
  const ref = typeof value === 'string' ? value : value?.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/components/schemas/')) {
    return undefined;
  }
  return ref.slice('#/components/schemas/'.length);
}

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function isObjectRecord(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shouldRenameComponentSchema(schemaName: string): boolean {
  return !validOpenApiGeneratorSchemaName.test(schemaName) || openApiGeneratorModelNameCollisions.has(toSchemaComponentName(schemaName));
}

function toSafeSchemaComponentName(schemaName: string): string {
  const normalized = toSchemaComponentName(schemaName);
  if (openApiGeneratorModelNameCollisions.has(normalized)) {
    return `${normalized}Model`;
  }
  return normalized;
}

function toSchemaComponentName(schemaName: string): string {
  const segments = schemaName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const normalized = segments.map(segment => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`).join('');
  return normalized || 'Schema';
}

function uniqueSchemaName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    return baseName;
  }
  let index = 2;
  while (usedNames.has(`${baseName}${index}`)) {
    index += 1;
  }
  return `${baseName}${index}`;
}

function rewriteComponentSchemaRefs(node: any, renamedSchemas: Map<string, string>): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(item => rewriteComponentSchemaRefs(item, renamedSchemas));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string') {
      node[key] = rewriteComponentSchemaRef(value, renamedSchemas);
    } else if (typeof value === 'string' && value.startsWith('#/components/schemas/')) {
      node[key] = rewriteComponentSchemaRef(value, renamedSchemas);
    } else {
      rewriteComponentSchemaRefs(value, renamedSchemas);
    }
  }
}

function rewriteComponentSchemaRef(ref: string, renamedSchemas: Map<string, string>): string {
  if (!ref.startsWith('#/')) {
    return ref;
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts[0] !== 'components' || parts[1] !== 'schemas' || !parts[2]) {
    return ref;
  }
  const normalizedName = renamedSchemas.get(parts[2]);
  if (!normalizedName) {
    return ref;
  }
  parts[2] = normalizedName;
  return `#/${parts.map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}
