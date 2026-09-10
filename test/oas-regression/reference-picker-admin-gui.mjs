#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { captureResponseBodyForAction } from './playwright-response-capture.mjs';
import { assertMappedReference, assertPersistedReference, valueAtPath } from './reference-picker-mapping.mjs';
import { loadReferencePickerTopology } from './reference-picker-topology.mjs';

const redactionMarker = '[REDACTED]';
const jwtPattern = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const bearerCredentialPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const urlCredentialsPattern = /([a-z][a-z\d+.-]*:\/\/)[^/@\s"]+@/gi;
const urlCredentialParameterPattern =
  /([?&#](?:access[_-]?token|id[_-]?token|refresh[_-]?token|authorization|api[_-]?key|password|secret|credential)=)[^&#\s"]*/gi;

export function redactBrowserDiagnostics(value, sensitiveValues = []) {
  const exactValues = sensitiveValues.filter(sensitiveValue => typeof sensitiveValue === 'string' && sensitiveValue.length > 0);
  const redact = current => {
    if (typeof current === 'string') {
      let redacted = current;
      for (const sensitiveValue of exactValues) {
        redacted = redacted.replaceAll(sensitiveValue, redactionMarker);
      }
      return redacted
        .replace(urlCredentialsPattern, `$1${redactionMarker}@`)
        .replace(urlCredentialParameterPattern, `$1${redactionMarker}`)
        .replace(jwtPattern, redactionMarker)
        .replace(bearerCredentialPattern, `$1${redactionMarker}`);
    }
    if (Array.isArray(current)) return current.map(redact);
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).map(([key, nestedValue]) => [key, redact(nestedValue)]));
    }
    return current;
  };
  return redact(value);
}

if (process.argv[2] === '--redact-diagnostics') {
  const diagnostics = JSON.parse(fs.readFileSync(process.stdin.fd, 'utf8'));
  process.stdout.write(`${JSON.stringify(redactBrowserDiagnostics(diagnostics))}\n`);
  process.exit(0);
}

function loadPlaywright() {
  const configuredRoots = [process.env.FORM_CRUD_GUI_PLAYWRIGHT_ROOT, process.env.PLAYWRIGHT_ROOT].filter(Boolean);
  const candidates = configuredRoots.length > 0 ? configuredRoots : [process.cwd(), '/tmp/playwright-tests'];
  const errors = [];

  for (const candidate of candidates) {
    try {
      const requireFromCandidate = createRequire(path.join(candidate, 'package.json'));
      try {
        return requireFromCandidate('playwright');
      } catch {
        return requireFromCandidate('@playwright/test');
      }
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(['Playwright is required for the reference-picker integration.', ...errors].join('\n'));
}

if (process.argv[2] === '--check-dependencies') {
  loadPlaywright();
  process.exit(0);
}

const [topologyFile, outputDir] = process.argv.slice(2);
if (!topologyFile || !outputDir) {
  process.stderr.write('Usage: reference-picker-admin-gui.mjs <topology.json> <output-dir>\n');
  process.exit(2);
}

const topology = loadReferencePickerTopology(topologyFile);
const sourceSeedResponseFile = process.env.REFERENCE_PICKER_SOURCE_SEED_RESPONSE;
const targetSeedResponseFile = process.env.REFERENCE_PICKER_TARGET_SEED_RESPONSE;
const targetTokenFile = process.env.REFERENCE_PICKER_TARGET_TOKEN_FILE;
for (const [label, filename] of [
  ['REFERENCE_PICKER_SOURCE_SEED_RESPONSE', sourceSeedResponseFile],
  ['REFERENCE_PICKER_TARGET_SEED_RESPONSE', targetSeedResponseFile],
  ['REFERENCE_PICKER_TARGET_TOKEN_FILE', targetTokenFile],
]) {
  if (!filename || !fs.existsSync(filename)) {
    throw new Error(`${label} must name an existing file`);
  }
}

fs.mkdirSync(outputDir, { recursive: true });

const timeoutMs = Number.parseInt(process.env.FORM_CRUD_GUI_TIMEOUT_MS ?? '30000', 10);
const headless = process.env.FORM_CRUD_GUI_HEADLESS !== 'false';
const sourceSeedResponse = JSON.parse(fs.readFileSync(sourceSeedResponseFile, 'utf8'));
const targetSeedResponse = JSON.parse(fs.readFileSync(targetSeedResponseFile, 'utf8'));
const targetToken = fs.readFileSync(targetTokenFile, 'utf8').trim();
const sensitiveValues = [targetToken];
const sourceIdentity = valueAtPath(sourceSeedResponse, topology.source.identityPath);
const targetIdentity = valueAtPath(targetSeedResponse, topology.target.identityPath);
const sourceItemPath = topology.verification.sourceItemPathTemplate.replace('{id}', encodeURIComponent(String(sourceIdentity)));

function redactDiagnostic(value) {
  return redactBrowserDiagnostics(value, sensitiveValues);
}

const result = {
  status: 'failed',
  source: {
    name: topology.source.name,
    port: topology.source.port,
    baseUrl: topology.source.baseUrl,
    identity: sourceIdentity,
  },
  target: {
    name: topology.target.name,
    port: topology.target.port,
    baseUrl: topology.target.baseUrl,
    identity: targetIdentity,
  },
  configuration: {
    requested: topology.picker,
    saved: undefined,
    reloaded: false,
  },
  field: {
    operationId: topology.picker.formId,
    sourcePath: topology.picker.sourcePath,
    exactFormlyFieldOpened: false,
  },
  targetRequest: undefined,
  selection: undefined,
  sourceRequest: undefined,
  sourceGet: undefined,
  pageErrors: [],
  consoleErrors: [],
  failedResponses: [],
  error: '',
};

let browser;
let authenticated = false;

function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function sameRequest(request, method, baseUrl, pathValue) {
  if (request.method() !== method) return false;
  const actual = new URL(request.url());
  const expected = new URL(pathValue, baseUrl);
  return actual.origin === expected.origin && actual.pathname === expected.pathname;
}

function expectedStatus(status, statuses, label) {
  if (!statuses.includes(status)) {
    throw new Error(`${label} returned unexpected HTTP ${status}; expected ${statuses.join(', ')}`);
  }
}

function pickerSemanticFields(value) {
  return {
    label: value.label,
    formId: value.formId,
    targetApiId: value.targetApiId,
    sourcePath: value.sourcePath,
    targetBaseUrl: String(value.targetBaseUrl ?? '').replace(/\/+$/, ''),
    collectionPath: value.collectionPath,
    displayFields: value.displayFields,
    copyFields: value.copyFields,
    mode: value.mode,
    multiple: value.multiple,
  };
}

function assertPickerConfiguration(actual, phase) {
  const expected = pickerSemanticFields(topology.picker);
  const candidate = pickerSemanticFields(actual ?? {});
  if (JSON.stringify(candidate) !== JSON.stringify(expected)) {
    throw new Error(
      `Reference-picker configuration ${phase} did not preserve the requested topology: expected ${JSON.stringify(expected)}, got ${JSON.stringify(candidate)}`,
    );
  }
}

async function pickerConfigurationFromPanel(panel) {
  const [label, formId, targetApiId, sourcePath, targetBaseUrl, collectionPath, displayFields, copyFields, mode, multiple] =
    await Promise.all([
      panel.locator('[data-cy="formCrudReferencePickerLabel"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerFormId"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerTargetApiId"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerSourcePath"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerBaseUrl"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerCollectionPath"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerDisplayFields"]').inputValue(),
      panel.locator('[data-cy="formCrudReferencePickerCopyFields"]').inputValue(),
      panel.locator('select[id^="mode-"]').inputValue(),
      panel.locator('input[id^="multiple-"]').isChecked(),
    ]);
  return {
    label,
    formId,
    targetApiId,
    sourcePath,
    targetBaseUrl,
    collectionPath,
    displayFields: displayFields
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    copyFields: copyFields
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const separator = value.indexOf(':');
        return { source: value.slice(0, separator).trim(), target: value.slice(separator + 1).trim() };
      }),
    mode,
    multiple,
  };
}

function configuredMappingValues(source) {
  return Object.fromEntries(topology.picker.copyFields.map(mapping => [mapping.target, valueAtPath(source, mapping.source)]));
}

function writeResult() {
  fs.writeFileSync(path.join(outputDir, 'status.json'), serializeResult());
}

function serializeResult() {
  return `${JSON.stringify(redactDiagnostic(result), null, 2)}\n`;
}

async function authenticatedFetch(page, requestPath, options = {}) {
  return page.evaluate(
    async ({ pathValue, requestOptions }) => {
      const rawToken = sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken');
      let token = rawToken;
      try {
        token = JSON.parse(rawToken);
      } catch {
        // Some generated applications store the token as a plain string.
      }
      const headers = {
        Accept: 'application/json',
        ...(requestOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      const response = await fetch(pathValue, {
        method: requestOptions.method,
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { pathValue: requestPath, requestOptions: options },
  );
}

async function debugState(page) {
  await page.waitForFunction(() => Boolean(window.__formsDebug?.formCrud), undefined, { timeout: timeoutMs });
  return page.evaluate(() => window.__formsDebug.formCrud());
}

async function expandAccordions(root) {
  const buttons = root.locator('button.accordion-button');
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const collapsed = await button.evaluate(
        element => element.getAttribute('aria-expanded') === 'false' || element.classList.contains('collapsed'),
      );
      if (!collapsed) continue;
      await button.click();
      changed = true;
    }
    if (!changed) return;
  }
}

async function exactReferencePickerField(page) {
  return page.evaluate(sourcePath => {
    const state = window.__formsDebug.formCrud();
    const normalize = value =>
      String(value ?? '')
        .replace(/\[['"]?([^'"\]]+)['"]?\]/g, '.$1')
        .replace(/\[(\d+)]/g, '.$1')
        .replace(/^[$.]+/, '')
        .replace(/^\.+|\.+$/g, '');
    const matches = [];
    const visit = (fields, prefix = '') => {
      for (const field of fields ?? []) {
        const key = field?.key === undefined || field?.key === null ? '' : String(field.key);
        const fieldPath =
          key ?
            prefix ? `${prefix}.${key}`
            : key
          : prefix;
        if (field?.props?.referencePicker && normalize(fieldPath) === normalize(sourcePath)) {
          matches.push({
            path: normalize(fieldPath),
            label: field.props.label,
            referencePicker: field.props.referencePicker,
          });
        }
        visit(field?.fieldGroup, fieldPath);
      }
    };
    visit(state.responseDetailFields);
    return matches;
  }, topology.picker.sourcePath);
}

async function configurePicker(page) {
  const cleared = await authenticatedFetch(page, topology.picker.configPath, { method: 'PUT', body: [] });
  expectedStatus(cleared.status, [200], 'Reference-picker configuration reset');

  const loadResponse = page.waitForResponse(
    response => sameRequest(response.request(), 'GET', topology.ui.baseUrl, topology.picker.configPath),
    { timeout: timeoutMs },
  );
  await page.goto(joinUrl(topology.ui.baseUrl, topology.picker.adminPath), { waitUntil: 'domcontentloaded' });
  expectedStatus((await loadResponse).status(), [200], 'Reference-picker administration load');

  const root = page.locator('[data-cy="formCrudReferencePickers"]').first();
  await root.waitFor({ state: 'visible' });
  await root.locator('[data-cy="formCrudRegisteredForms"]').waitFor({ state: 'visible' });
  await root.locator('[data-cy="formCrudRegisteredRestApis"]').waitFor({ state: 'visible' });
  await root.locator('[data-cy="formCrudReferencePickersAdd"]').click();
  const panel = root.locator('[data-cy="formCrudReferencePickerConfig"]').last();
  await panel.waitFor({ state: 'visible' });

  const formSelect = panel.locator('[data-cy="formCrudReferencePickerFormId"]');
  const targetSelect = panel.locator('[data-cy="formCrudReferencePickerTargetApiId"]');
  const registeredForms = await formSelect.locator('option').evaluateAll(options => options.map(option => option.value));
  const registeredTargets = await targetSelect.locator('option').evaluateAll(options => options.map(option => option.value));
  if (!registeredForms.includes(topology.picker.formId)) {
    throw new Error(`Configured source form ${topology.picker.formId} is not registered`);
  }
  if (topology.picker.targetApiId && !registeredTargets.includes(topology.picker.targetApiId)) {
    throw new Error(`Configured target API ${topology.picker.targetApiId} is not registered`);
  }

  await panel.locator('[data-cy="formCrudReferencePickerLabel"]').fill(topology.picker.label);
  await formSelect.selectOption(topology.picker.formId);
  await targetSelect.selectOption(topology.picker.targetApiId);
  await panel.locator('[data-cy="formCrudReferencePickerSourcePath"]').fill(topology.picker.sourcePath);
  await panel.locator('[data-cy="formCrudReferencePickerBaseUrl"]').fill(topology.picker.targetBaseUrl);
  await panel.locator('[data-cy="formCrudReferencePickerCollectionPath"]').fill(topology.picker.collectionPath);
  await panel.locator('[data-cy="formCrudReferencePickerDisplayFields"]').fill(topology.picker.displayFields.join(', '));
  await panel
    .locator('[data-cy="formCrudReferencePickerCopyFields"]')
    .fill(topology.picker.copyFields.map(mapping => `${mapping.source}:${mapping.target}`).join(', '));
  await panel.locator('select[id^="mode-"]').selectOption(topology.picker.mode);
  const multipleCheckbox = panel.locator('input[id^="multiple-"]');
  if ((await multipleCheckbox.isChecked()) !== topology.picker.multiple) {
    await multipleCheckbox.click();
  }

  const { response: saveResponse, body: saveResponseBody } = await captureResponseBodyForAction(
    page,
    response => sameRequest(response.request(), 'PUT', topology.ui.baseUrl, topology.picker.configPath),
    () => root.locator('[data-cy="formCrudReferencePickersSave"]').click(),
    { timeout: timeoutMs, label: 'reference-picker administration save' },
  );
  expectedStatus(saveResponse.status(), [200], 'Reference-picker administration save');
  const requestBody = JSON.parse(saveResponse.request().postData() ?? '[]');
  const requested = requestBody.find(candidate => candidate.sourcePath === topology.picker.sourcePath);
  assertPickerConfiguration(requested, 'request');
  const responseBody = JSON.parse(saveResponseBody.toString('utf8'));
  const saved = responseBody.find(candidate => candidate.sourcePath === topology.picker.sourcePath);
  assertPickerConfiguration(saved, 'response');
  result.configuration.saved = saved;
  await root.locator('[data-cy="formCrudReferencePickersSuccess"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, 'reference-picker-admin-saved.png'), fullPage: true });

  const reloadResponsePromise = page.waitForResponse(
    response => sameRequest(response.request(), 'GET', topology.ui.baseUrl, topology.picker.configPath),
    { timeout: timeoutMs },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadResponse = await reloadResponsePromise;
  expectedStatus(reloadResponse.status(), [200], 'Reference-picker administration reload');
  const reloadedPanel = root.locator('[data-cy="formCrudReferencePickerConfig"]').first();
  await reloadedPanel.waitFor({ state: 'visible' });
  assertPickerConfiguration(await pickerConfigurationFromPanel(reloadedPanel), 'rendered reload');
  const persisted = await authenticatedFetch(page, topology.picker.configPath, { method: 'GET' });
  expectedStatus(persisted.status, [200], 'Reference-picker persisted configuration GET');
  const reloaded = persisted.body.find(candidate => candidate.sourcePath === topology.picker.sourcePath);
  assertPickerConfiguration(reloaded, 'persisted reload');
  result.configuration.reloaded = true;
  await page.screenshot({ path: path.join(outputDir, 'reference-picker-admin-reloaded.png'), fullPage: true });
}

try {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(timeoutMs);

  page.on('pageerror', error => {
    result.pageErrors.push(redactDiagnostic({ message: error.message, stack: error.stack }));
  });
  page.on('console', message => {
    if (authenticated && message.type() === 'error') {
      result.consoleErrors.push(redactDiagnostic({ text: message.text() }));
    }
  });
  page.on('response', response => {
    if (authenticated && response.status() >= 400) {
      result.failedResponses.push(
        redactDiagnostic({
          method: response.request().method(),
          status: response.status(),
          url: response.url(),
        }),
      );
    }
  });

  await page.route(`${topology.picker.targetBaseUrl}/**`, async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${targetToken}`,
      },
    });
  });

  await page.goto(joinUrl(topology.ui.baseUrl, topology.authentication.loginPath), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="username"], input[name="username"]').first().fill(topology.authentication.username);
  await page.locator('[data-cy="password"], input[name="password"]').first().fill(topology.authentication.password);
  await page.locator('[data-cy="submit"], button[type="submit"]').first().click();
  await page.waitForFunction(
    () => Boolean(sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken')),
    undefined,
    { timeout: timeoutMs },
  );
  authenticated = true;

  await configurePicker(page);

  const listRoute = topology.picker.formPathTemplate.replace('{operationId}', encodeURIComponent(topology.picker.sourceListOperationId));
  await page.goto(joinUrl(topology.ui.baseUrl, listRoute), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible' });
  const listResponsePromise = page.waitForResponse(
    response => sameRequest(response.request(), 'GET', topology.ui.baseUrl, topology.verification.sourceListPath),
    { timeout: timeoutMs },
  );
  await page.locator('[data-cy="formCrudSubmit"]').first().click();
  expectedStatus((await listResponsePromise).status(), [200], 'Source list request');

  const rows = page.locator('[data-cy="formCrudTableRow"]');
  await rows.first().waitFor({ state: 'visible' });
  const rowCount = await rows.count();
  if (rowCount !== 1) {
    throw new Error(`Expected exactly one seeded source row, found ${rowCount}`);
  }
  const detailResponsePromise = page.waitForResponse(
    response => sameRequest(response.request(), 'GET', topology.ui.baseUrl, sourceItemPath),
    { timeout: timeoutMs },
  );
  await rows.first().locator('[data-cy="formCrudDetailsButton"]').click();
  expectedStatus((await detailResponsePromise).status(), topology.verification.sourceGetStatuses, 'Source detail request');
  await page.locator('[data-cy="formCrudDetails"]').waitFor({ state: 'visible' });

  const detailState = await debugState(page);
  if (detailState.operationId !== topology.picker.sourceListOperationId) {
    throw new Error(`Expected source list operation ${topology.picker.sourceListOperationId}, got ${detailState.operationId}`);
  }
  const exactFields = await exactReferencePickerField(page);
  if (exactFields.length !== 1) {
    throw new Error(
      `Expected one configured Formly picker at ${topology.picker.sourcePath}, found ${exactFields.length}: ${JSON.stringify(exactFields)}`,
    );
  }
  result.field.exactFormlyFieldOpened = true;

  const details = page.locator('[data-cy="formCrudDetails"]');
  await expandAccordions(details);
  const pickerButtons = details.locator('[data-cy="formCrudReferencePickerButton"]');
  if ((await pickerButtons.count()) !== 1) {
    throw new Error(`Expected exactly one picker button for the configured field, found ${await pickerButtons.count()}`);
  }
  const [targetResponse] = await Promise.all([
    page.waitForResponse(
      response => sameRequest(response.request(), 'GET', topology.picker.targetBaseUrl, topology.verification.targetListPath),
      { timeout: timeoutMs },
    ),
    pickerButtons.first().click(),
  ]);
  expectedStatus(targetResponse.status(), [200], 'Cross-service target collection request');
  if (new URL(targetResponse.url()).origin === new URL(topology.source.baseUrl).origin) {
    throw new Error('Reference picker target request unexpectedly used the source service origin');
  }
  result.targetRequest = {
    method: targetResponse.request().method(),
    url: targetResponse.url(),
    status: targetResponse.status(),
    crossService: true,
  };

  const modal = page.locator('[data-cy="formCrudReferencePickerModal"]').first();
  await modal.waitFor({ state: 'visible' });
  const pickerRows = modal.locator('[data-cy="formCrudReferencePickerRow"]');
  await pickerRows.first().waitFor({ state: 'visible' });
  const pickerRowCount = await pickerRows.count();
  if (pickerRowCount !== 1) {
    throw new Error(`Expected exactly one live target row, found ${pickerRowCount}`);
  }
  const selectedItem = (await debugState(page)).referencePickerRows[0]?.item;
  if (valueAtPath(selectedItem, topology.target.identityPath) !== targetIdentity) {
    throw new Error('Reference picker row did not come from the seeded target resource');
  }
  await pickerRows.first().locator('[data-cy="formCrudReferencePickerSelect"]').click();
  await modal.waitFor({ state: 'detached' });

  const selectedModel = (await debugState(page)).responseDetailModel;
  const selectedReference = assertMappedReference(
    valueAtPath(selectedModel, topology.picker.sourcePath),
    selectedItem,
    topology.picker,
    'Source model',
  );
  result.selection = {
    targetIdentity,
    mappedValues: configuredMappingValues(selectedItem),
    sourceModelReference: selectedReference,
  };
  await page.screenshot({ path: path.join(outputDir, 'reference-picker-selected.png'), fullPage: true });

  const saveResponsePromise = page.waitForResponse(
    response =>
      sameRequest(
        response.request(),
        topology.verification.sourceSaveMethod,
        topology.ui.baseUrl,
        topology.verification.sourceItemPathTemplate.replace('{id}', encodeURIComponent(String(sourceIdentity))),
      ),
    { timeout: timeoutMs },
  );
  const saveButton = page.locator('[data-cy="formCrudSaveButton"]').first();
  if (!(await saveButton.isEnabled())) {
    throw new Error(
      `Source detail form is invalid after picker selection: ${JSON.stringify((await debugState(page)).responseDetailInvalidControls)}`,
    );
  }
  await saveButton.click();
  const saveResponse = await saveResponsePromise;
  expectedStatus(saveResponse.status(), topology.verification.sourceSaveStatuses, 'Source save request');
  const sourceRequestBody = JSON.parse(saveResponse.request().postData() ?? '{}');
  const requestReference = assertMappedReference(
    valueAtPath(sourceRequestBody, topology.picker.sourcePath),
    selectedItem,
    topology.picker,
    'Source save request',
  );
  result.sourceRequest = {
    method: saveResponse.request().method(),
    url: saveResponse.url(),
    status: saveResponse.status(),
    reference: requestReference,
  };

  const persisted = await authenticatedFetch(page, sourceItemPath, { method: 'GET' });
  expectedStatus(persisted.status, topology.verification.sourceGetStatuses, 'Persisted source GET');
  const persistedValue = valueAtPath(persisted.body, topology.picker.sourcePath);
  result.sourceGet = {
    method: 'GET',
    url: joinUrl(topology.source.baseUrl, sourceItemPath),
    status: persisted.status,
    responseReference: persistedValue,
  };
  const { reference: persistedReference, mappingEvidence } = assertPersistedReference(
    persistedValue,
    requestReference,
    topology.picker,
    {
      identityPath: topology.target.identityPath,
      identity: targetIdentity,
      collectionUrl: targetResponse.url(),
    },
    'Persisted source resource',
  );
  result.sourceGet.stableReference = persistedReference;
  result.sourceGet.mappingEvidence = mappingEvidence;
  const hrefEvidence = mappingEvidence.find(mapping => mapping.contract === 'reference-href');
  const referredTypeEvidence = mappingEvidence.find(mapping => mapping.contract === 'reference-referred-type');
  const relationshipTypeEvidence = mappingEvidence.find(mapping => mapping.contract === 'relationship-type');
  const relationshipRoleEvidence = mappingEvidence.find(mapping => mapping.contract === 'relationship-role');
  const hrefUrl = new URL(String(hrefEvidence.getValue), topology.picker.targetBaseUrl);
  const targetOrigin = new URL(topology.target.baseUrl).origin;
  if (hrefUrl.origin !== targetOrigin) {
    throw new Error(`Persisted reference href used ${hrefUrl.origin} instead of target service origin ${targetOrigin}`);
  }
  result.sourceGet.contractEvidence = {
    targetIdentity: targetIdentity,
    href: hrefEvidence.getValue,
    hrefClassification: hrefEvidence.classification,
    hrefExpected: hrefEvidence.expectedValue,
    hrefOrigin: hrefUrl.origin,
    referredType: referredTypeEvidence.getValue,
    relationshipType: relationshipTypeEvidence.getValue,
    relationshipRole: relationshipRoleEvidence.getValue,
  };

  if (result.pageErrors.length || result.consoleErrors.length || result.failedResponses.length) {
    throw new Error(
      `Browser errors detected: page=${result.pageErrors.length}, console=${result.consoleErrors.length}, HTTP=${result.failedResponses.length}`,
    );
  }

  result.status = 'passed';
} catch (error) {
  result.error = redactDiagnostic(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  writeResult();
}

process.stdout.write(serializeResult());
