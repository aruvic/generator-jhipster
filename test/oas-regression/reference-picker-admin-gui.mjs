#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

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

  throw new Error(['Playwright is required for the reference-picker administration integration.', ...errors].join('\n'));
}

const [webBaseUrl, outputDir, pickerId, updatedLabel] = process.argv.slice(2);
if (!webBaseUrl || !outputDir || !pickerId || !updatedLabel) {
  process.stderr.write('Usage: reference-picker-admin-gui.mjs <web-base-url> <output-dir> <picker-id> <updated-label>\n');
  process.exit(2);
}

fs.mkdirSync(outputDir, { recursive: true });

const timeoutMs = Number.parseInt(process.env.FORM_CRUD_GUI_TIMEOUT_MS ?? '30000', 10);
const username = process.env.FORM_CRUD_GUI_USERNAME ?? 'admin';
const password = process.env.FORM_CRUD_GUI_PASSWORD ?? 'admin';
const headless = process.env.FORM_CRUD_GUI_HEADLESS !== 'false';
const result = {
  status: 'failed',
  pickerId,
  putStatus: undefined,
  persistedAfterReload: false,
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

function writeResult() {
  fs.writeFileSync(path.join(outputDir, 'status.json'), `${JSON.stringify(result, null, 2)}\n`);
}

try {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(timeoutMs);

  page.on('pageerror', error => {
    result.pageErrors.push({ message: error.message, stack: error.stack });
  });
  page.on('console', message => {
    if (authenticated && message.type() === 'error') result.consoleErrors.push({ text: message.text() });
  });
  page.on('response', response => {
    if (authenticated && response.status() >= 400) {
      result.failedResponses.push({
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
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
  authenticated = true;

  await page.goto(joinUrl(webBaseUrl, '/admin/form-crud-reference-pickers'), { waitUntil: 'domcontentloaded' });
  await page.locator('[data-cy="formCrudReferencePickers"]').waitFor({ state: 'visible' });
  const configPanel = page.locator('[data-cy="formCrudReferencePickerConfig"]').first();
  await configPanel.waitFor({ state: 'visible' });

  const labelInput = configPanel.locator('[data-cy="formCrudReferencePickerLabel"]');
  await labelInput.fill(updatedLabel);
  const saveResponsePromise = page.waitForResponse(
    response => response.url().includes('/api/form-crud-reference-pickers') && response.request().method() === 'PUT',
    { timeout: timeoutMs },
  );
  await page.locator('[data-cy="formCrudReferencePickersSave"]').click();
  const saveResponse = await saveResponsePromise;
  result.putStatus = saveResponse.status();
  if (saveResponse.status() < 200 || saveResponse.status() >= 300) {
    throw new Error(`Reference-picker administration save returned HTTP ${saveResponse.status()}`);
  }

  const requestBody = JSON.parse(saveResponse.request().postData() ?? '[]');
  const savedRequest =
    Array.isArray(requestBody) ? requestBody.find(candidate => (candidate?.id ?? candidate?.pickerId) === pickerId) : undefined;
  if (!savedRequest || savedRequest.label !== updatedLabel) {
    throw new Error('Reference-picker administration PUT did not contain the edited mapping');
  }

  const responseBody = await saveResponse.json();
  const savedResponse =
    Array.isArray(responseBody) ? responseBody.find(candidate => (candidate?.id ?? candidate?.pickerId) === pickerId) : undefined;
  if (!savedResponse || savedResponse.label !== updatedLabel) {
    throw new Error('Reference-picker administration response did not contain the persisted edit');
  }

  await page.locator('[data-cy="formCrudReferencePickersSuccess"]').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, 'reference-picker-admin-saved.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedPanel = page.locator('[data-cy="formCrudReferencePickerConfig"]').first();
  await reloadedPanel.waitFor({ state: 'visible' });
  const reloadedLabel = await reloadedPanel.locator('[data-cy="formCrudReferencePickerLabel"]').inputValue();
  if (reloadedLabel !== updatedLabel) {
    throw new Error(`Reference-picker label was not restored after reload: ${JSON.stringify(reloadedLabel)}`);
  }
  result.persistedAfterReload = true;
  await page.screenshot({ path: path.join(outputDir, 'reference-picker-admin-reloaded.png'), fullPage: true });

  if (result.pageErrors.length || result.consoleErrors.length || result.failedResponses.length) {
    throw new Error(
      `Browser errors detected: page=${result.pageErrors.length}, console=${result.consoleErrors.length}, HTTP=${result.failedResponses.length}`,
    );
  }

  result.status = 'passed';
} catch (error) {
  result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  writeResult();
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
