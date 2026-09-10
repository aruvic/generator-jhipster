const METRICS = ['lines', 'statements', 'functions', 'branches'];

export function evaluateSourceCoverageThresholds(components, { workflowComplete = true, incompleteReasons = [] } = {}) {
  const failures = [];
  const evaluated = [];
  for (const component of components ?? []) {
    if (!component.applicable) {
      evaluated.push({ ...component, passed: true, failures: [] });
      continue;
    }
    const componentFailures = [];
    for (const file of component.missingFiles ?? []) {
      componentFailures.push({ metric: 'files', actual: 0, minimum: 1, file });
    }
    for (const metric of METRICS) {
      const minimum = Number(component.thresholds?.[metric]);
      const actual = Number(component.summary?.[metric]?.pct);
      if (Number.isFinite(minimum) && (!Number.isFinite(actual) || actual < minimum)) {
        componentFailures.push({ metric, actual: Number.isFinite(actual) ? actual : 0, minimum });
      }
    }
    failures.push(...componentFailures.map(failure => ({ component: component.id, ...failure })));
    evaluated.push({ ...component, passed: componentFailures.length === 0, failures: componentFailures });
  }
  if (!workflowComplete) {
    return {
      status: 'not-evaluated',
      evaluated: false,
      passed: null,
      reasonCode: 'incomplete-workflow-evidence',
      incompleteReasons,
      failures: [],
      observedShortfalls: failures,
      components: evaluated.map(component => ({
        ...component,
        evaluated: false,
        passed: null,
        observedShortfalls: component.failures,
        failures: [],
      })),
    };
  }
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    evaluated: true,
    passed: failures.length === 0,
    incompleteReasons: [],
    failures,
    components: evaluated.map(component => ({ ...component, evaluated: true })),
  };
}
