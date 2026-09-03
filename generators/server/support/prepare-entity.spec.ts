import { describe, expect, it } from 'esmocha';

import { preparePostEntityServerDerivedProperties } from './prepare-entity.ts';

describe('generator - server - support - prepare entity', () => {
  describe('preparePostEntityServerDerivedProperties', () => {
    it('disambiguates relationship join columns that collide with scalar field columns', () => {
      const relationship: any = {
        relationshipName: 'characteristicSpecification',
        relationshipManyToOne: true,
        relationshipOneToOne: false,
        ownerSide: true,
        columnName: 'characteristic_specification',
        otherEntity: {
          embedded: false,
          primaryKey: {
            fields: [{ columnName: 'id' }],
          },
        },
      };
      const entity: any = {
        databaseType: 'sql',
        fields: [{ fieldNameAsDatabaseColumn: 'characteristic_specification_id' }],
        relationships: [relationship],
        reactiveEagerRelations: [],
      };

      preparePostEntityServerDerivedProperties(entity);

      expect(relationship.columnName).toBe('characteristic_specification_rel');
      expect(relationship.joinColumnNames).toEqual(['characteristic_specification_rel_id']);
    });

    it('keeps relationship join columns unchanged when there is no collision', () => {
      const relationship: any = {
        relationshipName: 'owner',
        relationshipManyToOne: true,
        relationshipOneToOne: false,
        ownerSide: true,
        columnName: 'owner',
        otherEntity: {
          embedded: false,
          primaryKey: {
            fields: [{ columnName: 'id' }],
          },
        },
      };
      const entity: any = {
        databaseType: 'sql',
        fields: [{ fieldNameAsDatabaseColumn: 'name' }],
        relationships: [relationship],
        reactiveEagerRelations: [],
      };

      preparePostEntityServerDerivedProperties(entity);

      expect(relationship.columnName).toBe('owner');
      expect(relationship.joinColumnNames).toEqual(['owner_id']);
    });

    it('moves the discriminator column to a synthetic column when a declared field cannot carry type tags', () => {
      const entity: any = {
        databaseType: 'sql',
        polymorphicRoot: true,
        discriminatorColumn: {
          rawName: 'isShipperOwned',
          name: 'is_shipper_owned',
          discriminatorType: 'STRING',
          discriminatorTypeLiteral: 'DiscriminatorType.STRING',
          length: 31,
          sqlType: 'varchar(31)',
          values: { true: 'UtEquipment', false: 'UtEquipmentReference' },
        },
        fields: [{ fieldName: 'isShipperOwned', fieldType: 'Boolean', fieldNameAsDatabaseColumn: 'is_shipper_owned' }],
        relationships: [],
        reactiveEagerRelations: [],
      };

      preparePostEntityServerDerivedProperties(entity);

      expect(entity.discriminatorColumn.name).toBe('dtype');
      expect(entity.discriminatorColumn.rawName).toBe('dtype');
      expect(entity.fields[0].columnInsertable).toBeUndefined();
      expect(entity.fields[0].columnUpdatable).toBeUndefined();
    });

    it('keeps a string field as the discriminator column when it can carry every type tag', () => {
      const entity: any = {
        databaseType: 'sql',
        polymorphicRoot: true,
        discriminatorColumn: {
          rawName: 'atType',
          name: 'at_type',
          discriminatorType: 'STRING',
          discriminatorTypeLiteral: 'DiscriminatorType.STRING',
          length: 31,
          sqlType: 'varchar(31)',
          values: { ConcreteRef: 'ConcreteRef', ExternalRef: 'ExternalRef' },
        },
        fields: [{ fieldName: 'atType', fieldType: 'String', fieldNameAsDatabaseColumn: 'at_type' }],
        relationships: [],
        reactiveEagerRelations: [],
      };

      preparePostEntityServerDerivedProperties(entity);

      expect(entity.discriminatorColumn.name).toBe('at_type');
      expect(entity.fields[0].columnInsertable).toBe(false);
      expect(entity.fields[0].columnUpdatable).toBe(false);
    });
  });
});
