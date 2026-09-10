const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function hasRequiredWritableScalar(fields, parentRequired = true) {
  return (fields ?? []).some(field => {
    const required = parentRequired && field.required === true && field.readOnly !== true;
    if (!required) return false;
    if (field.type === 'object') return hasRequiredWritableScalar(field.fields, true);
    if (field.type === 'array') return false;
    return field.type !== 'boolean' && field.format !== 'binary';
  });
}

export function requiredBodyValidationApplicability(operation) {
  const method = String(operation?.method ?? '').toUpperCase();
  if (!MUTATION_METHODS.has(method)) {
    return { applicable: false, reasonCode: 'non-mutation-method' };
  }
  if (operation?.requestBodyRequired !== true) {
    return { applicable: false, reasonCode: 'request-body-optional' };
  }
  if (!hasRequiredWritableScalar(operation?.requestBodyFields)) {
    return { applicable: false, reasonCode: 'no-required-writable-scalar-body-field' };
  }
  return { applicable: true };
}

export function accessibilityIssues(controls) {
  const issues = [];
  for (const control of controls ?? []) {
    if (!control.visible || control.disabled) continue;
    if (!control.accessibleName) {
      issues.push({
        control: control.identifier,
        reasonCode: 'missing-accessible-name',
      });
    }
    if (control.required && !control.requiredExposed) {
      issues.push({
        control: control.identifier,
        reasonCode: 'required-state-not-exposed',
      });
    }
  }
  return issues;
}

function fieldPath(parentPath, key) {
  if (key === undefined || key === null || key === '') return parentPath;
  const segments = Array.isArray(key) ? key : String(key).split('.');
  return [...parentPath, ...segments.map(segment => String(segment))];
}

function normalizedControlName(value) {
  return String(value ?? '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function requiredFormlyControls(fields, parentPath = []) {
  const controls = [];
  for (const field of fields ?? []) {
    const path = fieldPath(parentPath, field?.key);
    const type = typeof field?.type === 'string' ? field.type : '';
    const rendersControl = ['input', 'select', 'textarea'].includes(type) && !Array.isArray(field?.fieldGroup) && !field?.fieldArray;
    if (field?.props?.required && !field.props.disabled && rendersControl) {
      controls.push({
        identifier: path.join('.') || String(field.props.label ?? type),
        key: path.at(-1) ?? '',
        accessibleName: String(field.props.label ?? ''),
      });
    }
    if (Array.isArray(field?.fieldGroup)) {
      controls.push(...requiredFormlyControls(field.fieldGroup, path));
    }
  }
  return controls;
}

function controlMatchesField(control, field) {
  const accessibleName = normalizedControlName(control.accessibleName);
  const expectedName = normalizedControlName(field.accessibleName);
  if (accessibleName && expectedName && accessibleName === expectedName) return true;
  return Boolean(control.name && field.key && String(control.name) === String(field.key));
}

export function requiredFormlyControlIssues(fields, controls) {
  const requiredFields = requiredFormlyControls(fields);
  const availableControls = (controls ?? []).map((control, index) => ({ control, index }));
  const issues = [];

  for (const field of requiredFields) {
    const matchingControl = ({ control }) =>
      control.visible &&
      !control.disabled &&
      ['input', 'select', 'textarea'].includes(String(control.elementType ?? '').toLowerCase()) &&
      controlMatchesField(control, field);
    const matchIndex = availableControls.findIndex(candidate => matchingControl(candidate) && candidate.control.requiredExposed);
    const fallbackMatchIndex = availableControls.findIndex(matchingControl);
    const selectedMatchIndex = matchIndex >= 0 ? matchIndex : fallbackMatchIndex;
    if (selectedMatchIndex < 0) {
      issues.push({
        control: field.identifier,
        reasonCode: 'required-control-not-rendered',
        expectedAccessibleName: field.accessibleName,
      });
      continue;
    }

    const [{ control }] = availableControls.splice(selectedMatchIndex, 1);
    if (!control.requiredExposed) {
      issues.push({
        control: field.identifier,
        reasonCode: 'required-state-not-exposed',
        actualControl: control.identifier,
      });
    }
  }

  return issues;
}

async function accordionState(buttons) {
  const count = await buttons.count();
  let collapsed = 0;
  for (let index = 0; index < count; index += 1) {
    if (
      await buttons
        .nth(index)
        .evaluate(element => element.getAttribute('aria-expanded') === 'false' || element.classList.contains('collapsed'))
    ) {
      collapsed += 1;
    }
  }
  return { count, collapsed };
}

export async function expandAllNestedAccordions(root, { settleMs = 50, maxPasses = 1000 } = {}) {
  const buttons = root.locator('button.accordion-button');
  let state = await accordionState(buttons);
  let observed = state.count;
  let expanded = 0;

  for (let pass = 0; state.collapsed > 0 && pass < maxPasses; pass += 1) {
    let clicked = 0;
    for (let index = 0; index < state.count; index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible())) continue;
      const collapsed = await button.evaluate(
        element => element.getAttribute('aria-expanded') === 'false' || element.classList.contains('collapsed'),
      );
      if (!collapsed) continue;
      await button.click();
      clicked += 1;
      expanded += 1;
      if (settleMs > 0) await button.page().waitForTimeout(settleMs);
    }

    const nextState = await accordionState(buttons);
    observed = Math.max(observed, nextState.count);
    if (nextState.collapsed === 0) return { observed, expanded };
    if (clicked === 0 || (nextState.count <= state.count && nextState.collapsed >= state.collapsed)) {
      throw new Error(`Unable to expand ${nextState.collapsed} nested accordion(s)`);
    }
    state = nextState;
  }

  if (state.collapsed > 0) throw new Error(`Unable to expand ${state.collapsed} nested accordion(s) after ${maxPasses} passes`);
  return { observed, expanded };
}

export function requiredValidationResult(observation) {
  if (!observation) return { applicable: false, passed: true };
  const passed = observation.browserInvalid && observation.submitDisabled;
  return {
    applicable: true,
    passed,
    reasonCode: passed ? undefined : 'required-validation-not-enforced',
    ...observation,
  };
}
