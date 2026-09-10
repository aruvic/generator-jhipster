export async function captureResponseForAction(page, predicate, action, { timeout, label }) {
  const actionRequests = new Set();
  let actionStarted = false;
  let actionStartedAt = Number.POSITIVE_INFINITY;
  const rememberActionRequest = request => {
    if (actionStarted) actionRequests.add(request);
  };
  page.on('request', rememberActionRequest);
  const responsePromise = page.waitForResponse(
    response => {
      const request = response.request();
      const requestStart = Number(request.timing?.()?.startTime);
      return actionRequests.has(request) && (!Number.isFinite(requestStart) || requestStart >= actionStartedAt) && predicate(response);
    },
    { timeout },
  );
  try {
    actionStartedAt = Date.now();
    actionStarted = true;
    const [response] = await Promise.all([responsePromise, action()]);
    return response;
  } catch (error) {
    throw new Error(`Unable to capture ${label} response while performing the browser action: ${error.message}`, { cause: error });
  } finally {
    page.off('request', rememberActionRequest);
  }
}

export async function captureResponseBodyForAction(page, predicate, action, options) {
  let bodyPromise;
  const response = await captureResponseForAction(
    page,
    candidate => {
      if (!predicate(candidate)) return false;
      try {
        bodyPromise = Promise.resolve(candidate.body());
      } catch (error) {
        bodyPromise = Promise.reject(error);
      }
      void bodyPromise.catch(() => {});
      return true;
    },
    action,
    options,
  );

  try {
    return { response, body: await bodyPromise };
  } catch (error) {
    throw new Error(`Unable to read ${options.label} response body while performing the browser action: ${error.message}`, {
      cause: error,
    });
  }
}
