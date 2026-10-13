import assert from 'node:assert/strict';
import test from 'node:test';

import { expandAllNestedAccordions } from './accessibility-coverage.mjs';
import { newlyMaterializedOptionalArrayItems } from './form-crud-array-lifecycle.mjs';
import {
  interactWithOptionalFormControl,
  matchOptionalFormExerciseControls,
  mergeOptionalFormExerciseValues,
  planOptionalFormExercises,
} from './form-crud-field-exercise.mjs';
import { buildOperationSchemaCoverage, evaluateOperationSchemaCoverage } from './operation-schema-coverage.mjs';

function bodyFields(fields) {
  return [
    {
      key: 'body',
      wrappers: ['form-crud-accordion'],
      props: { label: 'Main information' },
      fieldGroup: [
        {
          key: 'shipment',
          wrappers: ['form-crud-accordion'],
          props: { label: 'Shipment' },
          fieldGroup: fields,
        },
      ],
    },
  ];
}

function shipmentSchema(fields) {
  return [{ name: 'shipment', path: ['shipment'], type: 'object', required: true, fields }];
}

test('plans every rendered optional scalar control kind without treating defaults as interactions', () => {
  const fields = [
    { key: 'name', type: 'input', props: { label: 'Name', type: 'text' } },
    { key: 'count', type: 'input', props: { label: 'Count', type: 'number' } },
    { key: 'state', type: 'select', props: { label: 'State' } },
    { key: 'enabled', type: 'checkbox', props: { label: 'Enabled' } },
    { key: 'notes', type: 'textarea', props: { label: 'Notes' } },
    { key: 'existing', type: 'input', props: { label: 'Existing', type: 'text' } },
    { key: 'requiredCode', type: 'input', props: { label: 'Required code', type: 'text', required: true } },
  ];
  const schema = shipmentSchema([
    { name: 'name', path: ['shipment', 'name'], type: 'string', required: false },
    { name: 'count', path: ['shipment', 'count'], type: 'integer', required: false },
    { name: 'state', path: ['shipment', 'state'], type: 'string', enumValues: ['NEW', 'OLD'], required: false },
    { name: 'enabled', path: ['shipment', 'enabled'], type: 'boolean', required: false },
    { name: 'notes', path: ['shipment', 'notes'], type: 'string', required: false },
    { name: 'existing', path: ['shipment', 'existing'], type: 'string', required: false },
    { name: 'requiredCode', path: ['shipment', 'requiredCode'], type: 'string', required: true },
  ]);
  const submittedBody = { shipment: { existing: 'already-covered', requiredCode: 'required' } };
  const formBody = {
    shipment: { name: 'sample', count: 1, state: 'NEW', enabled: false, notes: 'note', ...submittedBody.shipment },
  };

  const plan = planOptionalFormExercises(bodyFields(fields), schema, submittedBody, formBody, { budget: 10 });

  assert.deepEqual(plan.actions.map(action => action.kind).sort(), ['checkbox', 'input:number', 'input:text', 'select', 'textarea']);
  assert.deepEqual(plan.actions.map(action => action.schemaPath.join('.')).sort(), [
    'shipment.count',
    'shipment.enabled',
    'shipment.name',
    'shipment.notes',
    'shipment.state',
  ]);
  assert.equal(
    plan.actions.some(action => action.schemaPath.at(-1) === 'existing'),
    false,
  );
  assert.equal(
    plan.actions.some(action => action.schemaPath.at(-1) === 'requiredCode'),
    false,
  );
});

test('exercises and submits a contract-valid intentional blank without accepting constrained blanks', async () => {
  const fields = [
    { key: 'blank', type: 'input', props: { label: 'Blank', type: 'text' } },
    { key: 'requiredText', type: 'input', props: { label: 'Required text', type: 'text' } },
    { key: 'formatted', type: 'input', props: { label: 'Formatted', type: 'email' } },
  ];
  const schema = [
    { name: 'blank', path: ['blank'], type: 'string', required: false },
    { name: 'requiredText', path: ['requiredText'], type: 'string', minLength: 1, required: false },
    { name: 'formatted', path: ['formatted'], type: 'string', format: 'email', required: false },
  ];
  const formBody = { blank: '', requiredText: '', formatted: '' };
  const plan = planOptionalFormExercises(fields, schema, {}, formBody, { budget: 3 });
  const blankAction = plan.actions.find(action => action.schemaPath.at(-1) === 'blank');

  assert.equal(blankAction.intentionalValue, '');
  assert.equal(plan.actions.find(action => action.schemaPath.at(-1) === 'requiredText').intentionalValue, undefined);
  assert.equal(plan.actions.find(action => action.schemaPath.at(-1) === 'formatted').intentionalValue, undefined);

  const fills = [];
  let evaluation = 0;
  const interaction = await interactWithOptionalFormControl(
    blankAction,
    {
      evaluate: async () => (evaluation++ === 0 ? { tagName: 'input', type: 'text', value: '', checked: undefined } : true),
      fill: async value => fills.push(value),
      blur: async () => undefined,
    },
    async () => true,
  );

  assert.equal(interaction.interacted, true);
  assert.deepEqual(fills, [' ', '']);
  const constrainedAction = plan.actions.find(action => action.schemaPath.at(-1) === 'requiredText');
  const constrainedInteraction = await interactWithOptionalFormControl(
    constrainedAction,
    {
      evaluate: async () => ({ tagName: 'input', type: 'text', value: '', checked: undefined }),
    },
    async () => true,
  );
  assert.deepEqual(constrainedInteraction, { interacted: false, reasonCode: 'empty-generated-value' });
  const merged = mergeOptionalFormExerciseValues({}, formBody, schema, [blankAction]);
  assert.deepEqual(merged, { blank: '' });
  const operation = { id: 'create-resource', method: 'POST', requestBodyFields: schema };
  const report = buildOperationSchemaCoverage([operation], [{ operation, status: 201, requestBody: merged }]);
  assert.equal(report.entries.find(entry => entry.path.join('.') === 'blank').status, 'covered');
  assert.equal(report.entries.find(entry => entry.path.join('.') === 'requiredText').status, 'not-covered');
});

test('activates bounded array and nested accordion instances with only required closure values', () => {
  const fields = bodyFields([
    {
      key: 'dimensions',
      wrappers: ['form-crud-accordion'],
      props: { label: 'Dimensions' },
      fieldGroup: [
        { key: 'value', type: 'input', props: { label: 'Value', type: 'number', required: true } },
        { key: 'unit', type: 'select', props: { label: 'Unit', required: true } },
        { key: 'displayName', type: 'input', props: { label: 'Display name', type: 'text' } },
        { key: 'serverId', type: 'input', props: { label: 'Server ID', type: 'text', required: true, disabled: true } },
      ],
    },
    {
      key: 'tags',
      type: 'form-crud-repeat',
      props: { label: 'Tags' },
      fieldArray: { type: 'input', props: { label: 'Tag', type: 'text' } },
      fieldGroup: [],
    },
    {
      key: 'contacts',
      type: 'form-crud-repeat',
      props: { label: 'Contacts' },
      fieldArray: {
        fieldGroup: [
          { key: 'email', type: 'input', props: { label: 'Email', type: 'email', required: true } },
          { key: 'name', type: 'input', props: { label: 'Contact name', type: 'text' } },
        ],
      },
      fieldGroup: [],
    },
  ]);
  const schema = shipmentSchema([
    {
      name: 'dimensions',
      path: ['shipment', 'dimensions'],
      type: 'object',
      required: false,
      fields: [
        { name: 'value', path: ['shipment', 'dimensions', 'value'], type: 'number', required: true },
        { name: 'unit', path: ['shipment', 'dimensions', 'unit'], type: 'string', enumValues: ['KGM'], required: true },
        { name: 'displayName', path: ['shipment', 'dimensions', 'displayName'], type: 'string', required: false },
        { name: 'serverId', path: ['shipment', 'dimensions', 'serverId'], type: 'string', required: true, readOnly: true },
      ],
    },
    {
      name: 'tags',
      path: ['shipment', 'tags'],
      type: 'array',
      required: false,
      items: { name: 'tag', type: 'string', required: true },
    },
    {
      name: 'contacts',
      path: ['shipment', 'contacts'],
      type: 'array',
      required: false,
      items: {
        name: 'contact',
        type: 'object',
        required: true,
        fields: [
          { name: 'email', path: ['shipment', 'contacts', '0', 'email'], type: 'string', format: 'email', required: true },
          { name: 'name', path: ['shipment', 'contacts', '0', 'name'], type: 'string', required: false },
        ],
      },
    },
  ]);
  const submittedBody = { shipment: {} };
  const initialFormBody = {
    shipment: {
      dimensions: { value: 1, unit: 'KGM', displayName: 'generated but untouched', serverId: 'read-only' },
      tags: [],
      contacts: [],
    },
  };
  const plan = planOptionalFormExercises(fields, schema, submittedBody, initialFormBody, { budget: 3 });

  assert.deepEqual(plan.actions.map(action => action.kind).sort(), ['array', 'array', 'object']);
  assert.equal(plan.actions.find(action => action.kind === 'object').accordionDepth, 3);
  const exercisedFormBody = structuredClone(initialFormBody);
  exercisedFormBody.shipment.tags.push('tag');
  exercisedFormBody.shipment.contacts.push({ email: 'browser@example.invalid', name: 'untouched default' });
  const merged = mergeOptionalFormExerciseValues(submittedBody, exercisedFormBody, schema, plan.actions);

  assert.deepEqual(merged, {
    shipment: {
      contacts: [{ email: 'browser@example.invalid' }],
      dimensions: { value: 1, unit: 'KGM' },
      tags: ['tag'],
    },
  });
  const operation = { id: 'update-shipment', method: 'PUT', requestBodyFields: schema };
  const report = buildOperationSchemaCoverage([operation], [{ operation, status: 204, requestBody: merged }]);

  assert.equal(report.facets.optional.covered, 3);
  assert.equal(report.facets.optional.applicable, 5);
  assert.equal(evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.6 }).passed, true);
});

test('expands newly materialized repeated controls and credits only echoed response fields', async () => {
  const schema = [
    {
      name: 'contacts',
      path: ['contacts'],
      type: 'array',
      required: false,
      items: {
        name: 'contact',
        type: 'object',
        required: true,
        fields: [
          { name: 'email', path: ['contacts', '0', 'email'], type: 'string', format: 'email', required: true },
          { name: 'name', path: ['contacts', '0', 'name'], type: 'string', required: false },
          {
            name: 'preferences',
            path: ['contacts', '0', 'preferences'],
            type: 'object',
            required: false,
            fields: [
              { name: 'locale', path: ['contacts', '0', 'preferences', 'locale'], type: 'string', required: false },
              { name: 'timezone', path: ['contacts', '0', 'preferences', 'timezone'], type: 'string', required: false },
            ],
          },
        ],
      },
    },
  ];
  const initialFields = [
    {
      key: 'body',
      fieldGroup: [
        {
          key: 'contacts',
          type: 'form-crud-repeat',
          props: { label: 'Contacts' },
          fieldArray: {
            fieldGroup: [
              { key: 'email', type: 'input', props: { label: 'Email', type: 'email', required: true } },
              { key: 'name', type: 'input', props: { label: 'Name', type: 'text' } },
            ],
          },
          fieldGroup: [],
        },
      ],
    },
  ];
  const initialBody = { contacts: [] };
  const firstPlan = planOptionalFormExercises(initialFields, schema, {}, initialBody);

  assert.deepEqual(
    firstPlan.actions.map(action => action.kind),
    ['array'],
  );

  const expandedFields = structuredClone(initialFields);
  expandedFields[0].fieldGroup[0].fieldGroup = [
    {
      key: '0',
      fieldGroup: [
        { key: 'email', type: 'input', props: { label: 'Email', type: 'email', required: true } },
        { key: 'name', type: 'input', props: { label: 'Name', type: 'text' } },
        {
          key: 'preferences',
          fieldGroup: [
            { key: 'locale', type: 'input', props: { label: 'Locale', type: 'text' } },
            { key: 'timezone', type: 'input', props: { label: 'Timezone', type: 'text' } },
          ],
        },
      ],
    },
  ];
  const expandedBody = {
    contacts: [{ email: 'browser@example.invalid', name: 'Browser user', preferences: { locale: 'en', timezone: 'UTC' } }],
  };
  const requiredClosureBody = mergeOptionalFormExerciseValues({}, expandedBody, schema, firstPlan.actions);

  assert.deepEqual(requiredClosureBody, { contacts: [{ email: 'browser@example.invalid' }] });

  const secondPlan = planOptionalFormExercises(expandedFields, schema, requiredClosureBody, expandedBody, {
    budget: 3,
    excludedActions: firstPlan.actions,
  });
  assert.deepEqual(secondPlan.actions.map(action => action.schemaPath.join('.')).sort(), ['contacts.[].name', 'contacts.[].preferences']);

  const arrayItem = { expanded: false, ancestors: [] };
  const preferences = { expanded: false, ancestors: [arrayItem] };
  const accordions = [arrayItem, preferences];
  const materializedItems = {
    locator(selector) {
      assert.equal(selector, 'button.accordion-button');
      return {
        count: async () => accordions.length,
        nth: index => ({
          isVisible: async () => accordions[index].ancestors.every(ancestor => ancestor.expanded),
          evaluate: async () => !accordions[index].expanded,
          click: async () => {
            accordions[index].expanded = true;
          },
          page: () => ({ waitForTimeout: async () => undefined }),
        }),
      };
    },
  };
  const form = {
    locator(selector) {
      assert.equal(selector, '[data-form-crud-optional-array-item="true"]');
      return materializedItems;
    },
  };
  const renderedControls = () => [
    {
      tagName: 'input',
      type: 'email',
      name: 'email',
      accessibleName: 'Email',
      visible: arrayItem.expanded,
      disabled: false,
    },
    {
      tagName: 'input',
      type: 'text',
      name: 'name',
      accessibleName: 'Name',
      visible: arrayItem.expanded,
      disabled: false,
    },
    {
      tagName: 'input',
      type: 'text',
      name: 'locale',
      accessibleName: 'Locale',
      visible: arrayItem.expanded && preferences.expanded,
      disabled: false,
    },
    {
      tagName: 'input',
      type: 'text',
      name: 'timezone',
      accessibleName: 'Timezone',
      visible: arrayItem.expanded && preferences.expanded,
      disabled: false,
    },
  ];
  assert.ok(matchOptionalFormExerciseControls(secondPlan.actions, renderedControls()).every(action => action.controlIndex === undefined));

  assert.deepEqual(await expandAllNestedAccordions(newlyMaterializedOptionalArrayItems(form), { settleMs: 0 }), {
    observed: 2,
    expanded: 2,
  });
  const matchedSecondActions = matchOptionalFormExerciseControls(secondPlan.actions, renderedControls());
  assert.deepEqual(Object.fromEntries(matchedSecondActions.map(action => [action.schemaPath.join('.'), action.controlIndex])), {
    'contacts.[].name': 1,
    'contacts.[].preferences': 2,
  });

  const exercisedBody = mergeOptionalFormExerciseValues(requiredClosureBody, expandedBody, schema, matchedSecondActions);
  assert.deepEqual(exercisedBody, {
    contacts: [
      {
        email: 'browser@example.invalid',
        name: 'Browser user',
        preferences: { locale: 'en' },
      },
    ],
  });

  const operation = {
    id: 'create-contact',
    method: 'POST',
    requestBodyFields: schema,
    responseBodyFields: schema,
  };
  const report = buildOperationSchemaCoverage(
    [operation],
    [{ operation, status: 201, requestBody: exercisedBody, responseBody: exercisedBody }],
  );
  assert.equal(report.facets.optional.covered, 8);

  const omittedResponseReport = buildOperationSchemaCoverage(
    [operation],
    [{ operation, status: 201, requestBody: exercisedBody, responseBody: { contacts: [{ email: 'browser@example.invalid' }] } }],
  );
  assert.equal(
    omittedResponseReport.entries.find(entry => entry.direction === 'response' && entry.path.join('.') === 'contacts.[].name').status,
    'not-covered',
  );
});

test('keeps both optional-array frontiers within the unchanged 48-action cap', () => {
  const optionalFields = Array.from({ length: 60 }, (_, index) => ({
    name: `optional${index}`,
    path: ['contacts', '0', `optional${index}`],
    type: 'string',
    required: false,
  }));
  const schema = [
    {
      name: 'contacts',
      path: ['contacts'],
      type: 'array',
      required: false,
      items: {
        name: 'contact',
        type: 'object',
        required: true,
        fields: [{ name: 'email', path: ['contacts', '0', 'email'], type: 'string', format: 'email', required: true }, ...optionalFields],
      },
    },
  ];
  const initialFields = [
    {
      key: 'body',
      fieldGroup: [
        {
          key: 'contacts',
          type: 'form-crud-repeat',
          props: { label: 'Contacts' },
          fieldArray: {
            fieldGroup: [
              { key: 'email', type: 'input', props: { label: 'Email', type: 'email', required: true } },
              ...optionalFields.map(field => ({
                key: field.name,
                type: 'input',
                props: { label: field.name, type: 'text' },
              })),
            ],
          },
          fieldGroup: [],
        },
      ],
    },
  ];
  const initialBody = { contacts: [] };
  const firstPlan = planOptionalFormExercises(initialFields, schema, {}, initialBody, { budget: 48 });
  const expandedFields = structuredClone(initialFields);
  expandedFields[0].fieldGroup[0].fieldGroup = [{ key: '0', fieldGroup: initialFields[0].fieldGroup[0].fieldArray.fieldGroup }];
  const expandedBody = {
    contacts: [
      {
        email: 'browser@example.invalid',
        ...Object.fromEntries(optionalFields.map((field, index) => [field.name, `value-${index}`])),
      },
    ],
  };
  const requiredClosureBody = mergeOptionalFormExerciseValues({}, expandedBody, schema, firstPlan.actions);
  const secondPlan = planOptionalFormExercises(expandedFields, schema, requiredClosureBody, expandedBody, {
    budget: 48 - firstPlan.actions.length,
    excludedActions: firstPlan.actions,
  });

  assert.equal(firstPlan.actions.length, 1);
  assert.equal(secondPlan.actions.length, 47);
  assert.equal(firstPlan.actions.length + secondPlan.actions.length, 48);
  assert.equal(secondPlan.candidateCount, 60);
  assert.equal(secondPlan.truncated, true);
});

test('omits an optional array when compacted item metadata cannot build its required closure', () => {
  const schema = [
    {
      name: 'dependencies',
      path: ['dependencies'],
      type: 'array',
      required: false,
      items: {
        name: 'dependency',
        type: 'object',
        required: true,
        fields: [
          { name: 'status', path: ['dependencies', '0', 'status'], type: 'string', required: true },
          { name: 'displayName', path: ['dependencies', '0', 'displayName'], type: 'string', required: false },
          {
            name: 'descriptor',
            path: ['dependencies', '0', 'descriptor'],
            type: 'object',
            required: true,
          },
        ],
      },
    },
  ];
  const actions = [{ kind: 'array', schemaPath: ['dependencies'], valuePath: ['dependencies'] }];
  const formBody = {
    dependencies: [
      {
        displayName: 'partial browser value',
        descriptor: { type: 'Descriptor' },
      },
    ],
  };

  const merged = mergeOptionalFormExerciseValues({ name: 'base' }, formBody, schema, actions);
  assert.deepEqual(merged, { name: 'base' });
  const materializedFields = [
    {
      key: 'body',
      fieldGroup: [
        {
          key: 'dependencies',
          type: 'form-crud-repeat',
          props: { label: 'Dependencies' },
          fieldArray: {
            fieldGroup: [{ key: 'displayName', type: 'input', props: { label: 'Display name', type: 'text' } }],
          },
          fieldGroup: [
            {
              key: '0',
              fieldGroup: [{ key: 'displayName', type: 'input', props: { label: 'Display name', type: 'text' } }],
            },
          ],
        },
      ],
    },
  ];
  const secondPlan = planOptionalFormExercises(materializedFields, schema, merged, formBody, {
    budget: 47,
    excludedActions: actions,
  });
  assert.deepEqual(secondPlan.actions, []);

  const operation = { id: 'create-resource', method: 'POST', requestBodyFields: schema };
  const report = buildOperationSchemaCoverage([operation], [{ operation, status: 201, requestBody: merged }]);
  assert.equal(report.entries.find(entry => entry.path.join('.') === 'dependencies').status, 'not-covered');
  assert.ok(
    report.entries
      .filter(entry => entry.path.length > 1)
      .every(entry => entry.status === 'not-covered' && entry.reasonCode === 'writable-array-item-not-instantiated'),
  );
});

test('uses deterministic breadth sampling while respecting the interaction budget', () => {
  const scalarFields = Array.from({ length: 12 }, (_, index) => ({
    key: `optional${index}`,
    type: 'input',
    props: { label: `Optional ${index}`, type: index % 2 ? 'email' : 'text' },
  }));
  const formly = bodyFields([
    ...scalarFields,
    {
      key: 'details',
      wrappers: ['form-crud-accordion'],
      props: { label: 'Details' },
      fieldGroup: [{ key: 'code', type: 'input', props: { label: 'Code', type: 'text', required: true } }],
    },
    { key: 'tags', type: 'form-crud-repeat', props: { label: 'Tags' }, fieldArray: { type: 'input' }, fieldGroup: [] },
  ]);
  const schema = shipmentSchema([
    ...scalarFields.map((_, index) => ({
      name: `optional${index}`,
      path: ['shipment', `optional${index}`],
      type: 'string',
      format: index % 2 ? 'email' : undefined,
      required: false,
    })),
    {
      name: 'details',
      path: ['shipment', 'details'],
      type: 'object',
      required: false,
      fields: [{ name: 'code', path: ['shipment', 'details', 'code'], type: 'string', required: true }],
    },
    {
      name: 'tags',
      path: ['shipment', 'tags'],
      type: 'array',
      required: false,
      items: { name: 'tag', type: 'string', required: true },
    },
  ]);
  const submittedBody = { shipment: {} };
  const formBody = {
    shipment: {
      ...Object.fromEntries(
        scalarFields.map((_, index) => [`optional${index}`, index % 2 ? `user${index}@example.invalid` : `value-${index}`]),
      ),
      details: { code: 'code' },
      tags: [],
    },
  };

  const first = planOptionalFormExercises(formly, schema, submittedBody, formBody, { budget: 6 });
  const second = planOptionalFormExercises(formly, schema, submittedBody, formBody, { budget: 6 });

  assert.deepEqual(first, second);
  assert.equal(first.actions.length, 6);
  assert.equal(first.truncated, true);
  assert.deepEqual(new Set(first.actions.map(action => action.kind)), new Set(['array', 'input:email', 'input:text', 'object']));
  assert.ok(first.actions.some(action => action.schemaPath.at(-1) === 'optional0'));
  assert.ok(first.actions.some(action => Number(action.schemaPath.at(-1).replace('optional', '')) >= 5));
});

test('matches duplicate labels once and leaves a real optional miss below the threshold', () => {
  const schemaFields = Array.from({ length: 6 }, (_, index) => ({
    name: `field${index}`,
    path: [`field${index}`],
    type: 'string',
    required: false,
  }));
  const formlyFields = schemaFields.map(field => ({
    key: field.name,
    type: 'input',
    props: { label: 'Repeated label', type: 'text' },
  }));
  const submittedBody = { field0: 'covered' };
  const formBody = Object.fromEntries(schemaFields.map((field, index) => [field.name, `value-${index}`]));
  const plan = planOptionalFormExercises(formlyFields, schemaFields, submittedBody, formBody, { budget: 1 });
  const matched = matchOptionalFormExerciseControls(
    plan.actions,
    schemaFields.map(field => ({
      tagName: 'input',
      type: 'text',
      name: field.name,
      accessibleName: 'Repeated label',
      visible: true,
      disabled: false,
    })),
  );
  const exercisedBody = mergeOptionalFormExerciseValues(submittedBody, formBody, schemaFields, matched);
  const operation = { id: 'update-resource', method: 'PUT', requestBodyFields: schemaFields };
  const report = buildOperationSchemaCoverage([operation], [{ operation, status: 204, requestBody: exercisedBody }]);
  const gate = evaluateOperationSchemaCoverage(report, { optionalMinimum: 0.6 });

  assert.equal(matched[0].controlIndex, 1);
  assert.equal(report.facets.optional.covered, 2);
  assert.equal(gate.passed, false);
  assert.equal(gate.optionalCoverageRatio, 1 / 3);
  assert.equal(gate.failures.at(-1).reasonCode, 'optional-field-coverage-below-threshold');
});

test('matches an expanded control in the unfiltered ordinal space without crediting a hidden or unmatched peer', () => {
  const schemaFields = [
    { name: 'first', path: ['first'], type: 'string', required: false },
    { name: 'second', path: ['second'], type: 'string', required: false },
  ];
  const formlyFields = schemaFields.map(field => ({
    key: field.name,
    type: 'input',
    props: { label: 'Repeated label', type: 'text' },
  }));
  const formBody = { first: 'first-value', second: 'second-value' };
  const controls = [
    {
      tagName: 'input',
      type: 'text',
      name: 'first',
      accessibleName: 'Repeated label',
      visible: false,
      disabled: false,
    },
    {
      tagName: 'input',
      type: 'text',
      name: 'second',
      accessibleName: 'Repeated label',
      visible: true,
      disabled: false,
    },
  ];

  const secondPlan = planOptionalFormExercises(formlyFields, schemaFields, { first: 'already-covered' }, formBody, { budget: 1 });
  const secondMatch = matchOptionalFormExerciseControls(secondPlan.actions, controls);
  assert.equal(secondMatch[0].controlIdentity.ordinal, 1);
  assert.equal(secondMatch[0].controlIndex, 1);

  const firstPlan = planOptionalFormExercises(formlyFields, schemaFields, { second: 'already-covered' }, formBody, { budget: 1 });
  const hiddenMatch = matchOptionalFormExerciseControls(firstPlan.actions, controls);
  assert.equal(hiddenMatch[0].controlIdentity.ordinal, 0);
  assert.equal(hiddenMatch[0].controlIndex, undefined);
  const hiddenBody = mergeOptionalFormExerciseValues(
    { second: 'already-covered' },
    formBody,
    schemaFields,
    hiddenMatch.filter(action => action.controlIndex !== undefined),
  );
  assert.deepEqual(hiddenBody, { second: 'already-covered' });

  const unmatchedMatch = matchOptionalFormExerciseControls(
    [{ ...secondPlan.actions[0], controlIdentity: { ...secondPlan.actions[0].controlIdentity, value: 'missing label' } }],
    controls,
  );
  assert.equal(unmatchedMatch[0].controlIndex, undefined);
});
