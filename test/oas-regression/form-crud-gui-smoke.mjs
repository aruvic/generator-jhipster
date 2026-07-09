#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function loadPlaywright() {
  const candidates = [
    process.env.FORM_CRUD_GUI_PLAYWRIGHT_ROOT,
    process.env.PLAYWRIGHT_ROOT,
    process.cwd(),
    '/tmp/playwright-tests',
  ].filter(Boolean);
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

  throw new Error(
    [
      'Playwright is required for Form CRUD GUI tests.',
      'Install it locally and point FORM_CRUD_GUI_PLAYWRIGHT_ROOT at that install, for example:',
      'npm install --prefix /tmp/playwright-tests @playwright/test',
      ...errors,
    ].join('\n'),
  );
}

if (process.argv[2] === '--check-dependencies') {
  loadPlaywright();
  process.exit(0);
}

const [artifactName, webBaseUrl, outputDir] = process.argv.slice(2);

if (!artifactName || !webBaseUrl || !outputDir) {
  console.error('Usage: form-crud-gui-smoke.mjs <artifact-name> <web-base-url> <output-dir>');
  process.exit(2);
}

fs.mkdirSync(outputDir, { recursive: true });

function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function compactResponse(response) {
  return {
    status: response.status(),
    url: response.url(),
    method: response.request().method(),
  };
}

function slug(value) {
  return (
    String(value || 'step')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'step'
  );
}

function flattenResources(groups = []) {
  const resources = [];
  for (const group of groups) {
    for (const resource of group.resources ?? []) resources.push({ group: group.label, resource });
    for (const child of group.childGroups ?? []) {
      for (const resource of child.resources ?? []) resources.push({ group: `${group.label} / ${child.label}`, resource });
    }
  }
  return resources;
}

function normalizeName(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

function singularName(value) {
  const normalized = normalizeName(value);
  if (normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith('ys')) return normalized.slice(0, -1);
  if (normalized.endsWith('s') && normalized.length > 1) return normalized.slice(0, -1);
  return normalized;
}

function pathLeaf(value) {
  return (
    String(value ?? '')
      .split('/')
      .filter(Boolean)
      .pop() ?? ''
  );
}

function schemaPath(field) {
  return Array.isArray(field?.path) && field.path.length ? field.path.join('.') : field?.name;
}

function flattenFields(fields = []) {
  const output = [];
  for (const field of fields ?? []) {
    output.push(field);
    if (field?.fields?.length) output.push(...flattenFields(field.fields));
    if (field?.items?.fields?.length) output.push(...flattenFields(field.items.fields));
  }
  return output;
}

function fieldPathSet(fields = []) {
  return new Set(
    flattenFields(fields)
      .map(field => schemaPath(field))
      .filter(Boolean),
  );
}

function targetCopyFieldsForPath(fields = [], sourcePath) {
  const paths = fieldPathSet(fields);
  return ['id', 'tmfId', 'href', 'name']
    .filter(name => paths.has(`${sourcePath}.${name}`) || paths.has(`${sourcePath}.0.${name}`))
    .map(name => ({ source: name, target: name }));
}

function isReferenceCandidateField(field) {
  const target = field?.type === 'array' ? field.items : field;
  const fields = target?.fields ?? [];
  const names = new Set(fields.map(candidate => normalizeName(candidate.name)));
  return ['id', 'tmfid', 'href', 'name'].some(name => names.has(name));
}

function schemaComplexity(fields = []) {
  return flattenFields(fields).length;
}

function referencePickerScenarios(resources) {
  const scenarios = [];
  for (const sourceEntry of resources) {
    const sourceResource = sourceEntry.resource;
    if (!sourceResource?.listOperation || !sourceResource?.updateOperation || !sourceResource?.createOperation) continue;
    const candidateFields = flattenFields(sourceResource.updateOperation.requestBodyFields ?? []).filter(
      field => field.type === 'array' && isReferenceCandidateField(field),
    );

    for (const field of candidateFields) {
      const sourcePath = schemaPath(field);
      if (!sourcePath) continue;
      const sourceLeaf = singularName(sourcePath.split('.').filter(Boolean).pop());
      const targetEntry =
        resources.find(entry => {
          const targetResource = entry.resource;
          if (!targetResource?.listOperation || !targetResource?.createOperation) return false;
          const targetLeaf = singularName(pathLeaf(targetResource.listOperation.path));
          return (
            sourceLeaf && targetLeaf && (sourceLeaf === targetLeaf || sourceLeaf.includes(targetLeaf) || targetLeaf.includes(sourceLeaf))
          );
        }) ?? resources.find(entry => entry.resource?.listOperation && entry.resource?.createOperation);
      if (!targetEntry) continue;
      scenarios.push({ sourceEntry, targetEntry, field, sourcePath });
    }
  }
  return scenarios.sort((left, right) => {
    const leftTargetComplexity = schemaComplexity(left.targetEntry.resource.createOperation?.requestBodyFields);
    const rightTargetComplexity = schemaComplexity(right.targetEntry.resource.createOperation?.requestBodyFields);
    if (leftTargetComplexity !== rightTargetComplexity) return leftTargetComplexity - rightTargetComplexity;
    const leftSourceComplexity = schemaComplexity(left.sourceEntry.resource.createOperation?.requestBodyFields);
    const rightSourceComplexity = schemaComplexity(right.sourceEntry.resource.createOperation?.requestBodyFields);
    return leftSourceComplexity - rightSourceComplexity;
  });
}

function findReferencePickerScenario(resources) {
  return referencePickerScenarios(resources)[0];
}

function operationNames(operation) {
  return [operation?.id, operation?.operationId, `${operation?.method ?? ''}-${operation?.operationId ?? ''}`]
    .filter(Boolean)
    .map(normalizeName);
}

function findPayloadForOperation(operation) {
  const payloadDir = path.resolve(outputDir, '..', 'payloads');
  if (!fs.existsSync(payloadDir)) return undefined;
  const names = operationNames(operation);
  const files = fs.readdirSync(payloadDir).filter(file => file.endsWith('.json'));
  const file = files.find(candidate => {
    const normalized = normalizeName(candidate.replace(/\.json$/i, ''));
    return names.some(name => name && (normalized.includes(name) || name.includes(normalized)));
  });
  if (!file) return undefined;
  return JSON.parse(fs.readFileSync(path.join(payloadDir, file), 'utf8'));
}

function apiPath(operationPath) {
  const pathValue = String(operationPath ?? '');
  if (pathValue.startsWith('/api/')) return pathValue;
  return `/api/${pathValue.replace(/^\/+/, '')}`;
}

function valueAtPath(source, pathValue) {
  return String(pathValue ?? '')
    .split('.')
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === undefined || current === null) return undefined;
      return current[segment];
    }, source);
}

function sharedIdentityFields(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return [];
  return ['id', 'tmfId', 'href', 'name'].filter(
    field => left[field] !== undefined && right[field] !== undefined && left[field] === right[field],
  );
}

function copiedConfiguredFields(candidate, selectedItem, config) {
  if (!candidate || !selectedItem || typeof candidate !== 'object' || typeof selectedItem !== 'object') return [];
  return (config.copyFields ?? [])
    .filter(mapping => typeof mapping?.source === 'string' && typeof mapping?.target === 'string')
    .filter(mapping => {
      const sourceValue = valueAtPath(selectedItem, mapping.source);
      if (sourceValue === undefined || sourceValue === null || typeof sourceValue === 'object') return false;
      return valueAtPath(candidate, mapping.target) === sourceValue;
    })
    .map(mapping => mapping.target);
}

function formlyFieldKey(field) {
  if (field?.key === undefined || field?.key === null) return '';
  return String(field.key);
}

function flattenEditablePrimitiveFields(fields = [], prefix = '') {
  const output = [];
  for (const field of fields ?? []) {
    const key = formlyFieldKey(field);
    const pathValue = key ? (prefix ? `${prefix}.${key}` : key) : prefix;
    if (field?.fieldGroup?.length) {
      output.push(...flattenEditablePrimitiveFields(field.fieldGroup, pathValue));
      continue;
    }
    if (!key || field?.fieldArray || field?.type === 'form-crud-repeat') continue;
    const props = field.props ?? {};
    if (props.disabled) continue;
    if (props.pattern || props.options?.length) continue;
    if (!['input', 'textarea'].includes(String(field.type ?? 'input'))) continue;
    const inputType = String(props.type ?? 'text').toLowerCase();
    if (!['text', 'search', 'email', 'url', 'tel'].includes(inputType)) continue;
    const leaf = key.split('.').filter(Boolean).pop() ?? key;
    if (['id', 'tmfId', '@type', '@baseType', '@schemaLocation', '@referredType'].includes(leaf)) continue;
    output.push({ path: pathValue, leaf, props });
  }
  return output;
}

function existingDetailFieldCandidates(fields = [], model = undefined) {
  return flattenEditablePrimitiveFields(fields).filter(field => {
    if (!field?.path) return false;
    const pathSegments = field.path.split('.').filter(Boolean);
    const numericIndex = pathSegments.findIndex(segment => /^\d+$/.test(segment));
    if (numericIndex >= 0) return false;
    return valueAtPath(model, field.path) !== undefined;
  });
}

function preferredEditablePrimitiveField(fields = [], model = undefined) {
  const candidates = existingDetailFieldCandidates(fields, model);
  const priority = ['name', 'description', 'lifecycleStatus', 'version', 'href'];
  for (const preferred of priority) {
    const candidate = candidates.find(field => normalizeName(field.leaf) === normalizeName(preferred));
    if (candidate) return candidate;
  }
  return candidates[0];
}

function generatedFieldValue(field, stepName) {
  const leaf = normalizeName(field?.leaf);
  const base = leaf === 'href' ? `/api/gui-smoke/${Date.now()}` : `GUI ${slug(stepName)} ${Date.now()}`;
  const maxLength = Number(field?.props?.maxLength);
  if (Number.isFinite(maxLength) && maxLength > 0 && base.length > maxLength) return base.slice(0, maxLength);
  return base;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedConfiguredCopyFields(selectedItem, config) {
  if (!selectedItem || typeof selectedItem !== 'object') return [];
  return (config.copyFields ?? [])
    .filter(mapping => typeof mapping?.source === 'string' && typeof mapping?.target === 'string')
    .filter(mapping => {
      const sourceValue = valueAtPath(selectedItem, mapping.source);
      return sourceValue !== undefined && sourceValue !== null && typeof sourceValue !== 'object';
    })
    .map(mapping => mapping.target);
}

function parseLimit(value) {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'unlimited') return Number.POSITIVE_INFINITY;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.POSITIVE_INFINITY;
}

function limitEntries(entries, limit) {
  return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
}

async function locatorCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function expandAccordions(locator, maxCount = 100) {
  const buttons = locator.locator('button.accordion-button');
  let clicked = 0;
  let observed = 0;
  await buttons
    .first()
    .waitFor({ state: 'attached', timeout: optionalTimeoutMs })
    .catch(() => {});
  for (let pass = 0; pass < 8 && clicked < maxCount; pass += 1) {
    const count = await locatorCount(buttons);
    observed = Math.max(observed, count);
    let changed = false;
    for (let index = 0; index < count && clicked < maxCount; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible().catch(() => false))) continue;
      const collapsed = await button
        .evaluate(element => element.getAttribute('aria-expanded') === 'false' || element.classList.contains('collapsed'))
        .catch(() => false);
      if (!collapsed) continue;
      await button.click();
      clicked += 1;
      changed = true;
      await button.page().waitForTimeout(50);
    }
    if (!changed) break;
  }
  return observed;
}

const username = process.env.FORM_CRUD_GUI_USERNAME ?? 'admin';
const password = process.env.FORM_CRUD_GUI_PASSWORD ?? 'admin';
const timeoutMs = Number(process.env.FORM_CRUD_GUI_TIMEOUT_MS ?? '30000');
const apiTimeoutMs = Number(process.env.FORM_CRUD_GUI_API_TIMEOUT_MS ?? String(Math.min(timeoutMs, 30000)));
const settleTimeoutMs = Number(process.env.FORM_CRUD_GUI_SETTLE_TIMEOUT_MS ?? String(Math.min(timeoutMs, 3000)));
const optionalTimeoutMs = Number(process.env.FORM_CRUD_GUI_OPTIONAL_TIMEOUT_MS ?? String(Math.min(timeoutMs, 5000)));
const headless = (process.env.FORM_CRUD_GUI_HEADLESS ?? 'true') !== 'false';
const failOnConsoleError = (process.env.FORM_CRUD_GUI_FAIL_ON_CONSOLE_ERROR ?? 'true') !== 'false';
const failOnHttp4xx = (process.env.FORM_CRUD_GUI_FAIL_ON_HTTP_4XX ?? 'false') === 'true';
const maxListResources = parseLimit(process.env.FORM_CRUD_GUI_MAX_LIST_RESOURCES ?? 'all');
const maxCreateResources = parseLimit(process.env.FORM_CRUD_GUI_MAX_CREATE_RESOURCES ?? 'all');
const exerciseCreate = (process.env.FORM_CRUD_GUI_EXERCISE_CREATE ?? 'true') !== 'false';
const exerciseUpdate = (process.env.FORM_CRUD_GUI_EXERCISE_UPDATE ?? 'true') !== 'false';
const exerciseDelete = (process.env.FORM_CRUD_GUI_EXERCISE_DELETE ?? 'true') !== 'false';
const failOnInvalidCreateForm = (process.env.FORM_CRUD_GUI_FAIL_ON_INVALID_CREATE_FORM ?? 'true') !== 'false';
const failOnCreateHttpError = (process.env.FORM_CRUD_GUI_FAIL_ON_CREATE_HTTP_ERROR ?? 'true') !== 'false';
const screenshotFullPage = (process.env.FORM_CRUD_GUI_FULL_PAGE_SCREENSHOTS ?? 'true') !== 'false';

const result = {
  artifact: artifactName,
  webBaseUrl,
  startIso: new Date().toISOString(),
  endIso: null,
  durationMs: 0,
  status: 'running',
  console: [],
  pageErrors: [],
  failedResponses: [],
  apiExchanges: [],
  screenshots: [],
  steps: [],
  coverage: {
    discoveredResources: 0,
    plannedCreateResources: 0,
    plannedListResources: 0,
    exercisedCreateResources: 0,
    successfulCreateResources: 0,
    exercisedListResources: 0,
    exercisedDetailResources: 0,
    exercisedUpdateResources: 0,
    successfulUpdateResources: 0,
    exercisedDeleteResources: 0,
    successfulDeleteResources: 0,
    exercisedReferencePickerSaves: 0,
    successfulReferencePickerSaves: 0,
  },
};

const started = Date.now();
let browser;
let screenshotIndex = 0;
let apiExchangeIndex = 0;
let reportWritten = false;

function writeResultReport() {
  if (reportWritten) return;
  result.endIso = new Date().toISOString();
  result.durationMs = Date.now() - started;
  fs.writeFileSync(path.join(outputDir, 'form-crud-gui-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
  reportWritten = true;
}

async function handleTermination(signal) {
  result.status = 'interrupted';
  result.error = { message: `Received ${signal}` };
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    writeResultReport();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }
}

process.once('SIGINT', () => {
  void handleTermination('SIGINT');
});
process.once('SIGTERM', () => {
  void handleTermination('SIGTERM');
});

async function screenshot(page, name) {
  const file = path.join(outputDir, `${String(++screenshotIndex).padStart(2, '0')}-${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage: screenshotFullPage });
  result.screenshots.push(file);
  return file;
}

async function debugState(page) {
  await page.waitForFunction(() => Boolean(window.__formsDebug?.formCrud), undefined, { timeout: apiTimeoutMs });
  return page.evaluate(() => window.__formsDebug.formCrud());
}

async function gotoOperation(page, operationId) {
  await page.goto(joinUrl(webBaseUrl, `/form-crud/${operationId}`), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await debugState(page);
}

async function submitCurrentOperation(page, stepName, expectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const submitButton = page.locator('[data-cy="formCrudSubmit"]').first();
  if ((await locatorCount(submitButton)) === 0 || !(await submitButton.isVisible()) || !(await submitButton.isEnabled())) {
    result.steps.push({ name: stepName, status: 'skipped', reason: 'submit button unavailable or disabled' });
    return false;
  }
  const apiResponsePromise = waitForApiResponse(page, expectedMethods);
  await submitButton.click();
  const apiResponse = await apiResponsePromise;
  await recordApiExchange(stepName, apiResponse);
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, stepName);
  result.steps.push({ name: stepName, status: 'submitted', apiExchange: apiResponse ? compactResponse(apiResponse) : undefined });
  return true;
}

function waitForApiResponse(page, expectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const methods = new Set(expectedMethods.map(method => method.toUpperCase()));
  return page
    .waitForResponse(response => methods.has(response.request().method()) && response.url().includes('/api/'), { timeout: apiTimeoutMs })
    .catch(() => undefined);
}

async function recordApiExchange(stepName, response) {
  if (!response) return undefined;
  const request = response.request();
  const fileBase = `${String(++apiExchangeIndex).padStart(2, '0')}-${slug(stepName)}`;
  const requestFile = path.join(outputDir, `${fileBase}-request.txt`);
  const responseFile = path.join(outputDir, `${fileBase}-response.txt`);
  const exchange = {
    step: stepName,
    method: request.method(),
    url: response.url(),
    status: response.status(),
    requestFile: path.basename(requestFile),
    responseFile: path.basename(responseFile),
  };
  fs.writeFileSync(requestFile, request.postData() ?? '', 'utf8');
  try {
    fs.writeFileSync(responseFile, await response.text(), 'utf8');
  } catch (error) {
    fs.writeFileSync(responseFile, `Failed to read response body: ${error.message}`, 'utf8');
  }
  result.apiExchanges.push(exchange);
  return exchange;
}

async function saveVisibleDetail(page, stepName, required = false, expectedMutation = undefined) {
  if (!exerciseUpdate) {
    result.steps.push({ name: stepName, status: 'skipped', reason: 'detail update exercise disabled' });
    return false;
  }
  const saveButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudSaveButton"]').first();
  if ((await locatorCount(saveButton)) === 0 || !(await saveButton.isVisible())) {
    result.steps.push({ name: stepName, status: required ? 'failed' : 'skipped', reason: 'detail save button unavailable' });
    if (required) throw new Error(`Detail save button is unavailable for ${stepName}`);
    return false;
  }
  const state = await debugState(page);
  if (state.responseDetailValid === false) {
    result.steps.push({
      name: stepName,
      status: required ? 'failed' : 'skipped',
      reason: 'detail form is invalid',
      invalidControls: state.responseDetailInvalidControls,
    });
    if (required) throw new Error(`Detail form is invalid for ${stepName}`);
    return false;
  }
  result.coverage.exercisedUpdateResources += 1;
  const updateResponse = page
    .waitForResponse(response => ['PATCH', 'PUT'].includes(response.request().method()) && response.url().includes('/api/'), {
      timeout: apiTimeoutMs,
    })
    .catch(() => undefined);
  await saveButton.click();
  const response = await updateResponse;
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, stepName);
  const statusText = await page
    .locator('[data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const status = response?.status() ?? (statusMatch ? Number(statusMatch[1]) : undefined);
  const ok = status !== undefined && status >= 200 && status < 300;
  if (response) await recordApiExchange(stepName, response);
  result.steps.push({
    name: stepName,
    status: ok ? 'ok' : 'failed',
    httpStatus: status,
    text: statusText?.trim() ?? '',
  });
  if (!ok) throw new Error(`Detail save ${stepName} did not return HTTP 2xx: ${statusText?.trim() || status || 'no status shown'}`);
  result.coverage.successfulUpdateResources += 1;
  const after = await debugState(page);
  if (!after.responseDetailModel || typeof after.responseDetailModel !== 'object') {
    throw new Error(`Detail save ${stepName} did not repopulate the detail form model`);
  }
  if (expectedMutation) {
    const savedValue = valueAtPath(after.responseDetailModel, expectedMutation.path);
    if (!jsonEqual(savedValue, expectedMutation.value)) {
      result.steps.push({
        name: `${stepName}-mutation-retained`,
        status: 'failed',
        path: expectedMutation.path,
        expected: expectedMutation.value,
        actual: savedValue,
      });
      throw new Error(`Detail save ${stepName} did not retain changed value at ${expectedMutation.path}`);
    }
    result.steps.push({
      name: `${stepName}-mutation-retained`,
      status: 'ok',
      path: expectedMutation.path,
      value: savedValue,
    });
  }
  return true;
}

async function setResponseDetailValue(page, pathValue, value) {
  return page.evaluate(
    ({ path, nextValue }) => {
      const setter = window.__formsDebug?.setFormCrudResponseDetailValue;
      return typeof setter === 'function' ? setter(path, nextValue) : false;
    },
    { path: pathValue, nextValue: value },
  );
}

async function mutateEditablePrimitiveDetailField(page, stepName) {
  const state = await debugState(page);
  const field = preferredEditablePrimitiveField(state.responseDetailFields ?? [], state.responseDetailModel);
  if (!field) {
    result.steps.push({ name: `${stepName}-mutation`, status: 'skipped', reason: 'no safe writable primitive detail field' });
    return undefined;
  }
  const value = generatedFieldValue(field, stepName);
  const changed = await setResponseDetailValue(page, field.path, value);
  const after = await debugState(page);
  if (!changed || after.responseDetailValid === false) {
    result.steps.push({
      name: `${stepName}-mutation`,
      status: 'skipped',
      reason: changed ? 'mutation made detail form invalid' : 'debug setter unavailable',
      path: field.path,
      invalidControls: after.responseDetailInvalidControls,
    });
    return undefined;
  }
  result.steps.push({ name: `${stepName}-mutation`, status: 'ok', path: field.path, value });
  return { path: field.path, value };
}

async function clearResponseDetailArrayPath(page, pathValue, stepName) {
  const before = await debugState(page);
  const currentValue = valueAtPath(before.responseDetailModel, pathValue);
  if (!Array.isArray(currentValue) || currentValue.length === 0) {
    result.steps.push({ name: `${stepName}-clear-array`, status: 'skipped', path: pathValue, reason: 'array is already empty or unavailable' });
    return undefined;
  }
  const changed = await setResponseDetailValue(page, pathValue, []);
  const after = await debugState(page);
  if (!changed || after.responseDetailValid === false) {
    result.steps.push({
      name: `${stepName}-clear-array`,
      status: 'skipped',
      path: pathValue,
      reason: changed ? 'clearing array made detail form invalid' : 'debug setter unavailable',
      invalidControls: after.responseDetailInvalidControls,
    });
    return undefined;
  }
  result.steps.push({ name: `${stepName}-clear-array`, status: 'ok', path: pathValue, beforeCount: currentValue.length });
  return { path: pathValue, value: [] };
}

async function apiRequest(page, operation, body) {
  return page.evaluate(
    async ({ method, pathValue, requestBody }) => {
      const rawToken = sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken') ?? '';
      let token = rawToken;
      try {
        token = JSON.parse(rawToken);
      } catch {
        // Stored as a plain string in some generated applications.
      }
      const headers = { Accept: 'application/json' };
      if (requestBody !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(pathValue, {
        method,
        headers,
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { method: operation.method, pathValue: apiPath(operation.path), requestBody: body },
  );
}

async function authenticatedFetch(page, pathValue, options = {}) {
  return page.evaluate(
    async ({ requestPath, requestOptions }) => {
      const rawToken = sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken') ?? '';
      let token = rawToken;
      try {
        token = JSON.parse(rawToken);
      } catch {
        // Stored as a plain string in some generated applications.
      }
      const headers = {
        Accept: 'application/json',
        ...(requestOptions.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(requestOptions.headers ?? {}),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(requestPath, {
        ...requestOptions,
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { requestPath: pathValue, requestOptions: options },
  );
}

async function configureReferencePickerViaAdmin(page, config) {
  const resourcePath = '/api/form-crud-reference-pickers';
  const clearResponse = await authenticatedFetch(page, resourcePath, { method: 'PUT', body: [] });
  if (clearResponse.status < 200 || clearResponse.status >= 300) {
    throw new Error(`Unable to clear reference picker configuration before GUI setup: HTTP ${clearResponse.status}`);
  }

  await page.goto(joinUrl(webBaseUrl, '/admin/form-crud-reference-pickers'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrudReferencePickers"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-empty');

  await page.locator('[data-cy="formCrudReferencePickersAdd"]').click();
  const configPanel = page.locator('[data-cy="formCrudReferencePickerConfig"]').last();
  await configPanel.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await configPanel.locator('[data-cy="formCrudReferencePickerLabel"]').fill(config.label ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerFormId"]').selectOption(config.formId ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerSourcePath"]').fill(config.sourcePath);
  await configPanel.locator('[data-cy="formCrudReferencePickerTargetApiId"]').selectOption(config.targetApiId ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerCollectionPath"]').fill(config.collectionPath);
  await configPanel.locator('[data-cy="formCrudReferencePickerBaseUrl"]').fill(config.targetBaseUrl ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerSearchParam"]').fill(config.searchParam ?? '');
  await configPanel.locator('[data-cy="formCrudReferencePickerDisplayFields"]').fill((config.displayFields ?? []).join(', '));
  await configPanel
    .locator('[data-cy="formCrudReferencePickerCopyFields"]')
    .fill((config.copyFields ?? []).map(mapping => `${mapping.source}:${mapping.target}`).join(', '));
  await configPanel.locator('select[id^="mode-"]').selectOption(config.mode ?? 'reference');
  const multipleCheckbox = configPanel.locator('input[id^="multiple-"]');
  if ((await multipleCheckbox.isChecked()) !== (config.multiple !== false)) {
    await multipleCheckbox.click();
  }

  const saveResponse = page.waitForResponse(response => response.url().includes(resourcePath) && response.request().method() === 'PUT', {
    timeout: apiTimeoutMs,
  });
  await page.locator('[data-cy="formCrudReferencePickersSave"]').click();
  const response = await saveResponse;
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`Reference picker admin save failed: HTTP ${response.status()}`);
  }
  await page.locator('[data-cy="formCrudReferencePickersSuccess"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-saved');

  const persisted = await authenticatedFetch(page, resourcePath, { method: 'GET' });
  const saved = Array.isArray(persisted.body)
    ? persisted.body.find(
        candidate =>
          candidate?.formId === config.formId &&
          candidate?.targetApiId === config.targetApiId &&
          candidate?.sourcePath === config.sourcePath &&
          candidate?.collectionPath === config.collectionPath,
      )
    : undefined;
  if (!saved) {
    throw new Error('Reference picker configuration was not returned by the backend after admin save');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrudReferencePickerConfig"]').first().waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-admin-reloaded');
  result.steps.push({ name: 'reference-picker-admin-save-load', status: 'ok', sourcePath: config.sourcePath });
}

async function seedOperationFromGeneratedForm(page, operation, stepName) {
  await gotoOperation(page, operation.id);
  const state = await debugState(page);
  if (!state.valid) {
    result.steps.push({
      name: stepName,
      status: 'skipped',
      reason: 'generated form defaults are invalid',
      fieldCount: state.fields?.length ?? 0,
    });
    return undefined;
  }
  const submitted = await submitCurrentOperation(page, stepName);
  if (!submitted) return undefined;
  const statusText = await page
    .locator('[data-cy="formCrudStatus"], [data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  result.steps.push({
    name: `${stepName}-status`,
    status: status !== undefined && status >= 200 && status < 300 ? 'ok' : 'failed',
    source: 'generated-form-defaults',
    httpStatus: status,
    text: statusText?.trim() ?? '',
  });
  return status !== undefined && status >= 200 && status < 300 ? { status } : undefined;
}

async function seedOperation(page, operation, stepName) {
  const payload = findPayloadForOperation(operation);
  if (!payload) {
    return seedOperationFromGeneratedForm(page, operation, stepName);
  }
  const response = await apiRequest(page, operation, payload);
  result.steps.push({
    name: stepName,
    status: response.status >= 200 && response.status < 300 ? 'ok' : 'failed',
    source: 'payload-fixture',
    httpStatus: response.status,
  });
  return response.status >= 200 && response.status < 300 ? response.body : undefined;
}

async function exercisePanel(page) {
  await screenshot(page, 'form-crud-initial');
  const panel = page.locator('[data-cy="formCrudResourcePanel"]').first();
  const toggle = page.locator('[data-cy="formCrudTogglePanel"]').first();
  if ((await locatorCount(panel)) === 0 || (await locatorCount(toggle)) === 0) return;
  await toggle.click();
  await page
    .locator('[data-cy="formCrudResourcePanel"]')
    .waitFor({ state: 'detached', timeout: optionalTimeoutMs })
    .catch(() => undefined);
  await screenshot(page, 'form-crud-panel-collapsed');
  await toggle.click();
  await panel.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  result.steps.push({ name: 'resource-panel-collapse-expand', status: 'ok' });
}

async function exerciseListResource(page, entry) {
  const operation = entry.resource.listOperation;
  if (!operation) return;
  result.coverage.exercisedListResources += 1;
  await gotoOperation(page, operation.id);
  await screenshot(page, `list-${operation.id}-before-submit`);
  await submitCurrentOperation(page, `list-${operation.id}`, ['GET']);

  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const rowCount = await locatorCount(rows);
  result.steps.push({ name: `list-${operation.id}-rows`, status: 'ok', count: rowCount });
  if (rowCount === 0) return;

  const firstRow = rows.first();
  const detailsButton = firstRow.locator('[data-cy="formCrudDetailsButton"]').first();
  if ((await locatorCount(detailsButton)) > 0) {
    await detailsButton.click();
    await page.locator('[data-cy="formCrudDetails"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
    await screenshot(page, `detail-${operation.id}`);
    result.coverage.exercisedDetailResources += 1;
    result.steps.push({ name: `detail-${operation.id}`, status: 'ok' });

    const accordionCount = await expandAccordions(page.locator('[data-cy="formCrudDetails"]'), 12);
    if (accordionCount > 0) {
      await screenshot(page, `detail-${operation.id}-accordion-expanded`);
      result.steps.push({ name: `detail-accordions-${operation.id}`, status: 'ok', count: accordionCount });
    }

    const pickerButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudReferencePickerButton"]').first();
    if ((await locatorCount(pickerButton)) > 0 && (await pickerButton.isVisible())) {
      await pickerButton.click();
      const modal = page.locator('[data-cy="formCrudReferencePickerModal"]').first();
      await modal.waitFor({ state: 'visible', timeout: apiTimeoutMs });
      await screenshot(page, `reference-picker-${operation.id}`);
      const pickerRows = page.locator('[data-cy="formCrudReferencePickerRow"]');
      if ((await locatorCount(pickerRows)) > 0) {
        await pickerRows.first().locator('[data-cy="formCrudReferencePickerSelect"]').click();
        await modal.waitFor({ state: 'detached', timeout: apiTimeoutMs });
        await screenshot(page, `reference-picker-${operation.id}-selected`);
        result.steps.push({ name: `reference-picker-select-${operation.id}`, status: 'ok' });
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
        result.steps.push({ name: `reference-picker-select-${operation.id}`, status: 'skipped', reason: 'no rows' });
      }
    }

    if (entry.resource.updateOperation) {
      const mutation = await mutateEditablePrimitiveDetailField(page, `update-${entry.resource.updateOperation.id}`);
      await saveVisibleDetail(page, `update-${entry.resource.updateOperation.id}`, false, mutation);
    }
  }
}

async function listRowCount(page, operation, stepName) {
  await gotoOperation(page, operation.id);
  await submitCurrentOperation(page, stepName, ['GET']);
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const count = await locatorCount(rows);
  result.steps.push({ name: `${stepName}-rows`, status: 'observed', count });
  return count;
}

async function ensureResourceRows(page, entry, stepName) {
  const listOperation = entry.resource?.listOperation;
  const createOperation = entry.resource?.createOperation;
  if (!listOperation) return false;
  if ((await listRowCount(page, listOperation, `${stepName}-list-before-seed`)) > 0) return true;
  if (!createOperation) return false;
  await seedOperation(page, createOperation, `${stepName}-seed-${createOperation.id}`);
  return (await listRowCount(page, listOperation, `${stepName}-list-after-seed`)) > 0;
}

async function exerciseReferencePickerScenario(page, resources) {
  const scenario = findReferencePickerScenario(resources);
  if (!scenario) {
    result.steps.push({
      name: 'reference-picker-scenario',
      status: 'skipped',
      reason: 'no compatible reference field and target resource discovered',
    });
    return;
  }

  const { sourceEntry, targetEntry, sourcePath, field: sourceField } = scenario;
  const copyFields = targetCopyFieldsForPath(sourceEntry.resource.updateOperation.requestBodyFields ?? [], sourcePath);
  const config = {
    id: `gui-smoke-${Date.now()}`,
    label: `${sourceEntry.resource.label ?? sourceEntry.resource.listOperation.path} ${sourcePath}`,
    formId: sourceEntry.resource.updateOperation.id,
    targetApiId: targetEntry.resource.listOperation.id,
    sourcePath,
    collectionPath: targetEntry.resource.listOperation.path,
    displayFields: ['id', 'tmfId', 'href', 'name'],
    copyFields,
    mode: 'reference',
    multiple: true,
  };

  await configureReferencePickerViaAdmin(page, config);

  const targetReady = await ensureResourceRows(page, targetEntry, 'reference-picker-target');
  const sourceReady = await ensureResourceRows(page, sourceEntry, 'reference-picker-source');
  if (!targetReady || !sourceReady) {
    result.steps.push({
      name: 'reference-picker-select',
      status: 'skipped',
      reason: 'source or target list has no rows after seeding',
      targetReady,
      sourceReady,
    });
    return;
  }

  await gotoOperation(page, sourceEntry.resource.listOperation.id);
  await submitCurrentOperation(page, `reference-picker-list-${sourceEntry.resource.listOperation.id}`, ['GET']);
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  if ((await locatorCount(rows)) === 0) {
    result.steps.push({ name: 'reference-picker-select', status: 'skipped', reason: 'source list returned no rows after seeding' });
    return;
  }

  await rows.first().locator('[data-cy="formCrudDetailsButton"]').first().click();
  await page.locator('[data-cy="formCrudDetails"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await expandAccordions(page.locator('[data-cy="formCrudDetails"]'));
  await screenshot(page, 'reference-picker-detail-before-select');

  const before = await debugState(page);
  const pickerButton = page.locator('[data-cy="formCrudDetails"] [data-cy="formCrudReferencePickerButton"]').first();
  if ((await locatorCount(pickerButton)) === 0 || !(await pickerButton.isVisible())) {
    result.steps.push({
      name: 'reference-picker-select',
      status: 'failed',
      reason: 'configured picker button is not visible on the detail form',
    });
    throw new Error('Configured reference picker button is not visible on the detail form');
  }

  await pickerButton.click();
  const modal = page.locator('[data-cy="formCrudReferencePickerModal"]').first();
  await modal.waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-modal');
  const pickerRows = page.locator('[data-cy="formCrudReferencePickerRow"]');
  if ((await locatorCount(pickerRows)) === 0) {
    result.steps.push({ name: 'reference-picker-select', status: 'failed', reason: 'target list returned no selectable rows' });
    throw new Error('Reference picker target list returned no selectable rows');
  }

  const selectedItem = await page.evaluate(() => window.__formsDebug.formCrud().referencePickerRows[0]?.item);
  await pickerRows.first().locator('[data-cy="formCrudReferencePickerSelect"]').click();
  await modal.waitFor({ state: 'detached', timeout: apiTimeoutMs });
  await screenshot(page, 'reference-picker-selected');
  const after = await debugState(page);
  const beforeValue = valueAtPath(before.responseDetailModel, sourcePath);
  const afterValue = valueAtPath(after.responseDetailModel, sourcePath);
  const changed = JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
  const selectedValues = Array.isArray(afterValue) ? afterValue : [afterValue];
  const copied = selectedValues.some(candidate => sharedIdentityFields(candidate, selectedItem).length > 0);
  const expectedCopyFields = expectedConfiguredCopyFields(selectedItem, config);
  const copiedConfigured = selectedValues.flatMap(candidate => copiedConfiguredFields(candidate, selectedItem, config));
  const missingCopyFields = expectedCopyFields.filter(field => !copiedConfigured.includes(field));

  if (!changed || !copied || missingCopyFields.length) {
    result.steps.push({ name: 'reference-picker-select', status: 'failed', changed, copied, sourcePath, missingCopyFields });
    throw new Error(
      `Reference picker did not populate ${sourcePath} with selected configured fields: ${missingCopyFields.join(', ') || 'identity fields'}`,
    );
  }

  result.steps.push({
    name: 'reference-picker-select',
    status: 'ok',
    sourcePath,
    copiedFields: selectedValues.flatMap(candidate => sharedIdentityFields(candidate, selectedItem)),
    copiedConfiguredFields: copiedConfigured,
  });
  result.coverage.exercisedReferencePickerSaves += 1;
  if (await saveVisibleDetail(page, 'reference-picker-save-selected', true)) {
    const saved = await debugState(page);
    const savedValue = valueAtPath(saved.responseDetailModel, sourcePath);
    const savedValues = Array.isArray(savedValue) ? savedValue : [savedValue];
    const savedCopiedConfigured = savedValues.flatMap(candidate => copiedConfiguredFields(candidate, selectedItem, config));
    const savedMissingCopyFields = expectedCopyFields.filter(field => !savedCopiedConfigured.includes(field));
    if (savedMissingCopyFields.length) {
      result.steps.push({
        name: 'reference-picker-save-retains-selection',
        status: 'failed',
        sourcePath,
        missingCopyFields: savedMissingCopyFields,
      });
      throw new Error(`Reference picker save did not retain ${sourcePath} configured fields: ${savedMissingCopyFields.join(', ')}`);
    }
    result.steps.push({
      name: 'reference-picker-save-retains-selection',
      status: 'ok',
      sourcePath,
      copiedConfiguredFields: savedCopiedConfigured,
    });
    result.coverage.successfulReferencePickerSaves += 1;
    if (!sourceField.required && !(Number(sourceField.minItems) > 0)) {
      const clearMutation = await clearResponseDetailArrayPath(page, sourcePath, 'reference-picker-clear-selection');
      if (clearMutation && (await saveVisibleDetail(page, 'reference-picker-save-cleared-selection', true, clearMutation))) {
        result.steps.push({ name: 'reference-picker-clear-retained', status: 'ok', sourcePath });
      }
    }
  }
}

async function exerciseCreateResource(page, entry) {
  const operation = entry.resource.createOperation;
  if (!operation) return false;
  await gotoOperation(page, operation.id);
  await screenshot(page, `create-${operation.id}-initial`);

  const state = await debugState(page);
  result.steps.push({
    name: `create-${operation.id}-form-state`,
    status: 'observed',
    valid: state.valid,
    fieldCount: state.fields?.length ?? 0,
  });
  if (!state.valid) {
    result.steps.push({
      name: `create-${operation.id}-invalid-defaults`,
      status: failOnInvalidCreateForm ? 'failed' : 'observed',
      reason: 'generated form defaults are invalid',
      fieldCount: state.fields?.length ?? 0,
    });
    if (failOnInvalidCreateForm) {
      throw new Error(`Create form ${operation.id} is invalid with generated defaults`);
    }
    return false;
  }

  const submitted = await submitCurrentOperation(page, `create-${operation.id}`);
  if (!submitted) return false;

  const statusText = await page
    .locator('[data-cy="formCrudStatus"], [data-cy="formCrudDetailStatus"]')
    .first()
    .textContent()
    .catch(() => '');
  const statusMatch = statusText?.match(/HTTP\s+(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;
  const ok = httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
  result.steps.push({
    name: `create-${operation.id}-status`,
    status: ok ? 'ok' : 'failed',
    httpStatus,
    text: statusText?.trim() ?? '',
  });
  if (!ok && failOnCreateHttpError) {
    throw new Error(`Create operation ${operation.id} did not return HTTP 2xx: ${statusText?.trim() || 'no status shown'}`);
  }
  if (ok) result.coverage.successfulCreateResources += 1;
  return ok;
}

async function exerciseDeleteCreatedItem(page, entry) {
  if (!exerciseDelete || !entry.resource.listOperation || !entry.resource.deleteOperation) return;
  await gotoOperation(page, entry.resource.listOperation.id);
  await submitCurrentOperation(page, `list-before-delete-${entry.resource.listOperation.id}`, ['GET']);
  const rows = page.locator('[data-cy="formCrudTableRow"]');
  const rowCount = await locatorCount(rows);
  if (rowCount === 0) return;
  const deleteButton = rows.last().locator('[data-cy="formCrudDeleteButton"]').first();
  if ((await locatorCount(deleteButton)) === 0 || !(await deleteButton.isEnabled())) return;
  const deletedRowText = (
    await rows
      .last()
      .textContent()
      .catch(() => '')
  ).trim();
  result.coverage.exercisedDeleteResources += 1;
  const deleteResponse = page
    .waitForResponse(response => response.request().method() === 'DELETE' && response.url().includes('/api/'), { timeout: apiTimeoutMs })
    .catch(() => undefined);
  page.once('dialog', dialog => dialog.accept());
  await deleteButton.click();
  const response = await deleteResponse;
  await page.waitForLoadState('networkidle', { timeout: settleTimeoutMs }).catch(() => undefined);
  await screenshot(page, `delete-${entry.resource.listOperation.id}`);
  const refreshedRowCount = await locatorCount(rows);
  const remainingText = (await rows.allTextContents().catch(() => [])).join('\n');
  const status = response?.status();
  const removedFromView = refreshedRowCount < rowCount || !remainingText.includes(deletedRowText);
  const ok = status !== undefined && status >= 200 && status < 300 && removedFromView;
  result.steps.push({
    name: `delete-${entry.resource.listOperation.id}`,
    status: ok ? 'ok' : 'failed',
    httpStatus: status,
    beforeRows: rowCount,
    afterRows: refreshedRowCount,
    removedFromView,
  });
  if (!ok) throw new Error(`Delete ${entry.resource.deleteOperation.id} did not remove a visible row with HTTP 2xx`);
  result.coverage.successfulDeleteResources += 1;
}

try {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);

  let authenticated = false;
  page.on('console', message => {
    result.console.push({ type: message.type(), text: message.text(), authenticated });
  });
  page.on('pageerror', error => {
    result.pageErrors.push({ message: error.message, stack: error.stack });
  });
  page.on('response', response => {
    const status = response.status();
    if (authenticated && (status >= 500 || (failOnHttp4xx && status >= 400))) {
      result.failedResponses.push(compactResponse(response));
    }
  });

  await page.goto(joinUrl(webBaseUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="username"], input[name="username"]').first().fill(username);
  await page.locator('[data-cy="password"], input[name="password"]').first().fill(password);
  await page.locator('[data-cy="submit"], button[type="submit"]').first().click();
  await page.waitForFunction(
    () => Boolean(sessionStorage.getItem('jhi-authenticationToken') ?? localStorage.getItem('jhi-authenticationToken')),
    undefined,
    { timeout: timeoutMs },
  );
  await page
    .locator('#home-logged-message')
    .waitFor({ state: 'visible', timeout: optionalTimeoutMs })
    .catch(() => undefined);
  authenticated = true;
  await screenshot(page, 'login-complete');
  result.steps.push({ name: 'login', status: 'ok' });

  await page.goto(joinUrl(webBaseUrl, '/form-crud'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible', timeout: apiTimeoutMs });
  await exercisePanel(page);

  const resources = flattenResources((await debugState(page)).resourceGroups);
  result.resourceCount = resources.length;
  result.coverage.discoveredResources = resources.length;
  result.steps.push({ name: 'discover-resources', status: 'ok', count: resources.length });

  await exerciseReferencePickerScenario(page, resources);

  const createdEntries = [];
  if (exerciseCreate) {
    const createEntries = limitEntries(
      resources.filter(candidate => candidate.resource.createOperation),
      maxCreateResources,
    );
    result.coverage.plannedCreateResources = createEntries.length;
    result.steps.push({ name: 'create-resource-coverage', status: 'planned', count: createEntries.length });
    for (const entry of createEntries) {
      result.coverage.exercisedCreateResources += 1;
      const createdCurrent = await exerciseCreateResource(page, entry);
      if (createdCurrent) {
        createdEntries.push(entry);
      }
    }
  }

  const listEntries = limitEntries(
    resources.filter(candidate => candidate.resource.listOperation),
    maxListResources,
  );
  result.coverage.plannedListResources = listEntries.length;
  result.steps.push({ name: 'list-resource-coverage', status: 'planned', count: listEntries.length });
  for (const entry of listEntries) {
    await exerciseListResource(page, entry);
  }

  for (const entry of createdEntries) {
    await exerciseDeleteCreatedItem(page, entry);
  }

  const consoleErrors = result.console.filter(entry => entry.type === 'error' && entry.authenticated);
  if (result.pageErrors.length > 0) {
    throw new Error(`Browser page error(s): ${result.pageErrors.map(error => error.message).join('; ')}`);
  }
  if (result.failedResponses.length > 0) {
    throw new Error(
      `Failed HTTP response(s): ${result.failedResponses.map(response => `${response.method} ${response.url} ${response.status}`).join('; ')}`,
    );
  }
  if (failOnConsoleError && consoleErrors.length > 0) {
    throw new Error(`Browser console error(s): ${consoleErrors.map(entry => entry.text).join('; ')}`);
  }

  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
  writeResultReport();
}
