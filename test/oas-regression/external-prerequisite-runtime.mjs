#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parse } from 'yaml';

import {
  EXTERNAL_PREREQUISITE_PROFILE_VERSION,
  EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
  proveExternalPrerequisiteFixture,
  runExternalPrerequisiteProvider,
  sanitizeExternalPrerequisiteEvidence,
  validateExternalPrerequisiteProfile,
} from './external-prerequisite-fixture.mjs';
import { buildExternalPrerequisiteOperationReport, normalizeExternalPrerequisiteRecord } from './external-prerequisite-records.mjs';

const STATUS_VERSION = 1;

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function localRef(document, value) {
  if (!isPlainObject(value) || typeof value.$ref !== 'string') return value;
  if (!value.$ref.startsWith('#/')) return undefined;
  let current = document;
  for (const segment of value.$ref
    .slice(2)
    .split('/')
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    current = current?.[segment];
  }
  return current;
}

function operationDeclared(openApi, selector) {
  const pathItem = localRef(openApi, openApi.paths?.[selector.path]);
  return isPlainObject(localRef(openApi, pathItem?.[selector.method.toLowerCase()]));
}

function evidencePaths(outputDirectory) {
  const resolvedOutput = path.resolve(outputDirectory);
  return {
    status: path.join(resolvedOutput, 'status.json'),
    selection: path.join(resolvedOutput, 'selected-fixtures.json'),
    state: path.join(resolvedOutput, 'lifecycle-state.json'),
    provision: path.join(resolvedOutput, 'provision-results.json'),
    proof: path.join(resolvedOutput, 'proof-results.json'),
    operationResults: path.join(resolvedOutput, 'operation-results.json'),
    cleanup: path.join(resolvedOutput, 'cleanup-results.json'),
    verifiedResources: path.join(resolvedOutput, 'verified-resources.json'),
    runtimeError: path.join(resolvedOutput, 'runtime-error.json'),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultCounts() {
  return {
    declared: 0,
    required: 0,
    proven: 0,
    failed: 0,
    cleanupFailed: 0,
    disabledOptional: 0,
  };
}

function defaultStatus(outputDirectory) {
  const paths = evidencePaths(outputDirectory);
  const operationReport = buildExternalPrerequisiteOperationReport({ resources: [], records: [] });
  return {
    version: STATUS_VERSION,
    status: 'not-declared',
    gate: 'passed',
    evidence: {
      status: paths.status,
      selection: paths.selection,
      provision: paths.provision,
      proof: paths.proof,
      operationResults: paths.operationResults,
      cleanup: paths.cleanup,
      verifiedResources: paths.verifiedResources,
    },
    counts: defaultCounts(),
    enterpriseGate: operationReport.enterpriseGate,
    operationReport,
    fixtures: [],
  };
}

function safeError(error, sensitiveValues = []) {
  const evidence = isPlainObject(error?.evidence) ? error.evidence : {};
  return sanitizeExternalPrerequisiteEvidence(
    {
      reasonCode: error?.code ?? 'external-prerequisite-runtime-failed',
      message: error instanceof Error ? error.message : String(error),
      ...evidence,
    },
    sensitiveValues,
  );
}

function loadJson(filePath, location) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${location} could not be read as JSON`, { cause: error });
  }
}

function loadSecrets(secretsFile) {
  if (!secretsFile) return {};
  const secrets = loadJson(secretsFile, 'External prerequisite secrets file');
  if (!isPlainObject(secrets)) throw new Error('External prerequisite secrets file must contain an object');
  return secrets;
}

function sensitiveValues(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach(item => sensitiveValues(item, output));
  } else if (isPlainObject(value)) {
    Object.values(value).forEach(item => sensitiveValues(item, output));
  } else if (typeof value === 'string' && value.length > 0) {
    output.push(value);
  }
  return output;
}

function selectedResourceKey(fixtureId, resourceId) {
  return `${fixtureId}\0${resourceId}`;
}

function statusFixture(entry) {
  return {
    id: entry.fixture.id,
    requiredResourceIds: cloneJson(entry.requiredResourceIds),
    optionalResourceIds: cloneJson(entry.optionalResourceIds),
    provision: 'pending',
    proof: 'pending',
    cleanup: 'pending',
  };
}

function statusForSelection(selection, outputDirectory) {
  const status = defaultStatus(outputDirectory);
  const resources = selection.fixtures.flatMap(entry =>
    entry.fixture.resources.map(resource => ({
      key: selectedResourceKey(entry.fixture.id, resource.id),
      required: entry.requiredResourceIds.includes(resource.id),
    })),
  );
  status.status = resources.length > 0 ? 'selected' : 'not-declared';
  status.counts.declared = resources.length;
  status.counts.required = resources.filter(resource => resource.required).length;
  status.fixtures = selection.fixtures.map(statusFixture);
  return status;
}

function selectionEvidence(selection) {
  return {
    version: selection.version,
    fixtures: selection.fixtures.map(({ fixture, requiredResourceIds, optionalResourceIds }) => ({
      fixture,
      requiredResourceIds,
      optionalResourceIds,
    })),
  };
}

function writeInitialEvidence(paths, selection, status) {
  writeJson(paths.selection, sanitizeExternalPrerequisiteEvidence(selectionEvidence(selection)));
  writeJson(paths.state, selection);
  writeJson(paths.provision, []);
  writeJson(paths.proof, []);
  writeJson(paths.operationResults, status.operationReport);
  writeJson(paths.cleanup, []);
  writeJson(paths.verifiedResources, []);
  writeJson(paths.status, status);
}

function selectedResources(selection) {
  return selection.fixtures.flatMap(entry =>
    entry.fixture.resources.map(resource => ({
      fixtureId: entry.fixture.id,
      resourceId: resource.id,
      enabledOperations: resource.enabledOperations,
    })),
  );
}

function updateOperationReport(paths, status, selection, verifiedRecords, proofResults) {
  status.operationReport = buildExternalPrerequisiteOperationReport({
    resources: selectedResources(selection),
    records: verifiedRecords,
    proofResults,
    proofEvidenceFile: paths.proof,
    verifiedResourcesFile: paths.verifiedResources,
  });
  status.enterpriseGate = status.operationReport.enterpriseGate;
  writeJson(paths.operationResults, sanitizeExternalPrerequisiteEvidence(status.operationReport));
}

function requiredResource(entry, resourceId) {
  return entry.requiredResourceIds.includes(resourceId);
}

function matchingProof(proofResults, fixtureId, resourceId) {
  return proofResults.filter(result => result?.fixtureId === fixtureId && result?.resourceId === resourceId);
}

function verifiedProofRecord(proofResults, entry, resource) {
  const matches = matchingProof(proofResults, entry.fixture.id, resource.id);
  if (matches.length !== 1) return undefined;
  const normalized = normalizeExternalPrerequisiteRecord(matches[0]);
  if (
    !normalized ||
    !isDeepStrictEqual(normalized.identity, resource.identity) ||
    !isDeepStrictEqual(normalized.enabledOperations, resource.enabledOperations)
  ) {
    return undefined;
  }
  return normalized;
}

function fixtureStatus(status, fixtureId) {
  return status.fixtures.find(fixture => fixture.id === fixtureId);
}

function failedProofEvidence(entry, resource, proofResults, fallbackReasonCode) {
  const matches = matchingProof(proofResults, entry.fixture.id, resource.id);
  if (matches.length === 1 && matches[0]?.proof === 'failed') {
    return sanitizeExternalPrerequisiteEvidence(matches[0]);
  }
  return {
    fixtureId: entry.fixture.id,
    resourceId: resource.id,
    proof: 'failed',
    evidence: { reasonCode: fallbackReasonCode },
  };
}

function recomputePreparationCounts(status, selection, verifiedRecords, failedRequiredKeys, disabledOptionalKeys) {
  status.counts.proven = verifiedRecords.length;
  status.counts.failed = failedRequiredKeys.size;
  status.counts.disabledOptional = disabledOptionalKeys.size;
  status.gate = status.counts.failed > 0 ? 'failed' : 'passed';
  if (status.gate === 'failed') status.status = 'failed';
  else if (status.counts.declared > 0) status.status = 'prepared';
  else status.status = 'not-declared';

  for (const entry of selection.fixtures) {
    const current = fixtureStatus(status, entry.fixture.id);
    const resourceKeys = entry.fixture.resources.map(resource => selectedResourceKey(entry.fixture.id, resource.id));
    const provenCount = resourceKeys.filter(key =>
      verifiedRecords.some(record => selectedResourceKey(record.fixtureId, record.resourceId) === key),
    ).length;
    const requiredFailed = resourceKeys.some(key => failedRequiredKeys.has(key));
    if (requiredFailed) current.proof = 'failed';
    else if (provenCount === resourceKeys.length) current.proof = 'passed';
    else if (provenCount > 0) current.proof = 'partial';
    else current.proof = 'disabled-optional';
  }
}

export function selectExternalPrerequisiteFixtures(profile, openApi) {
  const validatedProfile = validateExternalPrerequisiteProfile(profile);
  if (!isPlainObject(openApi)) throw new Error('openApi must be an object');
  const fixtures = [];

  for (const fixture of validatedProfile.fixtures) {
    const resources = [];
    const requiredResourceIds = [];
    const optionalResourceIds = [];
    for (const resource of fixture.resources) {
      const enabledOperations = resource.enabledOperations.filter(selector => operationDeclared(openApi, selector));
      if (enabledOperations.length === 0) continue;
      resources.push({ ...resource, enabledOperations });
      if (enabledOperations.some(selector => selector.required)) {
        requiredResourceIds.push(resource.id);
      } else {
        optionalResourceIds.push(resource.id);
      }
    }
    if (resources.length > 0) {
      fixtures.push({
        fixture: { ...fixture, resources },
        requiredResourceIds,
        optionalResourceIds,
      });
    }
  }

  return { version: EXTERNAL_PREREQUISITE_PROFILE_VERSION, fixtures };
}

export async function prepareExternalPrerequisites({
  profileFile,
  openApiFile,
  openApi,
  repositoryRoot,
  outputDirectory,
  baseUrl,
  authentication,
  secretsFile,
  runProvider = runExternalPrerequisiteProvider,
  proveFixture = proveExternalPrerequisiteFixture,
}) {
  if (!outputDirectory) throw new Error('outputDirectory is required');
  const paths = evidencePaths(outputDirectory);
  let profile = { version: EXTERNAL_PREREQUISITE_PROFILE_VERSION, fixtures: [] };
  if (profileFile && fs.existsSync(profileFile)) {
    profile = loadJson(profileFile, 'External prerequisite profile');
  }
  const validatedProfile = validateExternalPrerequisiteProfile(profile);
  let openApiDocument = openApi;
  if (validatedProfile.fixtures.length > 0 && openApiDocument === undefined) {
    if (!openApiFile) throw new Error('openApiFile is required when external prerequisites are declared');
    openApiDocument = parse(fs.readFileSync(openApiFile, 'utf8'));
  }
  const selection =
    validatedProfile.fixtures.length > 0 ?
      selectExternalPrerequisiteFixtures(validatedProfile, openApiDocument)
    : { version: EXTERNAL_PREREQUISITE_PROFILE_VERSION, fixtures: [] };
  for (const entry of selection.fixtures) entry.provisionAttempted = false;
  const status = statusForSelection(selection, outputDirectory);
  writeInitialEvidence(paths, selection, status);
  if (selection.fixtures.length === 0) return { ok: true, status };

  let secrets;
  try {
    secrets = loadSecrets(secretsFile);
  } catch (error) {
    const failedRequiredKeys = new Set();
    const disabledOptionalKeys = new Set();
    const provisionResults = [];
    const proofResults = [];
    for (const entry of selection.fixtures) {
      const current = fixtureStatus(status, entry.fixture.id);
      current.provision = 'failed';
      provisionResults.push({
        fixtureId: entry.fixture.id,
        status: 'failed',
        evidence: safeError(error),
      });
      for (const resource of entry.fixture.resources) {
        const key = selectedResourceKey(entry.fixture.id, resource.id);
        if (requiredResource(entry, resource.id)) failedRequiredKeys.add(key);
        else disabledOptionalKeys.add(key);
        proofResults.push({
          fixtureId: entry.fixture.id,
          resourceId: resource.id,
          proof: 'failed',
          evidence: { reasonCode: 'provider-secrets-unavailable' },
        });
      }
    }
    recomputePreparationCounts(status, selection, [], failedRequiredKeys, disabledOptionalKeys);
    updateOperationReport(paths, status, selection, [], proofResults);
    writeJson(paths.provision, sanitizeExternalPrerequisiteEvidence(provisionResults));
    writeJson(paths.proof, proofResults);
    writeJson(paths.status, sanitizeExternalPrerequisiteEvidence(status));
    return { ok: status.gate === 'passed', status };
  }
  const redactionValues = sensitiveValues(secrets);
  const provisionResults = [];
  const proofResults = [];
  const verifiedRecords = [];
  const failedRequiredKeys = new Set();
  const disabledOptionalKeys = new Set();

  for (const entry of selection.fixtures) {
    const current = fixtureStatus(status, entry.fixture.id);
    let providerResult;
    try {
      entry.provisionAttempted = true;
      writeJson(paths.state, selection);
      providerResult = await runProvider({
        repositoryRoot,
        fixture: entry.fixture,
        action: 'provision',
        secrets,
      });
      current.provision = 'passed';
      entry.priorResult = cloneJson(providerResult);
      provisionResults.push({
        fixtureId: entry.fixture.id,
        status: 'passed',
        state: providerResult.state,
      });
    } catch (error) {
      current.provision = 'failed';
      provisionResults.push({
        fixtureId: entry.fixture.id,
        status: 'failed',
        evidence: safeError(error, redactionValues),
      });
      for (const resource of entry.fixture.resources) {
        const key = selectedResourceKey(entry.fixture.id, resource.id);
        if (requiredResource(entry, resource.id)) failedRequiredKeys.add(key);
        else disabledOptionalKeys.add(key);
        proofResults.push({
          fixtureId: entry.fixture.id,
          resourceId: resource.id,
          proof: 'failed',
          evidence: { reasonCode: 'provider-provisioning-failed' },
        });
      }
      continue;
    }

    let fixtureProofResults;
    try {
      fixtureProofResults = await proveFixture({
        fixture: entry.fixture,
        providerResult,
        openApi: openApiDocument,
        baseUrl,
        authentication,
      });
      if (!Array.isArray(fixtureProofResults)) throw new Error('Canonical proof did not return resource results');
    } catch (error) {
      fixtureProofResults = entry.fixture.resources.map(resource => ({
        fixtureId: entry.fixture.id,
        resourceId: resource.id,
        proof: 'failed',
        evidence: safeError(error, redactionValues),
      }));
    }

    for (const resource of entry.fixture.resources) {
      const key = selectedResourceKey(entry.fixture.id, resource.id);
      let verified;
      try {
        verified = verifiedProofRecord(fixtureProofResults, entry, resource);
      } catch {
        verified = undefined;
      }
      if (verified) {
        verifiedRecords.push(verified);
        proofResults.push(verified);
      } else {
        if (requiredResource(entry, resource.id)) failedRequiredKeys.add(key);
        else disabledOptionalKeys.add(key);
        proofResults.push(failedProofEvidence(entry, resource, fixtureProofResults, 'canonical-proof-incomplete'));
      }
    }
  }

  recomputePreparationCounts(status, selection, verifiedRecords, failedRequiredKeys, disabledOptionalKeys);
  updateOperationReport(paths, status, selection, verifiedRecords, proofResults);
  writeJson(paths.selection, sanitizeExternalPrerequisiteEvidence(selectionEvidence(selection), redactionValues));
  writeJson(paths.state, selection);
  writeJson(paths.provision, sanitizeExternalPrerequisiteEvidence(provisionResults, redactionValues));
  writeJson(paths.proof, sanitizeExternalPrerequisiteEvidence(proofResults, redactionValues));
  writeJson(paths.verifiedResources, verifiedRecords);
  writeJson(paths.status, sanitizeExternalPrerequisiteEvidence(status, redactionValues));
  return { ok: status.gate === 'passed', status };
}

export async function cleanupExternalPrerequisites({
  repositoryRoot,
  outputDirectory,
  secretsFile,
  runProvider = runExternalPrerequisiteProvider,
}) {
  if (!outputDirectory) throw new Error('outputDirectory is required');
  const paths = evidencePaths(outputDirectory);
  const status = fs.existsSync(paths.status) ? loadJson(paths.status, 'External prerequisite status') : defaultStatus(outputDirectory);
  if (!fs.existsSync(paths.state)) {
    writeJson(paths.cleanup, []);
    writeJson(paths.status, status);
    return { ok: true, status };
  }

  const selection = loadJson(paths.state, 'External prerequisite lifecycle state');
  let secrets = {};
  const cleanupResults = [];
  let cleanupFailed = 0;
  try {
    if (selection.fixtures?.length > 0) secrets = loadSecrets(secretsFile);
  } catch (error) {
    for (const entry of (selection.fixtures ?? []).filter(candidate => candidate.provisionAttempted === true)) {
      cleanupFailed += entry.fixture.resources.length;
      const current = fixtureStatus(status, entry.fixture.id);
      if (current) current.cleanup = 'failed';
      cleanupResults.push({
        fixtureId: entry.fixture.id,
        status: 'failed',
        evidence: safeError(error),
      });
    }
  }
  const redactionValues = sensitiveValues(secrets);

  const attemptedFixtures = (selection.fixtures ?? []).filter(entry => entry.provisionAttempted === true);
  for (const entry of cleanupFailed > 0 ? [] : attemptedFixtures) {
    const current = fixtureStatus(status, entry.fixture.id);
    try {
      const result = await runProvider({
        repositoryRoot,
        fixture: entry.fixture,
        action: 'cleanup',
        priorResult: entry.priorResult ?? {
          protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
          fixtureId: entry.fixture.id,
          state: 'provisioned',
          resources: entry.fixture.resources.map(resource => ({ id: resource.id, identity: cloneJson(resource.identity) })),
        },
        secrets,
      });
      if (current) current.cleanup = 'passed';
      cleanupResults.push({
        fixtureId: entry.fixture.id,
        status: 'passed',
        state: result.state,
      });
    } catch (error) {
      cleanupFailed += entry.fixture.resources.length;
      if (current) current.cleanup = 'failed';
      cleanupResults.push({
        fixtureId: entry.fixture.id,
        status: 'failed',
        evidence: safeError(error, redactionValues),
      });
    }
  }
  for (const entry of (selection.fixtures ?? []).filter(candidate => candidate.provisionAttempted !== true)) {
    const current = fixtureStatus(status, entry.fixture.id);
    if (current) current.cleanup = 'not-required';
  }

  status.counts ??= defaultCounts();
  status.counts.cleanupFailed = cleanupFailed;
  if (cleanupFailed > 0) {
    status.gate = 'failed';
    status.status = 'failed';
  } else if (status.gate === 'passed') {
    status.status = status.counts.declared > 0 ? 'cleaned' : 'not-declared';
  }
  writeJson(paths.cleanup, sanitizeExternalPrerequisiteEvidence(cleanupResults, redactionValues));
  writeJson(paths.status, sanitizeExternalPrerequisiteEvidence(status, redactionValues));
  return { ok: cleanupFailed === 0, status };
}

function parseArguments(argv) {
  const [action, ...remaining] = argv;
  const options = {};
  for (let index = 0; index < remaining.length; index += 2) {
    const flag = remaining[index];
    const value = remaining[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${flag ?? ''}`);
    options[flag.slice(2)] = value;
  }
  return { action, options };
}

function recordRuntimeError(outputDirectory, action, error, sensitive = []) {
  const paths = evidencePaths(outputDirectory);
  const status = fs.existsSync(paths.status) ? loadJson(paths.status, 'External prerequisite status') : defaultStatus(outputDirectory);
  const evidence = safeError(error, sensitive);
  status.status = 'failed';
  status.gate = 'failed';
  writeJson(paths.runtimeError, { action, evidence });
  status.evidence.runtimeError = paths.runtimeError;
  writeJson(paths.status, sanitizeExternalPrerequisiteEvidence(status, sensitive));
}

async function main() {
  const { action, options } = parseArguments(process.argv.slice(2));
  if (!['prepare', 'cleanup'].includes(action)) {
    throw new Error('Usage: external-prerequisite-runtime.mjs <prepare|cleanup> --repository-root <path> --output <path> [options]');
  }
  if (!options['repository-root'] || !options.output) throw new Error('--repository-root and --output are required');

  if (action === 'prepare') {
    if (!options.openapi || !options['base-url']) throw new Error('--openapi and --base-url are required for prepare');
    const token = process.env.EXTERNAL_PREREQUISITE_AUTH_TOKEN;
    const result = await prepareExternalPrerequisites({
      profileFile: options.profile,
      openApiFile: options.openapi,
      repositoryRoot: options['repository-root'],
      outputDirectory: options.output,
      baseUrl: options['base-url'],
      authentication: token && token !== '-' ? { headers: { authorization: `Bearer ${token}` } } : undefined,
      secretsFile: options['secrets-file'],
    });
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const result = await cleanupExternalPrerequisites({
    repositoryRoot: options['repository-root'],
    outputDirectory: options.output,
    secretsFile: options['secrets-file'],
  });
  process.exitCode = result.ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    const { action, options } = (() => {
      try {
        return parseArguments(process.argv.slice(2));
      } catch {
        return { action: 'unknown', options: {} };
      }
    })();
    if (options.output) {
      const token = process.env.EXTERNAL_PREREQUISITE_AUTH_TOKEN;
      recordRuntimeError(options.output, action, error, token ? [token] : []);
    }
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
