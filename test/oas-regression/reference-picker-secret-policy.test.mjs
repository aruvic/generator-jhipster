import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { containsTokenShapedValue, redactHarnessDiagnostics } from './reference-picker-secret-policy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const policyScript = path.join(scriptDir, 'reference-picker-secret-policy.mjs');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-picker-secret-policy-test-'));

after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

function syntheticTokenShape() {
  return ['eyJ', 'fixture_header', '.', 'fixture_payload', '.', 'fixture_signature'].join('');
}

test('redacts exact authentication and token-shaped values from every diagnostic channel', () => {
  const tokenShape = syntheticTokenShape();
  const authentication = ['synthetic', '-', 'authentication'].join('');
  const urlCredential = ['synthetic', '-', 'url', '-', 'credential'].join('');
  const diagnostics = {
    pageErrors: [{ message: `page failure ${tokenShape}`, stack: `Authorization: Bearer ${authentication}` }],
    consoleErrors: [{ text: `console failure ${tokenShape}` }],
    failedResponses: [
      {
        method: 'GET',
        status: 401,
        url: `https://client:${urlCredential}@example.invalid/items?access_token=${urlCredential}&visible=true`,
      },
    ],
    error: `workflow failure ${authentication}`,
  };

  const serialized = JSON.stringify(redactHarnessDiagnostics(diagnostics, [authentication]));

  assert.equal(containsTokenShapedValue(serialized), false);
  assert.equal(serialized.includes(authentication), false);
  assert.equal(serialized.includes(urlCredential), false);
  assert.equal(
    JSON.parse(serialized).failedResponses[0].url,
    'https://[REDACTED]@example.invalid/items?access_token=[REDACTED]&visible=true',
  );
  assert.equal(serialized.includes('[REDACTED]'), true);
});

test('detects only complete token-shaped values', () => {
  assert.equal(containsTokenShapedValue(`diagnostic ${syntheticTokenShape()}`), true);
  assert.equal(containsTokenShapedValue('diagnostic eyJfixture_header.fixture_payload'), false);
  assert.equal(containsTokenShapedValue('ordinary diagnostic text'), false);
});

test('artifact scanner signals exposure without writing diagnostic contents', () => {
  const cleanArtifact = path.join(testRoot, 'clean.log');
  const exposedArtifact = path.join(testRoot, 'exposed.log');
  fs.writeFileSync(cleanArtifact, 'ordinary diagnostic text\n');
  fs.writeFileSync(exposedArtifact, `diagnostic ${syntheticTokenShape()}\n`);

  const cleanResult = spawnSync(process.execPath, [policyScript, '--scan-artifacts', cleanArtifact], { encoding: 'utf8' });
  const exposedResult = spawnSync(process.execPath, [policyScript, '--scan-artifacts', exposedArtifact], { encoding: 'utf8' });

  assert.equal(cleanResult.status, 1);
  assert.equal(exposedResult.status, 0);
  assert.equal(cleanResult.stdout, '');
  assert.equal(cleanResult.stderr, '');
  assert.equal(exposedResult.stdout, '');
  assert.equal(exposedResult.stderr, '');
});
