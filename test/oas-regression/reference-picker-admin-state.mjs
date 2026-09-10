const semanticKeyFields = ['formId', 'targetApiId', 'sourcePath', 'collectionPath'];

function normalizedValue(value) {
  return String(value ?? '').trim();
}

export function referencePickerConfigIdentity(config) {
  const identity = normalizedValue(config?.id ?? config?.pickerId);
  return identity || undefined;
}

export function referencePickerConfigsShareSemanticKey(left, right) {
  return semanticKeyFields.every(field => normalizedValue(left?.[field]) === normalizedValue(right?.[field]));
}

export function findReferencePickerConfigBySemanticKey(configs, expected) {
  return Array.isArray(configs) ? configs.find(candidate => referencePickerConfigsShareSemanticKey(candidate, expected)) : undefined;
}

export function findReferencePickerConfig(configs, expected) {
  if (!Array.isArray(configs)) return undefined;
  const expectedIdentity = referencePickerConfigIdentity(expected);
  if (expectedIdentity) {
    return configs.find(candidate => referencePickerConfigIdentity(candidate) === expectedIdentity);
  }
  return findReferencePickerConfigBySemanticKey(configs, expected);
}

export function requireReferencePickerConfig(configs, expected, phase) {
  const found = findReferencePickerConfig(configs, expected);
  if (found) return found;
  const identity = referencePickerConfigIdentity(expected);
  const key = semanticKeyFields.map(field => `${field}=${normalizedValue(expected?.[field])}`).join(', ');
  throw new Error(`Reference picker configuration ${identity ? `identity ${identity}` : `semantic key (${key})`} was not ${phase}`);
}
