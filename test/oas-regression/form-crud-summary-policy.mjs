#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { SCHEMA_COVERAGE_METRIC_LABELS } from './operation-schema-coverage.mjs';
import { SOURCE_COVERAGE_METRIC_LABELS } from './source-coverage-policy.mjs';

const RATIO_DEFINITIONS = {
  createSuccessRatio: ['coverage.successfulCreateResources', 'coverage.plannedCreateResources'],
  listExerciseRatio: ['coverage.exercisedListResources', 'coverage.plannedListResources'],
  updateSuccessRatio: ['coverage.successfulUpdateResources', 'coverage.exercisedUpdateResources'],
  deleteSuccessRatio: ['coverage.successfulDeleteResources', 'coverage.exercisedDeleteResources'],
  referencePickerSaveSuccessRatio: ['coverage.successfulReferencePickerSaves', 'coverage.exercisedReferencePickerSaves'],
  operationRenderCoverageRatio: ['coverage.renderedOperations', 'coverage.declaredOperations'],
  apiOperationsPageRenderCoverageRatio: ['coverage.apiOperationsPageRenderedOperations', 'coverage.declaredOperations'],
  apiOperationsPageSubmissionCoverageRatio: [
    'coverage.apiOperationsPageSubmittedOperations',
    'coverage.apiOperationsPageApplicableOperations',
  ],
  apiOperationsPage2xxSuccessRatio: ['coverage.apiOperationsPage2xxSuccesses', 'coverage.apiOperationsPageApplicableOperations'],
  apiOperationsPageTerminalResultRatio: ['coverage.apiOperationsPageTerminalResults', 'coverage.apiOperationsPageApplicableOperations'],
  apiOperationsPageRoundTripSuccessRatio: [
    'coverage.apiOperationsPageSuccessfulRoundTripChecks',
    'coverage.apiOperationsPageRoundTripChecks',
  ],
  schemaObservedInstanceCoverageRatio: [
    'coverage.schemaFields.observedInstanceCoverage.covered',
    'coverage.schemaFields.observedInstanceCoverage.denominator',
  ],
  schemaContractCompletenessRatio: [
    'coverage.schemaFields.contractCompleteness.covered',
    'coverage.schemaFields.contractCompleteness.denominator',
  ],
};

const LEGACY_SCHEMA_SUMMARY_PROPERTIES = [
  'totalApplicableSchemaFields',
  'totalCoveredSchemaFields',
  'totalUnavailableSchemaFields',
  'totalExcludedSchemaFields',
  'schemaFieldCoverageRatio',
];
const LEGACY_SOURCE_COVERAGE_SUMMARY_PROPERTIES = [
  'totalCombinedSourceLines',
  'totalCoveredCombinedSourceLines',
  'totalCombinedSourceBranches',
  'totalCoveredCombinedSourceBranches',
  'combinedSourceLineCoverageRatio',
  'combinedSourceBranchCoverageRatio',
];
const SOURCE_COVERAGE_METRICS = ['lines', 'statements', 'functions', 'branches'];
const OPERATION_ERROR_EVENT_CLASSES = ['frontend-console', 'page-error', 'request-failure', 'http-response'];

function valueAtPath(value, propertyPath) {
  const resolved = propertyPath.split('.').reduce((current, property) => current?.[property], value);
  if (resolved === undefined && propertyPath === 'coverage.apiOperationsPageApplicableOperations') {
    return value.coverage?.declaredOperations;
  }
  return resolved;
}

function sum(runs, propertyPath) {
  return runs.reduce((total, run) => total + (Number(valueAtPath(run, propertyPath)) || 0), 0);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function withoutLegacySchemaSummaryProperties(summary) {
  const output = { ...(summary ?? {}) };
  for (const property of LEGACY_SCHEMA_SUMMARY_PROPERTIES) delete output[property];
  for (const property of LEGACY_SOURCE_COVERAGE_SUMMARY_PROPERTIES) delete output[property];
  return output;
}

function aggregateCoverageSummary(runs, source) {
  const summaries = runs.map(run => run.sourceCoverage?.[source]?.summary);
  if (summaries.some(summary => !summary)) return null;
  return {
    files: summaries.reduce((total, summary) => total + (Number(summary.files) || 0), 0),
    ...Object.fromEntries(
      SOURCE_COVERAGE_METRICS.map(metric => {
        const total = summaries.reduce((sumValue, summary) => sumValue + (Number(summary[metric]?.total) || 0), 0);
        const covered = summaries.reduce((sumValue, summary) => sumValue + (Number(summary[metric]?.covered) || 0), 0);
        const skipped = summaries.reduce((sumValue, summary) => sumValue + (Number(summary[metric]?.skipped) || 0), 0);
        return [
          metric,
          {
            total,
            covered,
            skipped,
            pct: total === 0 ? null : (covered / total) * 100,
          },
        ];
      }),
    ),
  };
}

function artifactSourceCoverageGate(run, source) {
  if (source === 'aggregate') return run.sourceCoverage?.coverageGate ?? null;
  return run.sourceCoverage?.[source]?.coverageGate ?? null;
}

function aggregateSourceCoverageGate(runs, source) {
  const artifactGates = runs.map(run => ({
    artifact: run.artifact,
    gate: artifactSourceCoverageGate(run, source),
  }));
  const failed = artifactGates.filter(({ gate }) => gate?.passed === false);
  const passed = artifactGates.filter(({ gate }) => gate?.passed === true);
  const unknown = artifactGates.filter(({ gate }) => gate?.passed !== true && gate?.passed !== false);
  let status = 'passed';
  if (artifactGates.length === 0) status = 'unavailable';
  else if (failed.length > 0) status = 'failed';
  else if (unknown.length > 0) status = 'unknown';
  let gatePassed = null;
  if (status === 'passed') gatePassed = true;
  else if (status === 'failed') gatePassed = false;
  return {
    metricLabel: source === 'aggregate' ? SOURCE_COVERAGE_METRIC_LABELS.aggregateGate : SOURCE_COVERAGE_METRIC_LABELS[source],
    source,
    status,
    evaluated: status === 'passed' || status === 'failed',
    passed: gatePassed,
    artifactCount: artifactGates.length,
    passedArtifacts: passed.length,
    failedArtifacts: failed.length,
    unknownArtifacts: unknown.length,
    failures: failed.map(({ artifact, gate }) => ({ artifact, failures: gate.failures ?? [], reasonCode: gate.reasonCode })),
    unknown: unknown.map(({ artifact, gate }) => ({ artifact, status: gate?.status ?? 'unavailable', reasonCode: gate?.reasonCode })),
  };
}

function aggregateSourceCoverageMetric(completeRuns, allRuns, source) {
  const artifactMetrics = completeRuns.map(run => ({
    artifact: run.artifact,
    metric: run.sourceCoverage?.[source] ?? null,
  }));
  const available = artifactMetrics.filter(({ metric }) => metric?.status === 'available' && metric.summary);
  let status = 'unavailable';
  if (artifactMetrics.length > 0 && available.length === artifactMetrics.length) status = 'available';
  else if (available.length > 0) status = 'partial';
  const summary = status === 'available' ? aggregateCoverageSummary(completeRuns, source) : null;
  return {
    metricLabel: SOURCE_COVERAGE_METRIC_LABELS[source],
    source,
    status,
    evidenceFiles: artifactMetrics.map(({ artifact, metric }) => ({
      artifact,
      status: metric?.status ?? 'unavailable',
      files: metric?.evidenceFiles ?? null,
      reasonCode: metric?.reasonCode,
    })),
    denominator:
      summary ?
        {
          kind: 'sum-of-independent-artifact-denominators',
          artifactCount: artifactMetrics.length,
          metrics: Object.fromEntries(SOURCE_COVERAGE_METRICS.map(metric => [metric, summary[metric].total])),
        }
      : null,
    thresholds: artifactMetrics.map(({ artifact, metric }) => ({ artifact, thresholds: metric?.thresholds ?? null })),
    summary,
    coverageGate: aggregateSourceCoverageGate(allRuns, source),
    ...(status !== 'available' ?
      {
        reasonCode: 'one-or-more-artifact-source-coverage-metrics-unavailable',
        unavailableArtifacts: artifactMetrics
          .filter(({ metric }) => metric?.status !== 'available' || !metric.summary)
          .map(({ artifact, metric }) => ({
            artifact,
            status: metric?.status ?? 'unavailable',
            reasonCode: metric?.reasonCode ?? 'source-coverage-report-unavailable',
          })),
      }
    : {}),
  };
}

function aggregateCompatibleUnion(completeRuns) {
  const artifacts = completeRuns.map(run => ({
    artifact: run.artifact,
    metric: run.sourceCoverage?.compatibleUnion ?? null,
  }));
  const available = artifacts.length > 0 && artifacts.every(({ metric }) => metric?.status === 'available' && metric.summary);
  const summary = available ? aggregateCoverageSummary(completeRuns, 'compatibleUnion') : null;
  return {
    metricLabel: SOURCE_COVERAGE_METRIC_LABELS.compatibleUnion,
    status: available ? 'available' : 'unavailable',
    evidenceFiles: artifacts.map(({ artifact, metric }) => ({
      artifact,
      status: metric?.status ?? 'unavailable',
      files: metric?.evidenceFiles ?? null,
      reasonCode: metric?.reasonCode,
    })),
    denominator:
      summary ?
        {
          kind: 'sum-of-compatible-instrumentation-union-denominators',
          artifactCount: artifacts.length,
          metrics: Object.fromEntries(SOURCE_COVERAGE_METRICS.map(metric => [metric, summary[metric].total])),
        }
      : null,
    summary,
    ...(available ?
      {}
    : {
        reasonCode: 'one-or-more-artifact-compatible-unions-unavailable',
        unavailableArtifacts: artifacts
          .filter(({ metric }) => metric?.status !== 'available' || !metric.summary)
          .map(({ artifact, metric }) => ({
            artifact,
            status: metric?.status ?? 'unavailable',
            reasonCode: metric?.reasonCode ?? 'compatible-union-report-unavailable',
          })),
      }),
  };
}

function aggregateObservedInstanceCoverage(runs) {
  const denominator = sum(runs, 'coverage.schemaFields.observedInstanceCoverage.denominator');
  const covered = sum(runs, 'coverage.schemaFields.observedInstanceCoverage.covered');
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.observedInstanceCoverage,
    denominator,
    covered,
    notCovered: sum(runs, 'coverage.schemaFields.observedInstanceCoverage.notCovered'),
    absentObservations: sum(runs, 'coverage.schemaFields.observedInstanceCoverage.absentObservations'),
    coverageRatio: ratio(covered, denominator),
  };
}

function aggregateContractCompleteness(runs) {
  const denominator = sum(runs, 'coverage.schemaFields.contractCompleteness.denominator');
  const covered = sum(runs, 'coverage.schemaFields.contractCompleteness.covered');
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.contractCompleteness,
    denominator,
    covered,
    uncovered: sum(runs, 'coverage.schemaFields.contractCompleteness.uncovered'),
    unknown: sum(runs, 'coverage.schemaFields.contractCompleteness.unknown'),
    notApplicableWithEvidence: sum(runs, 'coverage.schemaFields.contractCompleteness.notApplicableWithEvidence'),
    excluded: sum(runs, 'coverage.schemaFields.contractCompleteness.excluded'),
    completenessRatio: ratio(covered, denominator),
    complete: denominator > 0 && covered === denominator,
  };
}

function artifactSchemaEnterpriseGate(run) {
  return (
    run.coverage?.schemaFieldGate ?? {
      metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.enterpriseGate,
      status: run.workflow?.complete === true ? 'unavailable' : 'not-evaluated',
      evaluated: false,
      passed: null,
      reasonCode: 'schema-contract-enterprise-gate-unavailable',
    }
  );
}

function aggregateSchemaEnterpriseGate(runs) {
  const artifactGates = runs.map(run => ({ artifact: run.artifact, gate: artifactSchemaEnterpriseGate(run) }));
  const failed = artifactGates.filter(({ gate }) => gate.passed === false);
  const passed = artifactGates.filter(({ gate }) => gate.passed === true);
  const notApplicable = artifactGates.filter(({ gate }) => gate.status === 'not-applicable-with-evidence');
  const notEvaluated = artifactGates.filter(({ gate }) => gate.passed === null && gate.status !== 'not-applicable-with-evidence');
  let status = 'not-applicable-with-evidence';
  if (artifactGates.length === 0) status = 'unavailable';
  else if (failed.length > 0) status = 'failed';
  else if (notEvaluated.length > 0) status = 'not-evaluated';
  else if (passed.length > 0) status = 'passed';
  let gatePassed = null;
  if (status === 'passed') gatePassed = true;
  else if (status === 'failed') gatePassed = false;
  return {
    metricLabel: SCHEMA_COVERAGE_METRIC_LABELS.enterpriseGate,
    status,
    evaluated: status === 'passed' || status === 'failed',
    passed: gatePassed,
    artifactCount: artifactGates.length,
    passedArtifacts: passed.length,
    failedArtifacts: failed.length,
    notApplicableWithEvidenceArtifacts: notApplicable.length,
    notEvaluatedArtifacts: notEvaluated.length,
    failures: failed.map(({ artifact, gate }) => ({ artifact, failures: gate.failures ?? [] })),
  };
}

function aggregateOperationErrorAttribution(runs) {
  const artifacts = runs.map(run => ({
    artifact: run.artifact,
    report: run.operationErrorAttribution ?? run.browser?.operationErrorAttribution ?? null,
    reportFile: run.operationErrorAttributionReportFile ?? run.browser?.operationErrorAttributionReportFile ?? null,
  }));
  const available = artifacts.filter(({ report }) => report !== null);
  const failed = available.filter(({ report }) => report.enterpriseGate?.status === 'failed');
  let status = 'partial';
  if (available.length === 0) status = 'unavailable';
  else if (available.length === artifacts.length) status = 'available';
  return {
    metricLabel: 'form-crud-operation-error-attribution',
    status,
    artifactCount: artifacts.length,
    availableArtifactCount: available.length,
    eventClassCounts: Object.fromEntries(
      OPERATION_ERROR_EVENT_CLASSES.map(classification => [
        classification,
        available.reduce((total, { report }) => total + (Number(report.counts?.[classification]) || 0), 0),
      ]),
    ),
    attributedExpectedNegative: available.reduce(
      (total, { report }) => total + (Number(report.counts?.attributedExpectedNegative) || 0),
      0,
    ),
    attributedPostDelete: available.reduce((total, { report }) => total + (Number(report.counts?.attributedPostDelete) || 0), 0),
    unmatchedAuthenticatedHttp: available.reduce((total, { report }) => total + (Number(report.counts?.unmatchedAuthenticated) || 0), 0),
    ambiguousAuthenticatedHttp: available.reduce((total, { report }) => total + (Number(report.counts?.ambiguousAuthenticated) || 0), 0),
    enterpriseGate: {
      metricLabel: 'authenticated-target-http-error-attribution',
      status: failed.length > 0 ? 'failed' : 'passed',
      failedArtifacts: failed.length,
    },
    artifacts: artifacts.map(({ artifact, report, reportFile }) => ({
      artifact,
      status: report ? 'available' : 'unavailable',
      counts: report?.counts ?? null,
      enterpriseGate: report?.enterpriseGate ?? null,
      reportFile,
    })),
  };
}

function incompleteEvidence(run) {
  return {
    artifact: run.artifact,
    status: run.status,
    error: run.error?.message ?? '',
    reasons: run.workflow?.reasons ?? [{ reasonCode: 'workflow-completion-report-unavailable' }],
    observedCoverage: {
      declaredOperations: run.coverage?.declaredOperations ?? 0,
      renderedOperations: run.coverage?.renderedOperations ?? 0,
      submittedOperations: run.coverage?.submittedOperations ?? 0,
      apiOperationsPageTerminalResults: run.coverage?.apiOperationsPageTerminalResults ?? 0,
      schemaFields: {
        observedInstanceCoverage: run.coverage?.schemaFields?.observedInstanceCoverage ?? null,
        contractCompleteness: run.coverage?.schemaFields?.contractCompleteness ?? null,
      },
    },
    schemaCoverageGate: run.coverage?.schemaFieldGate ?? null,
    sourceCoverageGate: run.sourceCoverage?.coverageGate ?? null,
  };
}

export function applyFormCrudSummaryCompletionPolicy(summary, runs) {
  const allRuns = runs ?? [];
  const completeRuns = allRuns.filter(run => run.workflow?.complete === true);
  const incompleteRuns = allRuns.filter(run => run.workflow?.complete !== true);
  const baseSummary = withoutLegacySchemaSummaryProperties(summary);
  const ratios = Object.fromEntries(
    Object.entries(RATIO_DEFINITIONS).map(([name, [numeratorPath, denominatorPath]]) => [
      name,
      ratio(sum(completeRuns, numeratorPath), sum(completeRuns, denominatorPath)),
    ]),
  );
  const runByArtifact = new Map(allRuns.map(run => [run.artifact, run]));
  let status = 'partial';
  if (allRuns.length === 0) status = 'unavailable';
  else if (incompleteRuns.length === 0) status = 'complete';
  else if (completeRuns.length === 0) status = 'incomplete';

  return {
    ...baseSummary,
    ...ratios,
    schemaCoverage: {
      observedInstanceCoverage: aggregateObservedInstanceCoverage(completeRuns),
      contractCompleteness: aggregateContractCompleteness(completeRuns),
      enterpriseGate: aggregateSchemaEnterpriseGate(allRuns),
    },
    sourceCoverage: {
      browser: aggregateSourceCoverageMetric(completeRuns, allRuns, 'browser'),
      vitest: aggregateSourceCoverageMetric(completeRuns, allRuns, 'vitest'),
      compatibleUnion: aggregateCompatibleUnion(completeRuns),
      coverageGate: aggregateSourceCoverageGate(allRuns, 'aggregate'),
    },
    operationErrorAttribution: aggregateOperationErrorAttribution(allRuns),
    coverageSemantics: {
      status,
      completeWorkflowRuns: completeRuns.length,
      incompleteWorkflowRuns: incompleteRuns.length,
      ratiosUseCompleteWorkflowRunsOnly: true,
      thresholdsRequireCompleteWorkflow: true,
      schemaMetricLabels: SCHEMA_COVERAGE_METRIC_LABELS,
      observedInstanceCoverageIsContractCompleteness: false,
      sourceCoverageMetricLabels: SOURCE_COVERAGE_METRIC_LABELS,
      browserAndVitestSourceCoverageAreIndependent: true,
      compatibleUnionRequiresMatchingInstrumentation: true,
    },
    incompleteEvidence: incompleteRuns.map(incompleteEvidence),
    artifacts: (summary?.artifacts ?? []).map(artifact => {
      const run = runByArtifact.get(artifact.artifact);
      const schemaCoverage =
        run ?
          {
            observedInstanceCoverage: run.coverage?.schemaFields?.observedInstanceCoverage ?? null,
            contractCompleteness: run.coverage?.schemaFields?.contractCompleteness ?? null,
            enterpriseGate: artifactSchemaEnterpriseGate(run),
          }
        : null;
      return {
        ...artifact,
        workflow: run?.workflow ?? {
          status: 'incomplete',
          complete: false,
          thresholdEvaluationEligible: false,
          reasons: [{ reasonCode: 'workflow-completion-report-unavailable' }],
        },
        schemaCoverage,
        sourceCoverage: run?.sourceCoverage ?? artifact.sourceCoverage ?? null,
        operationErrorAttribution: run?.operationErrorAttribution ?? run?.browser?.operationErrorAttribution ?? null,
        operationErrorAttributionReportFile:
          run?.operationErrorAttributionReportFile ?? run?.browser?.operationErrorAttributionReportFile ?? null,
      };
    }),
  };
}

function main() {
  const [summaryFile, ...runFiles] = process.argv.slice(2);
  if (!summaryFile) {
    process.stderr.write('Usage: form-crud-summary-policy.mjs <summary.json> [form-crud-run.json ...]\n');
    process.exitCode = 2;
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  const runs = runFiles.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const output = applyFormCrudSummaryCompletionPolicy(summary, runs);
  fs.writeFileSync(summaryFile, `${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
