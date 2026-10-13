import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const EXTERNAL_PREREQUISITE_PROFILE_VERSION = 1;
export const EXTERNAL_PREREQUISITE_PROTOCOL_VERSION = 'external-prerequisite-fixture/v1';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,255})$/;
const PATH_PARAMETER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const HTTP_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);
const OPENAPI_METHODS = new Set([...HTTP_METHODS].map(method => method.toLowerCase()));
const ASSERTION_OPERATORS = new Set(['equals', 'notEquals', 'exists', 'includes']);
const CLEANUP_STATES = new Set(['cleaned', 'already-absent']);
const SHELL_EXECUTABLES = new Set(['bash', 'cmd', 'cmd.exe', 'dash', 'fish', 'ksh', 'powershell', 'powershell.exe', 'pwsh', 'sh', 'zsh']);
const INLINE_EXECUTION_ARGUMENTS = new Set(['-c', '-e', '-p', '--command', '--eval', '--print']);
const URL_PATTERN = /\b(?:https?|ftp):\/\/[^\s"'<>]+/gi;
const URL_CREDENTIALS_PATTERN = /\/\/[^/\s:@]+:[^/\s@]+@/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SENSITIVE_KEY_PATTERN =
  /(?:access.?token|api.?key|authorization|client.?secret|credential|id.?token|password|refresh.?token|secret|token)/i;
const REDACTION_MARKER = '[REDACTED]';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertPlainObject(value, location) {
  if (!isPlainObject(value)) throw new Error(`${location} must be an object`);
}

function assertExactKeys(value, allowedKeys, location) {
  const unknownKeys = Object.keys(value).filter(key => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) throw new Error(`${location} contains unknown properties: ${unknownKeys.join(', ')}`);
}

function assertIdentifier(value, location, pattern = IDENTIFIER_PATTERN) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${location} must be a stable identifier`);
  }
}

function assertJsonValue(value, location, depth = 0, { allowSensitiveKeys = false } = {}) {
  if (depth > 20) throw new Error(`${location} exceeds the maximum nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${location}[${index}]`, depth + 1, { allowSensitiveKeys }));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (!allowSensitiveKeys && SENSITIVE_KEY_PATTERN.test(key)) throw new Error(`${location} contains a sensitive property`);
      assertJsonValue(nestedValue, `${location}.${key}`, depth + 1, { allowSensitiveKeys });
    }
    return;
  }
  throw new Error(`${location} must contain only JSON values`);
}

function assertNoUrlValues(value, location) {
  if (typeof value === 'string' && (URL_PATTERN.test(value) || URL_CREDENTIALS_PATTERN.test(value))) {
    URL_PATTERN.lastIndex = 0;
    URL_CREDENTIALS_PATTERN.lastIndex = 0;
    throw new Error(`${location} must not contain URLs`);
  }
  URL_PATTERN.lastIndex = 0;
  URL_CREDENTIALS_PATTERN.lastIndex = 0;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUrlValues(item, `${location}[${index}]`));
  } else if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      assertNoUrlValues(nestedValue, `${location}.${key}`);
    }
  }
}

function decodePointerSegment(segment) {
  if (/~(?:[^01]|$)/.test(segment)) throw new Error('JSON pointer contains an invalid escape');
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function pointerSegments(pointer, location) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer === '/') {
    throw new Error(`${location} must be a non-root JSON pointer`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map(segment => {
      try {
        return decodePointerSegment(segment);
      } catch {
        throw new Error(`${location} must be a valid JSON pointer`);
      }
    });
}

function valueAtPointer(source, pointer, location) {
  let value = source;
  for (const segment of pointerSegments(pointer, location)) {
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= value.length) {
        return { found: false, value: undefined };
      }
      value = value[Number(segment)];
    } else if (isPlainObject(value) && Object.hasOwn(value, segment)) {
      value = value[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value };
}

function escapedPointerSegment(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function identityLeaves(value, segments = [], leaves = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => identityLeaves(item, [...segments, String(index)], leaves));
  } else if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      identityLeaves(nestedValue, [...segments, key], leaves);
    }
  } else {
    leaves.push({ pointer: `/${segments.map(escapedPointerSegment).join('/')}`, value });
  }
  return leaves;
}

function validateIdentity(identity, location) {
  assertPlainObject(identity, location);
  if (Object.keys(identity).length === 0) throw new Error(`${location} must not be empty`);
  assertJsonValue(identity, location);
  assertNoUrlValues(identity, location);
  if (identityLeaves(identity).length === 0) throw new Error(`${location} must contain at least one scalar value`);
  return cloneJson(identity);
}

function validatePathTemplate(value, location) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('://') ||
    /[{}].*[{}]/.test(value.replaceAll(/\{[A-Za-z0-9._-]+\}/g, ''))
  ) {
    throw new Error(`${location} must be an absolute OAS path template`);
  }
  const stripped = value.replaceAll(/\{[A-Za-z0-9._-]+\}/g, '');
  if (stripped.includes('{') || stripped.includes('}')) {
    throw new Error(`${location} contains a malformed path parameter`);
  }
  return value;
}

function validateSelector(selector, location) {
  assertPlainObject(selector, location);
  assertExactKeys(selector, ['method', 'path', 'required'], location);
  if (typeof selector.method !== 'string' || !HTTP_METHODS.has(selector.method)) {
    throw new Error(`${location}.method must be an uppercase HTTP method`);
  }
  if (selector.required !== undefined && typeof selector.required !== 'boolean') {
    throw new Error(`${location}.required must be boolean`);
  }
  return {
    method: selector.method,
    path: validatePathTemplate(selector.path, `${location}.path`),
    required: selector.required ?? true,
  };
}

function validateAssertion(assertion, location) {
  assertPlainObject(assertion, location);
  assertExactKeys(assertion, ['pointer', 'operator', 'value'], location);
  pointerSegments(assertion.pointer, `${location}.pointer`);
  if (!ASSERTION_OPERATORS.has(assertion.operator)) {
    throw new Error(`${location}.operator must be one of ${[...ASSERTION_OPERATORS].join(', ')}`);
  }
  if (assertion.operator === 'exists') {
    if (typeof assertion.value !== 'boolean') throw new Error(`${location}.value must be boolean for exists`);
  } else {
    if (!Object.hasOwn(assertion, 'value')) throw new Error(`${location}.value is required`);
    assertJsonValue(assertion.value, `${location}.value`);
    assertNoUrlValues(assertion.value, `${location}.value`);
  }
  return cloneJson(assertion);
}

function validateCanonicalRead(canonicalRead, identity, location) {
  assertPlainObject(canonicalRead, location);
  assertExactKeys(canonicalRead, ['operationId', 'pathParameters', 'expectedStatuses', 'assertions'], location);
  assertIdentifier(canonicalRead.operationId, `${location}.operationId`, OPERATION_ID_PATTERN);

  assertPlainObject(canonicalRead.pathParameters, `${location}.pathParameters`);
  const pathParameterEntries = Object.entries(canonicalRead.pathParameters);
  if (pathParameterEntries.length === 0) throw new Error(`${location}.pathParameters must not be empty`);
  const identityPointers = new Set();
  const pathParameters = {};
  for (const [parameter, pointer] of pathParameterEntries) {
    assertIdentifier(parameter, `${location}.pathParameters key`, PATH_PARAMETER_PATTERN);
    pointerSegments(pointer, `${location}.pathParameters.${parameter}`);
    const identityValue = valueAtPointer(identity, pointer, `${location}.pathParameters.${parameter}`);
    if (!identityValue.found || !['string', 'number', 'boolean'].includes(typeof identityValue.value)) {
      throw new Error(`${location}.pathParameters.${parameter} must point to a scalar identity value`);
    }
    if (identityPointers.has(pointer)) throw new Error(`${location}.pathParameters contains an ambiguous identity pointer`);
    identityPointers.add(pointer);
    pathParameters[parameter] = pointer;
  }

  if (!Array.isArray(canonicalRead.expectedStatuses) || canonicalRead.expectedStatuses.length === 0) {
    throw new Error(`${location}.expectedStatuses must be a non-empty array`);
  }
  const expectedStatuses = canonicalRead.expectedStatuses.map((status, index) => {
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw new Error(`${location}.expectedStatuses[${index}] must be a successful HTTP status`);
    }
    return status;
  });
  if (new Set(expectedStatuses).size !== expectedStatuses.length) {
    throw new Error(`${location}.expectedStatuses contains duplicates`);
  }

  if (!Array.isArray(canonicalRead.assertions) || canonicalRead.assertions.length === 0) {
    throw new Error(`${location}.assertions must be a non-empty array`);
  }
  const assertions = canonicalRead.assertions.map((assertion, index) => validateAssertion(assertion, `${location}.assertions[${index}]`));
  const assertionKeys = assertions.map(assertion => `${assertion.pointer}:${assertion.operator}`);
  if (new Set(assertionKeys).size !== assertionKeys.length) {
    throw new Error(`${location}.assertions contains ambiguous duplicates`);
  }

  return {
    operationId: canonicalRead.operationId,
    pathParameters,
    expectedStatuses,
    assertions,
  };
}

function validateResource(resource, location) {
  assertPlainObject(resource, location);
  assertExactKeys(resource, ['id', 'identity', 'canonicalRead', 'enabledOperations'], location);
  assertIdentifier(resource.id, `${location}.id`);
  const identity = validateIdentity(resource.identity, `${location}.identity`);
  const canonicalRead = validateCanonicalRead(resource.canonicalRead, identity, `${location}.canonicalRead`);
  if (!Array.isArray(resource.enabledOperations) || resource.enabledOperations.length === 0) {
    throw new Error(`${location}.enabledOperations must be a non-empty array`);
  }
  const enabledOperations = resource.enabledOperations.map((selector, index) =>
    validateSelector(selector, `${location}.enabledOperations[${index}]`),
  );
  const selectorKeys = enabledOperations.map(selector => `${selector.method} ${selector.path}`);
  if (new Set(selectorKeys).size !== selectorKeys.length) {
    throw new Error(`${location}.enabledOperations contains ambiguous duplicates`);
  }
  return { id: resource.id, identity, canonicalRead, enabledOperations };
}

function validateCommandArgument(value, location) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\0\r\n]/.test(value) ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/).includes('..') ||
    URL_PATTERN.test(value)
  ) {
    URL_PATTERN.lastIndex = 0;
    throw new Error(`${location} must be a bounded repository-safe literal argument`);
  }
  URL_PATTERN.lastIndex = 0;
  return value;
}

function validateProvider(provider, location) {
  assertPlainObject(provider, location);
  assertExactKeys(provider, ['command', 'configuration'], location);
  if (!Array.isArray(provider.command) || provider.command.length === 0 || provider.command.length > 32) {
    throw new Error(`${location}.command must be a non-empty bounded argv array`);
  }
  const command = provider.command.map((argument, index) => validateCommandArgument(argument, `${location}.command[${index}]`));
  const executable = path.basename(command[0]).toLowerCase();
  if (SHELL_EXECUTABLES.has(executable) || command.slice(1).some(argument => INLINE_EXECUTION_ARGUMENTS.has(argument))) {
    throw new Error(`${location}.command must not invoke a shell or inline command`);
  }
  const configuration = provider.configuration ?? {};
  assertPlainObject(configuration, `${location}.configuration`);
  assertJsonValue(configuration, `${location}.configuration`);
  assertNoUrlValues(configuration, `${location}.configuration`);
  return { command, configuration: cloneJson(configuration) };
}

export function validateExternalPrerequisiteFixture(fixture, location = 'fixture') {
  assertPlainObject(fixture, location);
  assertExactKeys(fixture, ['id', 'provider', 'resources'], location);
  assertIdentifier(fixture.id, `${location}.id`);
  const provider = validateProvider(fixture.provider, `${location}.provider`);
  if (!Array.isArray(fixture.resources) || fixture.resources.length === 0) {
    throw new Error(`${location}.resources must be a non-empty array`);
  }
  const resources = fixture.resources.map((resource, index) => validateResource(resource, `${location}.resources[${index}]`));
  const resourceIds = resources.map(resource => resource.id);
  if (new Set(resourceIds).size !== resourceIds.length) throw new Error(`${location}.resources contains duplicate ids`);
  return { id: fixture.id, provider, resources };
}

export function validateExternalPrerequisiteProfile(profile) {
  assertPlainObject(profile, 'profile');
  assertExactKeys(profile, ['version', 'fixtures'], 'profile');
  if (profile.version !== EXTERNAL_PREREQUISITE_PROFILE_VERSION) {
    throw new Error(`profile.version must equal ${EXTERNAL_PREREQUISITE_PROFILE_VERSION}`);
  }
  if (!Array.isArray(profile.fixtures)) throw new Error('profile.fixtures must be an array');
  const fixtures = profile.fixtures.map((fixture, index) => validateExternalPrerequisiteFixture(fixture, `profile.fixtures[${index}]`));
  const fixtureIds = fixtures.map(fixture => fixture.id);
  if (new Set(fixtureIds).size !== fixtureIds.length) throw new Error('profile.fixtures contains duplicate ids');
  return { version: EXTERNAL_PREREQUISITE_PROFILE_VERSION, fixtures };
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveRepositoryCommandPath(repositoryRoot, commandPath, location) {
  validateCommandArgument(commandPath, location);
  const candidate = path.resolve(repositoryRoot, commandPath);
  if (!isWithinRoot(repositoryRoot, candidate)) throw new Error(`${location} resolves outside the repository root`);
  const resolved = fs.realpathSync(candidate);
  if (!isWithinRoot(repositoryRoot, resolved)) throw new Error(`${location} resolves outside the repository root`);
  if (!fs.statSync(resolved).isFile()) throw new Error(`${location} must resolve to a file`);
  return resolved;
}

function isRepositoryPathArgument(argument) {
  return argument.startsWith('.') || argument.includes('/') || argument.includes('\\');
}

export function resolveExternalPrerequisiteProviderCommand(repositoryRoot, providerCommand) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new Error('repositoryRoot must be a path');
  }
  const { command } = validateProvider({ command: providerCommand }, 'provider');
  const root = fs.realpathSync(repositoryRoot);
  let hasRepositoryPath = false;
  let [executable] = command;
  if (isRepositoryPathArgument(executable)) {
    executable = resolveRepositoryCommandPath(root, executable, 'provider.command[0]');
    hasRepositoryPath = true;
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(executable)) {
    throw new Error('provider.command[0] must be a repository path or executable name');
  }

  const args = command.slice(1).map((argument, index) => {
    if (!isRepositoryPathArgument(argument)) return argument;
    hasRepositoryPath = true;
    return resolveRepositoryCommandPath(root, argument, `provider.command[${index + 1}]`);
  });
  if (!hasRepositoryPath) throw new Error('provider.command must reference a repository-local provider file');
  return { executable, args };
}

export function sanitizeExternalPrerequisiteEvidence(value, sensitiveValues = []) {
  const normalizedSensitiveValues = sensitiveValues
    .filter(item => typeof item === 'string' && item.length > 0)
    .sort((left, right) => right.length - left.length);
  const sanitize = current => {
    if (typeof current === 'string') {
      let output = current;
      for (const sensitiveValue of normalizedSensitiveValues) {
        output = output.replaceAll(sensitiveValue, () => REDACTION_MARKER);
      }
      return output
        .replace(URL_CREDENTIALS_PATTERN, `//${REDACTION_MARKER}@`)
        .replace(URL_PATTERN, REDACTION_MARKER)
        .replace(BEARER_PATTERN, REDACTION_MARKER)
        .replace(JWT_PATTERN, REDACTION_MARKER);
    }
    if (Array.isArray(current)) return current.map(sanitize);
    if (isPlainObject(current)) {
      return Object.fromEntries(
        Object.entries(current).map(([key, nestedValue]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? REDACTION_MARKER : sanitize(nestedValue),
        ]),
      );
    }
    return current;
  };
  return sanitize(value);
}

class ExternalPrerequisiteError extends Error {
  constructor(code, message, evidence = {}) {
    super(message);
    this.name = 'ExternalPrerequisiteError';
    this.code = code;
    this.evidence = sanitizeExternalPrerequisiteEvidence({ reasonCode: code, ...evidence });
  }
}

function errorWithEvidence(code, message, evidence) {
  return new ExternalPrerequisiteError(code, message, evidence);
}

function collectSensitiveValues(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectSensitiveValues(item, output));
  } else if (isPlainObject(value)) {
    Object.values(value).forEach(item => collectSensitiveValues(item, output));
  } else if (typeof value === 'string' && value.length > 0) {
    output.push(value);
  }
  return output;
}

function providerEnvironment() {
  return Object.fromEntries(
    ['PATH', 'SystemRoot', 'WINDIR'].filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]]),
  );
}

function validateProviderResult(result, fixture, action) {
  assertPlainObject(result, 'provider result');
  assertExactKeys(result, ['protocolVersion', 'fixtureId', 'state', 'resources'], 'provider result');
  if (result.protocolVersion !== EXTERNAL_PREREQUISITE_PROTOCOL_VERSION) {
    throw errorWithEvidence('provider-protocol-version-mismatch', 'Provider returned an unsupported protocol version');
  }
  if (result.fixtureId !== fixture.id) {
    throw errorWithEvidence('provider-fixture-mismatch', 'Provider returned a different fixture id');
  }
  const allowedStates = action === 'provision' ? new Set(['provisioned']) : CLEANUP_STATES;
  if (!allowedStates.has(result.state)) {
    throw errorWithEvidence('provider-lifecycle-state-invalid', 'Provider returned an invalid lifecycle state', { action });
  }
  if (!Array.isArray(result.resources) || result.resources.length !== fixture.resources.length) {
    throw errorWithEvidence('provider-resource-set-mismatch', 'Provider returned an incomplete resource set');
  }
  const declaredById = new Map(fixture.resources.map(resource => [resource.id, resource]));
  const seen = new Set();
  for (const [index, resource] of result.resources.entries()) {
    assertPlainObject(resource, `provider result.resources[${index}]`);
    assertExactKeys(resource, ['id', 'identity'], `provider result.resources[${index}]`);
    const declared = declaredById.get(resource.id);
    if (!declared || seen.has(resource.id)) {
      throw errorWithEvidence('provider-resource-set-mismatch', 'Provider returned an unknown or duplicate resource');
    }
    seen.add(resource.id);
    assertJsonValue(resource.identity, `provider result.resources[${index}].identity`);
    assertNoUrlValues(resource.identity, `provider result.resources[${index}].identity`);
    if (!isDeepStrictEqual(resource.identity, declared.identity)) {
      throw errorWithEvidence('provider-identity-mismatch', 'Provider altered a declared resource identity', {
        resourceId: resource.id,
      });
    }
  }
  return {
    protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
    fixtureId: fixture.id,
    state: result.state,
    resources: fixture.resources.map(resource => ({ id: resource.id, identity: cloneJson(resource.identity) })),
  };
}

function validatePriorProviderResult(result, fixture) {
  assertPlainObject(result, 'priorResult');
  const action = result.state === 'provisioned' ? 'provision' : 'cleanup';
  return validateProviderResult(result, fixture, action);
}

export function isSuccessfulExternalPrerequisiteCleanupState(state) {
  return CLEANUP_STATES.has(state);
}

export async function runExternalPrerequisiteProvider({
  repositoryRoot,
  fixture,
  action = 'provision',
  priorResult,
  secrets = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  spawnImpl = spawn,
}) {
  const validatedFixture = validateExternalPrerequisiteFixture(fixture);
  if (!['provision', 'cleanup'].includes(action)) throw new Error('action must be provision or cleanup');
  assertPlainObject(secrets, 'secrets');
  assertJsonValue(secrets, 'secrets', 0, { allowSensitiveKeys: true });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs must be a positive integer');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('maxOutputBytes must be a positive integer');

  let validatedPriorResult;
  if (action === 'cleanup') {
    if (priorResult === undefined) throw new Error('priorResult is required for cleanup');
    validatedPriorResult = validatePriorProviderResult(priorResult, validatedFixture);
  } else if (priorResult !== undefined) {
    throw new Error('priorResult is only accepted for cleanup');
  }

  const provider = resolveExternalPrerequisiteProviderCommand(repositoryRoot, validatedFixture.provider.command);
  const request = {
    protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
    action,
    fixtureId: validatedFixture.id,
    configuration: cloneJson(validatedFixture.provider.configuration),
    resources: validatedFixture.resources.map(resource => ({ id: resource.id, identity: cloneJson(resource.identity) })),
    secrets: cloneJson(secrets),
    ...(validatedPriorResult ? { priorResult: validatedPriorResult } : {}),
  };
  const requestText = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(requestText) > maxOutputBytes) {
    throw errorWithEvidence('provider-request-too-large', 'Provider request exceeds the protocol limit');
  }
  const sensitiveValues = collectSensitiveValues(secrets);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(provider.executable, [...provider.args, action], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: providerEnvironment(),
      });
    } catch {
      reject(errorWithEvidence('provider-spawn-failed', 'Provider could not be started'));
      return;
    }

    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let requestPipeFailed = false;
    let terminalError;
    let settled = false;
    const fail = error => {
      terminalError ??= error;
      if (child.pid) child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      fail(errorWithEvidence('provider-timeout', 'Provider exceeded its timeout', { timeoutMs }));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      if (terminalError) return;
      if (stdout.length + chunk.length > maxOutputBytes) {
        fail(errorWithEvidence('provider-stdout-too-large', 'Provider stdout exceeded the protocol limit', { maxOutputBytes }));
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutputBytes) {
        fail(errorWithEvidence('provider-stderr-too-large', 'Provider stderr exceeded the protocol limit', { maxOutputBytes }));
      }
    });
    child.on('error', () => {
      fail(errorWithEvidence('provider-spawn-failed', 'Provider could not be started'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (terminalError) {
        reject(terminalError);
        return;
      }
      if (code !== 0) {
        reject(errorWithEvidence('provider-exit-failed', 'Provider exited unsuccessfully', { exitCode: code }));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout.toString('utf8').trim());
      } catch {
        reject(errorWithEvidence('provider-result-malformed', 'Provider did not return one JSON result'));
        return;
      }
      if (requestPipeFailed) {
        reject(errorWithEvidence('provider-request-failed', 'Provider request pipe failed'));
        return;
      }
      try {
        resolve(validateProviderResult(parsed, validatedFixture, action));
      } catch (error) {
        if (error instanceof ExternalPrerequisiteError) {
          reject(error);
        } else {
          reject(
            errorWithEvidence('provider-result-invalid', 'Provider result failed strict validation', {
              validation: sanitizeExternalPrerequisiteEvidence(error instanceof Error ? error.message : String(error), sensitiveValues),
            }),
          );
        }
      }
    });

    child.stdio[3].on('error', () => {
      requestPipeFailed = true;
    });
    child.stdio[3].end(requestText);
  });
}

function localRef(document, value) {
  if (!isPlainObject(value) || typeof value.$ref !== 'string') return value;
  if (!value.$ref.startsWith('#/')) throw new Error('Canonical proof only supports local OAS references');
  let current = document;
  for (const segment of value.$ref.slice(2).split('/').map(decodePointerSegment)) {
    current = current?.[segment];
  }
  if (current === undefined) throw new Error(`Unresolved OAS reference: ${value.$ref}`);
  return current;
}

function declaredJsonResponse(document, operation, status) {
  const responses = operation.responses ?? {};
  const exactStatus = String(status);
  const upperStatusRange = `${Math.floor(status / 100)}XX`;
  const lowerStatusRange = `${Math.floor(status / 100)}xx`;
  let responseKey;
  if (Object.hasOwn(responses, exactStatus)) responseKey = exactStatus;
  else if (Object.hasOwn(responses, upperStatusRange)) responseKey = upperStatusRange;
  else if (Object.hasOwn(responses, lowerStatusRange)) responseKey = lowerStatusRange;
  if (!responseKey) return false;
  const response = localRef(document, responses[responseKey]);
  return Object.keys(response?.content ?? {}).some(contentType => {
    const normalized = contentType.toLowerCase().split(';', 1)[0].trim();
    return normalized === 'application/json' || normalized.endsWith('+json');
  });
}

function operationPathParameters(document, pathItem, operation) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(parameter => localRef(document, parameter));
}

export function resolveExternalPrerequisiteCanonicalRead(openApi, resource) {
  assertPlainObject(openApi, 'openApi');
  const validatedResource = validateResource(resource, 'resource');
  const matches = [];
  for (const [pathTemplate, pathItemValue] of Object.entries(openApi.paths ?? {})) {
    const pathItem = localRef(openApi, pathItemValue);
    for (const [method, operationValue] of Object.entries(pathItem ?? {})) {
      if (!OPENAPI_METHODS.has(method.toLowerCase()) || !isPlainObject(operationValue)) continue;
      const operation = localRef(openApi, operationValue);
      if (operation.operationId === validatedResource.canonicalRead.operationId) {
        matches.push({ method: method.toUpperCase(), pathTemplate, pathItem, operation });
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(`canonicalRead.operationId must resolve exactly once, resolved ${matches.length} times`);
  }
  const resolved = matches[0];
  if (resolved.method !== 'GET') throw new Error('canonicalRead.operationId must resolve to GET');
  const placeholders = [...resolved.pathTemplate.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
  const declaredNames = Object.keys(validatedResource.canonicalRead.pathParameters);
  if (
    placeholders.length !== declaredNames.length ||
    placeholders.some(name => !declaredNames.includes(name)) ||
    declaredNames.some(name => !placeholders.includes(name))
  ) {
    throw new Error('canonicalRead.pathParameters must exactly match the OAS path template');
  }
  const oasPathParameters = operationPathParameters(openApi, resolved.pathItem, resolved.operation);
  for (const parameterName of placeholders) {
    const parameter = oasPathParameters.find(candidate => candidate?.in === 'path' && candidate?.name === parameterName);
    if (!parameter || parameter.required !== true) {
      throw new Error(`OAS path parameter ${parameterName} must be declared and required`);
    }
  }
  for (const status of validatedResource.canonicalRead.expectedStatuses) {
    if (!declaredJsonResponse(openApi, resolved.operation, status)) {
      throw new Error(`Expected status ${status} must declare a JSON OAS response`);
    }
  }
  return { ...resolved, resource: validatedResource };
}

function concreteCanonicalPath(pathTemplate, pathParameters, identity) {
  return pathTemplate.replaceAll(/\{([^{}]+)\}/g, (_match, parameterName) => {
    const pointer = pathParameters[parameterName];
    const identityValue = valueAtPointer(identity, pointer, `canonicalRead.pathParameters.${parameterName}`);
    if (!identityValue.found) throw new Error(`Identity pointer for ${parameterName} did not resolve`);
    return encodeURIComponent(String(identityValue.value));
  });
}

function serverUrl(openApi, resolved, baseUrl) {
  const server = resolved.operation.servers?.[0] ?? resolved.pathItem.servers?.[0] ?? openApi.servers?.[0];
  if (!server) return new URL(baseUrl);
  if (!isPlainObject(server) || typeof server.url !== 'string' || server.url.length === 0) {
    throw new Error('OAS server must declare a URL');
  }
  const expanded = server.url.replaceAll(/\{([^{}]+)\}/g, (_match, variable) => {
    const defaultValue = server.variables?.[variable]?.default;
    if (defaultValue === undefined) throw new Error(`OAS server variable ${variable} has no default`);
    return encodeURIComponent(String(defaultValue));
  });
  if (expanded.includes('{') || expanded.includes('}')) throw new Error('OAS server URL contains unresolved variables');
  return new URL(expanded, baseUrl);
}

function canonicalRequestUrl(openApi, resolved, baseUrl, concretePath) {
  const trustedOrigin = new URL(baseUrl);
  if (trustedOrigin.username || trustedOrigin.password) throw new Error('baseUrl must not contain credentials');
  const server = serverUrl(openApi, resolved, trustedOrigin);
  if (server.username || server.password || server.origin !== trustedOrigin.origin) {
    throw new Error('Canonical read must remain on the trusted origin');
  }
  const serverPath = server.pathname.endsWith('/') ? server.pathname.slice(0, -1) : server.pathname;
  const operationPath = concretePath.startsWith('/') ? concretePath : `/${concretePath}`;
  const requestUrl = new URL(server);
  requestUrl.pathname = `${serverPath}${operationPath}`.replaceAll(/\/{2,}/g, '/');
  requestUrl.search = '';
  requestUrl.hash = '';
  if (requestUrl.origin !== trustedOrigin.origin) throw new Error('Canonical read must remain on the trusted origin');
  return requestUrl;
}

function validateAuthentication(authentication) {
  if (authentication === undefined) return {};
  assertPlainObject(authentication, 'authentication');
  assertExactKeys(authentication, ['headers'], 'authentication');
  assertPlainObject(authentication.headers, 'authentication.headers');
  const headers = {};
  for (const [name, value] of Object.entries(authentication.headers)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      /^(?:connection|content-length|host|transfer-encoding)$/i.test(name) ||
      typeof value !== 'string'
    ) {
      throw new Error('authentication.headers contains an invalid header');
    }
    headers[name] = value;
  }
  return headers;
}

async function boundedResponseText(response, maxResponseBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error('Canonical response exceeds the size limit');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxResponseBytes) {
      await reader.cancel();
      throw new Error('Canonical response exceeds the size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function assertionPassed(assertion, body) {
  const actual = valueAtPointer(body, assertion.pointer, `assertion ${assertion.pointer}`);
  if (assertion.operator === 'exists') return actual.found === assertion.value;
  if (!actual.found) return false;
  if (assertion.operator === 'equals') return isDeepStrictEqual(actual.value, assertion.value);
  if (assertion.operator === 'notEquals') return !isDeepStrictEqual(actual.value, assertion.value);
  if (assertion.operator === 'includes') {
    if (typeof actual.value === 'string' && typeof assertion.value === 'string') return actual.value.includes(assertion.value);
    return Array.isArray(actual.value) && actual.value.some(item => isDeepStrictEqual(item, assertion.value));
  }
  return false;
}

function failedProof(fixtureId, resourceId, reasonCode, details = {}) {
  return {
    fixtureId,
    resourceId,
    proof: 'failed',
    evidence: sanitizeExternalPrerequisiteEvidence({
      protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
      reasonCode,
      ...details,
    }),
  };
}

export async function proveExternalPrerequisiteResource({
  fixtureId,
  resource,
  openApi,
  baseUrl,
  authentication,
  fetchImpl = globalThis.fetch,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
}) {
  assertIdentifier(fixtureId, 'fixtureId');
  const validatedResource = validateResource(resource, 'resource');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive integer');
  }

  let resolved;
  let requestUrl;
  try {
    resolved = resolveExternalPrerequisiteCanonicalRead(openApi, validatedResource);
    const concretePath = concreteCanonicalPath(
      resolved.pathTemplate,
      validatedResource.canonicalRead.pathParameters,
      validatedResource.identity,
    );
    requestUrl = canonicalRequestUrl(openApi, resolved, baseUrl, concretePath);
  } catch {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-resolution-failed');
  }

  let headers;
  try {
    headers = { accept: 'application/json', ...validateAuthentication(authentication) };
  } catch {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-authentication-invalid');
  }

  let response;
  try {
    response = await fetchImpl(requestUrl, { method: 'GET', headers, redirect: 'manual' });
  } catch {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-request-failed');
  }
  if (!response || !Number.isInteger(response.status) || typeof response.headers?.get !== 'function') {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-request-failed');
  }
  if (!validatedResource.canonicalRead.expectedStatuses.includes(response.status)) {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-status-failed', { status: response.status });
  }
  if (!declaredJsonResponse(openApi, resolved.operation, response.status)) {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-oas-response-failed', { status: response.status });
  }
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-content-type-failed', { status: response.status });
  }

  let body;
  try {
    const text = await boundedResponseText(response, maxResponseBytes);
    body = JSON.parse(text);
  } catch {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-json-failed', { status: response.status });
  }

  const identityEvidence = [];
  for (const identity of identityLeaves(validatedResource.identity)) {
    const actual = valueAtPointer(body, identity.pointer, `identity ${identity.pointer}`);
    const passed = actual.found && isDeepStrictEqual(actual.value, identity.value);
    identityEvidence.push({ pointer: identity.pointer, passed });
    if (!passed) {
      return failedProof(fixtureId, validatedResource.id, 'canonical-read-identity-failed', {
        status: response.status,
        identity: identityEvidence,
      });
    }
  }

  const assertionEvidence = validatedResource.canonicalRead.assertions.map(assertion => ({
    pointer: assertion.pointer,
    operator: assertion.operator,
    passed: assertionPassed(assertion, body),
  }));
  if (assertionEvidence.some(assertion => !assertion.passed)) {
    return failedProof(fixtureId, validatedResource.id, 'canonical-read-assertion-failed', {
      status: response.status,
      assertions: assertionEvidence,
    });
  }

  return {
    fixtureId,
    resourceId: validatedResource.id,
    identity: cloneJson(validatedResource.identity),
    enabledOperations: cloneJson(validatedResource.enabledOperations),
    proof: 'passed',
    evidence: {
      protocolVersion: EXTERNAL_PREREQUISITE_PROTOCOL_VERSION,
      operationId: validatedResource.canonicalRead.operationId,
      method: 'GET',
      pathTemplate: resolved.pathTemplate,
      status: response.status,
      identity: identityEvidence,
      assertions: assertionEvidence,
    },
  };
}

export async function proveExternalPrerequisiteFixture({
  fixture,
  providerResult,
  openApi,
  baseUrl,
  authentication,
  fetchImpl = globalThis.fetch,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
}) {
  const validatedFixture = validateExternalPrerequisiteFixture(fixture);
  let validatedProviderResult;
  try {
    validatedProviderResult = validateProviderResult(providerResult, validatedFixture, 'provision');
  } catch {
    return validatedFixture.resources.map(resource => failedProof(validatedFixture.id, resource.id, 'provider-provisioning-unverified'));
  }
  if (validatedProviderResult.state !== 'provisioned') {
    return validatedFixture.resources.map(resource => failedProof(validatedFixture.id, resource.id, 'provider-provisioning-unverified'));
  }
  return Promise.all(
    validatedFixture.resources.map(resource =>
      proveExternalPrerequisiteResource({
        fixtureId: validatedFixture.id,
        resource,
        openApi,
        baseUrl,
        authentication,
        fetchImpl,
        maxResponseBytes,
      }),
    ),
  );
}
