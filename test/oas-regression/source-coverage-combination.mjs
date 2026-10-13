const COVERAGE_MAP_KEYS = ['statementMap', 'fnMap', 'branchMap'];
const COVERAGE_COUNTER_KEYS = ['s', 'f', 'b'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function entryCounts(coverage) {
  return {
    lines: new Set(Object.values(coverage.statementMap ?? {}).map(statement => statement.start.line)).size,
    statements: Object.keys(coverage.statementMap ?? {}).length,
    functions: Object.keys(coverage.fnMap ?? {}).length,
    branches: Object.values(coverage.branchMap ?? {}).reduce((total, branch) => total + (branch.locations?.length ?? 0), 0),
  };
}

function hasCompatibleInstrumentation(left, right) {
  return COVERAGE_MAP_KEYS.every(key => JSON.stringify(left[key] ?? {}) === JSON.stringify(right[key] ?? {}));
}

function mergeCompatibleCoverage(canonical, additional) {
  const merged = clone(canonical);
  for (const key of COVERAGE_COUNTER_KEYS) {
    for (const [id, hits] of Object.entries(additional[key] ?? {})) {
      if (Array.isArray(hits)) {
        merged[key][id] = hits.map((hit, index) => hit + (merged[key][id]?.[index] ?? 0));
      } else {
        merged[key][id] = hits + (merged[key][id] ?? 0);
      }
    }
  }
  return merged;
}

export function combineIndependentCoverageMaps(browserCoverage, unitTestCoverage) {
  const browserFiles = Object.keys(browserCoverage ?? {});
  const unitTestFiles = Object.keys(unitTestCoverage ?? {});
  if (browserFiles.length === 0) {
    return {
      status: 'unavailable',
      coverage: null,
      sources: unitTestFiles.length > 0 ? ['vitest'] : [],
      reasonCode: 'browser-source-coverage-unavailable',
      files: Object.entries(unitTestCoverage ?? {}).map(([file, coverage]) => ({
        file,
        mode: 'vitest-only',
        selectedSources: ['vitest'],
        evidence: { vitest: entryCounts(coverage) },
      })),
    };
  }

  if (unitTestFiles.length === 0) {
    return {
      status: 'unavailable',
      coverage: null,
      sources: ['browser'],
      reasonCode: 'vitest-source-coverage-unavailable',
      files: Object.entries(browserCoverage).map(([file, coverage]) => ({
        file,
        mode: 'browser-only',
        selectedSources: ['browser'],
        evidence: { browser: entryCounts(coverage) },
      })),
    };
  }

  const coverage = clone(unitTestCoverage);
  const files = [];
  const incompatibleFiles = [];
  for (const file of new Set([...Object.keys(unitTestCoverage), ...Object.keys(browserCoverage)])) {
    const browser = browserCoverage[file];
    const unitTest = unitTestCoverage[file];
    if (!unitTest) {
      coverage[file] = clone(browser);
      files.push({
        file,
        mode: 'browser-only',
        selectedSources: ['browser'],
        reasonCode: 'unit-test-coverage-unavailable',
        evidence: { browser: entryCounts(browser) },
      });
    } else if (!browser) {
      files.push({
        file,
        mode: 'vitest-only',
        selectedSources: ['vitest'],
        reasonCode: 'browser-coverage-unavailable',
        evidence: { vitest: entryCounts(unitTest) },
      });
    } else if (hasCompatibleInstrumentation(unitTest, browser)) {
      coverage[file] = mergeCompatibleCoverage(unitTest, browser);
      files.push({
        file,
        mode: 'compatible-union',
        selectedSources: ['vitest', 'browser'],
        evidence: { vitest: entryCounts(unitTest), browser: entryCounts(browser) },
      });
    } else {
      const incompatible = {
        file,
        mode: 'incompatible',
        selectedSources: [],
        reasonCode: 'incompatible-source-coverage-instrumentation',
        evidence: { vitest: entryCounts(unitTest), browser: entryCounts(browser) },
      };
      incompatibleFiles.push(file);
      files.push(incompatible);
    }
  }

  if (incompatibleFiles.length > 0) {
    return {
      status: 'unavailable',
      coverage: null,
      sources: ['vitest', 'browser'],
      reasonCode: 'incompatible-source-coverage-instrumentation',
      incompatibleFiles,
      files,
    };
  }

  return {
    status: 'available',
    coverage,
    sources: ['vitest', 'browser'],
    files,
  };
}
