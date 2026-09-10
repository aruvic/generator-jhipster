#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requiredObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

function expectedStatuses(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return value.map((entry, index) => {
    if (!Number.isSafeInteger(entry) || entry < 100 || entry > 599) {
      throw new Error(`${label}[${index}] must be an HTTP status code`);
    }
    return entry;
  });
}

function normalizeEnvironment(value, label) {
  if (value === undefined) return {};
  const environment = requiredObject(value, label);
  return Object.fromEntries(
    Object.entries(environment).map(([name, entry]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`${label} contains invalid environment variable ${JSON.stringify(name)}`);
      }
      if (!['string', 'number', 'boolean'].includes(typeof entry)) {
        throw new Error(`${label}.${name} must be a string, number, or boolean`);
      }
      return [name, String(entry)];
    }),
  );
}

function normalizeRequest(value, label) {
  const request = requiredObject(value, label);
  return {
    method: requiredString(request.method, `${label}.method`).toUpperCase(),
    path: normalizePath(request.path, `${label}.path`),
    contentType: requiredString(request.contentType ?? 'application/json', `${label}.contentType`),
    body: request.body,
    expectedStatuses: expectedStatuses(request.expectedStatuses, `${label}.expectedStatuses`),
  };
}

function normalizePath(value, label) {
  const normalized = requiredString(value, label);
  if (!normalized.startsWith('/')) {
    throw new Error(`${label} must start with "/"`);
  }
  return normalized;
}

function normalizeApplication(value, label, configDirectory) {
  const application = requiredObject(value, label);
  const database = requiredObject(application.database, `${label}.database`);
  const directory = requiredString(application.directory, `${label}.directory`);
  return {
    name: requiredString(application.name, `${label}.name`),
    directory: path.resolve(configDirectory, directory),
    host: requiredString(application.host, `${label}.host`),
    publicHost: requiredString(application.publicHost ?? application.host, `${label}.publicHost`),
    port: positiveInteger(application.port, `${label}.port`),
    healthPath: normalizePath(application.healthPath, `${label}.healthPath`),
    startCommand: stringArray(application.startCommand, `${label}.startCommand`),
    environment: normalizeEnvironment(application.environment, `${label}.environment`),
    database: {
      host: requiredString(database.host, `${label}.database.host`),
      port: positiveInteger(database.port, `${label}.database.port`),
      container: requiredString(database.container, `${label}.database.container`),
      name: requiredString(database.name, `${label}.database.name`),
      user: requiredString(database.user, `${label}.database.user`),
      password: typeof database.password === 'string' ? database.password : '',
      image: requiredString(database.image, `${label}.database.image`),
    },
    seed: normalizeRequest(application.seed, `${label}.seed`),
    identityPath: requiredString(application.identityPath, `${label}.identityPath`),
  };
}

function applicationBaseUrl(application) {
  return `http://${application.publicHost}:${application.port}`;
}

function normalizeCopyFields(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('picker.copyFields must be a non-empty array');
  }
  return value.map((entry, index) => {
    const mapping = requiredObject(entry, `picker.copyFields[${index}]`);
    return {
      source: requiredString(mapping.source, `picker.copyFields[${index}].source`),
      target: requiredString(mapping.target, `picker.copyFields[${index}].target`),
    };
  });
}

export function normalizeReferencePickerTopology(input, configFile = process.cwd()) {
  const topology = requiredObject(input, 'topology');
  const configDirectory = path.dirname(path.resolve(configFile));
  const source = normalizeApplication(topology.source, 'source', configDirectory);
  const target = normalizeApplication(topology.target, 'target', configDirectory);
  const uiInput = requiredObject(topology.ui, 'ui');
  const authenticationInput = requiredObject(topology.authentication, 'authentication');
  const pickerInput = requiredObject(topology.picker, 'picker');
  const verificationInput = requiredObject(topology.verification, 'verification');

  const ui = {
    host: requiredString(uiInput.host, 'ui.host'),
    publicHost: requiredString(uiInput.publicHost ?? uiInput.host, 'ui.publicHost'),
    port: positiveInteger(uiInput.port, 'ui.port'),
  };
  const authentication = {
    loginPath: normalizePath(authenticationInput.loginPath, 'authentication.loginPath'),
    path: normalizePath(authenticationInput.path, 'authentication.path'),
    username: requiredString(authenticationInput.username, 'authentication.username'),
    password: requiredString(authenticationInput.password, 'authentication.password'),
    tokenField: requiredString(authenticationInput.tokenField, 'authentication.tokenField'),
  };
  const picker = {
    label: requiredString(pickerInput.label, 'picker.label'),
    adminPath: normalizePath(pickerInput.adminPath, 'picker.adminPath'),
    configPath: normalizePath(pickerInput.configPath, 'picker.configPath'),
    formPathTemplate: normalizePath(pickerInput.formPathTemplate, 'picker.formPathTemplate'),
    formId: requiredString(pickerInput.formId, 'picker.formId'),
    sourceListOperationId: requiredString(pickerInput.sourceListOperationId, 'picker.sourceListOperationId'),
    sourcePath: requiredString(pickerInput.sourcePath, 'picker.sourcePath'),
    targetApiId: optionalString(pickerInput.targetApiId, 'picker.targetApiId'),
    targetBaseUrl: requiredString(pickerInput.targetBaseUrl ?? applicationBaseUrl(target), 'picker.targetBaseUrl').replace(/\/+$/, ''),
    collectionPath: normalizePath(pickerInput.collectionPath, 'picker.collectionPath'),
    displayFields: stringArray(pickerInput.displayFields, 'picker.displayFields'),
    copyFields: normalizeCopyFields(pickerInput.copyFields),
    mode: requiredString(pickerInput.mode, 'picker.mode'),
    multiple: pickerInput.multiple,
  };
  const verification = {
    targetListPath: normalizePath(verificationInput.targetListPath, 'verification.targetListPath'),
    sourceListPath: normalizePath(verificationInput.sourceListPath, 'verification.sourceListPath'),
    sourceItemPathTemplate: normalizePath(verificationInput.sourceItemPathTemplate, 'verification.sourceItemPathTemplate'),
    sourceSaveMethod: requiredString(verificationInput.sourceSaveMethod, 'verification.sourceSaveMethod').toUpperCase(),
    sourceSaveStatuses: expectedStatuses(verificationInput.sourceSaveStatuses, 'verification.sourceSaveStatuses'),
    sourceGetStatuses: expectedStatuses(verificationInput.sourceGetStatuses, 'verification.sourceGetStatuses'),
  };

  if (!['embed', 'reference'].includes(picker.mode)) {
    throw new Error('picker.mode must be "embed" or "reference"');
  }
  if (typeof picker.multiple !== 'boolean') {
    throw new Error('picker.multiple must be a boolean');
  }
  if (!verification.sourceItemPathTemplate.includes('{id}')) {
    throw new Error('verification.sourceItemPathTemplate must contain "{id}"');
  }
  if (!picker.formPathTemplate.includes('{operationId}')) {
    throw new Error('picker.formPathTemplate must contain "{operationId}"');
  }

  const sourceBaseUrl = applicationBaseUrl(source);
  const targetBaseUrl = applicationBaseUrl(target);
  const uiBaseUrl = `http://${ui.publicHost}:${ui.port}`;
  if (source.directory === target.directory) {
    throw new Error('source.directory and target.directory must be distinct');
  }
  const ports = [
    ['source.port', source.port],
    ['target.port', target.port],
    ['ui.port', ui.port],
    ['source.database.port', source.database.port],
    ['target.database.port', target.database.port],
  ];
  for (let leftIndex = 0; leftIndex < ports.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ports.length; rightIndex += 1) {
      if (ports[leftIndex][1] === ports[rightIndex][1]) {
        throw new Error(`${ports[leftIndex][0]} and ${ports[rightIndex][0]} must be distinct`);
      }
    }
  }
  if (source.database.container === target.database.container) {
    throw new Error('source.database.container and target.database.container must be distinct');
  }
  if (source.database.name === target.database.name) {
    throw new Error('source.database.name and target.database.name must be distinct');
  }
  if (new URL(picker.targetBaseUrl).origin !== new URL(targetBaseUrl).origin) {
    throw new Error(`picker.targetBaseUrl must target the configured target application origin ${targetBaseUrl}`);
  }

  return {
    outputDirectory: path.resolve(configDirectory, requiredString(topology.outputDirectory, 'outputDirectory')),
    timeoutSeconds: positiveInteger(topology.timeoutSeconds ?? 240, 'timeoutSeconds'),
    source: { ...source, baseUrl: sourceBaseUrl },
    target: { ...target, baseUrl: targetBaseUrl },
    ui: { ...ui, baseUrl: uiBaseUrl },
    authentication,
    picker,
    verification,
  };
}

export function loadReferencePickerTopology(configFile) {
  const resolvedFile = path.resolve(requiredString(configFile, 'configFile'));
  return normalizeReferencePickerTopology(JSON.parse(fs.readFileSync(resolvedFile, 'utf8')), resolvedFile);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  const configFile = process.argv[2];
  if (!configFile) {
    process.stderr.write('Usage: reference-picker-topology.mjs <topology.json>\n');
    process.exit(2);
  }
  try {
    process.stdout.write(`${JSON.stringify(loadReferencePickerTopology(configFile), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
