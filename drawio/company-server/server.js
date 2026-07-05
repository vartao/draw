const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WEBAPP_DIR = path.resolve(process.env.DRAWIO_WEBAPP_DIR || path.join(ROOT_DIR, 'src', 'main', 'webapp'));
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DRAWIO_DATA_DIR || path.join(__dirname, 'data'));
const EMPLOYEE_DIR = path.join(DATA_DIR, 'employees');
const SHARES_DIR = path.join(DATA_DIR, 'shares');
const INTERNAL_SHARES_DIR = path.join(DATA_DIR, 'internal-shares');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Bind to loopback by default. Set HOST=0.0.0.0 only when LAN access is intended.
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8081);
const TEMP_PASSWORD = process.env.DRAWIO_TEMP_PASSWORD || '123456';
const ADMIN_ID = String(process.env.DRAWIO_ADMIN_ID || 'admin').trim() || 'admin';
const ADMIN_PASSWORD = process.env.DRAWIO_ADMIN_PASSWORD || TEMP_PASSWORD;
const COOKIE_NAME = process.env.DRAWIO_COOKIE_NAME || 'company_drawio_session';
const SESSION_DAYS = Number(process.env.DRAWIO_SESSION_DAYS || 7);
const SESSION_TTL_MS = Math.max(1, SESSION_DAYS) * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = Number(process.env.DRAWIO_MAX_JSON_BYTES || 25 * 1024 * 1024);
const MAX_EXPORT_BYTES = Number(process.env.DRAWIO_MAX_EXPORT_BYTES || 50 * 1024 * 1024);
const MAX_AI_PROMPT_CHARS = Number(process.env.DRAWIO_AI_MAX_PROMPT_CHARS || 4000);
const MAX_CHAT_MESSAGE_CHARS = Number(process.env.DRAWIO_MAX_CHAT_MESSAGE_CHARS || 2000);
const MAX_PROFILE_NAME_CHARS = Number(process.env.DRAWIO_MAX_PROFILE_NAME_CHARS || 40);
const MAX_INTERNAL_SHARE_RECIPIENTS = Number(process.env.DRAWIO_MAX_INTERNAL_SHARE_RECIPIENTS || 30);
const MIN_PASSWORD_CHARS = Number(process.env.DRAWIO_MIN_PASSWORD_CHARS || 6);
const MAX_BATCH_ACCOUNTS = Number(process.env.DRAWIO_MAX_BATCH_ACCOUNTS || 100);
const INVITE_CODE_BYTES = Number(process.env.DRAWIO_INVITE_CODE_BYTES || 9);
const AI_TIMEOUT_MS = Number(process.env.DRAWIO_AI_TIMEOUT_MS || 45000);
const TRUST_PROXY = process.env.DRAWIO_TRUST_PROXY === '1';
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.DRAWIO_AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.DRAWIO_LOGIN_RATE_LIMIT_MAX || 20);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.DRAWIO_REGISTER_RATE_LIMIT_MAX || 20);
const ACCESS_LOG_FILE = String(process.env.DRAWIO_ACCESS_LOG || '').toLowerCase() === 'off' ?
  null :
  path.resolve(process.env.DRAWIO_ACCESS_LOG || path.join(LOG_DIR, 'access.log'));
const OPS_TOKEN = process.env.DRAWIO_OPS_TOKEN || '';
const STARTED_AT_MS = Date.now();
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{6,96}$/;
const ACCOUNT_ROLES = new Set(['user', 'admin']);
const ACCOUNT_STATUSES = new Set(['pending', 'active', 'disabled']);
const AI_PROVIDER_FORMATS = new Set(['openai', 'anthropic']);
const AI_NODE_TYPES = new Set(['start', 'process', 'decision', 'data', 'end']);

const EMPTY_DIAGRAM_XML = '<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

const sessions = new Map();
const accounts = new Map();
const authRateLimits = new Map();
let accountsLoaded = false;

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

class CompatHeaders {
  constructor(headers = {}) {
    this.headers = new Map();

    Object.entries(headers).forEach(([name, value]) => {
      const normalizedName = String(name).toLowerCase();
      const normalizedValue = Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value);
      this.headers.set(normalizedName, normalizedValue);
    });
  }

  get(name) {
    return this.headers.get(String(name).toLowerCase()) || null;
  }
}

function normalizeRequestHeaders(headers = {}) {
  if (headers && typeof headers.forEach === 'function') {
    const output = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }

  return { ...headers };
}

function fetchCompat(url, options = {}) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(url, options);
  }

  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(String(url));
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(target, {
      method: options.method || 'GET',
      headers: normalizeRequestHeaders(options.headers)
    }, (upstream) => {
      const chunks = [];

      upstream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      upstream.on('end', () => {
        const buffer = Buffer.concat(chunks);

        resolve({
          status: upstream.statusCode || 0,
          ok: upstream.statusCode >= 200 && upstream.statusCode < 300,
          headers: new CompatHeaders(upstream.headers),
          text: async () => buffer.toString('utf8'),
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        });
      });
    });

    req.on('error', reject);

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        return;
      }

      options.signal.addEventListener('abort', () => {
        req.destroy(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      }, { once: true });
    }

    if (options.body != null) {
      req.write(options.body);
    }

    req.end();
  });
}

function nowIso() {
  return new Date().toISOString();
}

function findEnv(...names) {
  for (const name of names) {
    const value = process.env[name];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
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

function isValidFolderId(value) {
  return FILE_ID_PATTERN.test(String(value || ''));
}

function isValidToken(value) {
  return TOKEN_PATTERN.test(String(value || ''));
}

function sanitizeProfileName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROFILE_NAME_CHARS);
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

function sanitizeFolderName(value) {
  let name = String(value || '').trim();

  if (name.length === 0) {
    name = '新建文件夹';
  }

  name = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  if (name.length === 0) {
    name = '新建文件夹';
  }

  return name.slice(0, 120);
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
  await fsp.mkdir(INTERNAL_SHARES_DIR, { recursive: true });
  await fsp.mkdir(LOG_DIR, { recursive: true });
}

async function ensureEmployeeDirs(employeeId) {
  const base = employeeBaseDir(employeeId);
  await fsp.mkdir(path.join(base, 'files'), { recursive: true });
  await fsp.mkdir(path.join(base, 'meta'), { recursive: true });
  await fsp.mkdir(path.join(base, 'folders'), { recursive: true });
}

function employeeProfilePath(employeeId) {
  return path.join(employeeBaseDir(employeeId), 'profile.json');
}

function employeeProfileSummary(employeeId, name = '') {
  const cleanName = sanitizeProfileName(name);

  return {
    employeeId,
    name: cleanName,
    displayName: cleanName || employeeId
  };
}

async function readEmployeeProfile(employeeId) {
  if (!isValidEmployeeId(employeeId)) {
    return null;
  }

  try {
    const raw = await fsp.readFile(employeeProfilePath(employeeId), 'utf8');
    const profile = JSON.parse(raw);
    return employeeProfileSummary(employeeId, profile && profile.name);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return employeeProfileSummary(employeeId);
}

async function writeEmployeeProfile(employeeId, name) {
  if (!isValidEmployeeId(employeeId)) {
    throw Object.assign(new Error('Invalid employee id'), { status: 400, code: 'invalid_employee_id' });
  }

  const profile = employeeProfileSummary(employeeId, name);
  await ensureEmployeeDirs(employeeId);
  await atomicWrite(employeeProfilePath(employeeId), JSON.stringify({
    employeeId,
    name: profile.name,
    updatedAt: nowIso()
  }, null, 2));

  return profile;
}

async function loadEmployeeProfiles(employeeIds) {
  const uniqueIds = Array.from(new Set((employeeIds || []).filter(isValidEmployeeId)));
  const entries = await Promise.all(uniqueIds.map(async (employeeId) => {
    const profile = await readEmployeeProfile(employeeId);
    return [employeeId, profile || employeeProfileSummary(employeeId)];
  }));

  return Object.fromEntries(entries);
}

function normalizeAccountRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ACCOUNT_ROLES.has(role) ? role : 'user';
}

function normalizeAccountStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ACCOUNT_STATUSES.has(status) ? status : 'pending';
}

function normalizeInviteCode(value) {
  return String(value || '').trim();
}

function isValidInviteCode(value) {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(value));
}

function isValidPassword(value) {
  const password = String(value || '');
  const minLength = Number.isFinite(MIN_PASSWORD_CHARS) ? MIN_PASSWORD_CHARS : 6;
  return password.length >= minLength && password.length <= 256;
}

function createPasswordRecord(password) {
  const passwordSalt = randomToken(16);
  const passwordHash = crypto.scryptSync(String(password || ''), passwordSalt, 64).toString('base64url');
  return { passwordSalt, passwordHash };
}

function verifyPasswordRecord(account, password) {
  if (!account) {
    return false;
  }

  if (account.source === 'environment') {
    return timingSafeEqualText(password, ADMIN_PASSWORD);
  }

  if (!account.passwordSalt || !account.passwordHash) {
    return false;
  }

  const passwordHash = crypto.scryptSync(String(password || ''), account.passwordSalt, 64).toString('base64url');
  return timingSafeEqualText(passwordHash, account.passwordHash);
}

function envAdminAccount() {
  const employeeId = isValidEmployeeId(ADMIN_ID) ? ADMIN_ID : 'admin';
  const name = sanitizeProfileName(process.env.DRAWIO_ADMIN_NAME || 'Administrator');

  return {
    employeeId,
    name,
    displayName: name || employeeId,
    role: 'admin',
    status: 'active',
    source: 'environment',
    createdAt: '',
    updatedAt: ''
  };
}

function normalizeAccountRecord(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const employeeId = normalizeEmployeeId(row.employeeId);

  if (!isValidEmployeeId(employeeId)) {
    return null;
  }

  const name = sanitizeProfileName(row.name);
  const status = normalizeAccountStatus(row.status);

  return {
    employeeId,
    name,
    displayName: name || employeeId,
    role: normalizeAccountRole(row.role),
    status,
    passwordSalt: typeof row.passwordSalt === 'string' ? row.passwordSalt : '',
    passwordHash: typeof row.passwordHash === 'string' ? row.passwordHash : '',
    inviteCode: isValidInviteCode(row.inviteCode) ? normalizeInviteCode(row.inviteCode) : '',
    inviteCodeHash: typeof row.inviteCodeHash === 'string' ? row.inviteCodeHash : '',
    inviteCodePreview: typeof row.inviteCodePreview === 'string' ? row.inviteCodePreview : '',
    inviteCreatedAt: typeof row.inviteCreatedAt === 'string' ? row.inviteCreatedAt : '',
    inviteAcceptedAt: typeof row.inviteAcceptedAt === 'string' ? row.inviteAcceptedAt : '',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : nowIso(),
    createdBy: typeof row.createdBy === 'string' ? row.createdBy : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : '',
    registeredAt: typeof row.registeredAt === 'string' ? row.registeredAt : ''
  };
}

function accountSummary(account, extra = {}) {
  const name = sanitizeProfileName(account && account.name);
  const employeeId = account && account.employeeId;

  return {
    employeeId,
    name,
    displayName: name || employeeId,
    role: normalizeAccountRole(account && account.role),
    status: normalizeAccountStatus(account && account.status),
    source: account && account.source === 'environment' ? 'environment' : 'stored',
    createdAt: account && account.createdAt || '',
    createdBy: account && account.createdBy || '',
    updatedAt: account && account.updatedAt || '',
    updatedBy: account && account.updatedBy || '',
    registeredAt: account && account.registeredAt || '',
    inviteCreatedAt: account && account.inviteCreatedAt || '',
    inviteAcceptedAt: account && account.inviteAcceptedAt || '',
    inviteCode: account && account.status === 'pending' ? account.inviteCode || '' : '',
    inviteCodePreview: account && account.inviteCodePreview || '',
    canRegister: Boolean(account && account.status === 'pending' && account.inviteCodeHash),
    ...extra
  };
}

async function ensureAccountsLoaded() {
  if (accountsLoaded) {
    return;
  }

  accounts.clear();

  try {
    const raw = (await fsp.readFile(ACCOUNTS_FILE, 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed.accounts) ? parsed.accounts : Array.isArray(parsed) ? parsed : [];

    rows.forEach((row) => {
      const account = normalizeAccountRecord(row);

      if (account) {
        accounts.set(account.employeeId, account);
      }
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Unable to load accounts: ${err.message}`);
    }
  }

  accountsLoaded = true;
}

async function saveAccounts() {
  await ensureDataDirs();

  const rows = Array.from(accounts.values())
    .filter((account) => account && account.source !== 'environment')
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId, 'zh-CN'));

  await atomicWrite(ACCOUNTS_FILE, JSON.stringify({
    savedAt: nowIso(),
    accounts: rows
  }, null, 2));
}

function getAccount(employeeId) {
  const normalizedId = normalizeEmployeeId(employeeId);
  const stored = accounts.get(normalizedId);

  if (stored) {
    return stored;
  }

  const admin = envAdminAccount();
  return normalizedId === admin.employeeId ? admin : null;
}

async function getSessionAccount(session) {
  if (!session || !isValidEmployeeId(session.employeeId)) {
    return null;
  }

  await ensureAccountsLoaded();
  return getAccount(session.employeeId);
}

function isAdminAccount(account) {
  return Boolean(account && account.status === 'active' && account.role === 'admin');
}

function generateInviteCode() {
  const bytes = Number.isFinite(INVITE_CODE_BYTES) ? INVITE_CODE_BYTES : 9;
  return randomToken(Math.max(6, Math.floor(bytes)));
}

function inviteCodeHash(code) {
  return hashValue(`invite:${normalizeInviteCode(code)}`);
}

function assignInviteCode(account, actorId) {
  const code = generateInviteCode();
  const time = nowIso();

  account.inviteCodeHash = inviteCodeHash(code);
  account.inviteCode = code;
  account.inviteCodePreview = code.slice(-4);
  account.inviteCreatedAt = time;
  account.inviteAcceptedAt = '';
  account.updatedAt = time;
  account.updatedBy = actorId || '';

  return code;
}

function verifyInviteCode(account, code) {
  return Boolean(
    account &&
    account.inviteCodeHash &&
    isValidInviteCode(code) &&
    timingSafeEqualText(account.inviteCodeHash, inviteCodeHash(code))
  );
}

async function createPendingAccount(input, actorId, options = {}) {
  await ensureAccountsLoaded();

  const employeeId = normalizeEmployeeId(input && input.employeeId);

  if (!isValidEmployeeId(employeeId)) {
    throw publicError(400, 'invalid_employee_id', 'Employee ID is invalid.');
  }

  if (getAccount(employeeId)) {
    throw publicError(409, 'account_exists', 'Account already exists.');
  }

  const time = nowIso();
  const account = {
    employeeId,
    name: sanitizeProfileName(input && input.name),
    displayName: '',
    role: normalizeAccountRole(input && input.role),
    status: 'pending',
    passwordSalt: '',
    passwordHash: '',
    inviteCode: '',
    inviteCodeHash: '',
    inviteCodePreview: '',
    inviteCreatedAt: '',
    inviteAcceptedAt: '',
    createdAt: time,
    createdBy: actorId || '',
    updatedAt: time,
    updatedBy: actorId || '',
    registeredAt: ''
  };
  const inviteCode = assignInviteCode(account, actorId);
  account.displayName = account.name || employeeId;
  accounts.set(employeeId, account);

  if (options.save !== false) {
    await saveAccounts();
  }

  return { account, inviteCode };
}

function parseBatchAccounts(payload) {
  if (Array.isArray(payload && payload.accounts)) {
    return payload.accounts.map((account, index) => ({
      index,
      employeeId: account && account.employeeId,
      name: account && account.name,
      role: account && account.role
    }));
  }

  return String(payload && payload.text || '')
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((row) => row.line && !row.line.startsWith('#'))
    .map((row) => {
      const parts = row.line.split(/[\t,，]/).map((part) => part.trim());

      return {
        index: row.index,
        employeeId: parts[0],
        name: parts[1] || '',
        role: parts[2] || payload.role || 'user'
      };
    });
}

function listAccountSummaries() {
  const rows = new Map();
  const admin = envAdminAccount();

  rows.set(admin.employeeId, admin);
  accounts.forEach((account) => {
    rows.set(account.employeeId, account);
  });

  return Array.from(rows.values())
    .map((account) => accountSummary(account))
    .sort((a, b) => {
      if (a.role !== b.role) {
        return a.role === 'admin' ? -1 : 1;
      }

      if (a.status !== b.status) {
        return a.status.localeCompare(b.status, 'zh-CN');
      }

      return a.employeeId.localeCompare(b.employeeId, 'zh-CN');
    });
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

async function listKnownEmployees(currentEmployeeId = '') {
  await ensureDataDirs();
  await ensureAccountsLoaded();
  const ids = new Set();

  accounts.forEach((account) => {
    if (account.status === 'active') {
      ids.add(account.employeeId);
    }
  });

  try {
    const entries = await fsp.readdir(EMPLOYEE_DIR, { withFileTypes: true });

    entries.forEach((entry) => {
      if (entry.isDirectory() && isValidEmployeeId(entry.name)) {
        ids.add(entry.name);
      }
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  for (const session of sessions.values()) {
    if (session && isValidEmployeeId(session.employeeId)) {
      ids.add(session.employeeId);
    }
  }

  ids.delete(currentEmployeeId);
  const sortedIds = Array.from(ids).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return Promise.all(sortedIds.map((employeeId) => readEmployeeProfile(employeeId)));
}

async function getOperationalStatus() {
  await ensureDataDirs();
  await ensureAccountsLoaded();

  const [
    writable,
    dataStats,
    employeeStats,
    shareStats,
    internalShareStats,
    logStats,
    employeeCount,
    diagramCount,
    metadataCount,
    shareCount,
    internalShareCount
  ] = await Promise.all([
    checkDataWritable(),
    directoryStats(DATA_DIR),
    directoryStats(EMPLOYEE_DIR),
    directoryStats(SHARES_DIR),
    directoryStats(INTERNAL_SHARES_DIR),
    directoryStats(LOG_DIR),
    getEmployeeCount(),
    countFilesInDir(EMPLOYEE_DIR, (_entryPath, name) => name.endsWith('.drawio')),
    countFilesInDir(EMPLOYEE_DIR, (_entryPath, name) => name.endsWith('.json')),
    countFilesInDir(SHARES_DIR, (_entryPath, name) => name.endsWith('.json')),
    countFilesInDir(INTERNAL_SHARES_DIR, (_entryPath, name) => name.endsWith('.json'))
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
      accounts: listAccountSummaries().length,
      pendingAccounts: listAccountSummaries().filter((account) => account.status === 'pending').length,
      employees: employeeCount,
      diagrams: diagramCount,
      metadata: metadataCount,
      shares: shareCount,
      internalShares: internalShareCount
    },
    storage: {
      dataBytes: dataStats.bytes,
      employeeBytes: employeeStats.bytes,
      shareBytes: shareStats.bytes,
      internalShareBytes: internalShareStats.bytes,
      logBytes: logStats.bytes,
      dataFiles: dataStats.files,
      dataDirectories: dataStats.directories
    },
    config: {
      host: HOST,
      trustProxy: TRUST_PROXY,
      sessionDays: SESSION_DAYS,
      maxJsonBytes: MAX_JSON_BYTES,
      maxExportBytes: MAX_EXPORT_BYTES,
      authRateLimitWindowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      loginRateLimitMax: LOGIN_RATE_LIMIT_MAX,
      registerRateLimitMax: REGISTER_RATE_LIMIT_MAX,
      maxAiPromptChars: MAX_AI_PROMPT_CHARS,
      maxChatMessageChars: MAX_CHAT_MESSAGE_CHARS,
      maxInternalShareRecipients: MAX_INTERNAL_SHARE_RECIPIENTS,
      aiTimeoutMs: AI_TIMEOUT_MS,
      aiClientBaseUrlsAllowed: true,
      aiOpenAiConfigured: Boolean(findEnv('DRAWIO_AI_OPENAI_API_KEY', 'DRAWIO_OPENAI_API_KEY', 'OPENAI_API_KEY')),
      aiAnthropicConfigured: Boolean(findEnv('DRAWIO_AI_ANTHROPIC_API_KEY', 'DRAWIO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY')),
      secureCookie: process.env.DRAWIO_COOKIE_SECURE === '1',
      accessLog: ACCESS_LOG_FILE || 'off',
      opsTokenRequired: Boolean(OPS_TOKEN),
      exportProxy: Boolean(process.env.DRAWIO_EXPORT_URL)
    }
  };
}

async function loadSessions() {
  try {
    const raw = (await fsp.readFile(SESSIONS_FILE, 'utf8')).replace(/^\uFEFF/, '');
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

function folderPaths(employeeId, folderId) {
  if (!isValidEmployeeId(employeeId) || !isValidFolderId(folderId)) {
    return null;
  }

  return {
    meta: path.join(employeeBaseDir(employeeId), 'folders', `${folderId}.json`)
  };
}

function sharePathForHash(tokenHash) {
  return path.join(SHARES_DIR, `${tokenHash}.json`);
}

function internalSharePath(shareId) {
  return path.join(INTERNAL_SHARES_DIR, `${shareId}.json`);
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

function normalizeFolderId(value) {
  if (value == null || value === '') {
    return null;
  }

  const folderId = String(value);

  if (!isValidFolderId(folderId)) {
    throw Object.assign(new Error('Invalid folder id'), { status: 400, code: 'invalid_folder_id' });
  }

  return folderId;
}

async function requireFolderTarget(employeeId, value) {
  const folderId = normalizeFolderId(value);

  if (folderId === null) {
    return null;
  }

  const folder = await readFolder(employeeId, folderId);

  if (!folder) {
    throw Object.assign(new Error('Folder not found'), { status: 404, code: 'folder_not_found' });
  }

  return folderId;
}

async function readFolder(employeeId, folderId) {
  const paths = folderPaths(employeeId, folderId);

  if (!paths) {
    return null;
  }

  try {
    const raw = await fsp.readFile(paths.meta, 'utf8');
    const folder = JSON.parse(raw);

    if (folder && folder.id === folderId && folder.employeeId === employeeId) {
      return {
        ...folder,
        parentId: folder.parentId == null ? null : folder.parentId
      };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return null;
}

async function writeFolder(employeeId, folderId, folder) {
  const paths = folderPaths(employeeId, folderId);

  if (!paths) {
    throw Object.assign(new Error('Invalid folder id'), { status: 400, code: 'invalid_folder_id' });
  }

  await atomicWrite(paths.meta, JSON.stringify(folder, null, 2));
}

function fileSummary(meta) {
  return {
    id: meta.id,
    name: meta.name,
    folderId: isValidFolderId(meta.folderId) ? meta.folderId : null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    size: meta.size,
    etag: meta.etag
  };
}

function folderSummary(folder) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: isValidFolderId(folder.parentId) ? folder.parentId : null,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt
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

async function listFolders(employeeId) {
  await ensureEmployeeDirs(employeeId);
  const folderDir = path.join(employeeBaseDir(employeeId), 'folders');
  const entries = await fsp.readdir(folderDir, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const raw = await fsp.readFile(path.join(folderDir, entry.name), 'utf8');
        const folder = JSON.parse(raw);

        if (folder && folder.employeeId === employeeId && isValidFolderId(folder.id)) {
          folders.push(folderSummary(folder));
        }
      } catch (err) {
        console.warn(`Skipping invalid folder metadata ${entry.name}: ${err.message}`);
      }
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return folders;
}

async function createFolder(employeeId, name, parentId = null) {
  await ensureEmployeeDirs(employeeId);
  const normalizedParentId = await requireFolderTarget(employeeId, parentId);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const folder = {
    id,
    employeeId,
    name: sanitizeFolderName(name),
    parentId: normalizedParentId,
    createdAt,
    updatedAt: createdAt
  };

  await writeFolder(employeeId, id, folder);
  return folder;
}

async function createFile(employeeId, name, xml, folderId = null) {
  await ensureEmployeeDirs(employeeId);
  const normalizedFolderId = await requireFolderTarget(employeeId, folderId);
  const id = crypto.randomUUID();
  const body = typeof xml === 'string' && xml.trim() ? xml : EMPTY_DIAGRAM_XML;
  const createdAt = nowIso();
  const meta = {
    id,
    employeeId,
    name: sanitizeFileName(name),
    folderId: normalizedFolderId,
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

async function moveFile(employeeId, fileId, folderId = null) {
  const current = await getFile(employeeId, fileId);

  if (!current) {
    return null;
  }

  const normalizedFolderId = await requireFolderTarget(employeeId, folderId);
  const meta = {
    ...current.meta,
    folderId: normalizedFolderId,
    updatedAt: nowIso()
  };

  await writeMeta(employeeId, fileId, meta);
  return meta;
}

function copiedFileName(name) {
  const baseName = sanitizeFileName(name || 'diagram.drawio').replace(/\.drawio$/i, '');
  return sanitizeFileName(`${baseName} - 副本.drawio`);
}

async function copyFile(employeeId, fileId, folderId = null) {
  const current = await getFile(employeeId, fileId);

  if (!current) {
    return null;
  }

  return createFile(employeeId, copiedFileName(current.meta.name), current.xml, folderId);
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
  await deleteInternalSharesForFile(employeeId, fileId);
  return true;
}

async function renameFolder(employeeId, folderId, name) {
  const folder = await readFolder(employeeId, folderId);

  if (!folder) {
    return null;
  }

  const updated = {
    ...folder,
    name: sanitizeFolderName(name),
    updatedAt: nowIso()
  };

  await writeFolder(employeeId, folderId, updated);
  return updated;
}

async function folderDescendantIds(employeeId, folderId) {
  const folders = await listFolders(employeeId);
  const childrenByParent = new Map();

  folders.forEach((folder) => {
    const key = folder.parentId || '';
    const children = childrenByParent.get(key) || [];
    children.push(folder.id);
    childrenByParent.set(key, children);
  });

  const ids = [];
  const pending = [folderId];

  while (pending.length) {
    const current = pending.shift();
    const children = childrenByParent.get(current) || [];

    children.forEach((childId) => {
      ids.push(childId);
      pending.push(childId);
    });
  }

  return ids;
}

async function moveFolder(employeeId, folderId, parentId = null) {
  const folder = await readFolder(employeeId, folderId);

  if (!folder) {
    return null;
  }

  const normalizedParentId = await requireFolderTarget(employeeId, parentId);

  if (normalizedParentId === folderId) {
    throw Object.assign(new Error('Folder cannot move into itself'), { status: 400, code: 'invalid_folder_move' });
  }

  const descendantIds = await folderDescendantIds(employeeId, folderId);

  if (normalizedParentId && descendantIds.includes(normalizedParentId)) {
    throw Object.assign(new Error('Folder cannot move into a descendant'), { status: 400, code: 'invalid_folder_move' });
  }

  const updated = {
    ...folder,
    parentId: normalizedParentId,
    updatedAt: nowIso()
  };

  await writeFolder(employeeId, folderId, updated);
  return updated;
}

async function copyFolder(employeeId, folderId, parentId = null) {
  const source = await readFolder(employeeId, folderId);

  if (!source) {
    return null;
  }

  const normalizedParentId = await requireFolderTarget(employeeId, parentId);
  const sourceFolders = await listFolders(employeeId);
  const sourceFiles = await listFiles(employeeId);
  const childrenByParent = new Map();
  const filesByFolder = new Map();

  sourceFolders.forEach((folder) => {
    const key = folder.parentId || '';
    const children = childrenByParent.get(key) || [];
    children.push(folder);
    childrenByParent.set(key, children);
  });

  sourceFiles.forEach((file) => {
    const key = file.folderId || '';
    const files = filesByFolder.get(key) || [];
    files.push(file);
    filesByFolder.set(key, files);
  });

  async function copyBranch(folder, newParentId, isRoot = false) {
    const newFolder = await createFolder(
      employeeId,
      isRoot ? `${folder.name} - 副本` : folder.name,
      newParentId
    );

    const files = filesByFolder.get(folder.id) || [];

    for (const file of files) {
      const current = await getFile(employeeId, file.id);

      if (current) {
        await createFile(employeeId, current.meta.name, current.xml, newFolder.id);
      }
    }

    const children = childrenByParent.get(folder.id) || [];

    for (const child of children) {
      await copyBranch(child, newFolder.id);
    }

    return newFolder;
  }

  return copyBranch(source, normalizedParentId, true);
}

async function deleteFolder(employeeId, folderId) {
  const folder = await readFolder(employeeId, folderId);

  if (!folder) {
    return false;
  }

  const folderIds = [folderId].concat(await folderDescendantIds(employeeId, folderId));
  const folderIdSet = new Set(folderIds);
  const files = await listFiles(employeeId);

  for (const file of files) {
    if (folderIdSet.has(file.folderId)) {
      await deleteFile(employeeId, file.id);
    }
  }

  for (const id of folderIds.reverse()) {
    const paths = folderPaths(employeeId, id);
    await fsp.unlink(paths.meta).catch((err) => {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    });
  }

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

function sanitizeChatText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_CHARS);
}

function normalizeRecipients(value, ownerId) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\s;，；、]+/);
  const seen = new Set();
  const recipients = [];

  for (const item of raw) {
    const employeeId = normalizeEmployeeId(item);

    if (!employeeId || employeeId === ownerId || seen.has(employeeId)) {
      continue;
    }

    if (!isValidEmployeeId(employeeId)) {
      throw Object.assign(new Error('Invalid recipient'), { status: 400, code: 'invalid_recipient' });
    }

    seen.add(employeeId);
    recipients.push(employeeId);
  }

  if (!recipients.length) {
    throw Object.assign(new Error('Recipient required'), { status: 400, code: 'recipient_required' });
  }

  if (recipients.length > MAX_INTERNAL_SHARE_RECIPIENTS) {
    throw Object.assign(new Error('Too many recipients'), { status: 400, code: 'too_many_recipients' });
  }

  return recipients;
}

function internalShareParticipants(share) {
  return Array.from(new Set([share.ownerId].concat(Array.isArray(share.recipients) ? share.recipients : [])))
    .filter(isValidEmployeeId);
}

function isInternalShareParticipant(share, employeeId) {
  return internalShareParticipants(share).includes(employeeId);
}

async function readInternalShare(shareId) {
  if (!isValidFileId(shareId)) {
    return null;
  }

  try {
    const raw = await fsp.readFile(internalSharePath(shareId), 'utf8');
    const share = JSON.parse(raw);

    if (!share || share.id !== shareId || !isValidEmployeeId(share.ownerId) || !isValidFileId(share.fileId)) {
      return null;
    }

    share.recipients = Array.isArray(share.recipients) ? share.recipients.filter(isValidEmployeeId) : [];
    share.messages = Array.isArray(share.messages) ? share.messages : [];
    share.readBy = share.readBy && typeof share.readBy === 'object' ? Object.fromEntries(Object.entries(share.readBy)
      .filter(([employeeId, readAt]) => isValidEmployeeId(employeeId) && typeof readAt === 'string')) : {};
    return share;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return null;
}

async function writeInternalShare(share) {
  await atomicWrite(internalSharePath(share.id), JSON.stringify(share, null, 2));
}

function internalShareMessage(authorId, text, type = 'message') {
  return {
    id: crypto.randomUUID(),
    authorId,
    text,
    type,
    createdAt: nowIso()
  };
}

function unreadInternalShareCount(share, viewerId) {
  const messages = Array.isArray(share.messages) ? share.messages : [];
  const readAt = Date.parse(share.readBy && share.readBy[viewerId] ? share.readBy[viewerId] : '');
  const readTime = Number.isNaN(readAt) ? 0 : readAt;

  return messages.filter((message) => {
    if (!message || message.authorId === viewerId) {
      return false;
    }

    const messageTime = Date.parse(message.createdAt || '');
    return !Number.isNaN(messageTime) && messageTime > readTime;
  }).length;
}

async function internalShareSummary(share, file, viewerId) {
  const messages = Array.isArray(share.messages) ? share.messages : [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  const participants = internalShareParticipants(share);
  const messageAuthorIds = messages.map((message) => message && message.authorId).filter(isValidEmployeeId);
  const profiles = await loadEmployeeProfiles(participants.concat(messageAuthorIds));

  return {
    id: share.id,
    ownerId: share.ownerId,
    recipients: share.recipients,
    participants,
    profiles,
    unreadCount: unreadInternalShareCount(share, viewerId),
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    lastMessageAt: share.lastMessageAt || share.updatedAt,
    direction: viewerId === share.ownerId ? 'sent' : 'received',
    file: file ? fileSummary(file.meta) : null,
    lastMessage
  };
}

async function markInternalShareRead(employeeId, share) {
  if (!share || !isInternalShareParticipant(share, employeeId)) {
    return false;
  }

  const previous = share.readBy && share.readBy[employeeId];
  share.readBy = share.readBy && typeof share.readBy === 'object' ? share.readBy : {};
  share.readBy[employeeId] = nowIso();

  if (previous === share.readBy[employeeId]) {
    return false;
  }

  await writeInternalShare(share);
  return true;
}

async function createInternalShare(ownerId, fileId, recipientsInput, messageInput) {
  const current = await getFile(ownerId, fileId);

  if (!current) {
    return null;
  }

  const recipients = normalizeRecipients(recipientsInput, ownerId);
  const message = sanitizeChatText(messageInput) || '分享了一张图纸。';
  const createdAt = nowIso();
  const share = {
    id: crypto.randomUUID(),
    ownerId,
    fileId,
    recipients,
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: createdAt,
    readBy: {
      [ownerId]: createdAt
    },
    messages: [
      internalShareMessage(ownerId, message, 'share')
    ]
  };

  await ensureDataDirs();
  await writeInternalShare(share);
  return { share, file: current };
}

async function getInternalShareForEmployee(employeeId, shareId) {
  const share = await readInternalShare(shareId);

  if (!share || !isInternalShareParticipant(share, employeeId)) {
    return null;
  }

  const file = await getFile(share.ownerId, share.fileId);

  if (!file) {
    return { share, file: null };
  }

  return { share, file };
}

async function listInternalShares(employeeId) {
  await ensureDataDirs();
  const entries = await fsp.readdir(INTERNAL_SHARES_DIR, { withFileTypes: true });
  const shares = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    try {
      const shareId = entry.name.replace(/\.json$/i, '');
      const shared = await getInternalShareForEmployee(employeeId, shareId);

      if (shared) {
        shares.push(await internalShareSummary(shared.share, shared.file, employeeId));
      }
    } catch (err) {
      console.warn(`Skipping invalid internal share ${entry.name}: ${err.message}`);
    }
  }

  shares.sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
  return shares;
}

async function addInternalShareMessage(employeeId, shareId, messageInput) {
  const shared = await getInternalShareForEmployee(employeeId, shareId);

  if (!shared) {
    return null;
  }

  const text = sanitizeChatText(messageInput);

  if (!text) {
    throw Object.assign(new Error('Message required'), { status: 400, code: 'message_required' });
  }

  const message = internalShareMessage(employeeId, text);
  shared.share.messages.push(message);
  shared.share.readBy = shared.share.readBy && typeof shared.share.readBy === 'object' ? shared.share.readBy : {};
  shared.share.readBy[employeeId] = message.createdAt;
  shared.share.updatedAt = nowIso();
  shared.share.lastMessageAt = message.createdAt;
  await writeInternalShare(shared.share);

  return { share: shared.share, file: shared.file, message };
}

async function deleteInternalSharesForFile(employeeId, fileId) {
  await fsp.mkdir(INTERNAL_SHARES_DIR, { recursive: true });
  const entries = await fsp.readdir(INTERNAL_SHARES_DIR, { withFileTypes: true });

  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      const filePath = path.join(INTERNAL_SHARES_DIR, entry.name);

      try {
        const share = JSON.parse(await fsp.readFile(filePath, 'utf8'));

        if (share.ownerId === employeeId && share.fileId === fileId) {
          await fsp.unlink(filePath);
        }
      } catch (_err) {
        // Ignore corrupt internal share records during cleanup.
      }
    }));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function publicError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, publicMessage: message, ...extra });
}

function normalizeAiFormat(value) {
  const format = String(value || 'openai').trim().toLowerCase();

  if (format.includes('anthropic') || format.includes('claude')) {
    return 'anthropic';
  }

  if (format.includes('openai') || format.includes('chat-completions') || format === 'compatible') {
    return 'openai';
  }

  if (AI_PROVIDER_FORMATS.has(format)) {
    return format;
  }

  throw publicError(400, 'unsupported_ai_provider', 'Unsupported AI provider format.');
}

function defaultAiBaseUrl(format) {
  return format === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
}

function normalizeAiBaseUrl(value, format) {
  const raw = String(value || defaultAiBaseUrl(format)).trim();
  let url;

  try {
    url = new URL(raw);
  } catch (_err) {
    throw publicError(400, 'invalid_ai_base_url', 'AI base URL is invalid.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw publicError(400, 'invalid_ai_base_url', 'AI base URL must use http or https.');
  }

  return url.toString().replace(/\/+$/, '');
}

function aiBaseUrlInput(config, format) {
  const clientBaseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';

  if (clientBaseUrl) {
    return { value: clientBaseUrl, source: 'client' };
  }

  const envBaseUrl = format === 'anthropic' ?
    findEnv('DRAWIO_AI_ANTHROPIC_BASE_URL', 'DRAWIO_ANTHROPIC_BASE_URL', 'ANTHROPIC_BASE_URL', 'DRAWIO_AI_BASE_URL') :
    findEnv('DRAWIO_AI_OPENAI_BASE_URL', 'DRAWIO_OPENAI_BASE_URL', 'OPENAI_BASE_URL', 'DRAWIO_AI_BASE_URL');

  return { value: envBaseUrl, source: envBaseUrl ? 'environment' : 'default' };
}

function aiEndpoint(baseUrl, terminalPath) {
  const normalized = String(baseUrl || '').replace(/\/+$/, '');

  if (normalized.endsWith(`/${terminalPath}`)) {
    return new URL(normalized);
  }

  return new URL(`${normalized}/${terminalPath}`);
}

function normalizeAiConfig(input, options = {}) {
  const config = input && typeof input === 'object' ? input : {};
  const requireModel = options.requireModel !== false;
  const format = normalizeAiFormat(config.providerFormat || config.format || config.provider || process.env.DRAWIO_AI_PROVIDER || 'openai');
  const baseUrlConfig = aiBaseUrlInput(config, format);
  const baseUrl = normalizeAiBaseUrl(baseUrlConfig.value, format);
  const apiKey = String(config.apiKey || (
    format === 'anthropic' ?
      findEnv('DRAWIO_AI_ANTHROPIC_API_KEY', 'DRAWIO_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY', 'DRAWIO_AI_API_KEY') :
      findEnv('DRAWIO_AI_OPENAI_API_KEY', 'DRAWIO_OPENAI_API_KEY', 'OPENAI_API_KEY', 'DRAWIO_AI_API_KEY')
  ) || '').trim();
  const model = String(config.model || (
    format === 'anthropic' ?
      findEnv('DRAWIO_AI_ANTHROPIC_MODEL', 'DRAWIO_ANTHROPIC_MODEL', 'ANTHROPIC_MODEL', 'DRAWIO_AI_MODEL') :
      findEnv('DRAWIO_AI_OPENAI_MODEL', 'DRAWIO_OPENAI_MODEL', 'OPENAI_MODEL', 'DRAWIO_AI_MODEL')
  ) || '').trim();
  const maxTokens = clampNumber(
    config.maxTokens != null ? config.maxTokens : findEnv('DRAWIO_AI_MAX_TOKENS'),
    800,
    8000,
    2200
  );
  const temperature = clampNumber(
    config.temperature != null ? config.temperature : findEnv('DRAWIO_AI_TEMPERATURE'),
    0,
    1,
    0.2
  );

  if (!apiKey) {
    throw publicError(400, 'ai_api_key_required', 'AI API key is required.');
  }

  if (requireModel && !model) {
    throw publicError(400, 'ai_model_required', 'AI model is required.');
  }

  return { format, baseUrl, baseUrlSource: baseUrlConfig.source, apiKey, model, maxTokens, temperature };
}

function normalizeAiModelRecord(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const id = String(row.id || row.name || '').trim();

  if (!id) {
    return null;
  }

  const label = String(row.display_name || row.displayName || row.name || row.id || id).trim();

  return {
    id,
    label: label || id,
    createdAt: typeof row.created_at === 'number' ? row.created_at : null
  };
}

function normalizeAiModels(json) {
  const rows = Array.isArray(json && json.data) ? json.data : Array.isArray(json && json.models) ? json.models : [];
  const seen = new Set();
  const models = [];

  rows.forEach((row) => {
    const model = normalizeAiModelRecord(row);

    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  });

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

function buildFlowchartInstruction(prompt) {
  return [
    'Create a concise flowchart from the user request.',
    'Return only one JSON object. Do not use Markdown fences or explanatory text.',
    'Schema:',
    '{"title":"short diagram title","nodes":[{"id":"n1","label":"Start","type":"start|process|decision|data|end"}],"edges":[{"from":"n1","to":"n2","label":"optional"}]}',
    'Rules:',
    '- Use 4 to 14 nodes unless the request is extremely small.',
    '- Keep labels short and action-oriented.',
    '- Use decision nodes only where a real branch exists.',
    '- Order nodes in natural reading order: start, main path, branch tasks, merge, end.',
    '- Label decision edges with concise yes/no labels in the user language.',
    '- Avoid backward edges unless a loop or rework path is explicitly needed.',
    '- Node ids must be stable ASCII identifiers.',
    '- Preserve the user language for labels.',
    '',
    'User request:',
    prompt
  ].join('\n');
}

function isHtmlLikeProviderResponse(text, contentType = '') {
  const normalizedContentType = String(contentType || '').toLowerCase();

  if (normalizedContentType.includes('text/html')) {
    return true;
  }

  return /^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(String(text || ''));
}

function compactProviderText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function providerErrorMessage(json, fallbackText, contentType) {
  if (json && typeof json === 'object') {
    if (json.error && typeof json.error.message === 'string') {
      return json.error.message;
    }

    if (typeof json.message === 'string') {
      return json.message;
    }
  }

  if (isHtmlLikeProviderResponse(fallbackText, contentType)) {
    return 'AI provider returned a web page instead of JSON. Check the Base URL and endpoint path.';
  }

  return compactProviderText(fallbackText) || 'AI provider returned an error.';
}

function isProviderAuthFailure(status, message) {
  if (status === 401 || status === 403) {
    return true;
  }

  return /invalid\s+(?:api\s+)?(?:key|token)|unauthori[sz]ed|forbidden|authentication|auth\s+failed/i.test(String(message || ''));
}

async function fetchAiProvider(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, AI_TIMEOUT_MS));

  try {
    return await fetchCompat(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw publicError(504, 'ai_provider_timeout', 'AI provider request timed out.');
    }

    throw publicError(502, 'ai_provider_unreachable', 'AI provider is unreachable.');
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderJson(upstream) {
  const text = await upstream.text();
  const contentType = upstream.headers && typeof upstream.headers.get === 'function' ? upstream.headers.get('content-type') : '';
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    if (upstream.ok) {
      throw publicError(502, 'ai_provider_non_json', providerErrorMessage(null, text, contentType), {
        providerStatus: upstream.status
      });
    }
  }

  if (!upstream.ok) {
    const message = providerErrorMessage(json, text, contentType);
    const authFailed = isProviderAuthFailure(upstream.status, message);

    throw publicError(502, authFailed ? 'ai_provider_auth_failed' : json ? 'ai_provider_error' : 'ai_provider_non_json', authFailed ? 'AI provider rejected the API key.' : message, {
      providerStatus: upstream.status
    });
  }

  if (!json || typeof json !== 'object') {
    throw publicError(502, 'ai_invalid_response', 'AI provider response is empty.');
  }

  return json;
}

function textFromContentParts(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part.text === 'string') {
        return part.text;
      }

      if (part && part.type === 'text' && typeof part.content === 'string') {
        return part.content;
      }

      return '';
    }).join('\n').trim();
  }

  return '';
}

async function requestOpenAiFlowchart(prompt, config) {
  const upstream = await fetchAiProvider(aiEndpoint(config.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: [
        {
          role: 'system',
          content: 'You convert user requirements into clean flowchart JSON for draw.io. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildFlowchartInstruction(prompt)
        }
      ]
    })
  });
  const json = await readProviderJson(upstream);
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const content = choice && choice.message ? textFromContentParts(choice.message.content) : '';

  if (!content) {
    throw publicError(502, 'ai_invalid_response', 'AI provider did not return message content.');
  }

  return content;
}

async function requestAnthropicFlowchart(prompt, config) {
  const upstream = await fetchAiProvider(aiEndpoint(config.baseUrl, 'messages'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': process.env.DRAWIO_AI_ANTHROPIC_VERSION || '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: 'You convert user requirements into clean flowchart JSON for draw.io. Return valid JSON only.',
      messages: [
        {
          role: 'user',
          content: buildFlowchartInstruction(prompt)
        }
      ]
    })
  });
  const json = await readProviderJson(upstream);
  const content = textFromContentParts(json.content);

  if (!content) {
    throw publicError(502, 'ai_invalid_response', 'AI provider did not return message content.');
  }

  return content;
}

async function requestOpenAiModels(config) {
  const upstream = await fetchAiProvider(aiEndpoint(config.baseUrl, 'models'), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    }
  });
  const json = await readProviderJson(upstream);
  return normalizeAiModels(json);
}

async function requestAnthropicModels(config) {
  const upstream = await fetchAiProvider(aiEndpoint(config.baseUrl, 'models'), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': process.env.DRAWIO_AI_ANTHROPIC_VERSION || '2023-06-01'
    }
  });
  const json = await readProviderJson(upstream);
  return normalizeAiModels(json);
}

async function requestAiModels(config) {
  if (config.format === 'anthropic') {
    return requestAnthropicModels(config);
  }

  return requestOpenAiModels(config);
}

async function requestAiFlowchart(prompt, config) {
  if (config.format === 'anthropic') {
    return requestAnthropicFlowchart(prompt, config);
  }

  return requestOpenAiFlowchart(prompt, config);
}

function parseAiJsonObject(text) {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw publicError(502, 'ai_response_not_json', 'AI response did not include a JSON object.');
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_err) {
    throw publicError(502, 'ai_response_not_json', 'AI response JSON could not be parsed.');
  }
}

function sanitizeDiagramText(value, fallback, maxLength = 80) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (text || fallback).slice(0, maxLength);
}

function normalizeNodeId(value, index, used) {
  const base = String(value || `n${index + 1}`)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 36) || `n${index + 1}`;
  let id = base;
  let suffix = 2;

  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }

  used.add(id);
  return id;
}

function normalizeNodeType(value, index, total) {
  const type = String(value || '').trim().toLowerCase();

  if (AI_NODE_TYPES.has(type)) {
    return type;
  }

  if (index === 0) {
    return 'start';
  }

  if (index === total - 1) {
    return 'end';
  }

  return 'process';
}

function normalizeFlowchartSpec(raw, prompt) {
  const nodesInput = Array.isArray(raw && raw.nodes) ? raw.nodes.slice(0, 24) : [];

  if (nodesInput.length < 2) {
    throw publicError(502, 'ai_flowchart_too_small', 'AI response did not include enough flowchart nodes.');
  }

  const used = new Set();
  const rawIdMap = new Map();
  const nodes = nodesInput.map((node, index) => {
    const rawId = String(node && node.id ? node.id : `n${index + 1}`);
    const id = normalizeNodeId(rawId, index, used);

    if (!rawIdMap.has(rawId)) {
      rawIdMap.set(rawId, id);
    }

    return {
      id,
      label: sanitizeDiagramText(node && node.label, `Step ${index + 1}`),
      type: normalizeNodeType(node && node.type, index, nodesInput.length)
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const edgeInputs = Array.isArray(raw && raw.edges) ? raw.edges.slice(0, 48) : [];

  for (const edge of edgeInputs) {
    const from = rawIdMap.get(String(edge && edge.from)) || String(edge && edge.from || '');
    const to = rawIdMap.get(String(edge && edge.to)) || String(edge && edge.to || '');

    if (nodeIds.has(from) && nodeIds.has(to) && from !== to) {
      edges.push({
        from,
        to,
        label: sanitizeDiagramText(edge && edge.label, '', 24)
      });
    }
  }

  if (!edges.length) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ from: nodes[index].id, to: nodes[index + 1].id, label: '' });
    }
  }

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI flowchart', 32), 64),
    nodes,
    edges
  };
}

function escapeXml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  })[ch]);
}

function nodeStyle(type) {
  const common = 'whiteSpace=wrap;html=1;strokeWidth=2;fontColor=#17211f;fontSize=14;fontFamily=Microsoft YaHei,Arial;align=center;verticalAlign=middle;spacing=12;shadow=0;';

  if (type === 'start') {
    return `${common}ellipse;fillColor=#e0f1ec;strokeColor=#147866;`;
  }

  if (type === 'end') {
    return `${common}ellipse;fillColor=#f9edda;strokeColor=#b16f18;`;
  }

  if (type === 'decision') {
    return `${common}rhombus;fillColor=#edf4ff;strokeColor=#215fbd;spacing=8;`;
  }

  if (type === 'data') {
    return `${common}shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;fillColor=#fff7ed;strokeColor=#b16f18;`;
  }

  return `${common}rounded=1;arcSize=10;fillColor=#fffdf8;strokeColor=#215fbd;`;
}

function flowchartNodeSize(type) {
  if (type === 'decision') {
    return { width: 176, height: 96 };
  }

  if (type === 'start' || type === 'end') {
    return { width: 184, height: 64 };
  }

  if (type === 'data') {
    return { width: 210, height: 72 };
  }

  return { width: 210, height: 72 };
}

function edgeLabelKind(label) {
  const text = String(label || '').trim().toLowerCase();

  if (/^(no|n|false)$/.test(text) || /否|不|未|拒绝|无需|失败/.test(text)) {
    return 'no';
  }

  if (/^(yes|y|true)$/.test(text) || /是|需|通过|同意|成功|升级/.test(text)) {
    return 'yes';
  }

  return '';
}

function assignFlowchartLanes(spec, indexById) {
  const lanes = new Map();
  const outgoing = new Map();

  spec.edges.forEach((edge) => {
    if (!outgoing.has(edge.from)) {
      outgoing.set(edge.from, []);
    }

    outgoing.get(edge.from).push(edge);
  });

  spec.nodes.forEach((node, index) => {
    if (!lanes.has(node.id)) {
      lanes.set(node.id, index > 0 && lanes.has(spec.nodes[index - 1].id) ? lanes.get(spec.nodes[index - 1].id) : 0);
    }

    const lane = lanes.get(node.id);
    const forwardEdges = (outgoing.get(node.id) || [])
      .filter((edge) => indexById.get(edge.to) > index)
      .sort((a, b) => indexById.get(a.to) - indexById.get(b.to));

    if (node.type === 'decision' && forwardEdges.length > 1) {
      const mainEdge = forwardEdges.find((edge) => edgeLabelKind(edge.label) === 'no') ||
        forwardEdges.find((edge) => indexById.get(edge.to) === index + 1) ||
        forwardEdges[0];
      let sideOffset = 1;

      forwardEdges.forEach((edge) => {
        if (edge === mainEdge) {
          if (!lanes.has(edge.to)) {
            lanes.set(edge.to, lane);
          }

          return;
        }

        const kind = edgeLabelKind(edge.label);
        const side = kind === 'no' ? -1 : 1;

        if (!lanes.has(edge.to)) {
          lanes.set(edge.to, lane + side * sideOffset);
        }

        sideOffset += 1;
      });

      return;
    }

    forwardEdges.forEach((edge) => {
      if (!lanes.has(edge.to)) {
        lanes.set(edge.to, lane);
      }
    });
  });

  spec.nodes.forEach((node) => {
    if (!lanes.has(node.id)) {
      lanes.set(node.id, 0);
    }
  });

  return lanes;
}

function roundedGrid(value) {
  return Math.round(value / 10) * 10;
}

function flowchartEdgeStyle(sourceLayout, targetLayout) {
  const backward = targetLayout.index <= sourceLayout.index;
  const common = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    'endArrow=block',
    'strokeWidth=2',
    'fontSize=12',
    'fontFamily=Microsoft YaHei,Arial',
    'fontColor=#3f514c',
    'labelBackgroundColor=#ffffff',
    'spacing=8'
  ];

  if (backward) {
    common.push('strokeColor=#8a9792', 'dashed=1', 'dashPattern=8 4');
  } else {
    common.push('strokeColor=#52645f');
  }

  return `${common.join(';')};`;
}

function edgeWaypoints(sourceLayout, targetLayout) {
  const sourceCenterX = sourceLayout.x + sourceLayout.width / 2;
  const sourceCenterY = sourceLayout.y + sourceLayout.height / 2;
  const targetCenterX = targetLayout.x + targetLayout.width / 2;
  const targetCenterY = targetLayout.y + targetLayout.height / 2;
  const backward = targetLayout.index <= sourceLayout.index;
  const crossLane = sourceLayout.lane !== targetLayout.lane;
  const skippedSameLane = !crossLane && targetLayout.index > sourceLayout.index + 1;

  if (backward) {
    const routeX = roundedGrid(Math.max(sourceLayout.x + sourceLayout.width, targetLayout.x + targetLayout.width) + 90);
    return [
      { x: routeX, y: roundedGrid(sourceCenterY) },
      { x: routeX, y: roundedGrid(targetCenterY) }
    ];
  }

  if (crossLane) {
    return [
      { x: roundedGrid(targetCenterX), y: roundedGrid(sourceCenterY) }
    ];
  }

  if (skippedSameLane) {
    const routeX = roundedGrid(sourceLayout.x + sourceLayout.width + 72);
    return [
      { x: routeX, y: roundedGrid(sourceCenterY) },
      { x: routeX, y: roundedGrid(targetCenterY) }
    ];
  }

  return [];
}

function edgeGeometryXml(points) {
  if (!points.length) {
    return '<mxGeometry relative="1" as="geometry"/>';
  }

  return [
    '<mxGeometry relative="1" as="geometry">',
    '<Array as="points">',
    points.map((point) => `<mxPoint x="${point.x}" y="${point.y}"/>`).join(''),
    '</Array>',
    '</mxGeometry>'
  ].join('');
}

function renderFlowchartXml(spec) {
  const startY = 80;
  const gapY = 136;
  const laneGap = 285;
  const minPageWidth = 900;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const nodeCellIds = new Map();
  const nodeLayouts = new Map();
  const indexById = new Map(spec.nodes.map((node, index) => [node.id, index]));
  const lanes = assignFlowchartLanes(spec, indexById);
  const laneValues = Array.from(lanes.values());
  const maxAbsLane = Math.max(1, ...laneValues.map((lane) => Math.abs(lane)));
  const pageWidth = Math.max(minPageWidth, maxAbsLane * 2 * laneGap + 480);
  const centerX = pageWidth / 2;

  spec.nodes.forEach((node, index) => {
    const cellId = `ai_node_${node.id}`;
    const size = flowchartNodeSize(node.type);
    const lane = lanes.get(node.id) || 0;
    const x = roundedGrid(centerX + lane * laneGap - size.width / 2);
    const y = startY + index * gapY;

    nodeCellIds.set(node.id, cellId);
    nodeLayouts.set(node.id, { ...size, x, y, lane, index });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(node.label)}" style="${escapeXml(nodeStyle(node.type))}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${y}" width="${size.width}" height="${size.height}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
  });

  spec.edges.forEach((edge, index) => {
    const source = nodeCellIds.get(edge.from);
    const target = nodeCellIds.get(edge.to);
    const sourceLayout = nodeLayouts.get(edge.from);
    const targetLayout = nodeLayouts.get(edge.to);

    if (!source || !target || !sourceLayout || !targetLayout) {
      return;
    }

    cells.push([
      `<mxCell id="ai_edge_${index + 1}" value="${escapeXml(edge.label)}" style="${escapeXml(flowchartEdgeStyle(sourceLayout, targetLayout))}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}">`,
      edgeGeometryXml(edgeWaypoints(sourceLayout, targetLayout)),
      '</mxCell>'
    ].join(''));
  });

  const pageHeight = Math.max(1169, startY + spec.nodes.length * gapY + 160);

  return [
    `<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">`,
    '<root>',
    cells.join(''),
    '</root>',
    '</mxGraphModel>'
  ].join('');
}

async function handleAiFlowchart(req, res, session) {
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

  try {
    const prompt = String(payload.prompt || '').trim();

    if (!prompt) {
      throw publicError(400, 'prompt_required', 'Prompt is required.');
    }

    if (prompt.length > MAX_AI_PROMPT_CHARS) {
      throw publicError(413, 'prompt_too_large', 'Prompt is too long.');
    }

    const config = normalizeAiConfig(payload.config || {});
    const aiText = await requestAiFlowchart(prompt, config);
    const rawSpec = parseAiJsonObject(aiText);
    const spec = normalizeFlowchartSpec(rawSpec, prompt);
    const xml = renderFlowchartXml(spec);

    sendJson(res, 200, {
      diagram: {
        title: spec.title,
        nodeCount: spec.nodes.length,
        edgeCount: spec.edges.length
      },
      provider: {
        format: config.format,
        baseUrl: config.baseUrl,
        model: config.model
      },
      generatedBy: session.employeeId,
      xml
    });
  } catch (err) {
    sendJson(res, err.status || 500, {
      error: err.code || 'internal_server_error',
      message: err.publicMessage || 'Unable to generate flowchart.',
      providerStatus: err.providerStatus || null
    });
  }
}

async function handleAiModels(req, res) {
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

  try {
    const config = normalizeAiConfig(payload.config || {}, { requireModel: false });
    const models = await requestAiModels(config);

    if (!models.length) {
      throw publicError(502, 'ai_models_empty', 'AI provider did not return any models.');
    }

    sendJson(res, 200, {
      models,
      provider: {
        format: config.format,
        baseUrl: config.baseUrl
      }
    });
  } catch (err) {
    sendJson(res, err.status || 500, {
      error: err.code || 'internal_server_error',
      message: err.publicMessage || 'Unable to load AI models.',
      providerStatus: err.providerStatus || null
    });
  }
}

function securityHeaders(headers = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers
  };
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);

  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    ...headers
  }));
  res.end(body);
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, securityHeaders({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    ...headers
  }));
  res.end(text);
}

function sendDownload(res, body, filename, contentType) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');

  res.writeHead(200, securityHeaders({
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Content-Disposition': contentDisposition(filename),
    'Cache-Control': 'no-store, max-age=0'
  }));
  res.end(buffer);
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({
    Location: location,
    'Cache-Control': 'no-store, max-age=0'
  }));
  res.end();
}

function notFound(res) {
  sendText(res, 404, 'Not found');
}

function methodNotAllowed(res, allow = 'GET, POST') {
  sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: allow });
}

function hasJsonContentType(req) {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return contentType === 'application/json' || contentType.endsWith('+json');
}

async function readJsonBody(req) {
  if (!hasJsonContentType(req)) {
    const err = new Error('Unsupported media type');
    err.status = 415;
    err.code = 'unsupported_media_type';
    throw err;
  }

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
    upstream = await fetchCompat(target, {
      method: req.method,
      headers: proxyHeaders(req),
      body
    });
  } catch (err) {
    sendJson(res, 502, { error: 'export_server_unreachable', message: err.message });
    return;
  }

  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  const headers = securityHeaders({
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Content-Length': upstreamBody.length,
    'Cache-Control': 'no-store, max-age=0'
  });
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
  const url = new URL(req.url, `http://${requestHost(req)}`);
  return decodeURIComponent(url.pathname);
}

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function trustedHeader(req, name) {
  return TRUST_PROXY ? firstHeaderValue(req.headers[name]) : '';
}

function requestHost(req) {
  const rawHost = trustedHeader(req, 'x-forwarded-host') || firstHeaderValue(req.headers.host) || `127.0.0.1:${PORT}`;
  const host = rawHost.replace(/[\r\n]/g, '').trim();

  if (/^[A-Za-z0-9._:\-[\]]+$/.test(host)) {
    return host;
  }

  return `127.0.0.1:${PORT}`;
}

function requestProto(req) {
  const proto = (trustedHeader(req, 'x-forwarded-proto') || 'http').toLowerCase();
  return proto === 'https' ? 'https' : 'http';
}

function externalBaseUrl(req) {
  return `${requestProto(req)}://${requestHost(req)}`;
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
  const forwardedFor = trustedHeader(req, 'x-forwarded-for');
  return forwardedFor || req.socket.remoteAddress || '';
}

function isStateChangingMethod(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function isSameOriginRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();

  if (site && !['same-origin', 'same-site', 'none'].includes(site)) {
    return false;
  }

  const origin = firstHeaderValue(req.headers.origin);

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === `${requestProto(req)}://${requestHost(req)}`;
  } catch (_err) {
    return false;
  }
}

function rejectCrossSiteMutation(req, res) {
  if (isStateChangingMethod(req.method) && !isSameOriginRequest(req)) {
    sendJson(res, 403, { error: 'cross_site_request_rejected' });
    return true;
  }

  return false;
}

function authRateKey(req, scope, subject) {
  return `${scope}:${clientAddress(req)}:${String(subject || '').toLowerCase()}`;
}

function authRateWindowMs() {
  return Math.max(1000, Number.isFinite(AUTH_RATE_LIMIT_WINDOW_MS) ? AUTH_RATE_LIMIT_WINDOW_MS : 15 * 60 * 1000);
}

function authRateMax(value) {
  return Math.max(0, Number.isFinite(value) ? Math.floor(value) : 20);
}

function currentAuthRateRecord(key, now = Date.now()) {
  let record = authRateLimits.get(key);

  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + authRateWindowMs() };
    authRateLimits.set(key, record);
  }

  return record;
}

function authRateRetryAfterSeconds(key, maxAttempts) {
  const max = authRateMax(maxAttempts);

  if (max === 0) {
    return 0;
  }

  const now = Date.now();
  const record = currentAuthRateRecord(key, now);

  if (record.count < max) {
    return 0;
  }

  return Math.max(1, Math.ceil((record.resetAt - now) / 1000));
}

function recordAuthFailure(key) {
  const record = currentAuthRateRecord(key);
  record.count += 1;
}

function clearAuthFailures(key) {
  authRateLimits.delete(key);
}

function sendRateLimited(res, retryAfterSeconds) {
  sendJson(res, 429, {
    error: 'too_many_attempts',
    retryAfterSeconds
  }, {
    'Retry-After': retryAfterSeconds
  });
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

    res.writeHead(200, securityHeaders({
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache
    }));

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
  if (
    pathname === '/login.html' ||
    pathname === '/register.html' ||
    pathname === '/app.html' ||
    pathname === '/admin.html' ||
    pathname === '/editor.html' ||
    pathname === '/share.html'
  ) {
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

  const rateKey = authRateKey(req, 'login', employeeId);
  const retryAfterSeconds = authRateRetryAfterSeconds(rateKey, LOGIN_RATE_LIMIT_MAX);

  if (retryAfterSeconds) {
    sendRateLimited(res, retryAfterSeconds);
    return;
  }

  await ensureAccountsLoaded();
  const account = getAccount(employeeId);

  if (!account || account.status === 'pending' || !verifyPasswordRecord(account, password)) {
    recordAuthFailure(rateKey);
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  if (account.status === 'disabled') {
    sendJson(res, 403, { error: 'account_disabled' });
    return;
  }

  clearAuthFailures(rateKey);
  const session = await createSession(account.employeeId);

  sendJson(res, 200, {
    authenticated: true,
    employeeId: account.employeeId,
    role: account.role,
    canAdmin: isAdminAccount(account),
    expiresAt: session.expiresAt
  }, {
    'Set-Cookie': buildCookie(session.token, { maxAge: Math.floor(SESSION_TTL_MS / 1000) })
  });
}

async function handleRegister(req, res) {
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
  const inviteCode = normalizeInviteCode(payload.inviteCode);

  if (!isValidEmployeeId(employeeId)) {
    sendJson(res, 400, { error: 'invalid_employee_id' });
    return;
  }

  if (!isValidInviteCode(inviteCode)) {
    sendJson(res, 400, { error: 'invalid_invite_code' });
    return;
  }

  if (!isValidPassword(password)) {
    sendJson(res, 400, { error: 'weak_password', minLength: MIN_PASSWORD_CHARS });
    return;
  }

  const rateKey = authRateKey(req, 'register', employeeId);
  const retryAfterSeconds = authRateRetryAfterSeconds(rateKey, REGISTER_RATE_LIMIT_MAX);

  if (retryAfterSeconds) {
    sendRateLimited(res, retryAfterSeconds);
    return;
  }

  await ensureAccountsLoaded();
  const account = accounts.get(employeeId);

  if (!account || account.status !== 'pending' || !verifyInviteCode(account, inviteCode)) {
    recordAuthFailure(rateKey);
    sendJson(res, 401, { error: 'invalid_invite_code' });
    return;
  }

  const time = nowIso();
  const name = sanitizeProfileName(payload.name || account.name);
  Object.assign(account, createPasswordRecord(password), {
    name,
    displayName: name || employeeId,
    status: 'active',
    inviteCode: '',
    inviteCodeHash: '',
    inviteCodePreview: '',
    inviteAcceptedAt: time,
    registeredAt: time,
    updatedAt: time,
    updatedBy: employeeId
  });

  accounts.set(employeeId, account);
  await saveAccounts();
  await writeEmployeeProfile(employeeId, name);
  clearAuthFailures(rateKey);

  const session = await createSession(employeeId);

  sendJson(res, 201, {
    authenticated: true,
    account: accountSummary(account),
    expiresAt: session.expiresAt
  }, {
    'Set-Cookie': buildCookie(session.token, { maxAge: Math.floor(SESSION_TTL_MS / 1000) })
  });
}

async function handleAdminAccounts(req, res, session) {
  await ensureAccountsLoaded();

  if (req.method === 'GET') {
    sendJson(res, 200, { accounts: listAccountSummaries() });
    return;
  }

  if (req.method === 'POST') {
    try {
      const payload = await readJsonBody(req);
      const created = await createPendingAccount(payload, session.employeeId);

      sendJson(res, 201, {
        account: accountSummary(created.account, { inviteCode: created.inviteCode })
      });
    } catch (err) {
      sendJson(res, err.status || 500, {
        error: err.code || 'internal_server_error',
        message: err.publicMessage || 'Unable to create account.'
      });
    }

    return;
  }

  methodNotAllowed(res, 'GET, POST');
}

async function handleAdminBatchAccounts(req, res, session) {
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

  const rows = parseBatchAccounts(payload);

  if (!rows.length) {
    sendJson(res, 400, { error: 'batch_empty' });
    return;
  }

  if (rows.length > MAX_BATCH_ACCOUNTS) {
    sendJson(res, 413, { error: 'batch_too_large', max: MAX_BATCH_ACCOUNTS });
    return;
  }

  const created = [];
  const errors = [];

  for (const row of rows) {
    try {
      const result = await createPendingAccount(row, session.employeeId, { save: false });
      created.push(accountSummary(result.account, {
        inviteCode: result.inviteCode,
        line: row.index + 1
      }));
    } catch (err) {
      errors.push({
        line: row.index + 1,
        employeeId: normalizeEmployeeId(row.employeeId),
        error: err.code || 'internal_server_error'
      });
    }
  }

  if (created.length) {
    await saveAccounts();
  }

  sendJson(res, created.length ? 201 : 400, { created, errors });
}

async function handleAdminAccountItem(req, res, session, employeeId, action) {
  await ensureAccountsLoaded();

  if (!isValidEmployeeId(employeeId)) {
    sendJson(res, 400, { error: 'invalid_employee_id' });
    return;
  }

  const account = accounts.get(employeeId);
  const envAdmin = envAdminAccount();

  if (employeeId === envAdmin.employeeId && !account) {
    sendJson(res, 409, { error: 'environment_admin_readonly' });
    return;
  }

  if (!account) {
    sendJson(res, 404, { error: 'account_not_found' });
    return;
  }

  if (action === 'invite') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, 'POST');
      return;
    }

    if (account.status !== 'pending') {
      sendJson(res, 409, { error: 'account_already_registered' });
      return;
    }

    const inviteCode = assignInviteCode(account, session.employeeId);
    await saveAccounts();
    sendJson(res, 200, { account: accountSummary(account, { inviteCode }) });
    return;
  }

  if (action) {
    notFound(res);
    return;
  }

  if (req.method === 'PATCH') {
    let payload;

    try {
      payload = await readJsonBody(req);
    } catch (err) {
      sendJson(res, err.status || 400, { error: err.code || 'invalid_json' });
      return;
    }

    const nextRole = payload.role == null ? account.role : normalizeAccountRole(payload.role);
    const nextStatus = payload.status == null ? account.status : normalizeAccountStatus(payload.status);

    if (employeeId === session.employeeId && (nextRole !== 'admin' || nextStatus !== 'active')) {
      sendJson(res, 409, { error: 'cannot_lock_self' });
      return;
    }

    if (nextStatus === 'active' && !account.passwordHash) {
      sendJson(res, 409, { error: 'account_not_registered' });
      return;
    }

    account.name = payload.name == null ? account.name : sanitizeProfileName(payload.name);
    account.displayName = account.name || account.employeeId;
    account.role = nextRole;
    account.status = nextStatus;
    account.updatedAt = nowIso();
    account.updatedBy = session.employeeId;
    await saveAccounts();
    await writeEmployeeProfile(account.employeeId, account.name);
    sendJson(res, 200, { account: accountSummary(account) });
    return;
  }

  if (req.method === 'DELETE') {
    if (employeeId === session.employeeId) {
      sendJson(res, 409, { error: 'cannot_delete_self' });
      return;
    }

    accounts.delete(employeeId);
    await saveAccounts();
    sendJson(res, 200, { deleted: true });
    return;
  }

  methodNotAllowed(res, 'PATCH, DELETE');
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

  if (pathname === '/api/register') {
    await handleRegister(req, res);
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
    const account = await getSessionAccount(session);
    const isActive = Boolean(account && account.status === 'active');
    const profile = isActive ? await readEmployeeProfile(session.employeeId) : null;

    sendJson(res, 200, isActive ? {
      authenticated: true,
      employeeId: session.employeeId,
      name: profile.name,
      displayName: profile.displayName,
      role: account.role,
      canAdmin: isAdminAccount(account),
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

  const account = await getSessionAccount(session);

  if (!account || account.status !== 'active') {
    sendJson(res, 401, { error: 'not_authenticated' }, { 'Set-Cookie': clearCookie() });
    return;
  }

  if (pathname === '/api/admin/accounts') {
    if (!isAdminAccount(account)) {
      sendJson(res, 403, { error: 'not_authorized' });
      return;
    }

    await handleAdminAccounts(req, res, session);
    return;
  }

  if (pathname === '/api/admin/accounts/batch') {
    if (!isAdminAccount(account)) {
      sendJson(res, 403, { error: 'not_authorized' });
      return;
    }

    await handleAdminBatchAccounts(req, res, session);
    return;
  }

  const adminAccountMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)(?:\/([^/]+))?$/);

  if (adminAccountMatch) {
    if (!isAdminAccount(account)) {
      sendJson(res, 403, { error: 'not_authorized' });
      return;
    }

    await handleAdminAccountItem(req, res, session, adminAccountMatch[1], adminAccountMatch[2] || null);
    return;
  }

  if (pathname === '/api/ai/flowchart') {
    await handleAiFlowchart(req, res, session);
    return;
  }

  if (pathname === '/api/ai/models') {
    await handleAiModels(req, res);
    return;
  }

  if (pathname === '/api/profile') {
    if (req.method === 'GET') {
      sendJson(res, 200, { profile: await readEmployeeProfile(session.employeeId) });
      return;
    }

    if (req.method === 'PUT') {
      try {
        const payload = await readJsonBody(req);
        const profile = await writeEmployeeProfile(session.employeeId, payload.name);
        sendJson(res, 200, { profile });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    methodNotAllowed(res, 'GET, PUT');
    return;
  }

  if (pathname === '/api/employees') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    sendJson(res, 200, { employees: await listKnownEmployees(session.employeeId) });
    return;
  }

  if (pathname === '/api/internal-shares') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, 'GET');
      return;
    }

    sendJson(res, 200, { shares: await listInternalShares(session.employeeId) });
    return;
  }

  const internalShareMatch = pathname.match(/^\/api\/internal-shares\/([^/]+)(?:\/([^/]+))?$/);

  if (internalShareMatch) {
    const shareId = internalShareMatch[1];
    const action = internalShareMatch[2] || null;

    if (!isValidFileId(shareId)) {
      sendJson(res, 400, { error: 'invalid_share_id' });
      return;
    }

    if (action === null) {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return;
      }

      const shared = await getInternalShareForEmployee(session.employeeId, shareId);

      if (!shared || !shared.file) {
        sendJson(res, 404, { error: 'internal_share_not_found' });
        return;
      }

      await markInternalShareRead(session.employeeId, shared.share);

      sendJson(res, 200, {
        share: await internalShareSummary(shared.share, shared.file, session.employeeId),
        messages: shared.share.messages,
        xml: shared.file.xml
      });
      return;
    }

    if (action === 'messages') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const updated = await addInternalShareMessage(session.employeeId, shareId, payload.message);

        if (!updated || !updated.file) {
          sendJson(res, 404, { error: 'internal_share_not_found' });
          return;
        }

        sendJson(res, 200, {
          share: await internalShareSummary(updated.share, updated.file, session.employeeId),
          messages: updated.share.messages,
          message: updated.message
        });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    if (action === 'download') {
      if (req.method !== 'GET') {
        methodNotAllowed(res, 'GET');
        return;
      }

      const shared = await getInternalShareForEmployee(session.employeeId, shareId);

      if (!shared || !shared.file) {
        sendJson(res, 404, { error: 'internal_share_not_found' });
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

    notFound(res);
    return;
  }

  if (pathname === '/api/folders') {
    if (req.method === 'GET') {
      sendJson(res, 200, { folders: await listFolders(session.employeeId) });
      return;
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const folder = await createFolder(session.employeeId, payload.name, payload.parentId);
        sendJson(res, 201, { folder: folderSummary(folder) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    methodNotAllowed(res, 'GET, POST');
    return;
  }

  const folderMatch = pathname.match(/^\/api\/folders\/([^/]+)(?:\/([^/]+))?$/);

  if (folderMatch) {
    const folderId = folderMatch[1];
    const action = folderMatch[2] || null;

    if (!isValidFolderId(folderId)) {
      sendJson(res, 400, { error: 'invalid_folder_id' });
      return;
    }

    if (action === null) {
      if (req.method === 'GET') {
        const folder = await readFolder(session.employeeId, folderId);

        if (!folder) {
          sendJson(res, 404, { error: 'folder_not_found' });
          return;
        }

        sendJson(res, 200, { folder: folderSummary(folder) });
        return;
      }

      if (req.method === 'DELETE') {
        const deleted = await deleteFolder(session.employeeId, folderId);
        sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: 'folder_not_found' });
        return;
      }

      methodNotAllowed(res, 'GET, DELETE');
      return;
    }

    if (action === 'rename') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const folder = await renameFolder(session.employeeId, folderId, payload.name);

        if (!folder) {
          sendJson(res, 404, { error: 'folder_not_found' });
          return;
        }

        sendJson(res, 200, { folder: folderSummary(folder) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    if (action === 'move') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const folder = await moveFolder(session.employeeId, folderId, payload.parentId);

        if (!folder) {
          sendJson(res, 404, { error: 'folder_not_found' });
          return;
        }

        sendJson(res, 200, { folder: folderSummary(folder) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    if (action === 'copy') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const folder = await copyFolder(session.employeeId, folderId, payload.parentId);

        if (!folder) {
          sendJson(res, 404, { error: 'folder_not_found' });
          return;
        }

        sendJson(res, 201, { folder: folderSummary(folder) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    notFound(res);
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

      try {
        const created = await createFile(session.employeeId, payload.name, payload.xml, payload.folderId);
        sendJson(res, 201, { file: fileSummary(created.meta), xml: created.xml });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }
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

    if (action === 'move') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const moved = await moveFile(session.employeeId, fileId, payload.folderId);

        if (!moved) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        sendJson(res, 200, { file: fileSummary(moved) });
      } catch (err) {
        sendJson(res, err.status || 500, { error: err.code || 'internal_server_error' });
      }

      return;
    }

    if (action === 'copy') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const copied = await copyFile(session.employeeId, fileId, payload.folderId);

        if (!copied) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        sendJson(res, 201, { file: fileSummary(copied.meta) });
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

    if (action === 'share-internal') {
      if (req.method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return;
      }

      try {
        const payload = await readJsonBody(req);
        const shared = await createInternalShare(session.employeeId, fileId, payload.recipients, payload.message);

        if (!shared) {
          sendJson(res, 404, { error: 'file_not_found' });
          return;
        }

        sendJson(res, 200, {
          share: await internalShareSummary(shared.share, shared.file, session.employeeId),
          messages: shared.share.messages
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

  let session = getSession(req);
  const account = session ? await getSessionAccount(session) : null;

  if (session && (!account || account.status !== 'active')) {
    await destroySession(req);
    session = null;
  }

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

  if (pathname === '/register.html') {
    if (session) {
      redirect(res, safeNext(searchParams.get('next')));
      return;
    }

    await serveFile(req, res, path.join(PUBLIC_DIR, 'register.html'));
    return;
  }

  if (pathname === '/share.html') {
    await serveFile(req, res, path.join(PUBLIC_DIR, 'share.html'));
    return;
  }

  if (pathname === '/admin.html') {
    if (!session) {
      const next = encodeURIComponent(`${pathname}${searchParams.size ? `?${searchParams}` : ''}`);
      redirect(res, `/login.html?next=${next}`);
      return;
    }

    const account = await getSessionAccount(session);

    if (!isAdminAccount(account)) {
      redirect(res, '/app.html');
      return;
    }

    await serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'));
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
    url = new URL(req.url, `http://${requestHost(req)}`);
    pathname = getRequestPath(req);
  } catch (_err) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }

  try {
    if (rejectCrossSiteMutation(req, res)) {
      return;
    }

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
  await ensureAccountsLoaded();
  await loadSessions();

  const server = http.createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    console.log(`Company draw.io server listening on ${HOST}:${PORT}`);

    if (HOST === '0.0.0.0' || HOST === '::') {
      console.log(`Local URL: http://127.0.0.1:${PORT}/`);

      const lanUrls = localNetworkUrls(PORT);

      if (lanUrls.length > 0) {
        console.log(`LAN URLs: ${lanUrls.join(', ')}`);
      } else {
        console.log(`LAN URL: http://<your-lan-ip>:${PORT}/`);
      }
    } else {
      console.log(`URL: http://${HOST}:${PORT}/`);
    }

    console.log(`Serving webapp from ${WEBAPP_DIR}`);
    console.log(`Using data directory ${DATA_DIR}`);
  });
}

function localNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/`);
      }
    });
  });

  return urls;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  EMPTY_DIAGRAM_XML,
  fetchCompat,
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
