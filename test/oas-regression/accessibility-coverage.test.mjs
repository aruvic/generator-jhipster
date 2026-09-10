import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accessibilityIssues,
  expandAllNestedAccordions,
  requiredBodyValidationApplicability,
  requiredFormlyControlIssues,
  requiredFormlyControls,
  requiredValidationResult,
} from './accessibility-coverage.mjs';

test('requires accessible names and exposed required state on visible controls', () => {
  assert.deepEqual(
    accessibilityIssues([
      { identifier: 'name', visible: true, disabled: false, accessibleName: 'Name', required: true, requiredExposed: true },
      { identifier: 'save', visible: true, disabled: false, accessibleName: '', required: false, requiredExposed: false },
      { identifier: 'hidden', visible: false, disabled: false, accessibleName: '', required: true, requiredExposed: false },
    ]),
    [{ control: 'save', reasonCode: 'missing-accessible-name' }],
  );
});

test('expands nested accordions before mapping every required Formly field to a semantic control', async () => {
  const outer = { expanded: false, ancestors: [] };
  const inner = { expanded: false, ancestors: [outer] };
  const accordions = [outer, inner];
  const buttons = {
    count: async () => accordions.length,
    nth: index => ({
      isVisible: async () => accordions[index].ancestors.every(ancestor => ancestor.expanded),
      evaluate: async () => !accordions[index].expanded,
      click: async () => {
        assert.equal(
          accordions[index].ancestors.every(ancestor => ancestor.expanded),
          true,
        );
        accordions[index].expanded = true;
      },
      page: () => ({ waitForTimeout: async () => undefined }),
    }),
  };
  const root = {
    locator: selector => {
      assert.equal(selector, 'button.accordion-button');
      return buttons;
    },
  };
  const fields = [
    {
      key: 'body',
      fieldGroup: [
        {
          key: 'shipment',
          type: 'input',
          wrappers: ['form-crud-accordion'],
          props: { label: 'Shipment', required: true },
          fieldGroup: [
            {
              key: 'reference',
              type: 'input',
              props: { label: 'Booking reference', required: true },
            },
          ],
        },
      ],
    },
  ];
  const requiredControl = {
    identifier: 'booking-reference',
    elementType: 'input',
    name: 'reference',
    visible: false,
    disabled: false,
    accessibleName: 'Booking reference *',
    requiredExposed: true,
  };

  assert.deepEqual(requiredFormlyControls(fields), [
    { identifier: 'body.shipment.reference', key: 'reference', accessibleName: 'Booking reference' },
  ]);
  assert.deepEqual(requiredFormlyControlIssues(fields, [requiredControl]), [
    {
      control: 'body.shipment.reference',
      reasonCode: 'required-control-not-rendered',
      expectedAccessibleName: 'Booking reference',
    },
  ]);

  assert.deepEqual(await expandAllNestedAccordions(root, { settleMs: 0 }), { observed: 2, expanded: 2 });
  requiredControl.visible = outer.expanded && inner.expanded;
  assert.deepEqual(requiredFormlyControlIssues(fields, [requiredControl]), []);

  requiredControl.requiredExposed = false;
  assert.deepEqual(requiredFormlyControlIssues(fields, [requiredControl]), [
    {
      control: 'body.shipment.reference',
      reasonCode: 'required-state-not-exposed',
      actualControl: 'booking-reference',
    },
  ]);
});

test('excludes required object and repeat containers while retaining their rendered leaf controls', () => {
  const fields = [
    {
      key: 'body',
      type: 'object',
      props: { label: 'Body', required: true },
      fieldGroup: [
        {
          key: 'document',
          type: 'object',
          props: { label: 'Document', required: true },
          fieldGroup: [
            {
              key: 'transports',
              type: 'form-crud-repeat',
              props: { label: 'Transports', required: true },
              fieldArray: {
                fieldGroup: [{ key: 'UNLocationCode', type: 'input', props: { label: 'UN location code', required: true } }],
              },
              fieldGroup: [
                {
                  key: '0',
                  type: 'object',
                  props: { label: 'Transport', required: true },
                  fieldGroup: [{ key: 'UNLocationCode', type: 'input', props: { label: 'UN location code', required: true } }],
                },
              ],
            },
            {
              key: 'invoicePayableAt',
              type: 'object',
              props: { label: 'Invoice payable at', required: true },
              fieldGroup: [{ key: 'UNLocationCode', type: 'select', props: { label: 'Invoice location code', required: true } }],
            },
            { key: 'metadata', type: 'object', props: { label: 'Metadata', required: true } },
          ],
        },
      ],
    },
  ];

  assert.deepEqual(requiredFormlyControls(fields), [
    { identifier: 'body.document.transports.0.UNLocationCode', key: 'UNLocationCode', accessibleName: 'UN location code' },
    {
      identifier: 'body.document.invoicePayableAt.UNLocationCode',
      key: 'UNLocationCode',
      accessibleName: 'Invoice location code',
    },
  ]);
});

test('matches duplicate labels to required controls without hiding missing required semantics', () => {
  const fields = [
    {
      key: 'first',
      fieldGroup: [{ key: 'code', type: 'input', props: { label: 'Location code', required: true } }],
    },
    {
      key: 'second',
      fieldGroup: [{ key: 'code', type: 'input', props: { label: 'Location code', required: true } }],
    },
  ];
  const optionalControl = {
    identifier: 'optional-location-code',
    elementType: 'input',
    name: 'code',
    visible: true,
    disabled: false,
    accessibleName: 'Location code',
    requiredExposed: false,
  };
  const requiredControl = {
    identifier: 'required-location-code',
    elementType: 'input',
    name: 'code',
    visible: true,
    disabled: false,
    accessibleName: 'Location code *',
    requiredExposed: true,
  };

  assert.deepEqual(requiredFormlyControlIssues(fields.slice(0, 1), [optionalControl, requiredControl]), []);
  assert.deepEqual(requiredFormlyControlIssues(fields, [optionalControl, requiredControl]), [
    {
      control: 'second.code',
      reasonCode: 'required-state-not-exposed',
      actualControl: 'optional-location-code',
    },
  ]);
});

test('requires browser validation and submit blocking for an emptied required field', () => {
  assert.equal(requiredValidationResult(undefined).applicable, false);
  assert.equal(requiredValidationResult({ browserInvalid: true, submitDisabled: true }).passed, true);
  assert.equal(requiredValidationResult({ browserInvalid: false, submitDisabled: true }).passed, false);
});

test('does not apply mutable-body validation to required GET query parameters with defaults', () => {
  assert.deepEqual(
    requiredBodyValidationApplicability({
      method: 'GET',
      parameters: [
        { name: 'placeOfReceipt', location: 'query', required: true, defaultValue: 'NLAMS' },
        { name: 'placeOfDelivery', location: 'query', required: true, example: 'NLRTM' },
      ],
      requestBodyRequired: false,
      requestBodyFields: [],
    }),
    { applicable: false, reasonCode: 'non-mutation-method' },
  );
});

test('applies validation to required writable scalar fields in mutation request bodies', () => {
  assert.deepEqual(
    requiredBodyValidationApplicability({
      method: 'POST',
      requestBodyRequired: true,
      requestBodyFields: [
        {
          name: 'booking',
          type: 'object',
          required: true,
          fields: [
            { name: 'reference', type: 'string', required: true },
            { name: 'createdAt', type: 'string', required: true, readOnly: true },
          ],
        },
      ],
    }),
    { applicable: true },
  );
  assert.equal(
    requiredBodyValidationApplicability({
      method: 'PATCH',
      requestBodyRequired: true,
      requestBodyFields: [{ name: 'name', type: 'string', required: false }],
    }).applicable,
    false,
  );
});
