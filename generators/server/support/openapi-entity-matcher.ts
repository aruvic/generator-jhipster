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

import pluralize from 'pluralize';

import {
  type OpenAPIOperation,
  type OpenAPIParameter,
  type ParsedOpenAPISpec,
  extractSchemaRef,
  getOperationType,
  normalizeTypeName,
  stripDtoSuffix,
} from './openapi-mapper-generator.ts';

interface EntitySummary {
  name: string;
  canonical: string;
  fqcn: string;
  entity: any;
  aliases: Set<string>;
}

export interface MatchedEntityInfo<E = any> {
  name: string;
  fqcn: string;
  entity: E;
}

export type OperationKind = ReturnType<typeof getOperationType>;

export interface OperationDescriptor {
  operation: OpenAPIOperation;
  operationType: OperationKind;
  resourceToken?: string;
  resourceName?: string;
  matchedEntity?: MatchedEntityInfo;
  requestEntityMatch?: MatchedEntityInfo;
  responseEntityMatch?: MatchedEntityInfo;
  requestSchemaNames: string[];
  responseSchemaNames: string[];
  pathParameters: OpenAPIParameter[];
}

const VARIANT_PREFIXES = new Set([
  'create',
  'update',
  'delete',
  'list',
  'get',
  'fetch',
  'patch',
  'partial',
  'partialupdate',
  'command',
  'remove',
]);

const VARIANT_SUFFIXES = new Set([
  'create',
  'update',
  'patch',
  'request',
  'response',
  'payload',
  'command',
  'dto',
  'input',
  'model',
  'output',
  'resource',
  'schema',
  'id',
  'ids',
]);

const CANONICALIZE_REGEX = /[^a-z0-9]/g;

export class OpenApiEntityMatcher {
  private readonly basePackage?: string;
  private readonly entities: EntitySummary[] = [];
  private readonly aliasIndex = new Map<string, EntitySummary>();

  constructor(generator: any, basePackage?: string) {
    this.basePackage = basePackage;
    const existingEntities: { name: string; definition: any }[] | undefined = generator?.getExistingEntities?.();
    if (!Array.isArray(existingEntities)) {
      return;
    }

    for (const { definition } of existingEntities) {
      const entity = definition ?? {};
      const simpleName: string | undefined = entity.entityClass ?? entity.name;
      if (!simpleName) {
        continue;
      }
      const normalizedName = normalizeTypeName(simpleName);
      const canonical = this.canonicalize(normalizedName);
      if (!canonical) {
        continue;
      }
      const fqcn: string = entity.entityAbsoluteClass ?? this.buildDomainFqcn(normalizedName);
      const summary: EntitySummary = {
        name: normalizedName,
        canonical,
        fqcn,
        entity,
        aliases: new Set<string>([canonical]),
      };
      this.entities.push(summary);
      this.registerEntityAliases(summary, entity);
    }
  }

  describeOperations(spec: ParsedOpenAPISpec): Map<OpenAPIOperation, OperationDescriptor> {
    const descriptors = new Map<OpenAPIOperation, OperationDescriptor>();
    for (const operation of spec.operations ?? []) {
      descriptors.set(operation, this.describeOperation(operation, spec));
    }
    return descriptors;
  }

  /**
   * Attempt to match a schema name to an existing entity definition.
   */
  matchSchemaName(schemaName: string): MatchedEntityInfo | undefined {
    const match = this.matchEntityBySchema(schemaName);
    if (!match) {
      return undefined;
    }
    return { name: match.name, fqcn: match.fqcn, entity: match.entity };
  }

  describeOperation(operation: OpenAPIOperation, spec: ParsedOpenAPISpec): OperationDescriptor {
    const operationType = getOperationType(operation);
    const pathParameters = (operation.parameters ?? []).filter(param => param.in === 'path');
    const requestSchemaNames = this.collectSchemaNames(operation.requestBodySchema, operation.requestBodySchemaObject, spec);
    const responseSchemaNames = this.collectSchemaNames(operation.responseSchema, operation.responseSchemaObject, spec);

    let matchedEntity = this.matchByPath(operation);
    if (!matchedEntity) {
      matchedEntity = this.matchByTags(operation.tags);
    }
    if (!matchedEntity) {
      matchedEntity = this.matchBySchemas([...requestSchemaNames, ...responseSchemaNames]);
    }

    const requestEntityMatch = this.matchPreferredEntity(requestSchemaNames, matchedEntity, spec);
    const responseEntityMatch = this.matchPreferredEntity(responseSchemaNames, matchedEntity, spec);

    let resourceName = matchedEntity?.name;
    const resourceToken = matchedEntity ? undefined : this.derivePrimaryToken(operation);

    if (!resourceName) {
      resourceName = this.fallbackResourceName(operation, requestSchemaNames, responseSchemaNames, resourceToken);
    }

    if (matchedEntity?.name && !resourceName) {
      resourceName = matchedEntity.name;
    }

    const descriptor: OperationDescriptor = {
      operation,
      operationType,
      pathParameters,
      requestSchemaNames: [...requestSchemaNames],
      responseSchemaNames: [...responseSchemaNames],
    };

    if (resourceToken) {
      descriptor.resourceToken = resourceToken;
    }

    if (resourceName) {
      descriptor.resourceName = normalizeTypeName(resourceName);
    }

    if (matchedEntity) {
      descriptor.matchedEntity = {
        name: matchedEntity.name,
        fqcn: matchedEntity.fqcn,
        entity: matchedEntity.entity,
      };
    }

    if (requestEntityMatch) {
      descriptor.requestEntityMatch = {
        name: requestEntityMatch.name,
        fqcn: requestEntityMatch.fqcn,
        entity: requestEntityMatch.entity,
      };
    }

    if (responseEntityMatch) {
      descriptor.responseEntityMatch = {
        name: responseEntityMatch.name,
        fqcn: responseEntityMatch.fqcn,
        entity: responseEntityMatch.entity,
      };
    }

    return descriptor;
  }

  private matchPreferredEntity(schemaNames: string[], fallback?: EntitySummary, spec?: ParsedOpenAPISpec): EntitySummary | undefined {
    let directMatch: EntitySummary | undefined;
    let bestMatch: EntitySummary | undefined;

    for (const schemaName of schemaNames) {
      const candidate = this.matchEntityBySchema(schemaName);
      if (!candidate) {
        continue;
      }
      if (!bestMatch) {
        bestMatch = candidate;
      }

      const schemaCanonical = this.canonicalize(stripDtoSuffix(normalizeTypeName(schemaName)));
      if (schemaCanonical && candidate.canonical === schemaCanonical) {
        directMatch = candidate;
        break;
      }
    }

    if (
      directMatch &&
      fallback &&
      directMatch.canonical !== fallback.canonical &&
      this.isComposedAliasOfEntity(schemaNames[0], fallback, spec)
    ) {
      return fallback;
    }

    if (directMatch) {
      return directMatch;
    }

    if (bestMatch && (!fallback || bestMatch.canonical !== fallback.canonical)) {
      return bestMatch;
    }

    return undefined;
  }

  private isComposedAliasOfEntity(schemaName: string | undefined, entity: EntitySummary, spec?: ParsedOpenAPISpec): boolean {
    if (!schemaName || !spec?.schemas) {
      return false;
    }
    const schema = spec.schemas[schemaName] ?? spec.schemas[normalizeTypeName(schemaName)];
    if (!schema || schema.properties || schema.additionalProperties) {
      return false;
    }

    const composition = Array.isArray(schema.allOf) ? schema.allOf : undefined;
    if (!composition || composition.length !== 1) {
      return false;
    }

    const ref = extractSchemaRef(composition[0]);
    const refCanonical = this.canonicalize(stripDtoSuffix(normalizeTypeName(ref ?? '')));
    return Boolean(refCanonical && refCanonical === entity.canonical);
  }

  private registerEntityAliases(summary: EntitySummary, entity: any): void {
    const aliases = new Set<string>();

    const candidates: (string | undefined)[] = [
      entity.entityClass,
      entity.name,
      entity.entityNameCapitalized,
      entity.entityInstance,
      entity.entityInstancePlural,
      entity.entityNamePlural,
      entity.entityNamePluralHumanized,
      entity.entityNameKebabCase,
      entity.entityAbsoluteClass,
      entity.persistClass,
    ];

    for (const candidate of candidates) {
      if (candidate) {
        aliases.add(candidate);
      }
    }

    const derivedAliases = new Set<string>();
    for (const alias of aliases) {
      derivedAliases.add(alias);
      derivedAliases.add(normalizeTypeName(alias));
      derivedAliases.add(pluralize.singular(alias));
      derivedAliases.add(pluralize.plural(alias));
    }

    const discriminatorValue =
      entity.annotations?.discriminatorValue?.value ??
      entity.annotations?.discriminatorValue ??
      entity.discriminatorValue ??
      entity.discriminator?.value;
    if (typeof discriminatorValue === 'string' && discriminatorValue.trim()) {
      derivedAliases.add(discriminatorValue);
    }

    for (const alias of derivedAliases) {
      this.addAlias(summary, alias);
    }
  }

  private addAlias(summary: EntitySummary, alias?: string): void {
    const canonical = this.canonicalize(alias);
    if (!canonical) {
      return;
    }
    summary.aliases.add(canonical);
    if (!this.aliasIndex.has(canonical)) {
      this.aliasIndex.set(canonical, summary);
    }
  }

  private matchByPath(operation: OpenAPIOperation): EntitySummary | undefined {
    const staticSegments = this.getStaticSegments(operation.path);
    for (let i = staticSegments.length - 1; i >= 0; i -= 1) {
      const segment = staticSegments[i];
      const match = this.findByToken(segment);
      if (match) {
        return match;
      }
      const singular = pluralize.singular(segment);
      if (singular !== segment) {
        const singularMatch = this.findByToken(singular);
        if (singularMatch) {
          return singularMatch;
        }
      }
    }
    return undefined;
  }

  private matchByTags(tags?: string[]): EntitySummary | undefined {
    if (!tags) {
      return undefined;
    }
    for (const tag of tags) {
      const sanitized = tag?.trim();
      if (!sanitized) {
        continue;
      }
      const match = this.findByToken(sanitized);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  private matchBySchemas(schemaNames: string[]): EntitySummary | undefined {
    for (const schemaName of schemaNames) {
      const match = this.matchEntityBySchema(schemaName);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  private findByToken(token?: string): EntitySummary | undefined {
    const canonical = this.canonicalize(token);
    if (!canonical) {
      return undefined;
    }
    const direct = this.aliasIndex.get(canonical);
    if (direct) {
      return direct;
    }
    return this.findBestByCanonical(canonical);
  }

  private matchEntityBySchema(schemaName?: string): EntitySummary | undefined {
    if (!schemaName) {
      return undefined;
    }
    const normalized = normalizeTypeName(schemaName);
    const candidates = new Set<string>();

    const rawStripped = stripDtoSuffix(schemaName);
    const canonicalRawStripped = this.canonicalize(rawStripped);
    if (canonicalRawStripped) {
      candidates.add(canonicalRawStripped);
    }

    const canonicalMain = this.canonicalize(normalized);
    if (canonicalMain) {
      candidates.add(canonicalMain);
    }

    const stripped = stripDtoSuffix(normalized);
    const canonicalStripped = this.canonicalize(stripped);
    if (canonicalStripped) {
      candidates.add(canonicalStripped);
    }

    const rawCanonical = this.canonicalize(schemaName);
    if (rawCanonical) {
      candidates.add(rawCanonical);
    }

    for (const variant of candidates) {
      const direct = this.aliasIndex.get(variant);
      if (direct) {
        return direct;
      }
    }

    let bestMatch: EntitySummary | undefined;
    let bestScore = 0;

    for (const candidate of candidates) {
      const match = this.findBestByCanonical(candidate);
      if (match) {
        const score = this.scoreCandidate(candidate, match.canonical);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = match;
        }
      }
    }

    return bestMatch;
  }

  private findBestByCanonical(canonical: string): EntitySummary | undefined {
    let best: EntitySummary | undefined;
    let bestScore = 0;
    for (const entity of this.entities) {
      const score = this.scoreCandidate(canonical, entity.canonical);
      if (score > bestScore) {
        best = entity;
        bestScore = score;
      }
    }
    return bestScore >= 3 ? best : undefined;
  }

  private scoreCandidate(candidate: string, canonical: string): number {
    if (candidate === canonical) {
      return 6;
    }
    if (candidate.startsWith(canonical)) {
      const suffix = candidate.slice(canonical.length);
      if (!suffix) {
        return 6;
      }
      if (this.isVariantPrefix(suffix)) {
        return 4;
      }
      return 0;
    }
    if (candidate.endsWith(canonical)) {
      const prefix = candidate.slice(0, candidate.length - canonical.length);
      if (!prefix) {
        return 4;
      }
      if (this.isVariantPrefix(prefix)) {
        return 4;
      }
    }
    return 0;
  }

  private isVariantPrefix(prefix: string): boolean {
    const canonical = prefix.replace(CANONICALIZE_REGEX, '');
    if (!canonical) {
      return false;
    }
    return VARIANT_PREFIXES.has(canonical) || VARIANT_SUFFIXES.has(canonical);
  }

  private canonicalize(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed = value.toLowerCase().replace(CANONICALIZE_REGEX, '');
    if (!trimmed) {
      return undefined;
    }
    return trimmed;
  }

  private buildDomainFqcn(simpleName: string): string {
    if (this.basePackage) {
      return `${this.basePackage}.domain.${normalizeTypeName(simpleName)}`;
    }
    return normalizeTypeName(simpleName);
  }

  private getStaticSegments(path?: string): string[] {
    if (!path) {
      return [];
    }
    return path
      .split('/')
      .map(segment => segment.trim())
      .filter(segment => segment && !(segment.startsWith('{') && segment.endsWith('}')));
  }

  private derivePrimaryToken(operation: OpenAPIOperation): string | undefined {
    const segments = this.getStaticSegments(operation.path);
    if (segments.length === 0) {
      return undefined;
    }
    return segments[segments.length - 1];
  }

  private fallbackResourceName(operation: OpenAPIOperation, requestSchemas: string[], responseSchemas: string[], token?: string): string {
    if (token) {
      const singular = pluralize.singular(token);
      const candidate = normalizeTypeName(singular || token);
      if (candidate) {
        return candidate;
      }
    }

    if (operation.tags?.length) {
      const tagCandidate = normalizeTypeName(pluralize.singular(operation.tags[0]));
      if (tagCandidate) {
        return tagCandidate;
      }
    }

    const schemaCandidate = requestSchemas[0] ?? responseSchemas[0];
    if (schemaCandidate) {
      const stripped = stripDtoSuffix(schemaCandidate);
      return normalizeTypeName(stripped);
    }

    return 'Resource';
  }

  private collectSchemaNames(schemaName?: string, schemaObject?: any, spec?: ParsedOpenAPISpec): string[] {
    const collected = new Set<string>();
    if (schemaName) {
      collected.add(schemaName);
    }
    if (schemaObject) {
      this.collectSchemaRefs(schemaObject, collected, spec);
    }
    return Array.from(collected);
  }

  private collectSchemaRefs(schema: any, collector: Set<string>, spec?: ParsedOpenAPISpec, depth = 0): void {
    if (!schema || depth > 16) {
      return;
    }

    const ref = extractSchemaRef(schema);
    if (ref) {
      collector.add(ref);
      const referenced = spec?.schemas?.[ref];
      if (referenced) {
        this.collectSchemaRefs(referenced, collector, spec, depth + 1);
      }
    }

    if (schema.items) {
      this.collectSchemaRefs(schema.items, collector, spec, depth + 1);
    }

    if (Array.isArray(schema.allOf)) {
      for (const item of schema.allOf) {
        this.collectSchemaRefs(item, collector, spec, depth + 1);
      }
    }
    if (Array.isArray(schema.oneOf)) {
      for (const item of schema.oneOf) {
        this.collectSchemaRefs(item, collector, spec, depth + 1);
      }
    }
    if (Array.isArray(schema.anyOf)) {
      for (const item of schema.anyOf) {
        this.collectSchemaRefs(item, collector, spec, depth + 1);
      }
    }

    if (schema.properties) {
      for (const propertySchema of Object.values(schema.properties)) {
        this.collectSchemaRefs(propertySchema, collector, spec, depth + 1);
      }
    }

    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      this.collectSchemaRefs(schema.additionalProperties, collector, spec, depth + 1);
    }
  }
}
