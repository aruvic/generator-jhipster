const STRUCTURAL_KINDS = new Set(['array', 'object']);

function clone(value) {
  if (value === undefined || value === null) return value;
  return structuredClone(value);
}

function keySegments(key) {
  if (key === undefined || key === null || key === '') return [];
  return (Array.isArray(key) ? key : String(key).split('.')).map(segment => String(segment));
}

function normalizedPath(path) {
  return (path ?? []).map(segment => (/^\d+$/.test(String(segment)) ? '[]' : String(segment)));
}

function pathKey(path) {
  return normalizedPath(path).join('.');
}

function schemaFieldPath(field, parentPath) {
  const declaredPath = normalizedPath(field?.path);
  if (declaredPath.length > 0) return declaredPath;
  if (!field?.name || (parentPath.length === 0 && field.name === 'body')) return parentPath;
  return [...parentPath, field.name];
}

function flattenSchemaFields(fields, parentPath = [], output = []) {
  for (const field of fields ?? []) {
    const path = schemaFieldPath(field, parentPath);
    if (path.length > 0) output.push({ field, path, key: pathKey(path) });
    if (field.fields?.length) flattenSchemaFields(field.fields, path, output);
    if (field.items?.fields?.length) flattenSchemaFields(field.items.fields, [...path, '[]'], output);
  }
  return output;
}

function flattenFormlyFields(fields, parentPath = [], accordionDepth = 0, output = []) {
  for (const field of fields ?? []) {
    const path = [...parentPath, ...keySegments(field?.key)];
    const wrappers = Array.isArray(field?.wrappers) ? field.wrappers : [];
    const nextAccordionDepth = accordionDepth + (wrappers.includes('form-crud-accordion') ? 1 : 0);
    output.push({ field, path: path[0] === 'body' ? path.slice(1) : path, accordionDepth: nextAccordionDepth });
    if (Array.isArray(field?.fieldGroup)) {
      flattenFormlyFields(field.fieldGroup, path, nextAccordionDepth, output);
    }
  }
  return output;
}

function valueAtPath(value, path) {
  let current = value;
  for (const segment of path ?? []) {
    if (current === undefined || current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

function hasConcreteParent(value, path) {
  const parent = valueAtPath(value, path.slice(0, -1));
  return parent !== null && typeof parent === 'object';
}

function formlyControlKind(formlyField) {
  if (formlyField?.type === 'select') return 'select';
  if (formlyField?.type === 'checkbox') return 'checkbox';
  if (formlyField?.type === 'textarea') return 'textarea';
  if (formlyField?.type === 'input') return `input:${formlyField.props?.type ?? 'text'}`;
  return undefined;
}

function isUsableControl(entry, formBody) {
  const kind = formlyControlKind(entry.field);
  if (!kind || entry.field?.props?.disabled) return false;
  if (kind === 'input:file') return false;
  return valueAtPath(formBody, entry.path) !== undefined;
}

function optionalDescendantCount(schemaEntries, entry) {
  const prefix = `${entry.key}.`;
  return schemaEntries.filter(candidate => candidate.key.startsWith(prefix) && !candidate.field.required && !candidate.field.readOnly)
    .length;
}

function entryOccurrence(entries, target) {
  const targetLabel = normalizedControlName(target.field?.props?.label);
  const targetKey = normalizedControlName(target.path.at(-1));
  return entries.slice(0, entries.indexOf(target)).filter(candidate => {
    const candidateLabel = normalizedControlName(candidate.field?.props?.label);
    const candidateKey = normalizedControlName(candidate.path.at(-1));
    return targetLabel ? candidateLabel === targetLabel : targetKey && candidateKey === targetKey;
  }).length;
}

function formlyControlIdentity(entry) {
  const kind = formlyControlKind(entry.field);
  const label = normalizedControlName(entry.field?.props?.label);
  const key = normalizedControlName(entry.path.at(-1));
  if (!kind || (!label && !key)) return undefined;
  return {
    path: normalizedPath(entry.path),
    kind,
    matchBy: label ? 'accessibleName' : 'name',
    value: label || key,
  };
}

function sameControlIdentity(left, right) {
  return left?.kind === right?.kind && left?.matchBy === right?.matchBy && left?.value === right?.value;
}

function plannedControlIdentity(controls, target) {
  const identity = formlyControlIdentity(target);
  if (!identity) return undefined;
  return {
    ...identity,
    ordinal: controls
      .slice(0, controls.indexOf(target))
      .filter(candidate => sameControlIdentity(formlyControlIdentity(candidate), identity)).length,
  };
}

function patternAllowsEmptyString(pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern).test('');
  } catch {
    return false;
  }
}

function allowsIntentionalEmptyString(field, kind) {
  if (field.type !== 'string' || (!kind?.startsWith('input:') && kind !== 'textarea')) return false;
  if (field.format || Number(field.minLength) > 0 || Number(field.maxLength) < 0) return false;
  if (field.enumValues?.length && !field.enumValues.includes('')) return false;
  if (field.discriminatorValues?.length && !field.discriminatorValues.includes('')) return false;
  return patternAllowsEmptyString(field.pattern);
}

function candidateKind(schemaField, formlyField) {
  if (schemaField.type === 'array') return 'array';
  if (schemaField.type === 'object') return 'object';
  return formlyControlKind(formlyField);
}

function evenlySample(values, count) {
  if (count <= 0) return [];
  if (values.length <= count) return [...values];
  return Array.from({ length: count }, (_, index) => values[Math.floor((index * values.length) / count)]);
}

function actionIdentity(action) {
  return `${action.kind}:${action.schemaPath.join('.')}`;
}

function chooseActions(candidates, budget, maxArrayAdditions, maxNestedObjects) {
  if (budget <= 0) return [];
  const selected = [];
  const selectedIds = new Set();
  const selectedCounts = { array: 0, object: 0 };
  const canSelect = candidate => {
    if (selectedIds.has(actionIdentity(candidate))) return false;
    if (candidate.kind === 'array' && selectedCounts.array >= maxArrayAdditions) return false;
    if (candidate.kind === 'object' && selectedCounts.object >= maxNestedObjects) return false;
    return true;
  };
  const select = candidate => {
    if (!candidate || selected.length >= budget || !canSelect(candidate)) return false;
    selected.push(candidate);
    selectedIds.add(actionIdentity(candidate));
    if (candidate.kind === 'array' || candidate.kind === 'object') selectedCounts[candidate.kind] += 1;
    return true;
  };

  const kinds = [...new Set(candidates.map(candidate => candidate.kind))].sort();
  for (const kind of kinds) {
    select(candidates.find(candidate => candidate.kind === kind));
  }

  const scalarCandidates = candidates.filter(candidate => !STRUCTURAL_KINDS.has(candidate.kind) && canSelect(candidate));
  for (const candidate of evenlySample(scalarCandidates, budget - selected.length)) select(candidate);

  const structuralCandidates = candidates
    .filter(candidate => STRUCTURAL_KINDS.has(candidate.kind) && canSelect(candidate))
    .sort(
      (left, right) =>
        left.optionalDescendants - right.optionalDescendants ||
        left.kind.localeCompare(right.kind) ||
        left.schemaPath.join('.').localeCompare(right.schemaPath.join('.')),
    );
  for (const candidate of structuralCandidates) select(candidate);

  return selected;
}

export function planOptionalFormExercises(
  formlyFields,
  schemaFields,
  submittedBody,
  formBody,
  { budget = 48, maxArrayAdditions = 8, maxNestedObjects = 8, excludedActions = [] } = {},
) {
  const schemaEntries = flattenSchemaFields(schemaFields);
  const schemaByPath = new Map(schemaEntries.map(entry => [entry.key, entry]));
  const formEntries = flattenFormlyFields(formlyFields).filter(entry => entry.path.length > 0);
  const identityControls = formEntries.filter(entry => formlyControlKind(entry.field));
  const controls = identityControls.filter(entry => isUsableControl(entry, formBody));
  const excludedActionIds = new Set(excludedActions.map(actionIdentity));
  const arrays = formEntries.filter(entry => entry.field?.type === 'form-crud-repeat' || entry.field?.fieldArray);
  const candidates = [];

  for (const formEntry of formEntries) {
    const schemaEntry = schemaByPath.get(pathKey(formEntry.path));
    if (
      !schemaEntry ||
      schemaEntry.field.required ||
      schemaEntry.field.readOnly ||
      valueAtPath(submittedBody, formEntry.path) !== undefined ||
      !hasConcreteParent(submittedBody, formEntry.path)
    ) {
      continue;
    }

    const kind = candidateKind(schemaEntry.field, formEntry.field);
    if (kind === 'array' && (formEntry.field?.type === 'form-crud-repeat' || formEntry.field?.fieldArray)) {
      candidates.push({
        kind,
        schemaPath: schemaEntry.path,
        valuePath: formEntry.path,
        label: String(formEntry.field?.props?.label ?? schemaEntry.field.name ?? ''),
        accordionDepth: formEntry.accordionDepth,
        arrayOccurrence: entryOccurrence(arrays, formEntry),
        optionalDescendants: optionalDescendantCount(schemaEntries, schemaEntry),
      });
      continue;
    }

    if (kind === 'object') {
      const control = controls.find(
        candidate =>
          candidate.path.length > formEntry.path.length &&
          formEntry.path.every((segment, index) => segment === candidate.path[index]) &&
          candidate.field?.props?.disabled !== true,
      );
      if (!control) continue;
      const controlIdentity = plannedControlIdentity(identityControls, control);
      candidates.push({
        kind,
        schemaPath: schemaEntry.path,
        valuePath: formEntry.path,
        controlPath: control.path,
        controlKind: formlyControlKind(control.field),
        accordionDepth: control.accordionDepth,
        controlIdentity,
        controlOccurrence: controlIdentity?.ordinal,
        key: String(control.path.at(-1) ?? ''),
        label: String(control.field?.props?.label ?? control.path.at(-1) ?? ''),
        optionalDescendants: optionalDescendantCount(schemaEntries, schemaEntry),
      });
      continue;
    }

    if (!kind || STRUCTURAL_KINDS.has(kind) || !isUsableControl(formEntry, formBody)) continue;
    const controlIdentity = plannedControlIdentity(identityControls, formEntry);
    const rawValue = valueAtPath(formBody, formEntry.path);
    candidates.push({
      kind,
      schemaPath: schemaEntry.path,
      valuePath: formEntry.path,
      controlPath: formEntry.path,
      controlKind: kind,
      accordionDepth: formEntry.accordionDepth,
      controlIdentity,
      controlOccurrence: controlIdentity?.ordinal,
      key: String(formEntry.path.at(-1) ?? ''),
      label: String(formEntry.field?.props?.label ?? schemaEntry.field.name ?? ''),
      ...(rawValue === '' && allowsIntentionalEmptyString(schemaEntry.field, kind) ? { intentionalValue: '' } : {}),
      optionalDescendants: 0,
    });
  }

  candidates.sort(
    (left, right) => left.schemaPath.join('.').localeCompare(right.schemaPath.join('.')) || left.kind.localeCompare(right.kind),
  );
  const availableCandidates = candidates.filter(candidate => !excludedActionIds.has(actionIdentity(candidate)));
  const actions = chooseActions(
    availableCandidates,
    Math.max(0, Math.floor(budget)),
    Math.max(0, Math.floor(maxArrayAdditions)),
    Math.max(0, Math.floor(maxNestedObjects)),
  );
  return {
    actions,
    budget: Math.max(0, Math.floor(budget)),
    candidateCount: availableCandidates.length,
    truncated: actions.length < availableCandidates.length,
  };
}

function normalizedControlName(value) {
  return String(value ?? '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function controlKindMatches(actionKind, control) {
  const tagName = String(control?.tagName ?? '').toLowerCase();
  const inputType = String(control?.type ?? '').toLowerCase();
  if (actionKind === 'select') return tagName === 'select';
  if (actionKind === 'checkbox') return tagName === 'input' && inputType === 'checkbox';
  if (actionKind === 'textarea') return tagName === 'textarea';
  if (actionKind?.startsWith('input:')) return tagName === 'input' && inputType === actionKind.slice('input:'.length);
  return ['input', 'select', 'textarea'].includes(tagName);
}

export function matchOptionalFormExerciseControls(actions, controls) {
  return (actions ?? []).map(action => {
    if (!action.controlPath) return action;
    const fallbackLabel = normalizedControlName(action.label);
    const fallbackKey = normalizedControlName(action.key);
    const identity = action.controlIdentity ?? {
      kind: action.controlKind,
      matchBy: fallbackLabel ? 'accessibleName' : 'name',
      value: fallbackLabel || fallbackKey,
      ordinal: action.controlOccurrence ?? 0,
    };
    const matchingIndexes = (controls ?? [])
      .map((_, index) => index)
      .filter(index => {
        const control = controls[index];
        if (!controlKindMatches(identity.kind, control)) return false;
        return normalizedControlName(control?.[identity.matchBy]) === identity.value;
      });
    const controlIndex = matchingIndexes[identity.ordinal ?? 0];
    const control = controls?.[controlIndex];
    if (controlIndex === undefined || !control?.visible || control.disabled) return { ...action, controlIndex: undefined };
    return { ...action, controlIndex };
  });
}

export async function interactWithOptionalFormControl(action, control, readFormValid) {
  const original = await control.evaluate(element => ({
    tagName: element.tagName.toLowerCase(),
    type: element.tagName === 'INPUT' && 'type' in element ? element.type : '',
    value: 'value' in element ? String(element.value ?? '') : '',
    checked: element.tagName === 'INPUT' && 'type' in element && element.type === 'checkbox' ? element.checked : undefined,
  }));

  if (original.tagName === 'select') {
    if (!original.value) return { interacted: false, reasonCode: 'empty-generated-value' };
    await control.evaluate(element => {
      element.selectedIndex = -1;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await control.selectOption(original.value);
  } else if (original.type === 'checkbox') {
    await control.click();
    await control.click();
  } else if (!original.value) {
    if (action.intentionalValue !== '') return { interacted: false, reasonCode: 'empty-generated-value' };
    await control.fill(' ');
    await control.fill('');
  } else {
    await control.fill('');
    await control.fill(original.value);
  }
  await control.blur();

  const browserValid = await control.evaluate(element => !('checkValidity' in element) || element.checkValidity());
  const formValid = await readFormValid();
  return {
    interacted: browserValid && formValid,
    reasonCode: browserValid && formValid ? undefined : 'interaction-invalidated-form',
    original,
  };
}

function scalarValue(field, rawValue) {
  if (field.type === 'object' && typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch {
      return undefined;
    }
  }
  if (field.type === 'integer') {
    const parsed = typeof rawValue === 'number' ? Math.trunc(rawValue) : Number.parseInt(String(rawValue), 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (field.type === 'number') {
    const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (field.type === 'boolean') return rawValue === true || rawValue === 'true';
  if (field.type === 'string' && field.format === 'date-time' && typeof rawValue === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(rawValue)) return `${rawValue}${rawValue.length === 16 ? ':00' : ''}Z`;
  }
  return clone(rawValue);
}

function minimumSchemaValue(field, source, selectedPaths = [], force = false) {
  if (field.readOnly) return undefined;
  if (field.type === 'object') {
    if (!field.fields?.length) return undefined;
    const sourceObject = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const output = {};
    for (const child of field.fields) {
      if (child.readOnly) continue;
      const childSelections = selectedPaths.filter(path => path[0] === child.name).map(path => path.slice(1));
      if (!child.required && childSelections.length === 0) continue;
      const value = minimumSchemaValue(child, sourceObject[child.name], childSelections, child.required);
      if (value === undefined) return undefined;
      output[child.name] = value;
    }
    return output;
  }
  if (field.type === 'array') {
    const sourceArray = Array.isArray(source) ? source : [];
    const selectedIndexes = selectedPaths
      .map(path => (/^\d+$/.test(String(path[0])) ? Number(path[0]) : undefined))
      .filter(index => index !== undefined);
    const minimumItems = Math.max(Number(field.minItems) || 0, field.required || force ? 1 : 0);
    const targetCount = Math.max(minimumItems, selectedIndexes.length ? Math.max(...selectedIndexes) + 1 : 0);
    if (!field.items) return undefined;
    const output = Array.from({ length: targetCount }, (_, index) => {
      const itemSelections = selectedPaths.filter(path => Number(path[0]) === index).map(path => path.slice(1));
      return minimumSchemaValue(field.items, sourceArray[index], itemSelections, true);
    });
    return output.some(item => item === undefined) ? undefined : output;
  }
  const value = scalarValue(field, source);
  if (value !== undefined) return value;
  if (field.example !== undefined) return scalarValue(field, field.example);
  if (field.defaultValue !== undefined) return scalarValue(field, field.defaultValue);
  if (field.discriminatorValues?.length) return field.discriminatorValues[0];
  if (field.enumValues?.length) return field.enumValues[0];
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') {
    const minimum = Number(field.minimum);
    return Number.isFinite(minimum) ? minimum : 1;
  }
  if (field.format === 'date') return '2026-01-01';
  if (field.format === 'date-time') return '2026-01-01T00:00:00Z';
  if (field.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (field.format === 'email') return 'browser@example.invalid';
  if (field.format === 'uri' || field.format === 'url') return 'https://example.invalid/resource';
  const minimumLength = Math.max(Number(field.minLength) || 1, 1);
  const maximumLength = Number(field.maxLength);
  return 'x'.repeat(Number.isFinite(maximumLength) ? Math.min(minimumLength, maximumLength) : minimumLength);
}

function setValueAtPath(target, path, value) {
  if (path.length === 0) return clone(value);
  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextIsIndex = /^\d+$/.test(String(path[index + 1]));
    if (current[segment] === undefined || current[segment] === null || typeof current[segment] !== 'object') {
      current[segment] = nextIsIndex ? [] : {};
    }
    current = current[segment];
  }
  current[path.at(-1)] = clone(value);
  return target;
}

export function mergeOptionalFormExerciseValues(baseBody, formBody, schemaFields, actions) {
  let output = clone(baseBody);
  if (output === undefined || output === null || typeof output !== 'object') output = {};
  const schemaByPath = new Map(flattenSchemaFields(schemaFields).map(entry => [entry.key, entry.field]));

  for (const action of actions ?? []) {
    const field = schemaByPath.get(pathKey(action.schemaPath));
    if (!field) continue;
    const source = valueAtPath(formBody, action.valuePath);
    let value;
    if (action.kind === 'object') {
      value = minimumSchemaValue(field, source, [action.controlPath.slice(action.valuePath.length)], true);
    } else if (action.kind === 'array') {
      value = minimumSchemaValue(field, source, [], true);
    } else {
      value =
        action.intentionalValue !== undefined ?
          clone(action.intentionalValue)
        : scalarValue(field, valueAtPath(formBody, action.controlPath));
    }
    if (value !== undefined) output = setValueAtPath(output, action.valuePath, value);
  }

  return output;
}
