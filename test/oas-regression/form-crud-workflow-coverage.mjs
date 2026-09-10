function unique(values) {
  return [...new Set(values ?? [])].sort();
}

export function resourceWorkflowCoverage(coverage) {
  const plannedUpdateResourceKeys = unique(coverage.plannedUpdateResourceKeys);
  const successfulUpdateResourceKeys = new Set(unique(coverage.successfulUpdateResourceKeys));
  const plannedDeleteResourceKeys = unique(coverage.plannedDeleteResourceKeys);
  const successfulDeleteResourceKeys = new Set(unique(coverage.successfulDeleteResourceKeys));
  return {
    plannedUpdateResourceKeys,
    successfulUpdateResourceKeys: [...successfulUpdateResourceKeys].sort(),
    missingUpdateResourceKeys: plannedUpdateResourceKeys.filter(key => !successfulUpdateResourceKeys.has(key)),
    plannedDeleteResourceKeys,
    successfulDeleteResourceKeys: [...successfulDeleteResourceKeys].sort(),
    missingDeleteResourceKeys: plannedDeleteResourceKeys.filter(key => !successfulDeleteResourceKeys.has(key)),
  };
}

export function hasRequiredResourceWorkflowCoverage(coverage) {
  const summary = resourceWorkflowCoverage(coverage);
  return summary.missingUpdateResourceKeys.length === 0 && summary.missingDeleteResourceKeys.length === 0;
}

export function requiredWorkflowCompletion({
  reachedCoverageGate = false,
  declaredOperationIds = [],
  renderedOperationIds = [],
  terminalOperationIds = [],
  requireTerminalResults = true,
  resourceCoverage = {},
  requireResourceCoverage = true,
} = {}) {
  const declared = unique(declaredOperationIds);
  const rendered = new Set(unique(renderedOperationIds));
  const terminal = new Set(unique(terminalOperationIds));
  const missingRenderedOperationIds = declared.filter(operationId => !rendered.has(operationId));
  const missingTerminalOperationIds = requireTerminalResults ? declared.filter(operationId => !terminal.has(operationId)) : [];
  const resources = resourceWorkflowCoverage(resourceCoverage);
  const reasons = [];

  if (!reachedCoverageGate) reasons.push({ reasonCode: 'workflow-stopped-before-coverage-gate' });
  if (declared.length === 0) reasons.push({ reasonCode: 'operation-discovery-incomplete' });
  if (missingRenderedOperationIds.length > 0) {
    reasons.push({ reasonCode: 'operation-render-coverage-incomplete', operationIds: missingRenderedOperationIds });
  }
  if (missingTerminalOperationIds.length > 0) {
    reasons.push({ reasonCode: 'operation-terminal-coverage-incomplete', operationIds: missingTerminalOperationIds });
  }
  if (requireResourceCoverage && resources.missingUpdateResourceKeys.length > 0) {
    reasons.push({ reasonCode: 'resource-update-coverage-incomplete', resourceKeys: resources.missingUpdateResourceKeys });
  }
  if (requireResourceCoverage && resources.missingDeleteResourceKeys.length > 0) {
    reasons.push({ reasonCode: 'resource-delete-coverage-incomplete', resourceKeys: resources.missingDeleteResourceKeys });
  }

  const complete = reasons.length === 0;
  return {
    status: complete ? 'complete' : 'incomplete',
    complete,
    thresholdEvaluationEligible: complete,
    reachedCoverageGate,
    reasons,
    routeCoverage: {
      declaredOperationIds: declared,
      renderedOperationIds: [...rendered].sort(),
      terminalOperationIds: [...terminal].sort(),
      missingRenderedOperationIds,
      missingTerminalOperationIds,
    },
    resourceCoverage: resources,
  };
}
