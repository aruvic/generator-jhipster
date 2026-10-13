import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { identityRecordsForResolution } from './form-crud-gui-identity.mjs';
import {
  classifyPersistenceReadOutcome,
  persistenceReadIdentity,
  persistenceReadPathResolution,
  persistenceReadTarget,
  semanticIdentityResolution,
} from './form-crud-persistence.mjs';
import { isConfirmedResourceStateRecord } from './operation-payload.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const guiScript = path.join(scriptDir, 'form-crud-gui-smoke.mjs');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'form-crud-gui-smoke-lifecycle-test-'));

after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

function createPlaywrightRoot(root) {
  const packageDir = path.join(root, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"@playwright/test","main":"index.cjs"}\n');
  fs.writeFileSync(
    path.join(packageDir, 'index.cjs'),
    `const fs = require('node:fs');

module.exports = {
  chromium: {
    launch: async () => {
      let rejectNavigation;
      const keepAlive = setInterval(() => {}, 1000);
      return {
        newPage: async () => ({
          coverage: {
            startJSCoverage: async () => {},
            stopJSCoverage: async () => {
              fs.appendFileSync(process.env.FAKE_PLAYWRIGHT_MARKER, 'coverage-stop\\n');
              return [];
            },
          },
          setDefaultTimeout: () => {},
          on: () => {},
          goto: () =>
            new Promise((resolve, reject) => {
              rejectNavigation = reject;
              fs.appendFileSync(process.env.FAKE_PLAYWRIGHT_MARKER, 'navigation-started\\n');
            }),
        }),
        close: async () => {
          fs.appendFileSync(process.env.FAKE_PLAYWRIGHT_MARKER, 'browser-close\\n');
          rejectNavigation?.(new Error('page.goto: Target page, context or browser has been closed'));
          clearInterval(keepAlive);
          await new Promise(resolve => setTimeout(resolve, 50));
        },
      };
    },
  },
};
`,
  );
}

async function waitForMarker(marker, text) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').includes(text)) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${text}`);
}

function pathParameter(name) {
  return { name, location: 'path', required: true };
}

test('scopes merged form and API identity aliases to the selected API provenance', () => {
  const cases = [
    {
      operation: {
        method: 'GET',
        path: '/bookings/{bookingReference}',
        parameters: [pathParameter('bookingReference')],
        tag: 'Booking',
      },
      parameter: pathParameter('bookingReference'),
      responseBody: { carrierBookingRequestReference: 'created-booking' },
    },
    {
      operation: {
        method: 'GET',
        path: '/shipping-instructions/{documentReference}',
        parameters: [pathParameter('documentReference')],
        tag: 'Shipping Instructions',
      },
      parameter: pathParameter('documentReference'),
      responseBody: { shippingInstructionsReference: 'created-instructions' },
    },
  ];

  for (const { operation, parameter, responseBody } of cases) {
    const formRecord = { source: 'form-crud', status: 202, operation: { method: 'POST' }, responseBody };
    const formReplacement = {
      source: 'form-crud',
      status: 200,
      operation: { method: 'PUT', path: operation.path.replace(/\/\{[^/]+\}$/, '') },
      requestBody: [responseBody],
    };
    const apiRecord = { source: 'api-operations', status: 202, operation: { method: 'POST' }, responseBody };
    const candidates = identityRecordsForResolution(operation, [formReplacement, apiRecord, formRecord], {
      selectionRecord: apiRecord,
      allowUnconfirmed: true,
    });
    const resolution = semanticIdentityResolution(operation, parameter, [apiRecord], {
      origins: ['response'],
      candidateRecords: candidates,
    });

    assert.deepEqual(candidates, [apiRecord]);
    assert.equal(resolution.candidateCount, 1);
    assert.equal(resolution.unambiguous, true);
  }
});

test('keeps duplicate identities inside the selected API provenance ambiguous', () => {
  const parameter = pathParameter('bookingReference');
  const operation = {
    method: 'GET',
    path: '/bookings/{bookingReference}',
    parameters: [parameter],
    tag: 'Booking',
  };
  const selectedRecord = {
    source: 'api-operations',
    status: 202,
    operation: { method: 'POST' },
    responseBody: { carrierBookingRequestReference: 'duplicate-booking' },
  };
  const duplicateRecord = structuredClone(selectedRecord);
  const candidates = identityRecordsForResolution(operation, [selectedRecord, duplicateRecord], {
    selectionRecord: selectedRecord,
    allowUnconfirmed: true,
  });
  const resolution = semanticIdentityResolution(operation, parameter, [selectedRecord], {
    origins: ['response'],
    candidateRecords: candidates,
  });

  assert.equal(resolution.candidateCount, 2);
  assert.equal(resolution.unambiguous, false);
});

test('readback-confirms an API 202 beside a form observation and supplies GET/PATCH/PUT identity', () => {
  const parameter = pathParameter('documentReference');
  const itemPath = '/shipping-instructions/{documentReference}';
  const getOperation = {
    id: 'getShippingInstruction',
    method: 'GET',
    path: itemPath,
    parameters: [parameter],
    tag: 'Shipping Instructions',
  };
  const responseBody = {
    shippingInstructionsReference: 'created-instructions',
    shippingInstructionsStatus: 'RECEIVED',
  };
  const formRecord = {
    source: 'form-crud',
    status: 202,
    operation: { method: 'POST', path: '/shipping-instructions' },
    responseBody,
  };
  const apiRecord = {
    source: 'api-operations',
    status: 202,
    operation: { method: 'POST', path: '/shipping-instructions' },
    requestBody: { shippingInstructionsStatus: 'RECEIVED' },
    responseBody,
    writeResponseBodyAvailable: false,
    createdByApiOperations: false,
  };
  const candidates = identityRecordsForResolution(getOperation, [apiRecord, formRecord], {
    selectionRecord: apiRecord,
    allowUnconfirmed: true,
  });
  const resolution = semanticIdentityResolution(getOperation, parameter, [apiRecord], {
    origins: ['response'],
    candidateRecords: candidates,
  });
  const target = persistenceReadTarget(
    { readOperation: getOperation, matchKind: 'created-item' },
    {
      resolvedPath: `/api/shipping-instructions/${resolution.value}`,
      resolutions: [
        {
          parameter: parameter.name,
          value: resolution.value,
          source: 'response-semantic-field',
          semanticIdentityCandidateCount: resolution.candidateCount,
          semanticIdentityUnambiguous: resolution.unambiguous,
        },
      ],
    },
  );
  const readbackIdentity = persistenceReadIdentity(getOperation, target.path, responseBody);
  const outcome = classifyPersistenceReadOutcome(
    200,
    { checked: true, matched: true },
    {
      writeResponseBodyAvailable: apiRecord.writeResponseBodyAvailable,
      readbackIdentityVerified: readbackIdentity.verified,
      readbackPathVerified: target.readbackPathVerified,
    },
  );

  assert.deepEqual(outcome, { classification: 'success' });
  apiRecord.persistenceVerified = true;
  apiRecord.persistedResponseBody = responseBody;
  apiRecord.verifiedPersistenceReadPath = target.path;
  apiRecord.createdByApiOperations = true;
  assert.equal(isConfirmedResourceStateRecord(apiRecord), true);

  for (const method of ['GET', 'PATCH', 'PUT']) {
    const operation = { method, path: itemPath, parameters: [parameter], tag: getOperation.tag };
    const eligibleRecords = identityRecordsForResolution(operation, [apiRecord, formRecord], {
      createdByApiOperations: true,
    });
    assert.deepEqual(persistenceReadPathResolution(operation, parameter, eligibleRecords), {
      value: 'created-instructions',
      source: 'verified-persistence-read-path',
    });
  }
});

test('keeps timeout termination authoritative while closing an active browser navigation', async () => {
  const fixture = path.join(testRoot, 'timeout');
  const playwrightRoot = path.join(fixture, 'playwright');
  const outputDir = path.join(fixture, 'output');
  const marker = path.join(fixture, 'playwright.log');
  fs.mkdirSync(outputDir, { recursive: true });
  createPlaywrightRoot(playwrightRoot);

  const child = spawn(process.execPath, [guiScript, 'tmf620', 'http://localhost:4200', outputDir], {
    cwd: fixture,
    env: {
      ...process.env,
      FAKE_PLAYWRIGHT_MARKER: marker,
      FORM_CRUD_GUI_APP_DIR: fixture,
      FORM_CRUD_GUI_PLAYWRIGHT_ROOT: playwrightRoot,
      FORM_CRUD_GUI_SOURCE_COVERAGE_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });

  await waitForMarker(marker, 'navigation-started');
  assert.equal(child.kill('SIGTERM'), true);
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  assert.equal(signal, null);
  assert.equal(code, 143, stderr);
  const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'form-crud-gui-smoke.json'), 'utf8'));
  assert.equal(report.status, 'interrupted');
  assert.deepEqual(report.error, { message: 'Received SIGTERM' });
  assert.deepEqual(report.sourceCoverage.error, { message: 'Source coverage collection interrupted by SIGTERM' });
  assert.doesNotMatch(JSON.stringify(report), /Target page, context or browser has been closed/);
  const lifecycle = fs.readFileSync(marker, 'utf8').trim().split('\n');
  assert.deepEqual(lifecycle, ['navigation-started', 'browser-close']);
});
