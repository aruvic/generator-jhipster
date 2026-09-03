function normalizedPayloadName(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toLowerCase();
}

export function operationPayloadNames(operation) {
  return [
    ...new Set(
      [operation?.id, operation?.operationId, `${operation?.method ?? ''}-${operation?.operationId ?? ''}`]
        .filter(Boolean)
        .map(normalizedPayloadName),
    ),
  ].sort((left, right) => right.length - left.length);
}

export function payloadFileMatchScore(file, operation) {
  const stem = normalizedPayloadName(file.replace(/\.json$/i, '')).replace(/^\d+/, '');
  const names = operationPayloadNames(operation);
  if (names.includes(stem)) return 1_000_000 + stem.length;

  return names.reduce((best, name) => {
    if (!name) return best;
    if (stem.endsWith(name)) return Math.max(best, 10_000 + name.length - (stem.length - name.length));
    if (name.endsWith(stem)) return Math.max(best, 1_000 + stem.length - (name.length - stem.length));
    if (stem.includes(name)) return Math.max(best, 100 + name.length - (stem.length - name.length));
    if (name.includes(stem)) return Math.max(best, 10 + stem.length - (name.length - stem.length));
    return best;
  }, 0);
}

export function selectPayloadFile(files, operation) {
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => ({ file, score: payloadFileMatchScore(file, operation) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))[0]?.file;
}
