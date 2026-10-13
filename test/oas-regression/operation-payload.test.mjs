import assert from 'node:assert/strict';
import test from 'node:test';

import { patchPayloadFromResourceState, selectPayloadFile } from './operation-payload.mjs';

test('prefers an exact operation payload over an earlier overlapping operation name', () => {
  const files = ['005-post-cancelproductordercreateevent.json', '009-post-productordercreateevent.json'];

  assert.equal(
    selectPayloadFile(files, {
      id: 'post-product-order-create-event',
      operationId: 'productOrderCreateEvent',
      method: 'POST',
    }),
    '009-post-productordercreateevent.json',
  );
});

test('retains a bounded fallback for payload names with an added prefix', () => {
  assert.equal(
    selectPayloadFile(['003-post-create-resource.json'], {
      id: 'post-resource',
      operationId: 'createResource',
      method: 'POST',
    }),
    '003-post-create-resource.json',
  );
});

test('retains required resource state while changing an optional PATCH field', () => {
  const operation = {
    method: 'PATCH',
    parameters: [{ name: 'resourceKey', location: 'path' }],
    requestBodyFields: [
      { name: 'resourceKey', path: ['resourceKey'], type: 'string', required: true },
      { name: 'routingKey', path: ['routingKey'], type: 'string', required: true },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
      { name: 'serverVersion', path: ['serverVersion'], type: 'integer', required: false, readOnly: true },
    ],
  };
  const generatedReplacement = {
    resourceKey: 'generated-resource',
    routingKey: 'generated-route',
    displayName: 'updated display name',
  };
  const records = [
    {
      status: 200,
      responseBody: {
        resourceKey: 'created-resource',
        routingKey: 'created-route',
        displayName: 'original display name',
        serverVersion: 3,
      },
    },
  ];

  assert.deepEqual(patchPayloadFromResourceState(operation, generatedReplacement, records), {
    resourceKey: 'created-resource',
    routingKey: 'created-route',
    displayName: 'updated display name',
  });
});

test('retains every compatible desired PATCH mutation', () => {
  const operation = {
    method: 'PATCH',
    requestBodyFields: [
      { name: 'tenantKey', path: ['tenantKey'], type: 'string', required: true },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
      { name: 'enabled', path: ['enabled'], type: 'boolean', required: false },
    ],
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        tenantKey: 'generated-tenant',
        displayName: 'updated display name',
        enabled: true,
      },
      [
        {
          status: 200,
          responseBody: {
            tenantKey: 'created-tenant',
            displayName: 'original display name',
            enabled: false,
          },
        },
      ],
    ),
    {
      tenantKey: 'created-tenant',
      displayName: 'updated display name',
      enabled: true,
    },
  );
});

test('excludes immutable PATCH identities while retaining compatible desired mutations', () => {
  const operation = {
    method: 'PATCH',
    parameters: [{ name: 'widgetKey', location: 'path' }],
    requestBodyFields: [
      { name: 'id', path: ['id'], type: 'integer', required: false },
      { name: 'widgetKey', path: ['widgetKey'], type: 'string', required: false },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
      { name: 'enabled', path: ['enabled'], type: 'boolean', required: false },
    ],
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        id: 999,
        widgetKey: 'generated-widget',
        displayName: 'updated display name',
        enabled: true,
      },
      [
        {
          status: 200,
          responseBody: {
            id: 41,
            widgetKey: 'created-widget',
            displayName: 'original display name',
            enabled: false,
          },
        },
      ],
    ),
    {
      widgetKey: 'created-widget',
      displayName: 'updated display name',
      enabled: true,
    },
  );
});

test('omits incompatible desired PATCH mutations while retaining compatible ones', () => {
  const operation = {
    method: 'PATCH',
    requestBodyFields: [
      {
        name: 'resourceType',
        path: ['resourceType'],
        type: 'string',
        required: false,
        enumValues: ['ConcreteResource', 'AlternativeResource'],
        discriminatorValues: ['ConcreteResource', 'AlternativeResource'],
      },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
      { name: 'enabled', path: ['enabled'], type: 'boolean', required: false },
    ],
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        resourceType: 'AlternativeResource',
        displayName: 'updated display name',
        enabled: true,
      },
      [
        {
          status: 200,
          responseBody: {
            resourceType: 'ConcreteResource',
            displayName: 'original display name',
            enabled: false,
          },
        },
      ],
    ),
    {
      resourceType: 'ConcreteResource',
      displayName: 'updated display name',
      enabled: true,
    },
  );
});

test('keeps a single compatible desired PATCH mutation unchanged', () => {
  const operation = {
    method: 'PATCH',
    requestBodyFields: [
      { name: 'routingKey', path: ['routingKey'], type: 'string', required: true },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
    ],
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        routingKey: 'generated-route',
        displayName: 'updated display name',
      },
      [
        {
          status: 200,
          responseBody: {
            routingKey: 'created-route',
            displayName: 'original display name',
          },
        },
      ],
    ),
    {
      routingKey: 'created-route',
      displayName: 'updated display name',
    },
  );
});

test('omits top-level immutable identifiers from PATCH bodies without discarding nested reference identities', () => {
  const operation = {
    method: 'PATCH',
    parameters: [{ name: 'id', location: 'path' }],
    requestBodyFields: [
      { name: 'pickerId', path: ['pickerId'], type: 'string', required: true },
      { name: 'label', path: ['label'], type: 'string', required: false },
      {
        name: 'target',
        path: ['target'],
        type: 'object',
        required: false,
        fields: [{ name: 'targetId', path: ['target', 'targetId'], type: 'string', required: true }],
      },
    ],
  };
  const verifiedCreate = {
    status: 201,
    persistenceVerified: true,
    verifiedPersistenceReadPath: '/api/configurations/37',
    requestBody: {
      pickerId: 'business-config-key',
      label: 'original label',
      target: { targetId: 'nested-reference' },
    },
    responseBody: {
      id: 37,
      pickerId: 'business-config-key',
      label: 'original label',
      target: { targetId: 'nested-reference' },
    },
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        pickerId: '1004',
        label: 'updated label',
        target: { targetId: 'nested-reference' },
      },
      [verifiedCreate],
    ),
    {
      label: 'updated label',
      target: { targetId: 'nested-reference' },
    },
  );
  assert.equal(verifiedCreate.responseBody.pickerId, 'business-config-key');
  assert.equal(verifiedCreate.verifiedPersistenceReadPath, '/api/configurations/37');
});

test('omits top-level immutable identifiers from PATCH fixtures without prior resource state', () => {
  const operation = {
    method: 'PATCH',
    requestBodyFields: [
      { name: 'configurationID', path: ['configurationID'], type: 'string', required: true },
      { name: 'enabled', path: ['enabled'], type: 'boolean', required: false },
    ],
  };

  assert.deepEqual(patchPayloadFromResourceState(operation, { configurationID: 'fixture-identity', enabled: true }), { enabled: true });
});

test('fills resource fields omitted by a later read from the captured create request', () => {
  const operation = {
    method: 'PATCH',
    requestBodyFields: [
      { name: 'resourceKey', path: ['resourceKey'], type: 'string', required: true },
      { name: 'writeConfiguration', path: ['writeConfiguration'], type: 'string', required: true, writeOnly: true },
      { name: 'enabled', path: ['enabled'], type: 'boolean', required: false },
    ],
  };
  const records = [
    {
      status: 200,
      responseBody: { resourceKey: 'created-resource', enabled: false },
    },
    {
      status: 201,
      requestBody: { resourceKey: 'created-resource', writeConfiguration: 'created-configuration', enabled: false },
      responseBody: { resourceKey: 'created-resource', enabled: false },
    },
  ];

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      { resourceKey: 'generated-resource', writeConfiguration: 'generated-configuration', enabled: false },
      records,
    ),
    {
      resourceKey: 'created-resource',
      writeConfiguration: 'created-configuration',
      enabled: true,
    },
  );
});

test('does not use accepted resource state before persistence is verified', () => {
  const operation = {
    method: 'PUT',
    requestBodyFields: [
      { name: 'resourceKey', path: ['resourceKey'], type: 'string', required: true },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
    ],
  };
  const generatedReplacement = {
    resourceKey: 'generated-resource',
    displayName: 'generated display name',
  };

  assert.deepEqual(
    patchPayloadFromResourceState(operation, generatedReplacement, [
      {
        status: 202,
        responseBody: {
          resourceKey: 'accepted-resource',
          displayName: 'accepted display name',
        },
      },
    ]),
    generatedReplacement,
  );
});

test('builds a PUT from verified resource state without changing its polymorphic type', () => {
  const operation = {
    method: 'PUT',
    parameters: [{ name: 'resourceKey', location: 'path' }],
    requestBodyFields: [
      { name: 'resourceKey', path: ['resourceKey'], type: 'string', required: true },
      {
        name: 'resourceType',
        path: ['resourceType'],
        type: 'string',
        required: false,
        enumValues: ['ConcreteResource', 'AlternativeResource'],
        discriminatorValues: ['ConcreteResource', 'AlternativeResource'],
      },
      { name: 'concreteValue', path: ['concreteValue'], type: 'string', required: false },
      { name: 'alternativeValue', path: ['alternativeValue'], type: 'string', required: false },
      { name: 'displayName', path: ['displayName'], type: 'string', required: false },
    ],
  };

  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      {
        resourceKey: 'fixture-resource',
        resourceType: 'AlternativeResource',
        alternativeValue: 'fixture alternative value',
        displayName: 'updated display name',
      },
      [
        {
          status: 202,
          persistenceVerified: true,
          persistedResponseBody: {
            resourceKey: 'created-resource',
            resourceType: 'ConcreteResource',
            concreteValue: 'created concrete value',
            displayName: 'original display name',
          },
          responseBody: {
            resourceKey: 'accepted-resource',
            resourceType: 'AlternativeResource',
            alternativeValue: 'accepted alternative value',
            displayName: 'accepted display name',
          },
          requestBody: {
            resourceKey: 'fixture-resource',
            resourceType: 'AlternativeResource',
            alternativeValue: 'fixture alternative value',
            displayName: 'fixture display name',
          },
        },
      ],
    ),
    {
      resourceKey: 'created-resource',
      resourceType: 'ConcreteResource',
      concreteValue: 'created concrete value',
      displayName: 'updated display name',
    },
  );
});

test('scopes PATCH projection to the resolved resource identity before using UI fallback state', () => {
  const operation = {
    method: 'PATCH',
    path: '/services/{serviceId}',
    parameters: [{ name: 'serviceId', location: 'path', required: true }],
    requestBodyFields: [
      { name: 'name', path: ['name'], type: 'string', required: false },
      {
        name: 'context',
        path: ['context'],
        type: 'object',
        required: false,
        fields: [
          { name: 'tmfId', path: ['context', 'tmfId'], type: 'string', required: false },
          { name: 'name', path: ['context', 'name'], type: 'string', required: false },
        ],
      },
      {
        name: 'intent',
        path: ['intent'],
        type: 'object',
        required: false,
        fields: [
          { name: 'tmfId', path: ['intent', 'tmfId'], type: 'string', required: false },
          { name: 'name', path: ['intent', 'name'], type: 'string', required: false },
        ],
      },
    ],
  };
  const targetReadback = {
    operation: { method: 'GET', path: '/services/{serviceId}' },
    status: 200,
    responseUrl: 'http://localhost/api/services/1136',
    responseBodySource: 'network',
    responseBody: { id: '1136', name: 'Target service' },
  };
  const olderDetailFallback = {
    operation: { method: 'PATCH', path: '/services/{serviceId}' },
    status: 200,
    responseUrl: 'http://localhost/api/services/1113',
    responseBodySource: 'rendered-ui',
    responseBody: {
      id: '1113',
      name: 'Older service',
      context: '{"tmfId":"context-1113","name":"Older context"}',
      intent: '{"tmfId":"intent-1113","name":"Older intent"}',
    },
  };
  const options = { pathParameterValues: { 'path:serviceId': '1136' } };

  const targetPatch = patchPayloadFromResourceState(
    operation,
    { name: 'Updated target service' },
    [targetReadback, olderDetailFallback],
    options,
  );

  assert.deepEqual(targetPatch, { name: 'Updated target service' });
  assert.equal(JSON.stringify(targetPatch).includes('1113'), false);
  assert.equal(Object.hasOwn(targetPatch, 'context'), false);
  assert.equal(Object.hasOwn(targetPatch, 'intent'), false);

  const sameTargetDetailFallback = {
    ...olderDetailFallback,
    responseUrl: 'http://localhost/api/services/1136',
    responseBody: {
      id: '1136',
      name: 'Target service',
      context: '{"tmfId":"context-1136","name":"Target context"}',
    },
  };
  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      { name: 'Updated target service' },
      [targetReadback, olderDetailFallback, sameTargetDetailFallback],
      options,
    ),
    {
      name: 'Updated target service',
      context: { tmfId: 'context-1136', name: 'Target context' },
    },
  );

  const targetReadbackWithContext = {
    ...targetReadback,
    responseBody: {
      ...targetReadback.responseBody,
      context: { tmfId: 'canonical-context-1136', name: 'Canonical target context' },
    },
  };
  assert.deepEqual(
    patchPayloadFromResourceState(
      operation,
      { name: 'Updated target service' },
      [sameTargetDetailFallback, targetReadbackWithContext],
      options,
    ),
    {
      name: 'Updated target service',
      context: { tmfId: 'canonical-context-1136', name: 'Canonical target context' },
    },
  );
});
