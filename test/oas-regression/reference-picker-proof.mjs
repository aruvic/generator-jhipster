#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const proofKind = 'cross-service-reference-picker-proof';
const requiredGateNames = [
  'exactTwoGeneratedApplications',
  'distinctServiceTopology',
  'distinctListenerPorts',
  'isolatedDatabases',
  'configurationPersistence',
  'independentAuthenticatedTargetFetch',
  'sourcePatchCaptured',
  'sourceSelectionPersisted',
];

function origin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function successfulStatus(value) {
  return Number.isInteger(value) && value >= 200 && value < 300;
}

function distinct(values) {
  return values.length === new Set(values).size;
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function exactEndpoint(value, baseUrl, endpointPath) {
  try {
    const actual = new URL(value);
    const expected = new URL(endpointPath, baseUrl);
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function gate(metricLabel, checks, evidencePointers = []) {
  const reasonCodes = checks.filter(check => !check.passed).map(check => check.reasonCode);
  return {
    metricLabel,
    status: reasonCodes.length === 0 ? 'passed' : 'failed',
    reasonCodes,
    evidencePointers,
  };
}

function semanticPickerConfig(value) {
  return {
    label: value?.label,
    formId: value?.formId,
    targetApiId: value?.targetApiId,
    sourcePath: value?.sourcePath,
    targetBaseUrl: String(value?.targetBaseUrl ?? '').replace(/\/+$/, ''),
    collectionPath: value?.collectionPath,
    displayFields: value?.displayFields,
    copyFields: value?.copyFields,
    mode: value?.mode,
    multiple: value?.multiple,
  };
}

function samePickerConfig(left, right) {
  return JSON.stringify(semanticPickerConfig(left)) === JSON.stringify(semanticPickerConfig(right));
}

function databaseEndpoint(application) {
  return `${application?.database?.host ?? ''}:${application?.database?.port ?? ''}`;
}

export function buildReferencePickerProofReport({ topology, preconditions = {}, workflow = {}, evidencePointers = {} }) {
  const source = topology?.source ?? {};
  const target = topology?.target ?? {};
  const ui = topology?.ui ?? {};
  const configurationService = topology?.configurationService ?? {};
  const sourceOrigin = origin(source.baseUrl);
  const targetOrigin = origin(target.baseUrl);
  const uiOrigin = origin(ui.baseUrl);
  const configuredTargetOrigin = origin(topology?.picker?.targetBaseUrl);
  const configuredApplications = [source, target].filter(application => application && Object.keys(application).length > 0);
  const preconditionApplications = [preconditions?.source, preconditions?.target].filter(Boolean);

  const applicationPointers = evidencePointers.topology ?? ['topology.json#/source', 'topology.json#/target'];
  const preconditionPointers = evidencePointers.preconditions ?? ['preconditions.json'];
  const configurationPointers = evidencePointers.configuration ?? [
    'gui/status.json#/configuration/save',
    'gui/status.json#/configuration/externalReadback',
    'gui/status.json#/configuration/sourceReadback',
    'gui/status.json#/configuration/identityMapping',
  ];
  const targetPointers = evidencePointers.targetFetch ?? ['gui/status.json#/targetRequest'];
  const patchPointers = evidencePointers.sourcePatch ?? ['gui/status.json#/sourceRequest'];
  const readbackPointers = evidencePointers.sourceReadback ?? ['gui/status.json#/sourceGet'];

  const actualApplicationCount = preconditions.generatedApplicationCount ?? preconditionApplications.length;
  const listenerPorts = [source.port, target.port, ui.port, configurationService.port, source.database?.port, target.database?.port].filter(
    present,
  );
  const sourceDatabase = preconditions.source ?? {};
  const targetDatabase = preconditions.target ?? {};
  const configurationSave = workflow.configuration?.save ?? {};
  const externalReadback = workflow.configuration?.externalReadback ?? {};
  const sourceReadback = workflow.configuration?.sourceReadback ?? {};
  const identityMapping = workflow.configuration?.identityMapping ?? {};
  const savedConfiguration = configurationSave.response ?? workflow.configuration?.saved;
  const externalConfiguration = externalReadback.matchedConfiguration;
  const sourceConfiguration = sourceReadback.matchedConfiguration;
  const expectedConfiguration = topology?.picker;
  const targetRequest = workflow.targetRequest ?? {};
  const sourceRequest = workflow.sourceRequest ?? {};
  const sourceGet = workflow.sourceGet ?? {};

  const gates = {
    exactTwoGeneratedApplications: gate(
      'reference-picker-exact-two-generated-applications',
      [
        {
          passed: configuredApplications.length === 2 && actualApplicationCount === 2,
          reasonCode: 'topology-generated-application-count-not-two',
        },
        {
          passed: Boolean(source.directory && target.directory && source.directory !== target.directory),
          reasonCode: 'topology-generated-application-directory-reused',
        },
      ],
      [...applicationPointers, ...preconditionPointers],
    ),
    distinctServiceTopology: gate(
      'reference-picker-distinct-service-topology',
      [
        {
          passed: Boolean(source.name && target.name && source.name !== target.name),
          reasonCode: 'topology-service-identity-reused',
        },
        {
          passed: Boolean(sourceOrigin && targetOrigin && sourceOrigin !== targetOrigin),
          reasonCode: 'topology-source-target-origin-reused',
        },
        {
          passed: Boolean(configuredTargetOrigin && configuredTargetOrigin === targetOrigin),
          reasonCode: 'topology-picker-target-origin-mismatch',
        },
        {
          passed: Boolean(configuredTargetOrigin && configuredTargetOrigin !== sourceOrigin && configuredTargetOrigin !== uiOrigin),
          reasonCode: 'topology-picker-target-not-cross-service',
        },
      ],
      applicationPointers,
    ),
    distinctListenerPorts: gate(
      'reference-picker-distinct-listener-ports',
      [
        {
          passed: listenerPorts.length === 6 && distinct(listenerPorts),
          reasonCode: 'topology-listener-port-collision',
        },
      ],
      applicationPointers,
    ),
    isolatedDatabases: gate(
      'reference-picker-isolated-databases',
      [
        {
          passed: Boolean(source.database?.container && source.database.container !== target.database?.container),
          reasonCode: 'topology-database-container-reused',
        },
        {
          passed: Boolean(source.database?.name && source.database.name !== target.database?.name),
          reasonCode: 'topology-database-name-reused',
        },
        {
          passed: Boolean(databaseEndpoint(source) && databaseEndpoint(source) !== databaseEndpoint(target)),
          reasonCode: 'topology-database-endpoint-reused',
        },
        {
          passed: Boolean(
            sourceDatabase.databaseContainerId &&
            targetDatabase.databaseContainerId &&
            sourceDatabase.databaseContainerId !== targetDatabase.databaseContainerId,
          ),
          reasonCode: 'evidence-database-container-identity-not-isolated',
        },
        {
          passed: Boolean(
            sourceDatabase.database &&
            targetDatabase.database &&
            sourceDatabase.database !== targetDatabase.database &&
            sourceDatabase.database === source.database?.name &&
            targetDatabase.database === target.database?.name,
          ),
          reasonCode: 'evidence-database-name-not-isolated',
        },
      ],
      preconditionPointers,
    ),
    configurationPersistence: gate(
      'reference-picker-configuration-persistence',
      [
        {
          passed:
            configurationSave.method === 'PUT' &&
            successfulStatus(configurationSave.status) &&
            configurationSave.authenticated === true &&
            exactEndpoint(configurationSave.url, ui.baseUrl, topology?.picker?.configPath),
          reasonCode: 'evidence-configuration-save-response-missing',
        },
        {
          passed: Boolean(savedConfiguration && samePickerConfig(savedConfiguration, expectedConfiguration)),
          reasonCode: 'evidence-configuration-save-response-mismatch',
        },
        {
          passed: Boolean(
            configurationSave.transport?.kind === 'ui-same-origin-proxy' &&
            configurationSave.transport?.baseUrl === ui.baseUrl &&
            configurationSave.transport?.port === ui.port &&
            configurationSave.compatibilityService?.name === source.name &&
            configurationSave.compatibilityService?.port === source.port &&
            exactEndpoint(configurationSave.compatibilityService?.url, source.baseUrl, topology?.picker?.configPath),
          ),
          reasonCode: 'evidence-configuration-save-proxy-attribution-mismatch',
        },
        {
          passed: Boolean(
            externalReadback.method === 'GET' &&
            externalReadback.directService === true &&
            successfulStatus(externalReadback.status) &&
            exactEndpoint(externalReadback.url, configurationService.baseUrl, configurationService.collectionPath) &&
            externalReadback.service?.name === configurationService.name &&
            externalReadback.service?.port === configurationService.port,
          ),
          reasonCode: 'evidence-external-configuration-persistence-missing',
        },
        {
          passed: Boolean(externalConfiguration && samePickerConfig(externalConfiguration, expectedConfiguration)),
          reasonCode: 'evidence-external-configuration-persistence-mismatch',
        },
        {
          passed: Boolean(
            sourceReadback.method === 'GET' &&
            sourceReadback.authenticated === true &&
            sourceReadback.directService === true &&
            successfulStatus(sourceReadback.status) &&
            exactEndpoint(sourceReadback.url, source.baseUrl, topology?.picker?.configPath) &&
            sourceReadback.service?.name === source.name &&
            sourceReadback.service?.port === source.port,
          ),
          reasonCode: 'evidence-source-compatibility-readback-missing',
        },
        {
          passed: Boolean(sourceConfiguration && samePickerConfig(sourceConfiguration, expectedConfiguration)),
          reasonCode: 'evidence-source-compatibility-readback-mismatch',
        },
        {
          passed: Boolean(
            present(identityMapping.sourceId) &&
            identityMapping.sourceId === identityMapping.externalPickerId &&
            identityMapping.sourceId === identityMapping.sourceReadbackId &&
            identityMapping.sourceId === savedConfiguration?.id &&
            identityMapping.externalPickerId === externalConfiguration?.pickerId &&
            identityMapping.sourceReadbackId === sourceConfiguration?.id,
          ),
          reasonCode: 'evidence-configuration-identity-mapping-mismatch',
        },
      ],
      configurationPointers,
    ),
    independentAuthenticatedTargetFetch: gate(
      'reference-picker-independent-authenticated-target-fetch',
      [
        {
          passed: targetRequest.method === 'GET' && successfulStatus(targetRequest.status),
          reasonCode: 'evidence-target-fetch-missing',
        },
        {
          passed: targetRequest.authenticated === true,
          reasonCode: 'evidence-target-fetch-not-authenticated',
        },
        {
          passed: Boolean(
            origin(targetRequest.url) === targetOrigin &&
            origin(targetRequest.url) !== sourceOrigin &&
            origin(targetRequest.url) !== uiOrigin &&
            targetRequest.service?.name === target.name &&
            targetRequest.service?.port === target.port,
          ),
          reasonCode: 'evidence-target-fetch-not-independent-service',
        },
        {
          passed: Boolean(targetRequest.selectedIdentityFound && present(targetRequest.selectedIdentity)),
          reasonCode: 'evidence-target-response-selection-missing',
        },
      ],
      targetPointers,
    ),
    sourcePatchCaptured: gate(
      'reference-picker-source-patch-captured',
      [
        {
          passed: sourceRequest.method === 'PATCH' && successfulStatus(sourceRequest.status),
          reasonCode: 'evidence-source-patch-missing',
        },
        {
          passed: sourceRequest.authenticated === true && sourceRequest.selectionMapped === true,
          reasonCode: 'evidence-source-patch-selection-missing',
        },
        {
          passed: sourceRequest.service?.name === source.name && sourceRequest.service?.port === source.port,
          reasonCode: 'evidence-source-patch-service-mismatch',
        },
      ],
      patchPointers,
    ),
    sourceSelectionPersisted: gate(
      'reference-picker-source-selection-persisted',
      [
        {
          passed: sourceGet.method === 'GET' && successfulStatus(sourceGet.status),
          reasonCode: 'evidence-source-readback-missing',
        },
        {
          passed: sourceGet.authenticated === true && sourceGet.directService === true,
          reasonCode: 'evidence-source-readback-not-independent-authenticated',
        },
        {
          passed: Boolean(
            origin(sourceGet.url) === sourceOrigin && sourceGet.service?.name === source.name && sourceGet.service?.port === source.port,
          ),
          reasonCode: 'evidence-source-readback-service-mismatch',
        },
        {
          passed: sourceGet.selectionPersisted === true,
          reasonCode: 'evidence-source-readback-selection-not-persisted',
        },
      ],
      readbackPointers,
    ),
  };

  const decisions = requiredGateNames.map(name => ({ gate: name, ...gates[name] }));
  const failedDecisions = decisions.filter(decision => decision.status === 'failed');
  const reasonCodes = [...new Set(failedDecisions.flatMap(decision => decision.reasonCodes))];

  return {
    schemaVersion: 1,
    kind: proofKind,
    metricLabel: 'cross-service-reference-picker-proof',
    status: failedDecisions.length === 0 ? 'passed' : 'failed',
    topology: {
      generatedApplicationCount: actualApplicationCount,
      source: {
        name: source.name,
        directory: source.directory,
        api: { baseUrl: source.baseUrl, origin: sourceOrigin, port: source.port },
        database: {
          container: source.database?.container,
          name: source.database?.name,
          endpoint: databaseEndpoint(source),
          actualContainerId: sourceDatabase.databaseContainerId,
          actualName: sourceDatabase.database,
        },
      },
      target: {
        name: target.name,
        directory: target.directory,
        api: { baseUrl: target.baseUrl, origin: targetOrigin, port: target.port },
        database: {
          container: target.database?.container,
          name: target.database?.name,
          endpoint: databaseEndpoint(target),
          actualContainerId: targetDatabase.databaseContainerId,
          actualName: targetDatabase.database,
        },
      },
      ui: { baseUrl: ui.baseUrl, origin: uiOrigin, port: ui.port },
      configurationService: {
        name: configurationService.name,
        baseUrl: configurationService.baseUrl,
        origin: origin(configurationService.baseUrl),
        port: configurationService.port,
        collectionPath: configurationService.collectionPath,
      },
      configuredTargetOrigin,
    },
    operations: {
      configurationSave,
      configurationExternalReadback: externalReadback,
      configurationSourceReadback: sourceReadback,
      configurationIdentityMapping: identityMapping,
      targetFetch: targetRequest,
      sourcePatch: sourceRequest,
      sourceReadback: sourceGet,
    },
    gates,
    counts: {
      requiredGates: requiredGateNames.length,
      passedGates: decisions.length - failedDecisions.length,
      failedGates: failedDecisions.length,
      generatedApplications: actualApplicationCount,
      configurationPersistenceProofs: gates.configurationPersistence.status === 'passed' ? 1 : 0,
      independentAuthenticatedTargetFetches: gates.independentAuthenticatedTargetFetch.status === 'passed' ? 1 : 0,
      capturedSourcePatches: gates.sourcePatchCaptured.status === 'passed' ? 1 : 0,
      persistedSourceSelections: gates.sourceSelectionPersisted.status === 'passed' ? 1 : 0,
    },
    decisions,
    reasonCodes,
  };
}

export function summarizeReferencePickerProofReports(reports, { required = false } = {}) {
  const validReports = reports.filter(report => report?.kind === proofKind);
  const configured = validReports.length;
  const passed = validReports.filter(report => report.status === 'passed').length;
  const failed = validReports.filter(report => report.status !== 'passed').length;
  const missingRequired = required && configured === 0;
  const reasonCodes = [
    ...(missingRequired ? ['reference-picker-cross-service-proof-required-but-missing'] : []),
    ...new Set(validReports.flatMap(report => report.reasonCodes ?? [])),
  ];
  const gateNames = [...new Set(validReports.flatMap(report => Object.keys(report.gates ?? {})))];
  const gateCounts = Object.fromEntries(
    gateNames.map(name => [
      name,
      {
        passed: validReports.filter(report => report.gates?.[name]?.status === 'passed').length,
        failed: validReports.filter(report => report.gates?.[name]?.status === 'failed').length,
      },
    ]),
  );
  let status = 'not-configured';
  if (missingRequired || failed > 0) status = 'failed';
  else if (configured > 0) status = 'passed';

  return {
    metricLabel: 'cross-service-reference-picker-proof-summary',
    required,
    status,
    counts: {
      configured,
      passed,
      failed: failed + Number(missingRequired),
      requiredGates: validReports.reduce((total, report) => total + (report.counts?.requiredGates ?? 0), 0),
      passedGates: validReports.reduce((total, report) => total + (report.counts?.passedGates ?? 0), 0),
      failedGates: validReports.reduce((total, report) => total + (report.counts?.failedGates ?? 0), 0) + Number(missingRequired),
      configurationPersistenceProofs: validReports.reduce(
        (total, report) => total + (report.counts?.configurationPersistenceProofs ?? 0),
        0,
      ),
      independentAuthenticatedTargetFetches: validReports.reduce(
        (total, report) => total + (report.counts?.independentAuthenticatedTargetFetches ?? 0),
        0,
      ),
      capturedSourcePatches: validReports.reduce((total, report) => total + (report.counts?.capturedSourcePatches ?? 0), 0),
      persistedSourceSelections: validReports.reduce((total, report) => total + (report.counts?.persistedSourceSelections ?? 0), 0),
    },
    gateCounts,
    enterpriseGate: {
      metricLabel: 'cross-service-reference-picker-proof-required',
      status: missingRequired || failed > 0 ? 'failed' : 'passed',
      reasonCodes,
    },
    reports: validReports.map(report => ({
      status: report.status,
      sourceService: report.topology?.source?.name,
      targetService: report.topology?.target?.name,
      sourcePort: report.topology?.source?.api?.port,
      targetPort: report.topology?.target?.api?.port,
      uiPort: report.topology?.ui?.port,
      configurationServicePort: report.topology?.configurationService?.port,
      counts: report.counts,
      reasonCodes: report.reasonCodes,
    })),
  };
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'summary') {
    const requiredIndex = args.indexOf('--required');
    const required = requiredIndex !== -1;
    if (required) args.splice(requiredIndex, 1);
    const summary = summarizeReferencePickerProofReports(args.map(readJson), { required });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status === 'failed') process.exitCode = 1;
  } else if (command === 'report' && args.length === 3) {
    const report = buildReferencePickerProofReport({
      topology: readJson(args[0]),
      preconditions: readJson(args[1]),
      workflow: readJson(args[2]),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status === 'failed') process.exitCode = 1;
  } else {
    process.stderr.write(
      'Usage: reference-picker-proof.mjs report <topology.json> <preconditions.json> <workflow.json>\n' +
        '   or: reference-picker-proof.mjs summary [--required] [proof-report.json ...]\n',
    );
    process.exitCode = 2;
  }
}
