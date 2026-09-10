export function exclusiveMinimum(schema) {
  if (typeof schema?.exclusiveMinimum === 'number') return schema.exclusiveMinimum;
  return schema?.exclusiveMinimum === true && typeof schema.minimum === 'number' ? schema.minimum : undefined;
}

export function exclusiveMaximum(schema) {
  if (typeof schema?.exclusiveMaximum === 'number') return schema.exclusiveMaximum;
  return schema?.exclusiveMaximum === true && typeof schema.maximum === 'number' ? schema.maximum : undefined;
}

function validFormat(value, format) {
  if (format === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  }
  if (format === 'date-time') {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  if (format === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (format === 'hostname') {
    return (
      value.length <= 253 &&
      value
        .split('.')
        .every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    );
  }
  if (format === 'uri' || format === 'url') {
    try {
      return Boolean(new URL(value).protocol);
    } catch {
      return false;
    }
  }
  if (format === 'byte') return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  return true;
}

export function validateScalarConstraints(value, schema, pointer = '') {
  const errors = [];
  if (typeof value === 'number') {
    const minimum = exclusiveMinimum(schema);
    const maximum = exclusiveMaximum(schema);
    if (minimum !== undefined && value <= minimum) errors.push(`${pointer} expected > ${minimum}`);
    if (maximum !== undefined && value >= maximum) errors.push(`${pointer} expected < ${maximum}`);
  }
  if (typeof value === 'string' && schema?.format && !validFormat(value, schema.format)) {
    errors.push(`${pointer} expected format ${schema.format}`);
  }
  return errors;
}
