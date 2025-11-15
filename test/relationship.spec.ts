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
import { describe, expect, it } from 'esmocha';

import { loadEntitiesOtherSide } from '../generators/base-application/support/relationship.ts';
import { addEntitiesOtherRelationships } from '../generators/server/support/relationship.ts';

describe('relationship support', () => {
  describe('loadEntitiesOtherSide', () => {
    const relationship = {
      otherEntityName: 'partyInteraction',
      relationshipName: 'partyInteraction',
      relationshipSide: 'right',
      relationshipType: 'many-to-one',
    };
    it('should throw when the other entity is missing by default', () => {
      expect(() => loadEntitiesOtherSide([{ name: 'AttachmentRefOrValue', relationships: [relationship] } as any])).toThrow(
        /could not find the entity partyInteraction/,
      );
    });

    it('should skip missing other entity when allowed', () => {
      const result = loadEntitiesOtherSide([{ name: 'AttachmentRefOrValue', relationships: [relationship] } as any], {
        allowMissingOtherEntity: true,
      });
      expect(result.warning).toContain('Error at entity AttachmentRefOrValue: could not find the entity partyInteraction');
    });
  });

  it('addEntitiesOtherRelationships should ignore relationships without the other entity', () => {
    const relationship = {
      otherEntityName: 'partyInteraction',
      relationshipName: 'partyInteraction',
      relationshipSide: 'right',
      relationshipType: 'many-to-one',
    };
    expect(() =>
      addEntitiesOtherRelationships([{ name: 'AttachmentRefOrValue', relationships: [relationship], databaseType: 'sql' } as any]),
    ).not.toThrow();
  });
});
