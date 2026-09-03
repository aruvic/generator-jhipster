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

import { databaseTypes, searchEngineTypes } from '../../../lib/jhipster/index.ts';
import { mutateData } from '../../../lib/utils/object.ts';
import type { RelationshipWithEntity } from '../../base-application/types.ts';
import type { DatabaseField, DatabaseRelationship } from '../../liquibase/types.ts';
import type {
  Entity as SpringBootEntity,
  Field as SpringBootField,
  Relationship as SpringBootRelationship,
} from '../../spring-boot/types.d.ts';

import { hibernateSnakeCase } from './string.ts';

const { NO: NO_SEARCH_ENGINE, ELASTICSEARCH } = searchEngineTypes;
const { COUCHBASE } = databaseTypes;

function getFieldColumnName(field: SpringBootField): string | undefined {
  const databaseField = field as SpringBootField & DatabaseField;
  return databaseField.columnName ?? field.fieldNameAsDatabaseColumn;
}

export function loadRequiredConfigDerivedProperties(entity: any) {
  entity.searchEngineCouchbase = entity.searchEngine === COUCHBASE;
  entity.searchEngineElasticsearch = entity.searchEngine === ELASTICSEARCH;
  entity.searchEngineAny = entity.searchEngine && entity.searchEngine !== NO_SEARCH_ENGINE;
  entity.searchEngineNo = !entity.searchEngineAny;
}

export function preparePostEntityServerDerivedProperties(
  entity: SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>,
) {
  mutateData(entity, {
    uniqueEnums: ({ fields }) => [...new Set(fields.filter(field => field.fieldIsEnum))],
  });
  disableWritableDuplicateColumnFields(entity);

  ensureUniqueSqlRelationshipColumnNames(entity);

  if (entity.primaryKey?.derived) {
    entity.isUsingMapsId = true;
    entity.mapsIdAssoc = entity.relationships.find(rel => rel.id);
  } else {
    entity.isUsingMapsId = false;
    entity.mapsIdAssoc = undefined;
  }
  entity.reactiveOtherEntities = new Set(entity.reactiveEagerRelations.map(rel => rel.otherEntity));
  entity.reactiveUniqueEntityTypes = new Set(entity.reactiveEagerRelations.map(rel => rel.otherEntity.entityNameCapitalized));
  entity.reactiveUniqueEntityTypes.add(entity.entityClass);
  if (entity.databaseType === 'sql') {
    for (const relationship of entity.relationships) {
      if (!relationship.otherEntity.embedded) {
        const relationshipColumnName = (relationship as DatabaseRelationship).columnName ?? hibernateSnakeCase(relationship.relationshipName);
        (relationship as DatabaseRelationship).joinColumnNames = relationship.otherEntity.primaryKey!.fields.map(
          otherField =>
            `${relationship.id && relationship.relationshipOneToOne ? '' : `${relationshipColumnName}_`}${(otherField as DatabaseField).columnName}`,
        );
      }
    }
  }
}

function ensureUniqueSqlRelationshipColumnNames(
  entity: SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>,
) {
  if (entity.databaseType !== 'sql') {
    return;
  }

  const usedColumnNames = new Set(entity.fields.map(getFieldColumnName).filter(Boolean));
  const joinColumnNamesFor = (relationship: RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>, columnName: string) =>
    relationship.otherEntity.primaryKey!.fields.map(
      otherField =>
        `${relationship.id && relationship.relationshipOneToOne ? '' : `${columnName}_`}${(otherField as DatabaseField).columnName}`,
    );

  for (const relationship of entity.relationships) {
    if (!relationship.otherEntity || relationship.otherEntity.embedded) {
      continue;
    }

    const relationshipUsesJoinColumn =
      relationship.relationshipManyToOne || (relationship.relationshipOneToOne && relationship.ownerSide && !relationship.id);
    if (!relationshipUsesJoinColumn) {
      continue;
    }

    const databaseRelationship = relationship as SpringBootRelationship & DatabaseRelationship;
    const originalColumnName = databaseRelationship.columnName ?? hibernateSnakeCase(relationship.relationshipName);
    let columnName = originalColumnName;
    let joinColumnNames = joinColumnNamesFor(relationship, columnName);
    let suffix = 0;

    while (joinColumnNames.some(joinColumnName => usedColumnNames.has(joinColumnName))) {
      suffix += 1;
      columnName = suffix === 1 ? `${originalColumnName}_rel` : `${originalColumnName}_rel_${suffix}`;
      joinColumnNames = joinColumnNamesFor(relationship, columnName);
    }

    databaseRelationship.columnName = columnName;
    for (const joinColumnName of joinColumnNames) {
      usedColumnNames.add(joinColumnName);
    }
  }
}

const SYNTHETIC_DISCRIMINATOR_COLUMN_NAME = 'dtype';

function collectDiscriminatorValues(
  entity: SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>,
): string[] {
  const values = new Set<string>();
  const addValue = (value: unknown) => {
    if (value === undefined || value === null) {
      return;
    }
    const stringValue = String(value).trim();
    if (stringValue) {
      values.add(stringValue);
    }
  };
  for (const value of Object.keys(entity.discriminatorColumn?.values ?? {})) {
    addValue(value);
  }
  const addChildValues = (children: SpringBootEntity[] | undefined) => {
    for (const child of children ?? []) {
      addValue(child.discriminatorValue);
      addChildValues(child.childEntities as SpringBootEntity[] | undefined);
    }
  };
  addChildValues(entity.childEntities as SpringBootEntity[] | undefined);
  return [...values];
}

/**
 * A declared field can keep doubling as the physical discriminator column only when its own Java/SQL
 * type is able to hold every discriminator value verbatim. Otherwise Hibernate would write the class
 * `@DiscriminatorValue` into a column the API also exposes as user data, silently rewriting the
 * submitted payload value.
 */
function fieldCanCarryDiscriminatorValues(
  field: SpringBootField,
  discriminatorColumn: NonNullable<
    SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>['discriminatorColumn']
  >,
  discriminatorValues: string[],
): boolean {
  if (field.fieldIsEnum) {
    if (discriminatorColumn.discriminatorType === 'INTEGER') {
      return false;
    }
    const enumValues = new Set(
      (field.enumValues ?? []).map(enumValue => (typeof enumValue === 'string' ? enumValue : enumValue.name)).filter(Boolean),
    );
    if (enumValues.size === 0) {
      return false;
    }
    return discriminatorValues.every(value => enumValues.has(value));
  }
  const fieldType = String(field.fieldType ?? '');
  if (discriminatorColumn.discriminatorType === 'INTEGER') {
    return (fieldType === 'Integer' || fieldType === 'Long') && discriminatorValues.every(value => /^-?\d+$/.test(value));
  }
  if (fieldType !== 'String') {
    return false;
  }
  const maxLength = discriminatorColumn.length;
  return maxLength === undefined || discriminatorValues.every(value => value.length <= maxLength);
}

/**
 * Keep a declared payload field from doubling as the physical JPA discriminator column when it cannot
 * faithfully carry type tags. The `@DiscriminatorColumn` is moved to a synthetic column so the declared
 * field stays writable and is persisted verbatim.
 */
function relocateConflictingDiscriminatorColumn(
  entity: SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>,
  columns: Map<string, SpringBootField[]>,
): void {
  const discriminatorColumn = entity.discriminatorColumn;
  if (!discriminatorColumn) {
    return;
  }
  const conflictingFields = (columns.get(discriminatorColumn.name) ?? []).filter(field => !('derived' in field && field.derived));
  if (conflictingFields.length === 0) {
    return;
  }
  const discriminatorValues = collectDiscriminatorValues(entity);
  if (
    discriminatorValues.length > 0 &&
    conflictingFields.every(field => fieldCanCarryDiscriminatorValues(field, discriminatorColumn, discriminatorValues))
  ) {
    return;
  }

  const usedColumnNames = new Set([...columns.keys()]);
  let syntheticName = SYNTHETIC_DISCRIMINATOR_COLUMN_NAME;
  let suffix = 0;
  while (usedColumnNames.has(syntheticName)) {
    suffix += 1;
    syntheticName = `${SYNTHETIC_DISCRIMINATOR_COLUMN_NAME}_${suffix}`;
  }
  discriminatorColumn.rawName = syntheticName;
  discriminatorColumn.name = syntheticName;
}

function disableWritableDuplicateColumnFields(
  entity: SpringBootEntity<SpringBootField, RelationshipWithEntity<SpringBootRelationship, SpringBootEntity>>,
) {
  if (entity.databaseType !== 'sql') {
    return;
  }
  const columns = new Map<string, SpringBootField[]>();
  for (const field of entity.fields) {
    const columnName = getFieldColumnName(field);
    if (!columnName) {
      continue;
    }
    const group = columns.get(columnName) ?? [];
    group.push(field);
    columns.set(columnName, group);
  }

  const markColumnsAsReadOnly = (fields: SpringBootField[] | undefined) => {
    if (!fields?.length) {
      return;
    }
    for (const field of fields) {
      if (field.columnInsertable !== false) {
        field.columnInsertable = false;
      }
      if (field.columnUpdatable !== false) {
        field.columnUpdatable = false;
      }
    }
  };

  const discriminatorColumnName = entity.discriminatorColumn?.name;
  if (discriminatorColumnName) {
    relocateConflictingDiscriminatorColumn(entity, columns);
    if (entity.discriminatorColumn?.name === discriminatorColumnName) {
      markColumnsAsReadOnly(columns.get(discriminatorColumnName));
    }
  }

  for (const fields of columns.values()) {
    if (fields.length <= 1) {
      continue;
    }
    const writableField = fields.find(field => !('derived' in field && field.derived)) ?? fields[0];
    markColumnsAsReadOnly(fields.filter(field => field !== writableField));
  }
}
