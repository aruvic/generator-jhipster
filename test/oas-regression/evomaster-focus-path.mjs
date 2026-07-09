#!/usr/bin/env node
import fs from 'node:fs';
import { parse } from 'yaml';

const [, , schemaPath, endpointId] = process.argv;

if (!schemaPath || !endpointId) {
  console.error('Usage: evomaster-focus-path.mjs <openapi-yaml> <endpoint-id>');
  process.exit(2);
}

function endpointPathFromId(value) {
  const match = String(value).match(/^[A-Z]+:(\/.*)$/);
  return match ? match[1] : String(value);
}

function normalizePath(value) {
  const normalized = String(value || '').replace(/\/+$/g, '');
  return normalized || '/';
}

function pathMatchesReportedPath(schemaPathValue, reportedPathValue) {
  const schemaCandidate = normalizePath(schemaPathValue);
  const reportedPath = normalizePath(reportedPathValue);
  if (schemaCandidate === reportedPath) return true;
  if (schemaCandidate === '/') return false;
  return reportedPath.endsWith(schemaCandidate);
}

function collectionPathForItemPath(schemaPathValue, allSchemaPaths) {
  const normalized = normalizePath(schemaPathValue);
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length < 2) return undefined;
  const last = segments[segments.length - 1];
  if (!/^\{[^}]+\}$/.test(last)) return undefined;
  const candidate = `/${segments.slice(0, -1).join('/')}`;
  return allSchemaPaths.find(pathValue => normalizePath(pathValue) === candidate);
}

const reportedPath = endpointPathFromId(endpointId);

let doc;
try {
  doc = parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (error) {
  console.error(`Could not read OpenAPI schema for EvoMaster focus resolution: ${error.message}`);
  process.exit(1);
}

const schemaPaths = Object.keys(doc?.paths ?? {});
if (!schemaPaths.length) {
  console.error(`OpenAPI schema has no paths for EvoMaster focus resolution: ${schemaPath}`);
  process.exit(1);
}

const match = schemaPaths
  .filter(schemaPathValue => pathMatchesReportedPath(schemaPathValue, reportedPath))
  .sort((left, right) => normalizePath(right).length - normalizePath(left).length)[0];

if (!match) {
  console.error(`Could not resolve EvoMaster focus path for endpoint ${endpointId}`);
  process.exit(1);
}

console.log(collectionPathForItemPath(match, schemaPaths) ?? match);
