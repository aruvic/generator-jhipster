#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RATIO_DEFINITIONS = {
  createSuccessRatio: ['coverage.successfulCreateResources', 'coverage.plannedCreateResources'],
  listExerciseRatio: ['coverage.exercisedListResources', 'coverage.plannedListResources'],
  updateSuccessRatio: ['coverage.successfulUpdateResources', 'coverage.exercisedUpdateResources'],
  deleteSuccessRatio: ['coverage.successfulDeleteResources', 'coverage.exercisedDeleteResources'],
  referencePickerSaveSuccessRatio: ['coverage.successfulReferencePickerSaves', 'coverage.exercisedReferencePickerSaves'],
  operationRenderCoverageRatio: ['coverage.renderedOperations', 'coverage.declaredOperations'],
  apiOperationsPageRenderCoverageRatio: ['coverage.apiOperationsPageRenderedOperations', 'coverage.declaredOperations'],
  apiOperationsPageSubmissionCoverageRatio: ['coverage.apiOperationsPageSubmittedOperations', 'coverage.declaredOperations'],
  apiOperationsPage2xxSuccessRatio: ['coverage.apiOperationsPage2xxSuccesses', 'coverage.declaredOperations'],
  apiOperationsPageTerminalResultRatio: ['coverage.apiOperationsPageTerminalResults', 'coverage.declaredOperations'],
  apiOperationsPageRoundTripSuccessRatio: [
    'coverage.apiOperationsPageSuccessfulRoundTripChecks',
    'coverage.apiOperationsPageRoundTripChecks',
  ],
  schemaFieldCoverageRatio: ['coverage.schemaFields.covered', 'coverage.schemaFields.applicable'],
  combinedSourceLineCoverageRatio: ['sourceCoverage.combined.lines.covered', 'sourceCoverage.combined.lines.total'],
  combinedSourceBranchCoverageRatio: ['sourceCoverage.combined.branches.covered', 'sourceCoverage.combined.branches.total'],
};

function valueAtPath(value, propertyPath) {
  return propertyPath.split('.').reduce((current, property) => current?.[property], value);
}

function sum(runs, propertyPath) {
  return runs.reduce((total, run) => total + (Number(valueAtPath(run, propertyPath)) || 0), 0);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
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
        applicable: run.coverage?.schemaFields?.applicable ?? 0,
        covered: run.coverage?.schemaFields?.covered ?? 0,
        unavailable: run.coverage?.schemaFields?.unavailable ?? 0,
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
  const ratios = Object.fromEntries(
    Object.entries(RATIO_DEFINITIONS).map(([name, [numeratorPath, denominatorPath]]) => [
      name,
      ratio(sum(completeRuns, numeratorPath), sum(completeRuns, denominatorPath)),
    ]),
  );
  const runByArtifact = new Map(allRuns.map(run => [run.artifact, run]));
  const status =
    allRuns.length === 0 ? 'unavailable'
    : incompleteRuns.length === 0 ? 'complete'
    : completeRuns.length === 0 ? 'incomplete'
    : 'partial';

  return {
    ...summary,
    ...ratios,
    coverageSemantics: {
      status,
      completeWorkflowRuns: completeRuns.length,
      incompleteWorkflowRuns: incompleteRuns.length,
      ratiosUseCompleteWorkflowRunsOnly: true,
      thresholdsRequireCompleteWorkflow: true,
    },
    incompleteEvidence: incompleteRuns.map(incompleteEvidence),
    artifacts: (summary?.artifacts ?? []).map(artifact => ({
      ...artifact,
      workflow: runByArtifact.get(artifact.artifact)?.workflow ?? {
        status: 'incomplete',
        complete: false,
        thresholdEvaluationEligible: false,
        reasons: [{ reasonCode: 'workflow-completion-report-unavailable' }],
      },
    })),
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
