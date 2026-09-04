#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, outputPath, endpointId, ...options] = process.argv;

if (!inputPath || !outputPath || !endpointId) {
  console.error('Usage: evomaster-filter-postman-seed.mjs <input.postman.json> <output.postman.json> <endpoint-id> [--strip-bodies]');
  process.exit(2);
}

const stripBodies = options.includes('--strip-bodies') || /^(1|true|yes)$/i.test(process.env.EVOMASTER_FILTER_STRIP_BODIES ?? '');

function endpointParts(value) {
  const match = String(value).match(/^([A-Z]+):(\/.*)$/);
  if (!match) return undefined;
  return { method: match[1], path: match[2] };
}

function normalizePathPart(value) {
  return `/${String(value ?? '')
    .split('/')
    .filter(Boolean)
    .join('/')}`;
}

function postmanItemPath(item) {
  const url = item?.request?.url;
  if (Array.isArray(url?.path)) return normalizePathPart(url.path.join('/'));
  if (typeof url?.raw === 'string') {
    try {
      return normalizePathPart(new URL(url.raw, 'http://localhost').pathname);
    } catch {
      return normalizePathPart(url.raw.split('?')[0]);
    }
  }
  return undefined;
}

function pathMatches(templatePath, concretePath) {
  const templateSegments = normalizePathPart(templatePath).split('/').filter(Boolean);
  const concreteSegments = normalizePathPart(concretePath).split('/').filter(Boolean);
  return (
    templateSegments.length === concreteSegments.length &&
    templateSegments.every((segment, index) => (segment.startsWith('{') && segment.endsWith('}')) || segment === concreteSegments[index])
  );
}

const endpoint = endpointParts(endpointId);
if (!endpoint) {
  console.error(`Invalid EvoMaster endpoint id: ${endpointId}`);
  process.exit(1);
}

const collection = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
let strippedBodies = 0;
const items = (collection.item ?? [])
  .filter(item => {
    const method = String(item?.request?.method ?? '').toUpperCase();
    const itemPath = postmanItemPath(item);
    return method === endpoint.method && itemPath && pathMatches(endpoint.path, itemPath);
  })
  .map(item => {
    if (!stripBodies) return item;
    const output = JSON.parse(JSON.stringify(item));
    if (output.request?.body !== undefined) {
      delete output.request.body;
      strippedBodies += 1;
    }
    if (Array.isArray(output.request?.header)) {
      output.request.header = output.request.header.filter(header => !/^content-type$/i.test(String(header?.key ?? header?.name ?? '')));
    }
    return output;
  });

const output = {
  ...collection,
  item: items,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ seedFile: outputPath, itemCount: items.length, stripBodies, strippedBodies }));
