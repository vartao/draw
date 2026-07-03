const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WEBAPP_DIR = path.resolve(process.env.DRAWIO_WEBAPP_DIR || path.join(ROOT_DIR, 'src', 'main', 'webapp'));
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DRAWIO_DATA_DIR || path.join(__dirname, 'data'));
const EMPLOYEE_DIR = path.join(DATA_DIR, 'employees');
const SHARES_DIR = path.join(DATA_DIR, 'shares');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8081);
const TEMP_PASSWORD = process.env.DRAWIO_TEMP_PASSWORD || '123456';
const COOKIE_NAME = process.env.DRAWIO_COOKIE_NAME || 'company_drawio_session';
const SESSION_DAYS = Number(process.env.DRAWIO_SESSION_DAYS || 7);
const SESSION_TTL_MS = Math.max(1, SESSION_DAYS) * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = Number(process.env.DRAWIO_MAX_JSON_BYTES || 25 * 1024 * 1024);
const MAX_EXPORT_BYTES = Number(process.env.DRAWIO_MAX_EXPORT_BYTES || 50 * 1024 * 1024);
const ACCESS_LOG_FILE = String(process.env.DRAWIO_ACCESS_LOG || '').toLowerCase() === 'off' ?
  null :
  path.resolve(process.env.DRAWIO_ACCESS_LOG || path.join(LOG_DIR, 'access.log'));
const OPS_TOKEN = process.env.DRAWIO_OPS_TOKEN || '';
const STARTED_AT_MS = Date.now();
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

const EMPTY_DIAGRAM_XML = '<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

const sessions = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm',
  '.vsdx': 'application/octet-stream',
  '.drawio': 'application/xml; charset=utf-8'
};

function nowIso() {
  return new Date().toISOString();
}

function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmployeeId(value) {
  return String(value || '').trim();
}

function isValidEmployeeId(value) {
  return EMPLOYEE_ID_PATTERN.test(value);
}

function isValidFileId(value) {
  return FILE_ID_PATTERN.test(String(value || ''));
}

function isValidToken(value) {
  return TOKEN_PATTERN.test(String(value || ''));
}

function sanitizeFileName(value) {
  let name = String(value || '').trim();

  if (name.length === 0) {
    name = 'untitled.drawio';
  }

  name = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  if (name.length === 0) {
    name = 'untitled.drawio';
  }

  if (!/\.drawio$/i.test(name)) {
    name += '.drawio';
  }

  return name.slice(0, 180);
}

function parseCookies(header) {
  const cookies = {};

  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');

    if (index > -1) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();

      if (key) {
        try {
          cookies[key] = decodeURIComponent(value);
        } catch (_err) {
          cookies[key] = value;
        }
      }
    }
  });

  return cookies;
}

function buildCookie(value, options = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (process.env.DRAWIO_COOKIE_SECURE === '1') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function clearCookie() {
  return buildCookie('', { maxAge: 0 });
}

async function ensureDataDirs() {
  await fsp.mkdir(EMPLOYEE_DIR, { recursive: true });
  await fsp.mkdir(SHARES_DIR, { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
}

async function ensureEmployeeDirs(employeeId) {
  const base = employeeBaseDir(employeeId);
  await fsp.mkdir(path.join(base, 'files'), { recursive: true });
  await fsp.mkdir(path.join(base, 'meta'), { recursive: true });
}

async function directoryStats(rootDir) {
  const stats = {
    bytes: 0,
    files: 0,
    directories: 0
  };

  async function visit(currentDir) {
    let entries;

    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return;
      }

      throw err;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stats.directories += 1;
        await visit(entryPath);
      } else if (entry.isFile()) {
        const fileStat = await fsp.stat(entryPath);
        stats.files += 1;
        stats.bytes += fileStat.size;
      }
    }
  }

  await visit(rootDir);
  return stats;
}

async function countFilesInDir(rootDir, predicate) {
  let count = 0;

  async function visit(currentDir) {
    let entries;

    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return;
      }

      throw err;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && predicate(entryPath, entry.name)) {
        count += 1;
      }
    }
  }

  await visit(rootDir);
  return count;
}

async function checkDataWritable() {
  const filePath = path.join(DATA_DIR, `.healthcheck-${process.pid}-${Date.now()}.tmp`);

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(filePath, nowIso(), 'utf8');
    await fsp.unlink(filePath);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err.code || err.message
    };
  }
}

async function getEmployeeCount() {
  try {
    const entries = await fsp.readdir(EMPLOYEE_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && isValidEmployeeId(entry.name)).length;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return 0;
    }

    throw err;
  }
}

async function getOperationalStatus() {
  await ensureDataDirs();

  const [
    writable,
    dataStats,
    employeeStats,
    shareStats,
    logStats,
    employeeCount,
    diagramCount,
    metadataCount,
    shareCount
  ] = await Promise.all([
    checkDataWritable(),
    directoryStats(DATA_DIR),
    directoryStats(EMPLOYEE_DIR),
    directoryStats(SHARES_DIR),
    directoryStats(LOG_DIR),
    getEmployeeCount(),
    countFilesInDir(EMPLOYEE_DIR, (_entryPath, name) => name.endsWith('.drawio')),
    countFilesInDir(EMPLOYEE_DIR, (_entryPath, name) => name.endsWith('.json')),
    countFilesInDir(SHARES_DIR, (_entryPath, name) => name.endsWith('.json'))
  ]);

  return {
    ok: writable.ok,
    time: nowIso(),
    startedAt: new Date(STARTED_AT_MS).toISOString(),
    uptimeSeconds: Math.round((Date.now() - STARTED_AT_MS) / 1000),
    data: {
      directory: DATA_DIR,
      writable: writable.ok,
      writeError: writable.error || null
    },
    counts: {
      activeSessions: sessions.size,
      employees: employeeCount,
      diagrams: diagramCount,
      metadata: metadataCount,
      shares: shareCount
    },
    storage: {
      dataBytes: dataStats.bytes,
      employeeBytes: employeeStats.bytes,
      shareBytes: shareStats.bytes,
      logBytes: logStats.bytes,
      dataFiles: dataStats.files,
      dataDirectories: dataStats.directories
    },
    config: {
      sessionDays: SESSION_DAYS,
      maxJsonBytes: MAX_JSON_BYTES,
      maxExportBytes: MAX_EXPORT_BYTES,
      secureCookie: process.env.DRAWIO_COOKIE_SECURE === '1',
      accessLog: ACCESS_LOG_FILE || 'off',
      opsTokenRequired: Boolean(OPS_TOKEN),
      exportProxy: Boolean(process.env.DRAWIO_EXPORT_URL)
    }
  };
}

async function loadSessions() {
  try {
    const raw = await fsp.readFile(SESSIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const now = Date.now();

    rows.forEach((row) => {
      if (
        row &&
        typeof row.tokenHash === 'string' &&
        isValidEmployeeId(row.employeeId) &&
        typeof row.expiresAt === 'string' &&
        Date.parse(row.expiresAt) > now
      ) {
        sessions.set(row.tokenHash, {
          employeeId: row.employeeId,
          createdAt: row.createdAt || nowIso(),
          expiresAt: row.expiresAt
        });
      }
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Unable to load sessions: ${err.message}`);
    }
  }
}

async function atomicWrite(filePath, body) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, body, 'utf8');
  await fsp.rename(tmp, filePath);
}

async function saveSessions() {
  await ensureDataDirs();
  pruneExpiredSessions();

  const rows = Array.from(sessions.entries()).map(([tokenHash, session]) => ({
    tokenHash,
    employeeId: session.employeeId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  }));
  const body = JSON.stringify({ savedAt: nowIso(), sessions: rows }, null, 2);
  await atomicWrite(SESSIONS_FILE, body);
}

function pruneExpiredSessions() {
  const now = Date.now();

  for (const [tokenHash, session] of sessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) {
      sessions.delete(tokenHash);
    }
  }
}

function getSession(req) {
  pruneExpiredSessions();

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

  if (!token) {
    return null;
  }

  return sessions.get(hashValue(token)) || null;
}

async function createSession(employeeId) {
  const token = randomToken();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  sessions.set(hashValue(token), { employeeId, createdAt, expiresAt });
  await ensureEmployeeDirs(employeeId);
  await saveSessions();

  return { token, expiresAt };
}

async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

  if (token) {
    sessions.delete(hashValue(token));
    await saveSessions();
  }
}

function employeeBaseDir(employeeId) {
  return path.join(EMPLOYEE_DIR, employeeId);
}

function filePaths(employeeId, fileId) {
  if (!isValidEmployeeId(employeeId) || !isValidFileId(fileId)) {
    return null;
  }

  const base = employeeBaseDir(employeeId);
  return {
    xml: path.join(base, 'files', `${fileId}.drawio`),
    meta: path.join(base, 'meta', `${fileId}.json`)
  };
}

function sharePathForHash(tokenHash) {
  return path.join(SHARES_DIR, `${tokenHash}.json`);
}

async function readMeta(employeeId, fileId) {
  const paths = filePaths(employeeId, fileId);

  if (!paths) {
    return null;
  }

  try {
    const raw = await fsp.readFile(paths.meta, 'utf8');
    const meta = JSON.parse(raw);

    if (meta && meta.id === fileId && meta.employeeId === employeeId) {
      return meta;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return null;
}

async function writeMeta(employeeId, fileId, meta) {
  const paths = filePaths(employeeId, fileId);

  if (!paths) {
    throw Object.assign(new Error('Invalid file id'), { status: 400, code: 'invalid_file_id' });
  }

  await atomicWrite(paths.meta, JSON.stringify(meta, null, 2));
}

function fileSummary(meta) {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    size: meta.size,
    etag: meta.etag
  };
}

function attachmentName(name, extension) {
  const baseName = sanitizeFileName(name || 'diagram.drawio').replace(/\.drawio$/i, '');
  return `${baseName}${extension}`;
}

function contentDisposition(filename) {
  const fallback = String(filename || 'diagram.drawio')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function listFiles(employeeId) {
  await ensureEmployeeDirs(employeeId);
  const metaDir = path.join(employeeBaseDir(employeeId), 'meta');
  const entries = await fsp.readdir(metaDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const raw = await fsp.readFile(path.join(metaDir, entry.name), 'utf8');
        const meta = JSON.parse(raw);

        if (meta && meta.employeeId === employeeId && isValidFileId(meta.id)) {
          files.push(fileSummary(meta));
        }
      } catch (err) {
        console.warn(`Skipping invalid metadata ${entry.name}: ${err.message}`);
      }
    }
  }

  files.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return files;
}

async function createFile(employeeId, name, xml) {
  await ensureEmployeeDirs(employeeId);
  const id = crypto.randomUUID();
  const body = typeof xml === 'string' && xml.trim() ? xml : EMPTY_DIAGRAM_XML;
  const createdAt = nowIso();
  const meta = {
    id,
    employeeId,
    name: sanitizeFileName(name),
    createdAt,
    updatedAt: createdAt,
    size: Buffer.byteLength(body, 'utf8'),
    etag: hashValue(body)
  };
  const paths = filePaths(employeeId, id);

  await atomicWrite(paths.xml, body);
  await writeMeta(employeeId, id, meta);

  return { meta, xml: body };
}

async function getFile(employeeId, fileId) {
  const meta = await readMeta(employeeId, fileId);

  if (!meta) {
    return null;
  }

  const paths = filePaths(employeeId, fileId);
  const xml = await fsp.readFile(paths.xml, 'utf8');
  return { meta, xml };
}

async function updateFile(employeeId, fileId, xml, expectedEtag) {
  if (typeof xml !== 'string' || xml.trim().length === 0) {
    throw Object.assign(new Error('Diagram XML is required'), { status: 400, code: 'xml_required' });
  }

  const current = await getFile(employeeId, fileId);

  if (!current) {
    return null;
  }

  if (expectedEtag && expectedEtag !== current.meta.etag) {
    throw Object.assign(new Error('File has changed'), {
      status: 409,
      code: 'file_conflict',
      latest: fileSummary(current.meta)
    });
  }

  const updatedAt = nowIso();
  const meta = {
    ...current.meta,
    updatedAt,
    size: Buffer.byteLength(xml, 'utf8'),
    etag: hashValue(xml)
  };
  const paths = filePaths(employeeId, fileId);

  await atomicWrite(paths.xml, xml);
  await writeMeta(employeeId, fileId, meta);

  return { meta, xml };
}

async function renameFile(employeeId, fileId, name) {
  const current = await getFile(employeeId, fileId);

  if (!current) {
    return null;
  }

  const meta = {
    ...current.meta,
    name: sanitizeFileName(name),
    updatedAt: nowIso()
  };

  await writeMeta(employeeId, fileId, meta);
  return meta;
}

async function deleteFile(employeeId, fileId) {
  const meta = await readMeta(employeeId, fileId);

  if (!meta) {
    return false;
  }

  const paths = filePaths(employeeId, fileId);
  await Promise.allSettled([
    fsp.unlink(paths.xml),
    fsp.unlink(paths.meta)
  ]);
  await deleteSharesForFile(employeeId, fileId);
  return true;
}

async function createShare(employeeId, fileId, expiresAt = null) {
  const current = await getFile(employeeId, fileId);

  if (!current) {
    return null;
  }

  const token = randomToken();
  const tokenHash = hashValue(token);
  const createdAt = nowIso();
  const share = {
    tokenHash,
    employeeId,
    fileId,
    createdAt,
    expiresAt: typeof expiresAt === 'string' && expiresAt ? expiresAt : null
  };

  await atomicWrite(sharePathForHash(tokenHash), JSON.stringify(share, null, 2));
  return { token, share, file: current.meta };
}

async function getShare(token) {
  if (!isValidToken(token)) {
    return null;
  }

  const tokenHash = hashValue(token);

  try {
    const raw = await fsp.readFile(sharePathForHash(tokenHash), 'utf8');
    const share = JSON.parse(raw);

    if (!share || share.tokenHash !== tokenHash || !isValidEmployeeId(share.employeeId) || !isValidFileId(share.fileId)) {
      return null;
    }

    if (share.expiresAt && Date.parse(share.expiresAt) <= Date.now()) {
      await fsp.unlink(sharePathForHash(tokenHash)).catch(() => {});
      return { expired: true };
    }

    const file = await getFile(share.employeeId, share.fileId);

    if (!file) {
      return null;
    }

    return { share, file };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return null;
}

async function deleteSharesForFile(employeeId, fileId) {
  await fsp.mkdir(SHARES_DIR, { recursive: true });
  const entries = await fsp.readdir(SHARES_DIR, { withFileTypes: true });

  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      const shareFile = path.join(SHARES_DIR, entry.name);

      try {
        const share = JSON.parse(await fsp.readFile(shareFile, 'utf8'));

        if (share.employeeId === employeeId && share.fileId === fileId) {
          await fsp.unlink(shareFile);
        }
      } catch (_err) {
        // Ignore corrupt share records during cleanup.
      }
    }));
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(text);
}

function sendDownload(res, body, filename, contentType) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end();
}

function notFound(res) {
  sendText(res, 404, 'Not found');
}

function methodNotAllowed(res, allow = 'GET, POST') {
  sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: allow });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_JSON_BYTES) {
      const err = new Error('Request body too large');
      err.status = 413;
      err.code = 'request_too_large';
      throw err;
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_err) {
    const err = new Error('Invalid JSON');
    err.status = 400;
    err.code = 'invalid_json';
    throw err;
  }
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > maxBytes) {
      const err = new Error('Request body too large');
      err.status = 413;
      err.code = 'request_too_large';
      throw err;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function exportProxyTarget(pathname, search) {
  const configured = String(process.env.DRAWIO_EXPORT_URL || '').trim();

  if (!configured) {
    return null;
  }

  const target = new URL(configured);
  const suffix = pathname === '/export' ? '' : pathname.slice('/export'.length);

  if (suffix) {
    target.pathname = `${target.pathname.replace(/\/$/, '')}${suffix}`;
  }

  target.search = search || '';
  return target;
}

function proxyHeaders(req) {
  const headers = {};
  const skip = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'upgrade',
    'proxy-authorization',
    'proxy-authenticate'
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!skip.has(key.toLowerCase()) && value != null) {
      headers[key] = value;
    }
  }

  return headers;
}

async function handleExportProxy(req, res, pathname, search) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    methodNotAllowed(res, 'GET, POST');
    return;
  }

  if (!getSession(req)) {
    sendJson(res, 401, { error: 'not_authenticated' });
    return;
  }

  const target = exportProxyTarget(pathname, search);

  if (!target) {
    sendJson(res, 503, {
      error: 'export_server_not_configured',
      message: 'Set DRAWIO_EXPORT_URL to an internal draw.io export server endpoint.'
    });
    return;
  }

  let body = null;

  try {
    if (req.method !== 'GET') {
      body = await readRawBody(req, MAX_EXPORT_BYTES);
    }
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.code || 'invalid_export_request' });
    return;
  }

  let upstream;

  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: proxyHeaders(req),
      body
    });
  } catch (err) {
    sendJson(res, 502, { error: 'export_server_unreachable', message: err.message });
    return;
  }

  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': upstreamBody.length,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff'
  };
  const disposition = upstream.headers.get('content-disposition');

  if (disposition) {
    headers['Content-Disposition'] = disposition;
  }

  res.writeHead(upstream.status, headers);
  res.end(upstreamBody);
}

function safeNext(value) {
  if (!value || typeof value !== 'string') {
    return '/app.html';
  }

  try {
    const next = new URL(value, 'http://internal.local');

    if (next.origin !== 'http://internal.local') {
      return '/app.html';
    }

    return `${next.pathname}${next.search}${next.hash}`;
  } catch (_err) {
    return '/app.html';
  }
}

function getRequestPath(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return decodeURIComponent(url.pathname);
}

function externalBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isOpsAuthorized(req) {
  if (OPS_TOKEN) {
    return timingSafeEqualText(bearerToken(req), OPS_TOKEN);
  }

  return Boolean(getSession(req));
}

function sanitizeLogPath(pathname) {
  return String(pathname || '-')
    .replace(/^\/api\/share\/[^/]+$/, '/api/share/[token]')
    .replace(/^\/api\/share\/[^/]+\/download$/, '/api/share/[token]/download');
}

function clientAddress(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.socket.remoteAddress || '';
}

function writeAccessLog(req, res, startTime, pathname) {
  if (!ACCESS_LOG_FILE) {
    return;
  }

  const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1000000;
  const session = getSession(req);
  const entry = {
    time: nowIso(),
    method: req.method,
    path: sanitizeLogPath(pathname),
    status: res.statusCode,
    durationMs: Math.round(elapsedMs * 100) / 100,
    employeeId: session ? session.employeeId : null,
    remoteAddress: clientAddress(req),
    userAgent: req.headers['user-agent'] || ''
  };

  try {
    fs.mkdirSync(path.dirname(ACCESS_LOG_FILE), { recursive: true });
    fs.appendFileSync(ACCESS_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn(`Unable to write access log: ${err.message}`);
  }
}

function resolveStaticPath(baseDir, requestPath) {
  const relative = requestPath.replace(/^\/+/, '') || 'index.html';
  const candidate = path.resolve(baseDir, relative);

  if (candidate !== baseDir && !candidate.startsWith(`${baseDir}${path.sep}`)) {
    return null;
  }

  return candidate;
}

async function serveFile(req, res, filePath) {
  try {
    let stat = await fsp.stat(filePath);

    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath);
    }

    if (!stat.isFile()) {
      return notFound(res);
    }

    const ext = path.extname(filePath).toLowerCase();
    const cache = ext === '.html' || path.basename(filePath) === 'service-worker.js' ?
      'no-store, max-age=0' :
      'public, max-age=3600';

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      notFound(res);
      return;
    }

    console.error(err);
    sendJson(res, 500, { error: 'internal_server_error' });
  }
}

function isHtmlRequest(req, pathname) {
  const accept = req.headers.accept || '';
  return pathname === '/' || pathname.endsWith('.html') || accept.includes('text/html');
}

function publicPagePath(pathname) {
  if (pathname === '/login.html' || pathname === '/app.html' || pathname === '/editor.html' || pathname === '/share.html') {
    return path.join(PUBLIC_DIR, pathname.slice(1));
  }

  return null;
}

async function publicAssetPath(pathname) {
  if (pathname.endsWith('.html')) {
    return null;
  }

  const filePath = resolveStaticPath(PUBLIC_DIR, pathname);

  if (!filePath) {
    return null;
  }

  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() ? filePath : null;
  } catch (_err) {
    return null;
  }
}

async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, 'POST');
    return;
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.code || 'invalid_json' });
    return;
  }

  const employeeId = normalizeEmployeeId(payload.employeeId);
  const password = String(payload.password || '');

  if (!isValidEmployeeId(employeeId)) {
    sendJson(res, 400, { error: 'invalid_employee_id' });
    return;
  }

  if (password !== TEMP_PASSWORD) {
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  const session = await createSession(employeeId);

  sendJson(res, 200, {
    authenticated: true,
    employeeId,
    expiresAt: session.expiresAt
  }, {
    'Set-Cookie': buildCookie(session.token, { maxAge: Math.floor(SESSION_TTL_MS / 1000) })
  });
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    const writable = await checkDataWritable();

    sendJson(res, writable.ok ? 200 : 503, {
      ok: writable.ok,
      time: nowIso(),
      uptimeSeconds: Math.round((Date.now() - STARTED_AT_MS) / 1000),
      data: {
        writable: writable.ok,
        writeError: writable.error || null
      }
    });
    return;
  }

  if (pathname === '/api/login') {
    await handleLogin(req, res);
    return;
  }

  if (pathname === '/api/share' && req.method === 'GET') {
    sendJson(res, 400, { error: 'token_required' });
    return;
  }

  const shareDownloadMatch = pathname.match(/^\/api\/share\/([^/]+)\/download$/);

  if (shareDownloadMatch) {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    const shared = await getShare(shareDownloadMatch[1]);

    if (shared && shared.expired) {
      sendJson(res, 410, { error: 'share_expired' });
      return;
    }

    if (!shared) {
      sendJson(res, 404, { error: 'share_not_found' });
      return;
    }

    sendDownload(
      res,
      shared.file.xml,
      attachmentName(shared.file.meta.name, '.drawio'),
      'application/xml; charset=utf-8'
    );
    return;
  }

  const shareMatch = pathname.match(/^\/api\/share\/([^/]+)$/);

  if (shareMatch) {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    const shared = await getShare(shareMatch[1]);

    if (shared && shared.expired) {
      sendJson(res, 410, { error: 'share_expired' });
      return;
    }

    if (!shared) {
      sendJson(res, 404, { error: 'share_not_found' });
      return;
    }

    sendJson(res, 200, {
      file: fileSummary(shared.file.meta),
      share: {
        createdAt: shared.share.createdAt,
        expiresAt: shared.share.expiresAt
      },
      xml: shared.file.xml
    });
    return;
  }

  if (pathname === '/api/session' || pathname === '/api/me') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    const session = getSession(req);
    sendJson(res, 200, session ? {
      authenticated: true,
      employeeId: session.employeeId,
      expiresAt: session.expiresAt
    } : {
      authenticated: false
    });
    return;
  }

  if (pathname === '/api/logout') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, 'POST');
      return;
    }

    await destroySession(req);
    sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': clearCookie() });
    return;
  }

  if (pathname === '/api/ops/status') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    if (!isOpsAuthorized(req)) {
      sendJson(res, 401, { error: 'not_authorized' }, { 'WWW-Authenticate': 'Bearer' });
      return;
    }

    const status = await getOperationalStatus();
    sendJson(res, status.ok ? 200 : 503, status);
    return;
  }

  const session = getSession(req);

  if (!session) {
    sendJson(res, 401, { error: 'not_authenticated' });
    return;
  }

  if (pathname === '/api/files') {
    if (req.method === 'GET') {
      sendJson(res, 200, { files: await listFiles(session.employeeId) });
      return;
    }

    if (req.method === 'POST') {
      let payload;

      try {
        payload = await readJsonBody(req);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.code || 'invalid_json' });
        return;
      }

      const created = await createFile(session.employeeId, payload.name, payload.xml);
      sendJson(res, 201, { file: fileSummary(created.meta), xml: created.xml });
      return;
    }

    methodNotAllowed(res, 'GET, POST');
    return;
  }

  const fileMatch = pathname.match(/^\/api\/files\/([^/]+)(?:\/([^/]+))?$/);

  if (fileMatch) {
    const fileId = fileMatch[1];
    const action = fileMatch[2] || null;

    if (!isValidFileId(fileId)) {
      sendJson(res, 400, { error: 'invalid_file_id' });
      return;
    }

    if (action === null) {
      if (req.method === 'GET') {
        const file = await getFile(session.employeeId, fileId);

        if (!file) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        sendJson(res, 200, { file: fileSummary(file.meta), xml: file.xml });
        return;
      }

      if (req.method === 'PUT') {
        let payload;

        try {
          payload = await readJsonBody(req);
          const updated = await updateFile(session.employeeId, fileId, payload.xml, payload.etag || req.headers['if-match']);

          if (!updated) {
            sendJson(res, 404, { error: 'file_not_found' });
            return;
          }

          sendJson(res, 200, { file: fileSummary(updated.meta) });
        } catch (err) {
          sendJson(res, err.status || 500, {
            error: err.code || 'internal_server_error',
            latest: err.latest
          });
        }

        return;
      }

      if (req.method === 'DELETE') {
        const deleted = await deleteFile(session.employeeId, fileId);
        sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: 'file_not_found' });
        return;
      }

      methodNotAllowed(res, 'GET, PUT, DELETE');
      return;
    }

    if (action === 'download') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return;
      }

      const file = await getFile(session.employeeId, fileId);

      if (!file) {
        sendJson(res, 404, { error: 'file_not_found' });
        return;
      }

      sendDownload(
        res,
        file.xml,
        attachmentName(file.meta.name, '.drawio'),
        'application/xml; charset=utf-8'
      );
      return;
    }

    if (action === 'rename') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const renamed = await renameFile(session.employeeId, fileId, payload.name);

        if (!renamed) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        sendJson(res, 200, { file: fileSummary(renamed) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    if (action === 'share') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const shared = await createShare(session.employeeId, fileId, payload.expiresAt);

        if (!shared) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        const url = `${externalBaseUrl(req)}/share.html?token=${encodeURIComponent(shared.token)}`;
        sendJson(res, 200, {
          token: shared.token,
          url,
          file: fileSummary(shared.file),
          share: {
            createdAt: shared.share.createdAt,
            expiresAt: shared.share.expiresAt
          }
        });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    notFound(res);
    return;
  }

  notFound(res);
}

async function handleStatic(req, res, pathname, searchParams) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res, 'GET, HEAD');
    return;
  }

  const session = getSession(req);

  if (pathname === '/') {
    redirect(res, session ? '/app.html' : '/login.html');
    return;
  }

  if (pathname === '/login.html') {
    if (session) {
      redirect(res, safeNext(searchParams.get('next')));
      return;
    }

    await serveFile(req, res, path.join(PUBLIC_DIR, 'login.html'));
    return;
  }

  if (pathname === '/share.html') {
    await serveFile(req, res, path.join(PUBLIC_DIR, 'share.html'));
    return;
  }

  const publicAsset = await publicAssetPath(pathname);

  if (publicAsset) {
    await serveFile(req, res, publicAsset);
    return;
  }

  const publicPage = publicPagePath(pathname);

  if (publicPage) {
    if (!session) {
      const next = encodeURIComponent(`${pathname}${searchParams.size ? `?${searchParams}` : ''}`);
      redirect(res, `/login.html?next=${next}`);
      return;
    }

    await serveFile(req, res, publicPage);
    return;
  }

  if (isHtmlRequest(req, pathname) && !session) {
    const next = encodeURIComponent(`${pathname}${searchParams.size ? `?${searchParams}` : ''}`);
    redirect(res, `/login.html?next=${next}`);
    return;
  }

  const filePath = resolveStaticPath(WEBAPP_DIR, pathname);

  if (!filePath) {
    notFound(res);
    return;
  }

  await serveFile(req, res, filePath);
}

async function handleRequest(req, res) {
  const startTime = process.hrtime.bigint();
  let url;
  let pathname;

  res.on('finish', () => {
    writeAccessLog(req, res, startTime, pathname);
  });

  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = getRequestPath(req);
  } catch (_err) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }

  try {
    if (pathname === '/export' || pathname.startsWith('/export/')) {
      await handleExportProxy(req, res, pathname, url.search);
    } else if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      await handleStatic(req, res, pathname, url.searchParams);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'internal_server_error' });
  }
}

async function main() {
  await ensureDataDirs();
  await loadSessions();

  const server = http.createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    console.log(`Company draw.io server listening at http://${HOST}:${PORT}/`);
    console.log(`Serving webapp from ${WEBAPP_DIR}`);
    console.log(`Using data directory ${DATA_DIR}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  EMPTY_DIAGRAM_XML,
  sanitizeFileName,
  handleRequest,
  getOperationalStatus,
  createFile,
  getFile,
  updateFile,
  renameFile,
  deleteFile,
  createShare,
  getShare
};
