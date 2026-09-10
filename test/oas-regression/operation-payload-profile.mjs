function pointerSegments(pointer) {
  if (!String(pointer).startsWith('/')) throw new Error(`Profile JSON pointer must start with "/": ${pointer}`);
  return String(pointer)
    .slice(1)
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function applyDefault(target, pointer, value) {
  const segments = pointerSegments(pointer);
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (Array.isArray(current)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) throw new Error(`Invalid array index in profile pointer: ${pointer}`);
      current[arrayIndex] ??= /^\d+$/.test(nextSegment) ? [] : {};
      current = current[arrayIndex];
    } else {
      current[segment] ??= /^\d+$/.test(nextSegment) ? [] : {};
      current = current[segment];
    }
  }
  const leaf = segments.at(-1);
  if (Array.isArray(current)) {
    const arrayIndex = Number(leaf);
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0) throw new Error(`Invalid array index in profile pointer: ${pointer}`);
    if (current[arrayIndex] === undefined || current[arrayIndex] === null || current[arrayIndex] === '') {
      current[arrayIndex] = structuredClone(value);
    }
  } else if (current[leaf] === undefined || current[leaf] === null || current[leaf] === '') {
    current[leaf] = structuredClone(value);
  }
}

export function applyOperationPayloadProfile(payload, method, operationPath, profiles = []) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const output = structuredClone(payload);
  for (const profile of profiles) {
    if (String(profile.method).toUpperCase() !== String(method).toUpperCase() || profile.path !== operationPath) continue;
    for (const defaultValue of profile.defaults ?? []) applyDefault(output, defaultValue.pointer, defaultValue.value);
  }
  return output;
}
