import assert from 'node:assert/strict';
import test from 'node:test';

import { combineIndependentCoverageMaps } from './source-coverage-combination.mjs';

function coverage(path, statementMap, statementHits) {
  return {
    path,
    statementMap,
    fnMap: {},
    branchMap: {},
    s: statementHits,
    f: {},
    b: {},
  };
}

test('reports a compatible union as unavailable instead of selecting Vitest when browser instrumentation differs', () => {
  const file = '/app/src/main/webapp/app/form-crud/form-crud.ts';
  const unitTestCoverage = {
    [file]: coverage(
      file,
      {
        0: { start: { line: 10, column: 2 }, end: { line: 10, column: 20 } },
        1: { start: { line: 11, column: 2 }, end: { line: 13, column: 3 } },
      },
      { 0: 1, 1: 1 },
    ),
  };
  const browserCoverage = {
    [file]: coverage(
      file,
      {
        0: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
        1: { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
        2: { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
      },
      { 0: 1, 1: 0, 2: 0 },
    ),
  };

  const combined = combineIndependentCoverageMaps(browserCoverage, unitTestCoverage);

  assert.equal(combined.status, 'unavailable');
  assert.equal(combined.coverage, null);
  assert.equal(combined.reasonCode, 'incompatible-source-coverage-instrumentation');
  assert.deepEqual(combined.incompatibleFiles, [file]);
  assert.deepEqual(combined.files[0], {
    file,
    mode: 'incompatible',
    selectedSources: [],
    reasonCode: 'incompatible-source-coverage-instrumentation',
    evidence: {
      vitest: { lines: 2, statements: 2, functions: 0, branches: 0 },
      browser: { lines: 3, statements: 3, functions: 0, branches: 0 },
    },
  });
});

test('unions counters only when coverage instrumentation maps are identical', () => {
  const file = '/app/src/main/webapp/app/form-crud/form-crud.ts';
  const statementMap = {
    0: { start: { line: 10, column: 2 }, end: { line: 10, column: 20 } },
    1: { start: { line: 11, column: 2 }, end: { line: 11, column: 20 } },
  };
  const unitTestCoverage = { [file]: coverage(file, statementMap, { 0: 1, 1: 0 }) };
  const browserCoverage = { [file]: coverage(file, statementMap, { 0: 0, 1: 1 }) };

  const combined = combineIndependentCoverageMaps(browserCoverage, unitTestCoverage);

  assert.equal(combined.status, 'available');
  assert.deepEqual(combined.sources, ['vitest', 'browser']);
  assert.deepEqual(combined.coverage[file].s, { 0: 1, 1: 1 });
  assert.equal(combined.files[0].mode, 'compatible-union');
});

test('reports browser-only evidence without presenting it as a combined metric', () => {
  const file = '/app/src/main/webapp/app/form-crud/form-crud.ts';
  const browserCoverage = {
    [file]: coverage(file, { 0: { start: { line: 1 }, end: { line: 1 } } }, { 0: 1 }),
  };

  const combination = combineIndependentCoverageMaps(browserCoverage);

  assert.equal(combination.status, 'unavailable');
  assert.equal(combination.coverage, null);
  assert.equal(combination.reasonCode, 'vitest-source-coverage-unavailable');
  assert.deepEqual(combination.sources, ['browser']);
  assert.equal(combination.files[0].mode, 'browser-only');
});

test('reports Vitest-only evidence without presenting it as browser coverage', () => {
  const file = '/app/src/main/webapp/app/form-crud/form-crud.ts';
  const unitTestCoverage = {
    [file]: coverage(file, { 0: { start: { line: 1 }, end: { line: 1 } } }, { 0: 1 }),
  };

  const combination = combineIndependentCoverageMaps({}, unitTestCoverage);

  assert.equal(combination.status, 'unavailable');
  assert.equal(combination.coverage, null);
  assert.equal(combination.reasonCode, 'browser-source-coverage-unavailable');
  assert.deepEqual(combination.sources, ['vitest']);
  assert.equal(combination.files[0].mode, 'vitest-only');
});
