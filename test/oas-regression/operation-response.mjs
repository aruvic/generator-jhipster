export function isDeclaredResponseStatus(responseStatusCodes, status) {
  const normalizedStatus = String(status);
  const statusClass = normalizedStatus.charAt(0);
  return (responseStatusCodes ?? []).some(code => {
    const normalizedCode = String(code).toUpperCase();
    return normalizedCode === normalizedStatus || normalizedCode === 'DEFAULT' || new RegExp(`^${statusClass}XX$`).test(normalizedCode);
  });
}

export function classifyOperationResponse(
  responseStatusCodes,
  status,
  { expectation = 'happy-path', expectedNegativeStatusCodes = [] } = {},
) {
  if (status >= 200 && status < 300) {
    return expectation === 'expected-negative' ? 'unexpected-failure' : 'success-2xx';
  }
  if (
    expectation === 'expected-negative' &&
    status < 500 &&
    isDeclaredResponseStatus(responseStatusCodes, status) &&
    isDeclaredResponseStatus(expectedNegativeStatusCodes, status)
  ) {
    return 'expected-negative';
  }
  return 'unexpected-failure';
}

export function classifyOperationPreparationFailure(preparation) {
  return preparation?.unexecutable === true || preparation?.workflowBlocked === true ? 'unexecutable' : 'harness-error';
}
