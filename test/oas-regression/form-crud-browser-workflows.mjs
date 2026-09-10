function schemaFieldExample(field, depth = 0) {
  if (!field || depth > 12) return undefined;
  if (field.example !== undefined) return structuredClone(field.example);
  if (field.defaultValue !== undefined) return structuredClone(field.defaultValue);
  if (field.discriminatorValues?.length) return field.discriminatorValues[0];
  if (field.enumValues?.length) return field.enumValues[0];
  if (field.type === 'object') {
    const output = {};
    for (const child of field.fields ?? []) {
      const value = schemaFieldExample(child, depth + 1);
      if (value !== undefined) output[child.name] = value;
    }
    if (Object.keys(output).length === 0 && field.additionalProperties) {
      const value = schemaFieldExample(field.additionalProperties, depth + 1);
      if (value !== undefined) output.key = value;
    }
    return output;
  }
  if (field.type === 'array') {
    const item = schemaFieldExample(field.items, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (field.type === 'boolean') return true;
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

export function responseBrowsingFixture(operation) {
  if (operation?.responseBodyExample !== undefined && operation.responseBodyExample !== null) {
    return structuredClone(operation.responseBodyExample);
  }
  const fields = operation?.responseBodyFields ?? [];
  if (fields.length === 1 && fields[0]?.path?.length === 0) return schemaFieldExample(fields[0]);
  if (fields.length === 0) return undefined;
  return Object.fromEntries(fields.map(field => [field.name, schemaFieldExample(field)]).filter(([, value]) => value !== undefined));
}

export function parameterCoverageValue(parameter) {
  const configured = parameter?.example ?? parameter?.defaultValue ?? parameter?.enumValues?.[0];
  if (configured !== undefined && configured !== null && String(configured) !== '') return String(configured);
  if (parameter?.pattern) return undefined;
  if (parameter?.format === 'date') return '2026-01-01';
  if (parameter?.format === 'date-time') return '2026-01-01T00:00';
  if (parameter?.format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  if (parameter?.type === 'integer' || parameter?.type === 'number') {
    const minimum = Number(parameter.minimum);
    return String(Number.isFinite(minimum) ? minimum : 1);
  }
  if (parameter?.type === 'boolean') return 'true';
  const minimumLength = Math.max(Number(parameter?.minLength) || 1, 1);
  const maximumLength = Number(parameter?.maxLength);
  return 'x'.repeat(Number.isFinite(maximumLength) ? Math.min(minimumLength, maximumLength) : minimumLength);
}
