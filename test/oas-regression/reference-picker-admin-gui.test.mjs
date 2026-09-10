import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const guiScript = path.join(scriptDir, 'reference-picker-admin-gui.mjs');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-picker-admin-gui-test-'));

after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

function createPlaywrightRoot(root) {
  const packageDir = path.join(root, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"@playwright/test","main":"index.cjs"}\n');
  fs.writeFileSync(path.join(packageDir, 'index.cjs'), 'module.exports = { chromium: {} };\n');
}

function checkDependencies(root, cwd) {
  return spawnSync(process.execPath, [guiScript, '--check-dependencies'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORM_CRUD_GUI_PLAYWRIGHT_ROOT: root,
      PLAYWRIGHT_ROOT: '',
    },
  });
}

function redactDiagnostics(diagnostics) {
  return spawnSync(process.execPath, [guiScript, '--redact-diagnostics'], {
    encoding: 'utf8',
    input: JSON.stringify(diagnostics),
  });
}

test('redacts token-shaped values while retaining browser diagnostics', () => {
  const syntheticToken = ['eyJ', 'fixture_header', '.', 'fixture_payload', '.', 'fixture_signature'].join('');
  const diagnostics = {
    pageErrors: [{ message: `page failure ${syntheticToken}`, stack: `Error: ${syntheticToken}\n  at fixture.mjs:1:1` }],
    consoleErrors: [{ text: `request failed with Bearer ${syntheticToken}` }],
    failedResponses: [
      {
        method: 'GET',
        status: 401,
        url: `https://fixture:${syntheticToken}@example.invalid/items?access_token=${syntheticToken}&visible=true`,
      },
    ],
    error: `Error: workflow failure ${syntheticToken}\n  at fixture.mjs:2:1`,
  };

  const result = redactDiagnostics(diagnostics);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  const redacted = JSON.parse(result.stdout);
  const serialized = JSON.stringify(redacted);

  assert.equal(serialized.includes(syntheticToken), false);
  assert.deepEqual(redacted.pageErrors[0], {
    message: 'page failure [REDACTED]',
    stack: 'Error: [REDACTED]\n  at fixture.mjs:1:1',
  });
  assert.equal(redacted.consoleErrors[0].text, 'request failed with Bearer [REDACTED]');
  assert.equal(redacted.failedResponses[0].url, 'https://[REDACTED]@example.invalid/items?access_token=[REDACTED]&visible=true');
  assert.equal(redacted.error, 'Error: workflow failure [REDACTED]\n  at fixture.mjs:2:1');
});

test('checks the configured Playwright root without starting the GUI workflow', () => {
  const root = path.join(testRoot, 'configured');
  const cwd = path.join(testRoot, 'cwd');
  createPlaywrightRoot(root);
  fs.mkdirSync(cwd);

  const result = checkDependencies(root, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('does not report dependencies ready from an unconfigured fallback root', () => {
  const root = path.join(testRoot, 'missing');
  const cwd = path.join(testRoot, 'empty-cwd');
  fs.mkdirSync(root);
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n');

  const result = checkDependencies(root, cwd);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Playwright is required for the reference-picker integration/);
  assert.match(result.stderr, new RegExp(root.replaceAll('\\', '\\\\')));
  assert.doesNotMatch(result.stderr, /\/tmp\/playwright-tests/);
  assert.deepEqual(fs.readdirSync(cwd), []);
});
