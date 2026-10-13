#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { combineIndependentCoverageMaps } from './source-coverage-combination.mjs';
import {
  SOURCE_COVERAGE_METRIC_LABELS,
  buildSourceCoverageMetricReport,
  classifyBrowserSourceCoverageEvidence,
  evaluateIndependentSourceCoverageGates,
  evaluateSourceCoverageThresholds,
} from './source-coverage-policy.mjs';

const manifestFile = process.argv[2];
if (!manifestFile) {
  process.stderr.write('Usage: form-crud-source-coverage.mjs <worker-manifest.json> | --check-dependencies [app-dir]\n');
  process.exit(2);
}

const dependencyCheck = manifestFile === '--check-dependencies';
const manifest = dependencyCheck ? { appDir: process.argv[3] } : JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

function loadCoverageTools() {
  const configuredRoots = [process.env.FORM_CRUD_GUI_PLAYWRIGHT_ROOT, process.env.PLAYWRIGHT_ROOT].filter(Boolean);
  const candidates = [
    manifest.appDir,
    ...configuredRoots,
    process.cwd(),
    ...(configuredRoots.length === 0 ? ['/tmp/playwright-tests'] : []),
  ].filter(Boolean);
  const errors = [];
  for (const candidate of candidates) {
    try {
      const requireFromCandidate = createRequire(path.join(candidate, 'package.json'));
      return {
        v8Coverage: requireFromCandidate('@bcoe/v8-coverage'),
        v8ToIstanbul: requireFromCandidate('v8-to-istanbul'),
        coverage: requireFromCandidate('istanbul-lib-coverage'),
        report: requireFromCandidate('istanbul-lib-report'),
        reports: requireFromCandidate('istanbul-reports'),
      };
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Unable to load Istanbul/V8 coverage dependencies:\n${errors.join('\n')}`);
}

if (dependencyCheck) {
  loadCoverageTools();
  process.exit(0);
}

function normalizedCoveragePath(rawPath) {
  const normalized = String(rawPath ?? '').replaceAll('\\', '/');
  const marker = 'src/main/webapp/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const relativePath = normalized.slice(markerIndex);
  if (!manifest.scope.some(prefix => relativePath.startsWith(prefix))) return undefined;
  if (manifest.excludedGeneratedFiles.includes(relativePath)) return undefined;
  if (!relativePath.endsWith('.ts') || relativePath.endsWith('.spec.ts')) return undefined;
  return path.resolve(manifest.appDir, relativePath);
}

function inlineSourceMap(source) {
  const marker = 'sourceMappingURL=data:application/json';
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const metadataEnd = source.indexOf('\n', markerIndex);
  const metadata = source.slice(markerIndex + marker.length, metadataEnd < 0 ? undefined : metadataEnd).trim();
  const commaIndex = metadata.indexOf(',');
  if (commaIndex < 0) return undefined;
  const attributes = metadata.slice(0, commaIndex);
  const payload = metadata.slice(commaIndex + 1).replace(/\*\/\s*$/, '');
  const serialized = attributes.includes(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
  return JSON.parse(serialized);
}

function scopedCoverageMap(inputMap, coverageTools) {
  const outputMap = coverageTools.coverage.createCoverageMap({});
  for (const file of inputMap.files()) {
    const normalizedPath = normalizedCoveragePath(file);
    if (!normalizedPath) continue;
    const data = inputMap.fileCoverageFor(file).toJSON();
    data.path = normalizedPath;
    outputMap.addFileCoverage(data);
  }
  return outputMap;
}

function coverageSummary(coverageMap) {
  const summary = coverageMap.getCoverageSummary().toJSON();
  return {
    files: coverageMap.files().length,
    lines: summary.lines,
    statements: summary.statements,
    functions: summary.functions,
    branches: summary.branches,
  };
}

function coverageMapForComponent(inputMap, prefix, coverageTools) {
  const outputMap = coverageTools.coverage.createCoverageMap({});
  for (const file of inputMap.files()) {
    const relativePath = path.relative(manifest.appDir, file).replaceAll('\\', '/');
    if (relativePath.startsWith(prefix)) outputMap.addFileCoverage(inputMap.fileCoverageFor(file));
  }
  return outputMap;
}

function writeCoverageMap(coverageMap, directory, coverageTools) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'coverage-final.json'), `${JSON.stringify(coverageMap.toJSON())}\n`);
  const context = coverageTools.report.createContext({ dir: directory, coverageMap });
  coverageTools.reports.create('lcovonly', { file: 'lcov.info' }).execute(context);
  const summary = coverageSummary(coverageMap);
  fs.writeFileSync(path.join(directory, 'coverage-summary.json'), `${JSON.stringify({ total: summary }, null, 2)}\n`);
  return summary;
}

const coverageTools = loadCoverageTools();
const convertedMap = coverageTools.coverage.createCoverageMap({});
const conversionErrors = [];
const convertedScripts = [];
const scriptGroups = new Map();

for (const script of manifest.scripts) {
  const key = `${script.url}\0${script.sourceFile}`;
  let group = scriptGroups.get(key);
  if (!group) {
    group = {
      ...script,
      scriptId: String(scriptGroups.size + 1),
      coverage: undefined,
      occurrences: 0,
      segments: new Set(),
    };
    scriptGroups.set(key, group);
  }
  const functions = JSON.parse(fs.readFileSync(script.functionsFile, 'utf8'));
  const coverage = {
    scriptId: group.scriptId,
    url: script.url,
    functions,
  };
  group.coverage = group.coverage ? coverageTools.v8Coverage.mergeScriptCovs([group.coverage, coverage]) : coverage;
  group.occurrences += script.occurrences;
  if (script.segment) group.segments.add(script.segment);
}

for (const script of scriptGroups.values()) {
  try {
    const source = fs.readFileSync(script.sourceFile, 'utf8');
    const sourceMap = inlineSourceMap(source);
    if (!Array.isArray(sourceMap?.sources) || !sourceMap.sources.some(sourcePath => normalizedCoveragePath(sourcePath))) continue;
    const converter = coverageTools.v8ToIstanbul(script.url, 0, {
      source,
      sourceMap: { sourcemap: sourceMap },
    });
    await converter.load();
    converter.applyCoverage(script.coverage?.functions ?? []);
    convertedMap.merge(converter.toIstanbul());
    convertedScripts.push({
      url: script.url,
      sourceLength: script.sourceLength,
      functionCount: script.coverage?.functions?.length ?? 0,
      occurrences: script.occurrences,
      segmentCount: script.segments.size,
    });
  } catch (error) {
    conversionErrors.push({ url: script.url, message: error.message, stack: error.stack });
  }
}

fs.writeFileSync(path.join(manifest.outputDirectory, 'v8-scripts.json'), `${JSON.stringify(convertedScripts, null, 2)}\n`);
fs.writeFileSync(path.join(manifest.outputDirectory, 'conversion-errors.json'), `${JSON.stringify(conversionErrors, null, 2)}\n`);

const browserMap = scopedCoverageMap(convertedMap, coverageTools);
const browserSummary = writeCoverageMap(browserMap, path.join(manifest.outputDirectory, 'browser'), coverageTools);

const collectUnitTestCoverage = manifest.collectUnitTestCoverage ?? manifest.mergeUnitTestCoverage ?? false;
const unitTestCoverageAvailable = Boolean(manifest.unitTestCoverageFile && fs.existsSync(manifest.unitTestCoverageFile));
let unitTestMap = coverageTools.coverage.createCoverageMap({});
let unitTestSummary;
let unitTestCoverageError;
if (collectUnitTestCoverage && unitTestCoverageAvailable) {
  try {
    const rawUnitTestMap = coverageTools.coverage.createCoverageMap(JSON.parse(fs.readFileSync(manifest.unitTestCoverageFile, 'utf8')));
    unitTestMap = scopedCoverageMap(rawUnitTestMap, coverageTools);
    unitTestSummary = writeCoverageMap(unitTestMap, path.join(manifest.outputDirectory, 'vitest'), coverageTools);
  } catch (error) {
    unitTestCoverageError = { message: error.message, stack: error.stack };
  }
}

let coverageCombination = combineIndependentCoverageMaps(browserMap.toJSON(), unitTestMap.toJSON());
if (conversionErrors.length > 0) {
  coverageCombination = {
    ...coverageCombination,
    status: 'unavailable',
    coverage: null,
    reasonCode: 'browser-source-map-conversion-failed',
  };
} else if (!collectUnitTestCoverage) {
  coverageCombination = {
    ...coverageCombination,
    reasonCode: 'vitest-source-coverage-not-collected',
  };
} else if (!unitTestCoverageAvailable) {
  coverageCombination = {
    ...coverageCombination,
    reasonCode: 'vitest-source-coverage-unavailable',
  };
} else if (unitTestCoverageError) {
  coverageCombination = {
    ...coverageCombination,
    reasonCode: 'vitest-source-coverage-malformed',
  };
}

function relativeSourcePath(file) {
  return path.relative(manifest.appDir, file).replaceAll('\\', '/');
}

function componentThresholds(component, source) {
  return component.thresholds?.[source] ?? component.thresholds;
}

function componentReport(component, source, coverageMap) {
  const componentMap = coverageMapForComponent(coverageMap, component.prefix, coverageTools);
  const coveredFiles = new Set(componentMap.files().map(file => path.resolve(file)));
  return {
    id: component.id,
    prefix: component.prefix,
    applicable: component.sourceFiles.length > 0,
    sourceFiles: component.sourceFiles.map(relativeSourcePath),
    missingFiles: component.sourceFiles.filter(file => !coveredFiles.has(path.resolve(file))).map(relativeSourcePath),
    thresholds: componentThresholds(component, source),
    summary: coverageSummary(componentMap),
  };
}

const workflowOptions =
  manifest.workflow ?
    {
      workflowComplete: manifest.workflow.complete === true,
      incompleteReasons: manifest.workflow.reasons ?? [],
      declaredOperations: manifest.declaredOperations ?? [],
    }
  : { declaredOperations: manifest.declaredOperations ?? [] };
const browserComponents = (manifest.components ?? []).map(component => componentReport(component, 'browser', browserMap));
const vitestComponents = (manifest.components ?? []).map(component => componentReport(component, 'vitest', unitTestMap));
const { status: browserEvidenceStatus, reasonCode: browserEvidenceReasonCode } = classifyBrowserSourceCoverageEvidence({
  conversionErrorCount: conversionErrors.length,
  mappedFileCount: browserMap.files().length,
});
const browserCoverageGate = evaluateSourceCoverageThresholds(browserComponents, {
  ...workflowOptions,
  source: 'browser',
  evidenceStatus: browserEvidenceStatus,
  evidenceReasonCode: browserEvidenceReasonCode,
  evidence: {
    conversionErrorCount: conversionErrors.length,
    incompatibleFiles: coverageCombination.incompatibleFiles?.map(relativeSourcePath) ?? [],
  },
});
let vitestEvidenceStatus = 'available';
let vitestEvidenceReasonCode;
if (!collectUnitTestCoverage) {
  vitestEvidenceStatus = 'not-collected';
  vitestEvidenceReasonCode = 'vitest-source-coverage-not-collected';
} else if (unitTestCoverageError) {
  vitestEvidenceStatus = 'malformed';
  vitestEvidenceReasonCode = 'vitest-source-coverage-malformed';
} else if (!unitTestCoverageAvailable || unitTestMap.files().length === 0) {
  vitestEvidenceStatus = 'unavailable';
  vitestEvidenceReasonCode = 'vitest-source-coverage-unavailable';
}
const vitestCoverageGate = evaluateSourceCoverageThresholds(vitestComponents, {
  ...workflowOptions,
  source: 'vitest',
  evidenceStatus: vitestEvidenceStatus,
  evidenceReasonCode: vitestEvidenceReasonCode,
  evidence: {
    requestedCoverageFile: manifest.unitTestCoverageFile,
    error: unitTestCoverageError ?? null,
  },
});

const expectedFiles = [...new Set((manifest.components ?? []).flatMap(component => component.sourceFiles.map(relativeSourcePath)))].sort();
const browserFiles = browserMap.files().map(relativeSourcePath).sort();
const vitestFiles = unitTestMap.files().map(relativeSourcePath).sort();
const browserMissingFiles = [...new Set(browserComponents.flatMap(component => component.missingFiles))].sort();
const vitestMissingFiles = [...new Set(vitestComponents.flatMap(component => component.missingFiles))].sort();
const browserReport = buildSourceCoverageMetricReport({
  source: 'browser',
  status: browserEvidenceStatus,
  summary: browserSummary,
  evidenceFiles: {
    coverageMap: 'browser/coverage-final.json',
    lcov: 'browser/lcov.info',
    summary: 'browser/coverage-summary.json',
    convertedScripts: 'v8-scripts.json',
    conversionErrors: 'conversion-errors.json',
  },
  expectedFiles,
  instrumentedFiles: browserFiles,
  missingFiles: browserMissingFiles,
  thresholds: manifest.browserThresholds ?? manifest.components?.[0]?.thresholds?.browser ?? manifest.components?.[0]?.thresholds,
  coverageGate: browserCoverageGate,
  reasonCode: browserEvidenceReasonCode,
  evidence: {
    convertedScriptCount: convertedScripts.length,
    conversionErrorCount: conversionErrors.length,
  },
});
const vitestReport = buildSourceCoverageMetricReport({
  source: 'vitest',
  status: vitestEvidenceStatus,
  summary: unitTestSummary ?? null,
  evidenceFiles: {
    inputCoverageMap: manifest.unitTestCoverageFile,
    scopedCoverageMap: unitTestSummary ? 'vitest/coverage-final.json' : null,
    lcov: unitTestSummary ? 'vitest/lcov.info' : null,
    summary: unitTestSummary ? 'vitest/coverage-summary.json' : null,
  },
  expectedFiles,
  instrumentedFiles: vitestFiles,
  missingFiles: vitestMissingFiles,
  thresholds: manifest.vitestThresholds ?? manifest.components?.[0]?.thresholds?.vitest ?? manifest.components?.[0]?.thresholds,
  coverageGate: vitestCoverageGate,
  reasonCode: vitestEvidenceReasonCode,
  evidence: {
    requested: collectUnitTestCoverage,
    inputAvailable: unitTestCoverageAvailable,
    error: unitTestCoverageError ?? null,
  },
});
const sourceCoverageGate = evaluateIndependentSourceCoverageGates(
  { browser: browserReport, vitest: vitestReport },
  { vitestRequired: collectUnitTestCoverage },
);

let compatibleUnionSummary;
let compatibleUnionFiles = [];
if (coverageCombination.status === 'available') {
  const compatibleUnionMap = coverageTools.coverage.createCoverageMap(coverageCombination.coverage);
  compatibleUnionSummary = writeCoverageMap(compatibleUnionMap, path.join(manifest.outputDirectory, 'compatible-union'), coverageTools);
  compatibleUnionFiles = compatibleUnionMap.files().map(relativeSourcePath).sort();
}
const compatibleUnionReport = {
  metricLabel: SOURCE_COVERAGE_METRIC_LABELS.compatibleUnion,
  status: coverageCombination.status,
  sources: coverageCombination.sources,
  evidenceFiles:
    coverageCombination.status === 'available' ?
      {
        coverageMap: 'compatible-union/coverage-final.json',
        lcov: 'compatible-union/lcov.info',
        summary: 'compatible-union/coverage-summary.json',
      }
    : null,
  denominator:
    coverageCombination.status === 'available' ?
      {
        kind: 'compatible-instrumentation-union',
        fileCount: compatibleUnionFiles.length,
        files: compatibleUnionFiles,
        metrics: {
          lines: compatibleUnionSummary.lines.total,
          statements: compatibleUnionSummary.statements.total,
          functions: compatibleUnionSummary.functions.total,
          branches: compatibleUnionSummary.branches.total,
        },
      }
    : null,
  summary: compatibleUnionSummary ?? null,
  ...(coverageCombination.reasonCode ? { reasonCode: coverageCombination.reasonCode } : {}),
  instrumentationEvidence: {
    files: coverageCombination.files.map(file => ({
      ...file,
      file: relativeSourcePath(file.file),
    })),
    incompatibleFiles: coverageCombination.incompatibleFiles?.map(relativeSourcePath) ?? [],
  },
};

const workerReport = {
  workflow: manifest.workflow,
  browser: browserReport,
  vitest: vitestReport,
  compatibleUnion: compatibleUnionReport,
  coverageGate: sourceCoverageGate,
  convertedScriptCount: convertedScripts.length,
  conversionErrorCount: conversionErrors.length,
};
fs.writeFileSync(manifest.resultFile, `${JSON.stringify(workerReport, null, 2)}\n`);

if (sourceCoverageGate.passed === false) {
  const thresholdFailures = sourceCoverageGate.failures
    .flatMap(({ source, gate }) =>
      gate.failures.map(failure =>
        failure.metric === 'workflow' || failure.metric === 'evidence' || failure.reasonCode ?
          `${source}:${failure.component}:${failure.reasonCode}`
        : `${source}:${failure.component}:${failure.metric} ${failure.actual}<${failure.minimum}`,
      ),
    )
    .join(', ');
  throw new Error(`source coverage gate failed: ${thresholdFailures}`);
}
