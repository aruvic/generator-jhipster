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

import { upperFirst } from 'lodash-es';

import type BaseGenerator from '../../base-core/generator.ts';
import { hibernateSnakeCase } from '../../server/support/index.ts';
import type { DiscriminatorColumnConfig, Entity as BaseApplicationEntity } from '../entity.ts';

type Logger = BaseGenerator['log'] | undefined;

export function linkEntityInheritance(entities: BaseApplicationEntity[], logger?: Logger) {
  const entitiesByName = new Map<string, BaseApplicationEntity>();
  entities.forEach(entity => {
    entitiesByName.set(upperFirst(entity.name), entity);
  });

  for (const entity of entities) {
    if (!entity.extends) {
      continue;
    }
    const parentName = upperFirst(entity.extends);
    const parentEntity = entitiesByName.get(parentName);
    if (!parentEntity) {
      throw new Error(`Cannot extend unknown entity ${parentName} from ${entity.name}`);
    }
    if (parentEntity === entity) {
      throw new Error(`Entity ${entity.name} cannot extend itself`);
    }
    validateNoInheritanceCycle(entity, parentEntity);
    entity.parentEntity = parentEntity as typeof entity;
    parentEntity.childEntities = parentEntity.childEntities ?? [];
    if (!parentEntity.childEntities.includes(entity as typeof parentEntity)) {
      parentEntity.childEntities.push(entity as typeof parentEntity);
    }
  }

  for (const entity of entities) {
    if (!('parentEntity' in entity)) {
      entity.parentEntity = undefined;
    }
    if (!('childEntities' in entity) || !entity.childEntities) {
      entity.childEntities = [];
    }
    applyInheritanceMetadata(entity, logger);
  }
}

function validateNoInheritanceCycle(entity: BaseApplicationEntity, parent: BaseApplicationEntity) {
  let current: BaseApplicationEntity | undefined = parent;
  while (current) {
    if (current === entity) {
      throw new Error(`Cyclic inheritance detected for entity ${entity.name}`);
    }
    current = current.parentEntity;
  }
}

function applyInheritanceMetadata(entity: BaseApplicationEntity, logger?: Logger) {
  if (entity.abstract !== undefined) {
    entity.abstractClass = Boolean(entity.abstract);
  }

  entity.discriminatorValue = normalizeDiscriminatorValue(entity.discriminatorValue);

  const discriminatorColumn = buildDiscriminatorColumn(entity.discriminator);
  if (discriminatorColumn) {
    entity.discriminatorColumn = discriminatorColumn;
    entity.polymorphicRoot = true;
  }

  if (entity.parentEntity) {
    const polymorphicAncestor = findPolymorphicAncestor(entity.parentEntity);
    if (!polymorphicAncestor) {
      logger?.warn(`Entity ${entity.name} extends ${entity.parentEntity.name} without a discriminator definition`);
    }
    entity.polymorphicChild = Boolean(polymorphicAncestor);
    entity.abstractClass = entity.abstractClass ?? false;
    if (!entity.discriminatorValue) {
      const parentValues = polymorphicAncestor?.discriminatorColumn?.values;
      const derivedValue = parentValues?.[entity.name];
      if (derivedValue) {
        entity.discriminatorValue = derivedValue;
      }
    }
  } else if (entity.polymorphicRoot) {
    entity.abstractClass = entity.abstractClass ?? true;
  }

  entity.abstractClass = Boolean(entity.abstractClass);
  entity.polymorphicRoot = Boolean(entity.polymorphicRoot);
  entity.polymorphicChild = Boolean(entity.polymorphicChild);

  if (entity.polymorphicRoot || entity.polymorphicChild) {
    entity.skipFakeData = true;
  }

  (entity as any).hasParentEntity = Boolean(entity.parentEntity);
}

function findPolymorphicAncestor(entity: BaseApplicationEntity | undefined): BaseApplicationEntity | undefined {
  let current = entity;
  while (current) {
    if (current.discriminatorColumn) {
      return current;
    }
    current = current.parentEntity;
  }
  return undefined;
}

function normalizeDiscriminatorValue(value: any): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object') {
    if ('value' in value) {
      return value.value;
    }
    if ('name' in value) {
      return value.name;
    }
  }
  return String(value);
}

function buildDiscriminatorColumn(rawDiscriminator: any): DiscriminatorColumnConfig | undefined {
  if (!rawDiscriminator || typeof rawDiscriminator !== 'object') {
    return undefined;
  }
  const rawName = rawDiscriminator.column ?? 'dtype';
  const type = String(rawDiscriminator.type ?? 'String').toLowerCase();
  let discriminatorType: DiscriminatorColumnConfig['discriminatorType'];
  switch (type) {
    case 'integer':
      discriminatorType = 'INTEGER';
      break;
    case 'char':
    case 'character':
      discriminatorType = 'CHAR';
      break;
    default:
      discriminatorType = 'STRING';
  }
  let defaultLength: number | undefined;
  if (discriminatorType === 'CHAR') {
    defaultLength = 1;
  } else if (discriminatorType === 'STRING') {
    defaultLength = 31;
  }
  let length: number | undefined;
  if (rawDiscriminator.length !== undefined && rawDiscriminator.length !== null) {
    length = Number(rawDiscriminator.length);
  } else {
    length = defaultLength;
  }

  let sqlType: string;
  if (discriminatorType === 'INTEGER') {
    sqlType = 'integer';
  } else if (discriminatorType === 'CHAR') {
    sqlType = `char(${length ?? 1})`;
  } else {
    sqlType = `varchar(${length ?? 31})`;
  }
  const values = typeof rawDiscriminator.values === 'string' ? parseDiscriminatorValues(rawDiscriminator.values) : undefined;
  return {
    rawName: String(rawName),
    name: hibernateSnakeCase(String(rawName)),
    discriminatorType,
    discriminatorTypeLiteral: `DiscriminatorType.${discriminatorType}`,
    length,
    sqlType,
    values,
  };
}

function parseDiscriminatorValues(values: string): Record<string, string> {
  return Object.fromEntries(
    values
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0)
      .map(entry => {
        const [entity, discriminator] = entry.split('->').map(part => part.trim());
        return [entity, discriminator ?? entity];
      }),
  );
}
