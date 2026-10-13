const IDENTITY_TOKENS = new Set(['id', 'identifier', 'reference', 'ref', 'uuid']);
const CONTEXT_STOP_WORDS = new Set(['api']);
const EVENT_TOKENS = new Set(['event', 'notification']);

function singularToken(value) {
  if (value.endsWith('ies') && value.length > 3) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 3) return value.slice(0, -1);
  return value;
}

function canonicalToken(value) {
  const singular = singularToken(value.toLowerCase());
  if (singular === 'identifier') return 'id';
  if (singular === 'ref') return 'reference';
  return singular;
}

export function identityTokens(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(token => canonicalToken(token))
    .filter(token => token && !CONTEXT_STOP_WORDS.has(token) && !/^v\d+$/.test(token));
}

export function isEventLikeOperation(operation) {
  return [operation?.id, operation?.operationId, operation?.path, operation?.tag]
    .flatMap(identityTokens)
    .some(token => EVENT_TOKENS.has(token));
}

function normalizedName(value) {
  return identityTokens(value).join('');
}

function operationContextTokens(operation) {
  const pathTokens = String(operation?.path ?? '')
    .split('/')
    .filter(segment => segment && !/^\{[^}]+\}$/.test(segment))
    .flatMap(identityTokens);
  return new Set([...pathTokens, ...identityTokens(operation?.tag)]);
}

function collectScalarEntries(source, origin, output = [], propertyPath = [], depth = 0) {
  if (source === undefined || source === null || depth > 12) return output;
  if (Array.isArray(source)) {
    source.forEach((item, index) => collectScalarEntries(item, origin, output, [...propertyPath, String(index)], depth + 1));
    return output;
  }
  if (typeof source !== 'object') return output;

  for (const [key, value] of Object.entries(source)) {
    const nextPath = [...propertyPath, key];
    if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value)) {
      output.push({
        origin,
        key,
        normalizedKey: normalizedName(key),
        tokens: identityTokens(key),
        value: String(value),
        path: nextPath.join('.'),
        depth,
      });
    } else if (value && typeof value === 'object') {
      collectScalarEntries(value, origin, output, nextPath, depth + 1);
    }
  }
  return output;
}

function overlapCount(left, right) {
  return [...left].filter(value => right.has(value)).length;
}

function identityCompatibility(entry, operation, parameter) {
  const parameterTokens = new Set(identityTokens(parameter?.name));
  const candidateTokens = new Set(entry.tokens);
  const identityOverlap = overlapCount(
    new Set([...parameterTokens].filter(token => IDENTITY_TOKENS.has(token))),
    new Set([...candidateTokens].filter(token => IDENTITY_TOKENS.has(token))),
  );
  return {
    exactParameter: entry.normalizedKey === normalizedName(parameter?.name),
    contextOverlap: overlapCount(operationContextTokens(operation), candidateTokens),
    identityOverlap,
  };
}

function compareRankedEntries(left, right) {
  return (
    right.score - left.score ||
    Number(right.entry.origin === 'response') - Number(left.entry.origin === 'response') ||
    left.entry.depth - right.entry.depth ||
    left.recordIndex - right.recordIndex ||
    left.entry.path.localeCompare(right.entry.path)
  );
}

function scoreEntry(entry, operation, parameter, record) {
  const parameterTokens = new Set(identityTokens(parameter?.name));
  const parameterIdentityTokens = new Set([...parameterTokens].filter(token => IDENTITY_TOKENS.has(token)));
  const parameterDomainTokens = new Set([...parameterTokens].filter(token => !IDENTITY_TOKENS.has(token)));
  const candidateTokens = new Set(entry.tokens);
  const candidateIdentityTokens = new Set([...candidateTokens].filter(token => IDENTITY_TOKENS.has(token)));
  const candidateDomainTokens = new Set([...candidateTokens].filter(token => !IDENTITY_TOKENS.has(token)));
  const contextTokens = operationContextTokens(operation);
  const parameterDomainOverlap = overlapCount(parameterDomainTokens, candidateDomainTokens);
  const contextOverlap = overlapCount(contextTokens, candidateDomainTokens);
  const normalizedParameter = normalizedName(parameter?.name);
  const containsParameter = Boolean(normalizedParameter) && entry.normalizedKey.includes(normalizedParameter);

  if (!containsParameter && parameterDomainOverlap === 0 && contextOverlap === 0) return Number.NEGATIVE_INFINITY;

  let score = entry.origin === 'response' ? 20 : 4;
  if (record?.createdByApiOperations) score += 8;
  score += Math.max(0, 12 - entry.depth * 2);
  if (entry.normalizedKey === normalizedParameter) score += 120;
  else if (containsParameter) score += 60;
  if (overlapCount(parameterIdentityTokens, candidateIdentityTokens) > 0) score += 25;
  score += parameterDomainOverlap * 20;
  score += Math.min(3, contextOverlap) * 12;
  return score;
}

export function semanticIdentityCandidate(operation, parameter, records, { origins = ['response', 'request'], field, expectedValue } = {}) {
  const allowedOrigins = new Set(origins);
  const normalizedField = field === undefined || field === null ? undefined : normalizedName(field);
  const expected = expectedValue === undefined || expectedValue === null ? undefined : String(expectedValue).trim();
  const ranked = [];

  records.forEach((record, recordIndex) => {
    if (allowedOrigins.has('response')) {
      for (const entry of collectScalarEntries(record.responseBody, 'response')) {
        ranked.push({ entry, recordIndex, score: scoreEntry(entry, operation, parameter, record) });
      }
    }
    if (allowedOrigins.has('request')) {
      for (const entry of collectScalarEntries(record.requestBody, 'request')) {
        ranked.push({ entry, recordIndex, score: scoreEntry(entry, operation, parameter, record) });
      }
    }
  });

  const candidates = ranked
    .filter(
      candidate =>
        Number.isFinite(candidate.score) &&
        candidate.entry.value.trim() &&
        (normalizedField === undefined || candidate.entry.normalizedKey === normalizedField),
    )
    .sort(compareRankedEntries);
  const best = candidates[0];
  const bestCompatibility = best && identityCompatibility(best.entry, operation, parameter);
  const expectedCandidate =
    expected === undefined || !best ?
      undefined
    : candidates
        .filter(candidate => candidate.entry.value.trim() === expected)
        .filter(candidate => {
          const compatibility = identityCompatibility(candidate.entry, operation, parameter);
          const compatibleField = compatibility.exactParameter || (compatibility.contextOverlap > 0 && compatibility.identityOverlap > 0);
          const preservesCanonicalPrecedence =
            candidate.entry.depth <= best.entry.depth &&
            (candidate.score >= best.score ||
              (!bestCompatibility.exactParameter && compatibility.contextOverlap > bestCompatibility.contextOverlap));
          return compatibleField && preservesCanonicalPrecedence;
        })
        .sort(compareRankedEntries)[0];
  const selected = expectedCandidate ?? best;

  if (!selected || selected.score < 45) return undefined;
  return {
    value: selected.entry.value.trim(),
    field: selected.entry.key,
    path: selected.entry.path,
    origin: selected.entry.origin,
  };
}

export function semanticIdentityValue(operation, parameter, records, options) {
  return semanticIdentityCandidate(operation, parameter, records, options)?.value;
}
