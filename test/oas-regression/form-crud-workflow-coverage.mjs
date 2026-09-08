export function hasRequiredResourceWorkflowCoverage(coverage) {
  return (
    coverage.successfulUpdateResources >= coverage.plannedUpdateResources &&
    coverage.successfulDeleteResources === coverage.plannedDeleteResources
  );
}
