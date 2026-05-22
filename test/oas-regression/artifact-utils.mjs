#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function usage() {
  console.error('Usage: artifact-utils.mjs list --artifact-root <dir> --workspace-root <dir> [--app-root <dir>] [--format json|tsv]');
  process.exit(2);
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

function slugify(value) {
  return value
    .replace(/\.(yaml|yml|jdl)$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function parseJdlConfig(jdlText) {
  const configBlock = jdlText.match(/application\s*\{[\s\S]*?config\s*\{([\s\S]*?)\}[\s\S]*?\}/m)?.[1] ?? '';
  const config = {};
  for (const line of configBlock.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/);
    if (match) config[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return config;
}

function envMatcher(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  return value => parts.some(part => new RegExp(part, 'i').test(value));
}

function discoverPairs({ artifactRoot, workspaceRoot, appRoot }) {
  const include = envMatcher('ARTIFACT_INCLUDE');
  const exclude = envMatcher('ARTIFACT_EXCLUDE');
  const entries = fs.readdirSync(artifactRoot, { withFileTypes: true });
  const yamlFiles = entries
    .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const missing = [];
  const pairs = [];
  for (const yamlName of yamlFiles) {
    const stem = yamlName.replace(/\.ya?ml$/i, '');
    const jdlName = `${stem}.jdl`;
    const yamlPath = path.join(artifactRoot, yamlName);
    const jdlPath = path.join(artifactRoot, jdlName);
    const slug = slugify(stem);
    const searchable = `${slug} ${yamlName} ${jdlName}`;
    if (include && !include(searchable)) continue;
    if (exclude?.(searchable)) continue;
    if (!fs.existsSync(jdlPath)) {
      missing.push({ yaml: yamlPath, expectedJdl: jdlPath });
      continue;
    }
    const config = parseJdlConfig(fs.readFileSync(jdlPath, 'utf8'));
    pairs.push({
      name: slug,
      yaml: yamlPath,
      jdl: jdlPath,
      appDir: path.join(appRoot, `test-${slug}-app`),
      baseName: config.baseName ?? slug.replace(/-/g, '_'),
      packageName: config.packageName,
      databaseUser: config.prodDatabaseUsername ?? config.devDatabaseUsername ?? config.baseName ?? slug.replace(/-/g, '_'),
      databaseName: config.prodDatabaseName ?? config.devDatabaseName ?? config.baseName ?? slug.replace(/-/g, '_'),
    });
  }

  if (missing.length) {
    const message = missing.map(pair => `Missing JDL for ${pair.yaml}; expected ${pair.expectedJdl}`).join('\n');
    throw new Error(message);
  }
  return pairs;
}

if (process.argv[2] !== 'list') usage();

const artifactRoot = optionValue('--artifact-root', process.env.ARTIFACT_ROOT);
const workspaceRoot = optionValue('--workspace-root', process.env.WORKSPACE_ROOT);
const appRoot = optionValue('--app-root', process.env.REGRESSION_APP_ROOT ?? workspaceRoot);
const format = optionValue('--format', 'json');
if (!artifactRoot || !workspaceRoot || !appRoot) usage();

const pairs = discoverPairs({
  artifactRoot: path.resolve(artifactRoot),
  workspaceRoot: path.resolve(workspaceRoot),
  appRoot: path.resolve(appRoot),
});

if (format === 'tsv') {
  for (const pair of pairs) {
    console.log([pair.name, pair.appDir, pair.jdl, pair.yaml, pair.databaseUser, pair.databaseName, pair.baseName].join('\t'));
  }
} else if (format === 'json') {
  console.log(JSON.stringify(pairs, null, 2));
} else {
  usage();
}
