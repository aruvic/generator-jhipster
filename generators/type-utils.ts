/**
 * Copyright 2013-2026 the original author or authors from the JHipster project.
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
import type { ReadonlyDeep } from 'type-fest';

import type { JHipsterCommandDefinition } from '../lib/command/index.ts';

function deepFreeze<const T>(obj: T): ReadonlyDeep<T> {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.keys(obj).forEach(key => {
      deepFreeze((obj as any)[key]);
    });
    Object.freeze(obj);
  }
  return obj as ReadonlyDeep<T>;
}

/**
 * Type inferring function to create a JHipster command definition.
 * Freezes the object to prevent further modifications.
 */
export const asCommand = <const Def extends JHipsterCommandDefinition>(command: Def): ReadonlyDeep<Def> => deepFreeze(command);

const wordBoundaryRegex = /([a-z0-9])([A-Z])/g;
const nonAlphanumericRegex = /[^A-Za-z0-9]+/g;

export const JAVA_RESERVED_WORDS = new Set([
  'abstract',
  'assert',
  'boolean',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extends',
  'final',
  'finally',
  'float',
  'for',
  'goto',
  'if',
  'implements',
  'import',
  'instanceof',
  'int',
  'interface',
  'long',
  'native',
  'new',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'static',
  'strictfp',
  'super',
  'switch',
  'synchronized',
  'this',
  'throw',
  'throws',
  'transient',
  'try',
  'void',
  'volatile',
  'while',
]);

const JAVA_LANG_TYPES = new Set([
  'boolean',
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'char',
  'void',
  'Boolean',
  'Byte',
  'Short',
  'Integer',
  'Long',
  'Float',
  'Double',
  'Character',
  'String',
  'Object',
  'Void',
]);

const DEFAULT_COLLECTION_TYPE = { simple: 'List', fqcn: 'java.util.List' };
const DEFAULT_MAP_TYPE = { simple: 'Map', fqcn: 'java.util.Map' };

const capitalize = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value);

const splitIntoWords = (raw?: string): string[] => {
  if (!raw) {
    return [];
  }
  return raw.replace(wordBoundaryRegex, '$1 $2').replace(nonAlphanumericRegex, ' ').trim().split(/\s+/).filter(Boolean);
};

const isAllUpperCase = (token: string): boolean => token === token.toUpperCase();

const camelizeWords = (words: string[], lowerFirst = true): string => {
  if (words.length === 0) {
    return '';
  }
  const [first, ...rest] = words;
  const normalizeToken = (token: string, index: number): string => {
    if (token.length === 0) {
      return token;
    }
    if (index > 0 && isAllUpperCase(token)) {
      return token;
    }
    if (index === 0) {
      if (lowerFirst) {
        return token.toLowerCase();
      }
      if (isAllUpperCase(token)) {
        return token;
      }
      return capitalize(token);
    }
    return capitalize(token);
  };
  return [normalizeToken(first, 0), ...rest.map((token, idx) => normalizeToken(token, idx + 1))].join('');
};

export const camelize = (value: string, { lowerFirst = true }: { lowerFirst?: boolean } = {}): string =>
  camelizeWords(splitIntoWords(value), lowerFirst);

export const pascalize = (value: string): string => camelizeWords(splitIntoWords(value), false);

export const singularize = (value: string): string => {
  if (!value) {
    return value;
  }
  if (value.endsWith('ies') && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith('ses') && value.length > 3) {
    return value.slice(0, -2);
  }
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 1) {
    return value.slice(0, -1);
  }
  return value;
};

const escapeReservedWord = (name: string, strategy: 'underscore' | 'prefix', prefix = 'call'): string => {
  if (!JAVA_RESERVED_WORDS.has(name)) {
    return name;
  }
  if (strategy === 'underscore') {
    return name.startsWith('_') ? name : `_${name}`;
  }
  return `${prefix}${capitalize(name)}`;
};

const ensureJavaIdentifier = (name: string, fallback: string, strategy: 'underscore' | 'prefix', prefix = 'call'): string => {
  if (!name) {
    name = fallback;
  }
  if (!/^[A-Za-z_]/.test(name)) {
    if (strategy === 'prefix') {
      name = `${prefix}${capitalize(name)}`;
    } else {
      name = `_${name}`;
    }
  }
  name = escapeReservedWord(name, strategy, prefix);
  return name;
};

const ensureUniqueName = (name: string, usedNames?: Set<string>, suffixGenerator?: (index: number) => string): string => {
  if (!usedNames) {
    return name;
  }
  let candidate = name;
  if (!usedNames.has(candidate)) {
    usedNames.add(candidate);
    return candidate;
  }
  let index = 1;
  do {
    candidate = `${name}${suffixGenerator ? suffixGenerator(index) : index}`;
    index += 1;
  } while (usedNames.has(candidate));
  usedNames.add(candidate);
  return candidate;
};

export const sanitizeName = (value: string): string => {
  if (!value) {
    return value;
  }
  return value
    .replace(/[\[\]()]/g, '')
    .replace(/[.\s-]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '');
};

export const toModelName = (rawName: string, { prefix = 'Model' }: { prefix?: string } = {}): string => {
  const sanitized = sanitizeName(rawName);
  const candidate = pascalize(sanitized) || prefix;
  return ensureJavaIdentifier(candidate, prefix, 'prefix', prefix);
};

export const toJavaParamName = (
  rawName: string,
  { usedNames, fallback = 'param' }: { usedNames?: Set<string>; fallback?: string } = {},
): string => {
  const candidate = camelize(rawName, { lowerFirst: true }) || camelize(fallback, { lowerFirst: true }) || fallback;
  const ensured = ensureJavaIdentifier(candidate, fallback, 'underscore');
  if (!usedNames) {
    return ensured;
  }
  let unique = ensured;
  while (usedNames.has(unique)) {
    unique = `${unique}_`;
  }
  usedNames.add(unique);
  return unique;
};

const buildOperationNameFromPath = (httpMethod: string, path: string): string => {
  const methodPart = httpMethod?.toLowerCase?.() ?? 'call';
  const segments = (path || '')
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  const staticSegments: string[] = [];
  const paramSegments: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith('{') && segment.endsWith('}')) {
      paramSegments.push(segment.slice(1, -1));
    } else {
      staticSegments.push(segment);
    }
  }

  let name = methodPart;

  if (staticSegments.length === 0 && methodPart === 'get') {
    name += 'All';
  }

  for (const segment of staticSegments) {
    const words = splitIntoWords(segment);
    const token = singularize(words.map(word => capitalize(word)).join(''));
    if (token) {
      name += token;
    }
  }

  if (paramSegments.length > 0) {
    name += 'By';
    paramSegments.forEach((param, index) => {
      const token = pascalize(param) || `Param${index + 1}`;
      if (index > 0) {
        name += 'And';
      }
      name += token;
    });
  }

  return name;
};

export const toJavaOperationName = (
  operationId: string | undefined,
  httpMethod: string,
  path: string,
  { usedNames, fallbackPrefix = 'call' }: { usedNames?: Set<string>; fallbackPrefix?: string } = {},
): string => {
  let candidate = camelize(operationId ?? '', { lowerFirst: true });
  if (!candidate) {
    candidate = buildOperationNameFromPath(httpMethod, path);
  }
  candidate = ensureJavaIdentifier(candidate, fallbackPrefix, 'prefix', fallbackPrefix);
  return ensureUniqueName(candidate, usedNames, index => `${index}`);
};

const addImport = (imports: Set<string>, fqcn?: string) => {
  if (!fqcn) {
    return;
  }
  const simpleName = fqcn.substring(fqcn.lastIndexOf('.') + 1);
  if (JAVA_LANG_TYPES.has(simpleName)) {
    return;
  }
  imports.add(fqcn);
};

const mergeImports = (...sets: Array<Set<string>>): Set<string> => {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
};

export interface JavaResolvedType {
  fullType: string;
  baseType: string;
  rawType: string;
  isPrimitive: boolean;
  isContainer: boolean;
  isList: boolean;
  isMap: boolean;
  componentType?: JavaResolvedType;
  valueType?: JavaResolvedType;
  imports: Set<string>;
}

export interface JavaTypeResolverContext {
  schemas?: Record<string, any>;
}

export interface JavaTypeResolverOptions {
  collectionType?: string;
  collectionFqcn?: string;
  mapType?: string;
  mapFqcn?: string;
  modelPrefix?: string;
  dtoPackage?: string;
}

const createJavaType = ({
  fullType,
  baseType,
  rawType,
  isPrimitive = false,
  isContainer = false,
  isList = false,
  isMap = false,
  componentType,
  valueType,
  imports = new Set<string>(),
}: Partial<JavaResolvedType> & { fullType: string; baseType: string; rawType: string; imports?: Set<string> }): JavaResolvedType => ({
  fullType,
  baseType,
  rawType,
  isPrimitive,
  isContainer,
  isList,
  isMap,
  componentType,
  valueType,
  imports,
});

const resolveRefName = (schema: any): string | undefined => {
  if (schema?.$ref && typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    const parts = ref.split('/');
    return parts[parts.length - 1];
  }
  return undefined;
};
type JavaTypeResolverState = {
  resolvingRefs: Set<string>;
  refStack: string[];
};

const createModelType = (modelName: string, dtoPackage?: string): JavaResolvedType => {
  const imports = new Set<string>();
  addImport(imports, dtoPackage ? `${dtoPackage}.${modelName}` : undefined);
  return createJavaType({ fullType: modelName, baseType: modelName, rawType: modelName, imports });
};

const resolveJavaTypeInternal = (
  schema: any,
  { schemas = {} }: JavaTypeResolverContext = {},
  options: JavaTypeResolverOptions = {},
  state: JavaTypeResolverState,
): JavaResolvedType => {
  const collectionType = options.collectionType ?? DEFAULT_COLLECTION_TYPE.simple;
  const collectionFqcn = options.collectionFqcn ?? DEFAULT_COLLECTION_TYPE.fqcn;
  const mapType = options.mapType ?? DEFAULT_MAP_TYPE.simple;
  const mapFqcn = options.mapFqcn ?? DEFAULT_MAP_TYPE.fqcn;
  const modelPrefix = options.modelPrefix ?? 'Model';
  const dtoPackage = options.dtoPackage;

  if (!schema) {
    return createJavaType({ fullType: 'Void', baseType: 'Void', rawType: 'Void', isPrimitive: true });
  }

  if (schema.$ref) {
    const refName = resolveRefName(schema) ?? modelPrefix;
    const modelName = toModelName(refName, { prefix: modelPrefix });

    if (state.resolvingRefs.has(refName)) {
      return createModelType(modelName, dtoPackage);
    }

    state.resolvingRefs.add(refName);
    state.refStack.push(refName);
    try {
      const referencedSchema = schemas?.[refName];
      if (referencedSchema) {
        const resolved = resolveJavaTypeInternal(referencedSchema, { schemas }, options, state);
        if (resolved.isContainer || resolved.isPrimitive) {
          return resolved;
        }
        return createModelType(modelName, dtoPackage);
      }
    } finally {
      state.resolvingRefs.delete(refName);
      state.refStack.pop();
    }

    return createModelType(modelName, dtoPackage);
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const refItem = schema.allOf.find((item: any) => item.$ref) ?? schema.allOf[0];
    return resolveJavaTypeInternal(refItem, { schemas }, options, state);
  }

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const composites = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])];
    const currentRef = state.refStack[state.refStack.length - 1];

    const inferModelName = (): string | undefined => {
      if (currentRef) {
        return currentRef;
      }
      if (schema.title) {
        return schema.title;
      }
      const entry = Object.entries(schemas ?? {}).find(([, candidate]) => candidate === schema);
      if (entry) {
        return entry[0];
      }
      for (const composite of composites) {
        const refName = resolveRefName(composite);
        if (refName) {
          return refName;
        }
      }
      return undefined;
    };

    const modelTarget = inferModelName();
    if (modelTarget) {
      const modelName = toModelName(modelTarget, { prefix: modelPrefix });
      return createModelType(modelName, dtoPackage);
    }

    return createJavaType({ fullType: 'Object', baseType: 'Object', rawType: 'Object', imports: new Set() });
  }

  const type = schema.type ?? (schema.enum ? typeof schema.enum[0] : undefined);
  const format = schema.format;

  switch (type) {
    case 'integer': {
      if (format === 'int64' || format === 'long') {
        return createJavaType({ fullType: 'Long', baseType: 'Long', rawType: 'Long', isPrimitive: true });
      }
      if (format === 'int16' || format === 'short') {
        return createJavaType({ fullType: 'Short', baseType: 'Short', rawType: 'Short', isPrimitive: true });
      }
      if (format === 'int8' || format === 'byte') {
        return createJavaType({ fullType: 'Byte', baseType: 'Byte', rawType: 'Byte', isPrimitive: true });
      }
      return createJavaType({ fullType: 'Integer', baseType: 'Integer', rawType: 'Integer', isPrimitive: true });
    }
    case 'number': {
      if (format === 'float') {
        return createJavaType({ fullType: 'Float', baseType: 'Float', rawType: 'Float', isPrimitive: true });
      }
      if (format === 'double') {
        return createJavaType({ fullType: 'Double', baseType: 'Double', rawType: 'Double', isPrimitive: true });
      }
      const imports = new Set<string>();
      addImport(imports, 'java.math.BigDecimal');
      return createJavaType({ fullType: 'BigDecimal', baseType: 'BigDecimal', rawType: 'BigDecimal', imports });
    }
    case 'boolean': {
      return createJavaType({ fullType: 'Boolean', baseType: 'Boolean', rawType: 'Boolean', isPrimitive: true });
    }
    case 'string': {
      if (format === 'date') {
        const imports = new Set<string>();
        addImport(imports, 'java.time.LocalDate');
        return createJavaType({ fullType: 'LocalDate', baseType: 'LocalDate', rawType: 'LocalDate', imports });
      }
      if (format === 'date-time' || format === 'offset-date-time') {
        const imports = new Set<string>();
        addImport(imports, 'java.time.OffsetDateTime');
        return createJavaType({ fullType: 'OffsetDateTime', baseType: 'OffsetDateTime', rawType: 'OffsetDateTime', imports });
      }
      if (format === 'uuid') {
        const imports = new Set<string>();
        addImport(imports, 'java.util.UUID');
        return createJavaType({ fullType: 'UUID', baseType: 'UUID', rawType: 'UUID', imports });
      }
      if (format === 'byte') {
        return createJavaType({ fullType: 'byte[]', baseType: 'byte[]', rawType: 'byte[]', isPrimitive: true });
      }
      return createJavaType({ fullType: 'String', baseType: 'String', rawType: 'String', isPrimitive: true });
    }
    case 'array': {
      const itemsSchema = schema.items ?? {};
      const componentType = resolveJavaTypeInternal(itemsSchema, { schemas }, options, state);
      const imports = mergeImports(componentType.imports, new Set([collectionFqcn]));
      return createJavaType({
        fullType: `${collectionType}<${componentType.fullType}>`,
        baseType: componentType.baseType,
        rawType: collectionType,
        isContainer: true,
        isList: true,
        componentType,
        imports,
      });
    }
    case 'object': {
      if (schema.additionalProperties !== undefined) {
        const additional = schema.additionalProperties === true ? {} : schema.additionalProperties;
        const valueType = resolveJavaTypeInternal(additional, { schemas }, options, state);
        const imports = mergeImports(valueType.imports, new Set([mapFqcn]));
        return createJavaType({
          fullType: `${mapType}<String, ${valueType.fullType}>`,
          baseType: valueType.baseType,
          rawType: mapType,
          isContainer: true,
          isMap: true,
          valueType,
          imports,
        });
      }
      if (schema.properties || schema.title) {
        const currentRef = state.refStack[state.refStack.length - 1];
        if (currentRef && schemas?.[currentRef] === schema) {
          const modelName = toModelName(currentRef, { prefix: modelPrefix });
          return createModelType(modelName, dtoPackage);
        }
        const propertyKeys = Object.keys(schema.properties ?? {});
        const firstNonAnnotationProperty = propertyKeys.find(key => !key.startsWith('@'));
        const title = schema.title ?? firstNonAnnotationProperty ?? propertyKeys[0];
        if (title) {
          const modelName = toModelName(title, { prefix: modelPrefix });
          return createModelType(modelName, dtoPackage);
        }
      }
      return createJavaType({ fullType: 'Object', baseType: 'Object', rawType: 'Object', imports: new Set() });
    }
    default: {
      if (schema.enum) {
        return createJavaType({ fullType: 'String', baseType: 'String', rawType: 'String', isPrimitive: true });
      }
      if (schema.$ref) {
        const refName = resolveRefName(schema) ?? modelPrefix;
        const modelName = toModelName(refName, { prefix: modelPrefix });
        return createModelType(modelName, dtoPackage);
      }
      const inlineRef = resolveRefName(schema.schema);
      if (inlineRef) {
        const modelName = toModelName(inlineRef, { prefix: modelPrefix });
        return createModelType(modelName, dtoPackage);
      }
      return createJavaType({ fullType: 'Object', baseType: 'Object', rawType: 'Object', imports: new Set() });
    }
  }
};

export const resolveJavaType = (
  schema: any,
  context: JavaTypeResolverContext = {},
  options: JavaTypeResolverOptions = {},
): JavaResolvedType => resolveJavaTypeInternal(schema, context, options, { resolvingRefs: new Set(), refStack: [] });
