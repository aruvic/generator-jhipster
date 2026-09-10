import { isDeepStrictEqual } from 'node:util';

function normalizePath(value) {
  return String(value ?? '')
    .replace(/\[['"]?([^'"\]]+)['"]?\]/g, '.$1')
    .replace(/\[(\d+)]/g, '.$1')
    .replace(/^[$.]+/, '')
    .replace(/^\.+|\.+$/g, '');
}

export function valueAtPath(source, pathValue) {
  return normalizePath(pathValue)
    .split('.')
    .filter(Boolean)
    .reduce((current, segment) => {
      if (current === undefined || current === null) return undefined;
      return current[segment];
    }, source);
}

function references(value, multiple, phase) {
  if (multiple && !Array.isArray(value)) {
    throw new Error(`${phase} did not preserve configured multiple cardinality`);
  }
  if (!multiple && Array.isArray(value)) {
    throw new Error(`${phase} did not preserve configured single cardinality`);
  }
  return Array.isArray(value) ? value : [value];
}

export function assertMappedReference(value, selectedItem, picker, phase) {
  const reference = references(value, picker.multiple, phase).find(candidate =>
    picker.copyFields.every(mapping => {
      const expected = valueAtPath(selectedItem, mapping.source);
      return expected !== undefined && isDeepStrictEqual(valueAtPath(candidate, mapping.target), expected);
    }),
  );
  if (!reference) {
    throw new Error(`${phase} did not contain every configured copy mapping`);
  }
  return reference;
}

function mappingContracts(copyFields, targetIdentityPath) {
  const normalizedIdentityPath = normalizePath(targetIdentityPath);
  const identityMappings = copyFields.filter(mapping => normalizePath(mapping.source) === normalizedIdentityPath);
  if (identityMappings.length === 0) {
    throw new Error(`Reference-picker copy mappings do not map target identity path ${JSON.stringify(targetIdentityPath)}`);
  }

  const referenceRoots = [...new Set(identityMappings.map(mapping => {
    const segments = normalizePath(mapping.target).split('.');
    segments.pop();
    return segments.join('.');
  }))];

  const contracts = copyFields.map(mapping => {
    if (identityMappings.includes(mapping)) {
      return { mapping, contract: 'identity', classification: 'configured-copy', requiredOnReadback: true };
    }
    const target = normalizePath(mapping.target);
    const insideReference = referenceRoots.some(root => root === '' || target === root || target.startsWith(`${root}.`));
    const targetField = target.split('.').at(-1);
    if (insideReference && targetField === 'href') {
      return { mapping, contract: 'reference-href', classification: 'configured-copy', requiredOnReadback: true };
    }
    if (insideReference && targetField === '@referredType') {
      return { mapping, contract: 'reference-referred-type', classification: 'configured-copy', requiredOnReadback: true };
    }
    if (!insideReference && targetField === '@type') {
      return { mapping, contract: 'relationship-type', classification: 'configured-copy', requiredOnReadback: true };
    }
    if (!insideReference && targetField === 'role') {
      return { mapping, contract: 'relationship-role', classification: 'configured-copy', requiredOnReadback: true };
    }
    return {
      mapping,
      contract: insideReference ? 'reference-metadata' : 'relationship',
      classification: 'configured-copy',
      requiredOnReadback: !insideReference,
    };
  });
  return { contracts, referenceRoots };
}

function targetItemHref(collectionUrl, identity) {
  if (identity === undefined || identity === null || identity === '') {
    throw new Error('Selected target identity is required to prove the automatic reference href');
  }
  const url = new URL(collectionUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(String(identity))}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function hrefMatches(value, expectedHref) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return new URL(value).href === expectedHref;
  } catch {
    return false;
  }
}

function valuePresent(value) {
  return value !== undefined && value !== null && value !== '';
}

export function assertPersistedReference(value, requestReference, picker, targetSelection, phase) {
  const { contracts, referenceRoots } = mappingContracts(picker.copyFields, targetSelection.identityPath);
  for (const requiredContract of ['reference-referred-type', 'relationship-type', 'relationship-role']) {
    if (!contracts.some(({ contract }) => contract === requiredContract)) {
      throw new Error(`Reference-picker copy mappings do not prove required ${requiredContract} contract`);
    }
  }

  const identityContracts = contracts.filter(({ contract }) => contract === 'identity');
  if (
    identityContracts.some(
      ({ mapping }) => !isDeepStrictEqual(valueAtPath(requestReference, mapping.target), targetSelection.identity),
    )
  ) {
    throw new Error(`${phase} request did not map the selected target identity`);
  }

  let hrefContract = contracts.find(({ contract }) => contract === 'reference-href');
  if (!hrefContract) {
    if (referenceRoots.length !== 1) {
      throw new Error('Reference-picker copy mappings do not identify one automatic reference href target');
    }
    const target = referenceRoots[0] ? `${referenceRoots[0]}.href` : 'href';
    hrefContract = {
      mapping: { source: null, target },
      contract: 'reference-href',
      classification: 'automatic-resolver',
      requiredOnReadback: true,
    };
    contracts.splice(contracts.findLastIndex(({ contract }) => contract === 'identity') + 1, 0, hrefContract);
  }

  const expectedHref = targetItemHref(targetSelection.collectionUrl, targetSelection.identity);
  const requestHref = valueAtPath(requestReference, hrefContract.mapping.target);
  if (!hrefMatches(requestHref, expectedHref)) {
    throw new Error(`${phase} request did not contain the exact target reference href ${expectedHref}`);
  }

  const reference = references(value, picker.multiple, phase).find(candidate =>
    hrefMatches(valueAtPath(candidate, hrefContract.mapping.target), expectedHref),
  );
  if (!reference) {
    throw new Error(`${phase} did not preserve the exact target reference href ${expectedHref}`);
  }

  const mappingEvidence = contracts.map(({ mapping, contract, classification, requiredOnReadback }) => {
    const patchValue = valueAtPath(requestReference, mapping.target);
    const getValue = valueAtPath(reference, mapping.target);
    const preserved = isDeepStrictEqual(getValue, patchValue);
    const proven =
      contract === 'reference-href'
        ? hrefMatches(patchValue, expectedHref) && hrefMatches(getValue, expectedHref)
        : contract === 'identity'
          ? preserved || (valuePresent(getValue) && hrefMatches(valueAtPath(reference, hrefContract.mapping.target), expectedHref))
          : preserved;
    return {
      source: mapping.source,
      target: mapping.target,
      contract,
      classification,
      requiredOnReadback,
      patchValue,
      getValue,
      ...(contract === 'reference-href' ? { expectedValue: expectedHref } : {}),
      preserved,
      proven,
    };
  });
  const changedRequiredMappings = mappingEvidence.filter(mapping => mapping.requiredOnReadback && !mapping.proven);
  if (changedRequiredMappings.length > 0) {
    throw new Error(
      `${phase} changed stable identity/relationship mappings: ${changedRequiredMappings.map(mapping => mapping.target).join(', ')}`,
    );
  }

  return { reference, mappingEvidence };
}
