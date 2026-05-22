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
  });
});
