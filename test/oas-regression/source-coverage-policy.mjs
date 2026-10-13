const METRICS = ['lines', 'statements', 'functions', 'branches'];
export const SOURCE_COVERAGE_METRIC_LABELS = Object.freeze({
  browser: 'browser-e2e-source-coverage',
  vitest: 'vitest-unit-source-coverage',
  compatibleUnion: 'compatible-instrumentation-union-source-coverage',
  aggregateGate: 'independent-source-coverage-gates',
});

export function classifyBrowserSourceCoverageEvidence({ conversionErrorCount = 0, mappedFileCount = 0 } = {}) {
  if (conversionErrorCount > 0) {
    return { status: 'malformed', reasonCode: 'browser-source-map-conversion-failed' };
  }
  if (mappedFileCount === 0) {
    return { status: 'unavailable', reasonCode: 'browser-source-coverage-unavailable' };
  }
  return { status: 'available' };
}

const OPERATION_CAPABILITIES = [
  { id: 'read', methods: ['GET'] },
  { id: 'create', methods: ['POST'] },
  { id: 'update', methods: ['PUT', 'PATCH'] },
  { id: 'delete', methods: ['DELETE'] },
];

export function operationCapabilityApplicability(operations = []) {
  const declaredOperations = operations
    .map(operation => ({
      operationId: String(operation.operationId ?? operation.id ?? ''),
      method: String(operation.method ?? '').toUpperCase(),
    }))
    .filter(operation => operation.operationId && operation.method);
  const declaredMethods = [...new Set(declaredOperations.map(operation => operation.method))].sort();
  const capabilities = OPERATION_CAPABILITIES.map(capability => {
    const operationIds = declaredOperations
      .filter(operation => capability.methods.includes(operation.method))
      .map(operation => operation.operationId);
    return {
      ...capability,
      applicable: operationIds.length > 0,
      operationIds,
      ...(operationIds.length === 0 ?
        {
          reasonCode: 'no-declared-operation-method',
          evidence: { declaredMethods },
        }
      : {}),
    };
  });
  return {
    sourceDenominator: 'all-generated-source',
    excludedSourceRanges: [],
    evidence: {
      declaredOperationCount: declaredOperations.length,
      declaredOperationIds: declaredOperations.map(operation => operation.operationId),
      declaredMethods,
    },
    capabilities,
    nonApplicableCapabilities: capabilities.filter(capability => !capability.applicable),
  };
}

export function evaluateSourceCoverageThresholds(
  components,
  {
    source = 'browser',
    workflowComplete = true,
    incompleteReasons = [],
    declaredOperations = [],
    evidenceStatus = 'available',
    evidenceReasonCode,
    evidence = {},
  } = {},
) {
  const capabilityApplicability = operationCapabilityApplicability(declaredOperations);
  const metricLabel = SOURCE_COVERAGE_METRIC_LABELS[source];
  if (!metricLabel) throw new Error(`Unsupported source coverage metric: ${source}`);
  if (evidenceStatus === 'not-collected') {
    return {
      metricLabel,
      source,
      status: 'not-evaluated',
      evaluated: false,
      passed: null,
      reasonCode: evidenceReasonCode ?? `${source}-source-coverage-not-collected`,
      failures: [],
      observedShortfalls: [],
      capabilityApplicability,
      components: (components ?? []).map(component => ({
        ...component,
        evaluated: false,
        passed: null,
        observedShortfalls: [],
        failures: [],
      })),
    };
  }
  if (evidenceStatus !== 'available') {
    const reasonCode = evidenceReasonCode ?? `${source}-source-coverage-evidence-${evidenceStatus}`;
    return {
      metricLabel,
      source,
      status: 'failed',
      evaluated: false,
      passed: false,
      reasonCode,
      failures: [
        {
          component: source,
          metric: 'evidence',
          actual: null,
          minimum: null,
          reasonCode,
          evidence,
        },
      ],
      observedShortfalls: [],
      capabilityApplicability,
      components: (components ?? []).map(component => ({
        ...component,
        evaluated: false,
        passed: null,
        observedShortfalls: [],
        failures: [],
      })),
    };
  }
  if (!workflowComplete) {
    return {
      metricLabel,
      source,
      status: 'failed',
      evaluated: false,
      passed: false,
      reasonCode: 'incomplete-workflow-evidence',
      incompleteReasons,
      failures: [
        {
          component: 'workflow',
          metric: 'workflow',
          actual: 0,
          minimum: 1,
          reasonCode: 'incomplete-workflow-evidence',
          evidence: incompleteReasons,
        },
      ],
      observedShortfalls: [],
      capabilityApplicability,
      components: (components ?? []).map(component => ({
        ...component,
        evaluated: false,
        passed: null,
        observedShortfalls: [],
        failures: [],
      })),
    };
  }

  const failures = [];
  const evaluated = [];
  for (const component of components ?? []) {
    if (!component.applicable) {
      evaluated.push({ ...component, passed: true, failures: [] });
      continue;
    }
    const componentFailures = [];
    for (const file of component.missingFiles ?? []) {
      componentFailures.push({
        metric: 'files',
        actual: 0,
        minimum: 1,
        file,
        reasonCode: `${source}-source-file-evidence-missing`,
      });
    }
    for (const metric of METRICS) {
      const minimum = Number(component.thresholds?.[metric]);
      if (!Number.isFinite(minimum) || minimum <= 0 || minimum > 100) {
        componentFailures.push({
          metric,
          actual: null,
          minimum: Number.isFinite(minimum) ? minimum : null,
          reasonCode: 'invalid-source-coverage-threshold',
        });
        continue;
      }
      const actual = Number(component.summary?.[metric]?.pct);
      if (!Number.isFinite(actual) || actual < minimum) {
        componentFailures.push({ metric, actual: Number.isFinite(actual) ? actual : 0, minimum });
      }
    }
    failures.push(...componentFailures.map(failure => ({ component: component.id, ...failure })));
    evaluated.push({ ...component, passed: componentFailures.length === 0, failures: componentFailures });
  }
  return {
    metricLabel,
    source,
    status: failures.length === 0 ? 'passed' : 'failed',
    evaluated: true,
    passed: failures.length === 0,
    incompleteReasons: [],
    failures,
    capabilityApplicability,
    components: evaluated.map(component => ({ ...component, evaluated: true })),
  };
}

function metricDenominators(summary) {
  return Object.fromEntries(METRICS.map(metric => [metric, summary?.[metric]?.total ?? null]));
}

export function buildSourceCoverageMetricReport({
  source,
  status,
  summary = null,
  evidenceFiles,
  expectedFiles,
  instrumentedFiles,
  missingFiles,
  thresholds,
  coverageGate,
  reasonCode,
  evidence,
}) {
  const metricLabel = SOURCE_COVERAGE_METRIC_LABELS[source];
  if (!metricLabel) throw new Error(`Unsupported source coverage metric: ${source}`);
  return {
    metricLabel,
    source,
    status,
    evidenceFiles,
    denominator: {
      kind: 'instrumented-source-elements-with-required-source-file-presence',
      expectedFileCount: expectedFiles.length,
      instrumentedFileCount: instrumentedFiles.length,
      missingFileCount: missingFiles.length,
      expectedFiles,
      instrumentedFiles,
      missingFiles,
      metrics: metricDenominators(summary),
    },
    thresholds,
    summary,
    coverageGate,
    ...(reasonCode ? { reasonCode } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

export function evaluateIndependentSourceCoverageGates(metrics, { vitestRequired = true } = {}) {
  const requiredSources = vitestRequired ? ['browser', 'vitest'] : ['browser'];
  const gates = Object.fromEntries(requiredSources.map(source => [source, metrics[source]?.coverageGate ?? null]));
  const failures = requiredSources.filter(source => gates[source]?.passed === false).map(source => ({ source, gate: gates[source] }));
  const unknown = requiredSources
    .filter(source => gates[source]?.passed !== true && gates[source]?.passed !== false)
    .map(source => ({ source, gate: gates[source] }));
  let status = 'passed';
  if (failures.length > 0) status = 'failed';
  else if (unknown.length > 0) status = 'unknown';
  let passed = null;
  if (status === 'passed') passed = true;
  else if (status === 'failed') passed = false;
  return {
    metricLabel: SOURCE_COVERAGE_METRIC_LABELS.aggregateGate,
    status,
    evaluated: status === 'passed' || status === 'failed',
    passed,
    requiredSources,
    gates,
    failures,
    unknown,
  };
}
