const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-drawio-test-'));
process.env.DRAWIO_DATA_DIR = testDataDir;
process.env.DRAWIO_WEBAPP_DIR = path.resolve(__dirname, '..', 'src', 'main', 'webapp');

const { handleRequest } = require('./server');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('company API supports login, file isolation, save conflicts and share links', async (t) => {
  const server = http.createServer(handleRequest);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  let cookieOne = '';
  let cookieTwo = '';

  t.after(() => {
    server.close();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  async function request(pathname, options = {}, jar = 'one') {
    const headers = Object.assign({}, options.headers || {});
    const cookie = jar === 'two' ? cookieTwo : cookieOne;

    if (cookie) {
      headers.cookie = cookie;
    }

    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(base + pathname, Object.assign({}, options, { headers }));
    const setCookie = res.headers.get('set-cookie');

    if (setCookie) {
      if (jar === 'two') {
        cookieTwo = setCookie.split(';')[0];
      } else {
        cookieOne = setCookie.split(';')[0];
      }
    }

    const text = await res.text();
    let body = text;

    try {
      body = text ? JSON.parse(text) : null;
    } catch (_err) {
      // Keep text response.
    }

    return { res, body };
  }

  let result = await request('/company.css');
  assert.equal(result.res.status, 200);
  assert.match(result.body, /--accent/);

  result = await request('/api/health');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.writable, true);

  result = await request('/api/ops/status');
  assert.equal(result.res.status, 401);

  result = await request('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'format=png&xml=test'
  });
  assert.equal(result.res.status, 401);

  const redirect = await fetch(base + '/app.html', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.match(redirect.headers.get('location'), /^\/login\.html/);

  result = await request('/api/me');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.authenticated, false);

  result = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ employeeId: '10001', password: '123456' })
  });
  assert.equal(result.res.status, 200);
  assert.ok(cookieOne);

  result = await request('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'format=png&xml=test'
  });
  assert.equal(result.res.status, 503);

  const exportServer = http.createServer(async (req, res) => {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    assert.equal(req.url, '/node/export');
    assert.equal(Buffer.concat(chunks).toString('utf8'), 'format=png&xml=test');
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end('PNGDATA');
  });
  const exportPort = await listen(exportServer);
  process.env.DRAWIO_EXPORT_URL = `http://127.0.0.1:${exportPort}/node/export`;
  t.after(() => {
    exportServer.close();
    delete process.env.DRAWIO_EXPORT_URL;
  });

  result = await request('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'format=png&xml=test'
  });
  assert.equal(result.res.status, 200);
  assert.match(result.res.headers.get('content-type'), /^image\/png/);
  assert.equal(result.body, 'PNGDATA');

  result = await request('/api/files', {
    method: 'POST',
    body: JSON.stringify({ name: '../diagram:name', xml: '<mxGraphModel/>' })
  });
  assert.equal(result.res.status, 201);
  assert.ok(result.body.file.id);
  assert.equal(result.body.file.name.includes('/'), false);
  const file = result.body.file;

  result = await request('/api/files');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.files.length, 1);

  result = await request(`/api/files/${file.id}`, {
    method: 'PUT',
    body: JSON.stringify({ xml: '<mxGraphModel/>', etag: 'bad-etag' })
  });
  assert.equal(result.res.status, 409);

  result = await request(`/api/files/${file.id}`, {
    method: 'PUT',
    body: JSON.stringify({ xml: '<mxGraphModel><root/></mxGraphModel>', etag: file.etag })
  });
  assert.equal(result.res.status, 200);
  assert.notEqual(result.body.file.etag, file.etag);

  result = await request(`/api/files/${file.id}/download`);
  assert.equal(result.res.status, 200);
  assert.match(result.res.headers.get('content-type'), /^application\/xml/);
  assert.match(result.res.headers.get('content-disposition'), /attachment/);
  assert.equal(result.body, '<mxGraphModel><root/></mxGraphModel>');

  result = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ employeeId: '10002', password: '123456' })
  }, 'two');
  assert.equal(result.res.status, 200);

  result = await request('/api/ops/status');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.counts.employees, 2);
  assert.equal(result.body.counts.diagrams, 1);
  assert.equal(result.body.config.opsTokenRequired, false);

  result = await request(`/api/files/${file.id}`, {}, 'two');
  assert.equal(result.res.status, 404);

  result = await request(`/api/files/${file.id}/share`, {
    method: 'POST',
    body: JSON.stringify({})
  }, 'one');
  assert.equal(result.res.status, 200);
  assert.ok(result.body.token);
  const token = result.body.token;

  cookieOne = '';
  result = await request(`/api/share/${token}`);
  assert.equal(result.res.status, 200);
  assert.equal(result.body.xml, '<mxGraphModel><root/></mxGraphModel>');

  result = await request(`/api/share/${token}/download`);
  assert.equal(result.res.status, 200);
  assert.match(result.res.headers.get('content-type'), /^application\/xml/);
  assert.equal(result.body, '<mxGraphModel><root/></mxGraphModel>');

  const accessLog = fs.readFileSync(path.join(testDataDir, 'logs', 'access.log'), 'utf8');
  assert.match(accessLog, /"path":"\/api\/share\/\[token\]"/);
  assert.match(accessLog, /"path":"\/api\/share\/\[token\]\/download"/);
  assert.doesNotMatch(accessLog, new RegExp(token));

  const backupDir = path.join(os.tmpdir(), `company-drawio-backup-${Date.now()}`);
  const backup = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'backup-data.js')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DRAWIO_DATA_DIR: testDataDir,
      DRAWIO_BACKUP_DIR: backupDir
    }
  });

  assert.equal(backup.status, 0, backup.stderr);

  const manifest = JSON.parse(backup.stdout);
  assert.equal(manifest.files >= 1, true);
  assert.equal(fs.existsSync(path.join(manifest.target, 'backup-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(manifest.target, 'logs')), false);
  fs.rmSync(backupDir, { recursive: true, force: true });
});
