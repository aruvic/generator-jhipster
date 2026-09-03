#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const options = parseArgs(process.argv.slice(2));
const host = options.host ?? process.env.FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_HOST ?? '127.0.0.1';
const port = positiveInteger(options.port ?? process.env.FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_PORT, 8085);
const storagePath =
  options.storage ??
  process.env.FORM_CRUD_REFERENCE_PICKER_CONFIG_SERVICE_STORAGE ??
  path.join(process.env.OUTPUT_DIR ?? '/tmp/generator-jhipster-regression', 'form-crud-reference-pickers.json');

fs.mkdirSync(path.dirname(storagePath), { recursive: true });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
    if (url.pathname === '/management/health') {
      sendJson(response, 200, { status: 'UP' });
      return;
    }
    if (url.pathname === '/api/form-crud-reference-pickers') {
      await handleCollection(request, response);
      return;
    }
    if (url.pathname.startsWith('/api/form-crud-reference-pickers/')) {
      await handleItem(request, response, decodeURIComponent(url.pathname.slice('/api/form-crud-reference-pickers/'.length)));
      return;
    }
    sendJson(response, 404, problem(404, 'Not Found', `No route for ${request.method} ${url.pathname}`));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    sendJson(response, status, problem(status, status === 500 ? 'Internal Server Error' : 'Bad Request', error?.message ?? String(error)));
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Form CRUD reference picker config service listening at http://${host}:${port}\n`);
  process.stdout.write(`Storage: ${storagePath}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}

async function handleCollection(request, response) {
  if (request.method === 'GET') {
    sendJson(response, 200, readConfigs());
    return;
  }
  if (request.method === 'PUT') {
    const configs = sanitizeConfigs(await readJsonBody(request));
    writeConfigs(configs);
    sendJson(response, 200, configs);
    return;
  }
  if (request.method === 'POST') {
    const config = sanitizeConfig(await readJsonBody(request));
    const configs = readConfigs();
    const next = configs.filter(candidate => candidate.pickerId !== config.pickerId);
    next.push(config);
    writeConfigs(next);
    sendJson(response, 201, config);
    return;
  }
  sendJson(response, 405, problem(405, 'Method Not Allowed', `${request.method} is not supported for reference picker collection`));
}

async function handleItem(request, response, pickerId) {
  if (!pickerId.trim()) {
    sendJson(response, 400, problem(400, 'Bad Request', 'pickerId is required'));
    return;
  }
  const configs = readConfigs();
  const index = configs.findIndex(config => config.pickerId === pickerId);
  if (request.method === 'GET') {
    if (index === -1) {
      sendJson(response, 404, problem(404, 'Not Found', `Reference picker ${pickerId} was not found`));
      return;
    }
    sendJson(response, 200, configs[index]);
    return;
  }
  if (request.method === 'PATCH') {
    if (index === -1) {
      sendJson(response, 404, problem(404, 'Not Found', `Reference picker ${pickerId} was not found`));
      return;
    }
    const patch = await readJsonBody(request);
    const merged = sanitizeConfig({ ...configs[index], ...patch, pickerId });
    configs[index] = merged;
    writeConfigs(configs);
    sendJson(response, 200, merged);
    return;
  }
  if (request.method === 'DELETE') {
    if (index !== -1) {
      configs.splice(index, 1);
      writeConfigs(configs);
    }
    response.writeHead(204);
    response.end();
    return;
  }
  sendJson(response, 405, problem(405, 'Method Not Allowed', `${request.method} is not supported for reference picker item`));
}

function sanitizeConfigs(value) {
  if (!Array.isArray(value)) {
    throw httpError(400, 'Reference picker configuration payload must be an array');
  }
  return value.map(sanitizeConfig);
}

function sanitizeConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Reference picker configuration item must be an object');
  }
  const next = { ...value };
  const pickerId = firstText(next.pickerId, next.id);
  const sourcePath = firstText(next.sourcePath);
  const collectionPath = firstText(next.collectionPath);
  if (!pickerId) {
    throw httpError(400, 'Each reference picker needs pickerId');
  }
  if (!sourcePath || !collectionPath) {
    throw httpError(400, 'Each reference picker needs sourcePath and collectionPath');
  }
  next.pickerId = pickerId;
  next.sourcePath = sourcePath;
  next.collectionPath = collectionPath;
  delete next.id;
  if (next.displayFields !== undefined && !Array.isArray(next.displayFields)) {
    throw httpError(400, 'displayFields must be an array when provided');
  }
  if (next.copyFields !== undefined && !Array.isArray(next.copyFields)) {
    throw httpError(400, 'copyFields must be an array when provided');
  }
  return next;
}

function readConfigs() {
  if (!fs.existsSync(storagePath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  return sanitizeConfigs(parsed);
}

function writeConfigs(configs) {
  fs.writeFileSync(storagePath, `${JSON.stringify(configs, null, 2)}\n`);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(httpError(400, `Invalid JSON payload: ${error?.message ?? error}`));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body, null, 2));
}

function problem(status, title, detail) {
  return {
    type: 'about:blank',
    title,
    status,
    detail,
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return undefined;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host') parsed.host = args[++index];
    else if (arg === '--port') parsed.port = args[++index];
    else if (arg === '--storage') parsed.storage = args[++index];
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
