export async function waitForFormCrudOperationReady(page, operationId, timeout) {
  await page.locator('[data-cy="formCrud"]').waitFor({ state: 'visible', timeout });
  await page.waitForFunction(expectedOperationId => window.__formsDebug?.formCrud?.()?.operationId === expectedOperationId, operationId, {
    timeout,
  });
  return page.evaluate(() => window.__formsDebug.formCrud());
}
