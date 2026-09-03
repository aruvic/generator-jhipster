export function isDeclaredResponseStatus(responseStatusCodes, status) {
  const normalizedStatus = String(status);
  const statusClass = normalizedStatus.charAt(0);
  return (responseStatusCodes ?? []).some(code => {
    const normalizedCode = String(code).toUpperCase();
    return normalizedCode === normalizedStatus || normalizedCode === 'DEFAULT' || new RegExp(`^${statusClass}XX$`).test(normalizedCode);
  });
}

export function classifyOperationResponse(responseStatusCodes, status) {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500) return 'server-error';
  return isDeclaredResponseStatus(responseStatusCodes, status) ? 'declared-response' : 'unexpected-response';
}

export function classifyOperationPreparationFailure(preparation) {
  return preparation?.workflowBlocked === true ? 'workflow-blocked' : 'failed';
}
