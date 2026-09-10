#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const redactionMarker = '[REDACTED]';
const tokenShapeSource = String.raw`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`;
const bearerCredentialPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const urlCredentialsPattern = /([a-z][a-z\d+.-]*:\/\/)[^/@\s"]+@/gi;
const urlCredentialParameterPattern =
  /([?&#](?:access[_-]?token|id[_-]?token|refresh[_-]?token|authorization|api[_-]?key|password|secret|credential)=)[^&#\s"]*/gi;

export function containsTokenShapedValue(value) {
  return new RegExp(tokenShapeSource).test(String(value));
}

function redactText(value, sensitiveValues) {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.replaceAll(sensitiveValue, redactionMarker);
  }
  return redacted
    .replace(urlCredentialsPattern, `$1${redactionMarker}@`)
    .replace(urlCredentialParameterPattern, `$1${redactionMarker}`)
    .replace(new RegExp(tokenShapeSource, 'g'), redactionMarker)
    .replace(bearerCredentialPattern, `Bearer ${redactionMarker}`);
}

export function redactHarnessDiagnostics(value, sensitiveValues = []) {
  const normalizedSensitiveValues = sensitiveValues.filter(
    sensitiveValue => typeof sensitiveValue === 'string' && sensitiveValue.length > 0,
  );

  const redact = current => {
    if (typeof current === 'string') return redactText(current, normalizedSensitiveValues);
    if (Array.isArray(current)) return current.map(redact);
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).map(([key, nestedValue]) => [key, redact(nestedValue)]));
    }
    return current;
  };

  return redact(value);
}

export function artifactsContainTokenShapedValue(filenames) {
  return filenames.some(filename => containsTokenShapedValue(fs.readFileSync(filename, 'utf8')));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [command, ...filenames] = process.argv.slice(2);
  if (command !== '--scan-artifacts' || filenames.length === 0) {
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = artifactsContainTokenShapedValue(filenames) ? 0 : 1;
    } catch {
      process.exitCode = 2;
    }
  }
}
