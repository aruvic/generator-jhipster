#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { evaluateSourceCoverageThresholds } from './source-coverage-policy.mjs';

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
if (browserMap.files().length === 0) {
  throw new Error('Playwright V8 coverage did not map any executable generated Form CRUD TypeScript sources');
}
const browserSummary = writeCoverageMap(browserMap, path.join(manifest.outputDirectory, 'browser'), coverageTools);

const combinedMap = coverageTools.coverage.createCoverageMap({});
let unitTestCoverageMerged = false;
const unitTestCoverageAvailable = fs.existsSync(manifest.unitTestCoverageFile);
let mergeError;
if (manifest.mergeUnitTestCoverage) {
  if (!unitTestCoverageAvailable) {
    mergeError = `Vitest coverage merge was requested but ${manifest.unitTestCoverageFile} is unavailable`;
  } else {
    const unitTestMap = coverageTools.coverage.createCoverageMap(JSON.parse(fs.readFileSync(manifest.unitTestCoverageFile, 'utf8')));
    combinedMap.merge(scopedCoverageMap(unitTestMap, coverageTools));
    unitTestCoverageMerged = true;
  }
}
combinedMap.merge(browserMap);
const combinedSummary = writeCoverageMap(combinedMap, path.join(manifest.outputDirectory, 'combined'), coverageTools);

function componentReport(component) {
  const browserComponentMap = coverageMapForComponent(browserMap, component.prefix, coverageTools);
  const combinedComponentMap = coverageMapForComponent(combinedMap, component.prefix, coverageTools);
  const combinedFiles = new Set(combinedComponentMap.files().map(file => path.resolve(file)));
  return {
    id: component.id,
    prefix: component.prefix,
    applicable: component.sourceFiles.length > 0,
    sourceFiles: component.sourceFiles.map(file => path.relative(manifest.appDir, file).replaceAll('\\', '/')),
    missingFiles: component.sourceFiles
      .filter(file => !combinedFiles.has(path.resolve(file)))
      .map(file => path.relative(manifest.appDir, file).replaceAll('\\', '/')),
    thresholds: component.thresholds,
    browser: coverageSummary(browserComponentMap),
    summary: coverageSummary(combinedComponentMap),
  };
}

const thresholdReport = evaluateSourceCoverageThresholds(
  (manifest.components ?? []).map(componentReport),
  manifest.workflow ?
    {
      workflowComplete: manifest.workflow.complete === true,
      incompleteReasons: manifest.workflow.reasons ?? [],
    }
  : undefined,
);
const workerReport = {
  workflow: manifest.workflow,
  browser: browserSummary,
  combined: combinedSummary,
  combinedSources: unitTestCoverageMerged ? ['browser', 'vitest'] : ['browser'],
  unitTestCoverageAvailable,
  unitTestCoverageMerged,
  coverageGate: thresholdReport,
  convertedScriptCount: convertedScripts.length,
  conversionErrorCount: conversionErrors.length,
  mergeError,
  // Temporary compatibility for existing report consumers.
  jestCoverageAvailable: unitTestCoverageAvailable,
  jestCoverageMerged: unitTestCoverageMerged,
};
fs.writeFileSync(manifest.resultFile, `${JSON.stringify(workerReport, null, 2)}\n`);

if (mergeError || (thresholdReport.evaluated && !thresholdReport.passed)) {
  const thresholdFailures = thresholdReport.failures
    .map(failure => `${failure.component}:${failure.metric} ${failure.actual}<${failure.minimum}`)
    .join(', ');
  throw new Error([mergeError, thresholdFailures && `source coverage thresholds failed: ${thresholdFailures}`].filter(Boolean).join('; '));
}
