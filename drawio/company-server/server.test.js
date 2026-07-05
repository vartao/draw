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

const { fetchCompat, handleRequest } = require('./server');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(done, 1000);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    server.close(done);

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function geometryForValue(xml, value) {
  const match = xml.match(new RegExp(`value="${escapeRegex(value)}"[\\s\\S]*?<mxGeometry x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));

  assert.ok(match, `Missing geometry for ${value}`);
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4])
  };
}

test('company API supports login, file isolation, save conflicts and share links', async () => {
  const server = http.createServer(handleRequest);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const cleanup = [];
  let cookieOne = '';
  let cookieTwo = '';

  cleanup.push(async () => {
    await closeServer(server);
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

    const res = await fetchCompat(base + pathname, Object.assign({}, options, { headers }));
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

  try {
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

  const redirect = await fetchCompat(base + '/app.html', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.match(redirect.headers.get('location'), /^\/login\.html/);

  result = await request('/api/me');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.authenticated, false);

  result = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ employeeId: '10001', password: '123456' })
  });
  assert.equal(result.res.status, 401);

  result = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ employeeId: 'admin', password: '123456' })
  });
  assert.equal(result.res.status, 200);
  assert.ok(cookieOne);
  assert.equal(result.body.canAdmin, true);

  result = await request('/api/files', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site'
    },
    body: JSON.stringify({ name: 'csrf.drawio', xml: '<mxGraphModel/>' })
  });
  assert.equal(result.res.status, 403);
  assert.equal(result.body.error, 'cross_site_request_rejected');

  result = await request('/api/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ employeeId: '10001', name: '张三', role: 'user' })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.account.status, 'pending');
  assert.ok(result.body.account.inviteCode);
  const inviteOne = result.body.account.inviteCode;

  result = await request('/api/admin/accounts/batch', {
    method: 'POST',
    body: JSON.stringify({ text: '10002,李四', role: 'user' })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.created.length, 1);
  const inviteTwo = result.body.created[0].inviteCode;

  result = await request('/api/admin/accounts');
  assert.equal(result.res.status, 200);
  const pendingOne = result.body.accounts.find((account) => account.employeeId === '10001');
  assert.equal(pendingOne.inviteCode, inviteOne);

  result = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: '10001',
      name: '张三',
      inviteCode: inviteOne,
      password: 'user-password-1'
    })
  });
  assert.equal(result.res.status, 201);
  assert.ok(cookieOne);

  result = await request('/api/profile', {
    method: 'PUT',
    body: JSON.stringify({ name: '张三' })
  });
  assert.equal(result.res.status, 200);
  assert.deepEqual(result.body.profile, {
    employeeId: '10001',
    name: '张三',
    displayName: '张三'
  });

  result = await request('/api/me');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.name, '张三');
  assert.equal(result.body.displayName, '张三');

  result = await request('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'format=png&xml=test'
  });
  assert.equal(result.res.status, 503);

  const aiRequests = [];
  const aiServer = http.createServer(async (req, res) => {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    aiRequests.push({
      url: req.url,
      authorization: req.headers.authorization || '',
      apiKey: req.headers['x-api-key'] || '',
      body
    });

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'test-openai-model', object: 'model' },
          { id: 'test-openai-vision-model', object: 'model' }
        ]
      }));
      return;
    }

    if (req.url === '/html/models') {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html lang="zh-CN"><head><title>Not Found</title></head><body>not found</body></html>');
      return;
    }

    if (req.url === '/auth/models') {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: 'Invalid token (request id: test-request-id)' } }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Purchase approval',
                nodes: [
                  { id: 'start', label: 'Submit request', type: 'start' },
                  { id: 'review', label: 'Manager review', type: 'process' },
                  { id: 'approved', label: 'Approved?', type: 'decision' },
                  { id: 'archive', label: 'Archive record', type: 'end' }
                ],
                edges: [
                  { from: 'start', to: 'review' },
                  { from: 'review', to: 'approved' },
                  { from: 'approved', to: 'archive', label: 'yes' }
                ]
              })
            }
          }
        ]
      }));
      return;
    }

    if (req.url === '/branch/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'After-sales support',
                nodes: [
                  { id: 'start', label: '开始', type: 'start' },
                  { id: 'receive', label: '受理工单', type: 'process' },
                  { id: 'assign', label: '分派工单', type: 'process' },
                  { id: 'handle', label: '处理问题', type: 'process' },
                  { id: 'upgrade', label: '需要升级?', type: 'decision' },
                  { id: 'escalate', label: '升级处理', type: 'process' },
                  { id: 'confirm', label: '客户确认', type: 'process' },
                  { id: 'satisfied', label: '客户满意?', type: 'decision' },
                  { id: 'end', label: '关闭工单', type: 'end' }
                ],
                edges: [
                  { from: 'start', to: 'receive' },
                  { from: 'receive', to: 'assign' },
                  { from: 'assign', to: 'handle' },
                  { from: 'handle', to: 'upgrade' },
                  { from: 'upgrade', to: 'escalate', label: '是' },
                  { from: 'upgrade', to: 'satisfied', label: '否' },
                  { from: 'escalate', to: 'handle', label: '回退' },
                  { from: 'escalate', to: 'confirm' },
                  { from: 'confirm', to: 'satisfied' },
                  { from: 'satisfied', to: 'end', label: '是' }
                ]
              })
            }
          }
        ]
      }));
      return;
    }

    if (req.url === '/swimlane/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Leave approval lanes',
                diagramType: 'swimlane',
                lanes: [
                  { id: 'employee', label: 'Employee' },
                  { id: 'manager', label: 'Manager' },
                  { id: 'hr', label: 'HR' }
                ],
                nodes: [
                  { id: 'submit', label: 'Submit leave request', type: 'start', lane: 'employee' },
                  { id: 'review', label: 'Review request', type: 'decision', lane: 'manager' },
                  { id: 'record', label: 'Record leave', type: 'process', lane: 'hr' },
                  { id: 'notify', label: 'Notify result', type: 'end', lane: 'employee' }
                ],
                edges: [
                  { from: 'submit', to: 'review' },
                  { from: 'review', to: 'record', label: 'approved' },
                  { from: 'record', to: 'notify' }
                ]
              })
            }
          }
        ]
      }));
      return;
    }

    if (req.url === '/uml/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Order classes',
                diagramType: 'uml_class',
                classes: [
                  { id: 'order', name: 'Order', attributes: ['id: string', 'status: string'], methods: ['submit(): void'] },
                  { id: 'item', name: 'OrderItem', attributes: ['quantity: number'], methods: ['subtotal(): money'] },
                  { id: 'product', name: 'Product', attributes: ['sku: string'], methods: ['reserve(): void'] }
                ],
                relations: [
                  { from: 'order', to: 'item', type: 'composition', label: 'contains' },
                  { from: 'item', to: 'product', type: 'association', label: 'references' }
                ]
              })
            }
          }
        ]
      }));
      return;
    }

    if (req.url === '/anthropic/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'test-anthropic-model', display_name: 'Test Anthropic Model' }
        ]
      }));
      return;
    }

    if (req.url === '/anthropic/messages') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: [
          {
            type: 'text',
            text: '```json\n{"title":"Support ticket","nodes":[{"id":"n1","label":"Open ticket","type":"start"},{"id":"n2","label":"Assign owner","type":"process"},{"id":"n3","label":"Resolved?","type":"decision"},{"id":"n4","label":"Close ticket","type":"end"}],"edges":[{"from":"n1","to":"n2"},{"from":"n2","to":"n3"},{"from":"n3","to":"n4","label":"yes"}]}\n```'
          }
        ]
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unknown test route' } }));
  });
  const aiPort = await listen(aiServer);
  cleanup.push(async () => {
    await closeServer(aiServer);
  });

  result = await request('/api/ai/providers');
  assert.equal(result.res.status, 200);
  assert.deepEqual(result.body.providers, []);

  result = await request('/api/ai/providers', {
    method: 'POST',
    body: JSON.stringify({
      name: '公司 OpenAI 网关',
      providerFormat: 'openai',
      baseUrl: `http://127.0.0.1:${aiPort}/v1`,
      apiKey: 'openai-test-key',
      model: 'test-openai-model'
    })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.provider.name, '公司 OpenAI 网关');
  assert.equal(result.body.provider.hasApiKey, true);
  assert.equal(result.body.provider.apiKey, undefined);
  const savedProviderId = result.body.provider.id;
  assert.equal(result.body.selectedProviderId, savedProviderId);

  const providerStorePath = path.join(testDataDir, 'employees', '10001', 'ai-providers.json');
  const providerStore = JSON.parse(fs.readFileSync(providerStorePath, 'utf8'));
  assert.equal(providerStore.providers[0].apiKey, 'openai-test-key');

  result = await request('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        providerId: savedProviderId
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.deepEqual(result.body.models.map((model) => model.id), ['test-openai-model', 'test-openai-vision-model']);
  assert.equal(aiRequests.at(-1).url, '/v1/models');
  assert.equal(aiRequests.at(-1).authorization, 'Bearer openai-test-key');

  result = await request('/api/ai/providers/' + encodeURIComponent(savedProviderId), {
    method: 'PUT',
    body: JSON.stringify({
      name: '更新后的网关',
      model: 'test-openai-vision-model',
      apiKey: ''
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.provider.name, '更新后的网关');
  assert.equal(result.body.provider.model, 'test-openai-vision-model');
  assert.equal(result.body.provider.hasApiKey, true);
  assert.equal(JSON.parse(fs.readFileSync(providerStorePath, 'utf8')).providers[0].apiKey, 'openai-test-key');

  result = await request('/api/ai/providers/selection', {
    method: 'PUT',
    body: JSON.stringify({ providerId: '' })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.selectedProviderId, '');

  result = await request('/api/ai/providers/selection', {
    method: 'PUT',
    body: JSON.stringify({ providerId: savedProviderId })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.selectedProviderId, savedProviderId);

  result = await request('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/v1`,
        apiKey: 'openai-test-key'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.deepEqual(result.body.models.map((model) => model.id), ['test-openai-model', 'test-openai-vision-model']);
  assert.equal(aiRequests.at(-1).url, '/v1/models');
  assert.equal(aiRequests.at(-1).authorization, 'Bearer openai-test-key');

  result = await request('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/html`,
        apiKey: 'openai-test-key'
      }
    })
  });
  assert.equal(result.res.status, 502);
  assert.equal(result.body.error, 'ai_provider_non_json');
  assert.equal(result.body.providerStatus, 404);
  assert.match(result.body.message, /web page instead of JSON/);
  assert.doesNotMatch(result.body.message, /<!DOCTYPE|<html|_next\/static/i);
  assert.equal(aiRequests.at(-1).url, '/html/models');

  result = await request('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/auth`,
        apiKey: 'bad-openai-test-key'
      }
    })
  });
  assert.equal(result.res.status, 502);
  assert.equal(result.body.error, 'ai_provider_auth_failed');
  assert.equal(result.body.providerStatus, 401);
  assert.equal(result.body.message, 'AI provider rejected the API key.');
  assert.equal(aiRequests.at(-1).url, '/auth/models');

  result = await request('/api/ai/flowchart', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Create a purchase flowchart',
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/v1`,
        apiKey: 'openai-test-key',
        model: 'test-openai-model'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.diagram.title, 'Purchase approval');
  assert.equal(result.body.diagram.nodeCount, 4);
  assert.match(result.body.xml, /<mxGraphModel/);
  assert.match(result.body.xml, /Submit request/);
  assert.equal(aiRequests.at(-1).url, '/v1/chat/completions');
  assert.equal(aiRequests.at(-1).authorization, 'Bearer openai-test-key');
  assert.equal(aiRequests.at(-1).body.model, 'test-openai-model');

  result = await request('/api/ai/flowchart', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Create an after-sales support flowchart',
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/branch`,
        apiKey: 'openai-test-key',
        model: 'test-openai-model'
      }
    })
  });
  assert.equal(result.res.status, 200);
  const branchPageWidth = Number(result.body.xml.match(/pageWidth="([^"]+)"/)[1]);
  const escalateGeometry = geometryForValue(result.body.xml, '升级处理');
  const confirmGeometry = geometryForValue(result.body.xml, '客户确认');
  const satisfiedGeometry = geometryForValue(result.body.xml, '客户满意?');
  assert.ok(branchPageWidth >= 1050);
  assert.ok(escalateGeometry.x > satisfiedGeometry.x);
  assert.equal(confirmGeometry.x, escalateGeometry.x);
  assert.equal(satisfiedGeometry.x < branchPageWidth / 2, true);
  assert.match(result.body.xml, /rounded=0/);
  assert.match(result.body.xml, /dashed=1/);
  assert.match(result.body.xml, /<Array as="points">/);
  assert.equal(aiRequests.at(-1).url, '/branch/chat/completions');

  result = await request('/api/ai/diagram', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Create a leave approval swimlane diagram',
      diagramType: 'swimlane',
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/swimlane`,
        apiKey: 'openai-test-key',
        model: 'test-openai-model'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.diagram.type, 'swimlane');
  assert.equal(result.body.diagram.typeLabel, '泳道图');
  assert.match(result.body.xml, /ai_lane_employee/);
  assert.match(result.body.xml, /Submit leave request/);
  const submitGeometry = geometryForValue(result.body.xml, 'Submit leave request');
  const reviewGeometry = geometryForValue(result.body.xml, 'Review request');
  const recordGeometry = geometryForValue(result.body.xml, 'Record leave');
  assert.ok(reviewGeometry.y > submitGeometry.y);
  assert.ok(recordGeometry.y > reviewGeometry.y);
  const swimlaneEdge = result.body.xml.match(/id="ai_edge_2"[\s\S]*?<\/mxCell>/);
  assert.ok(swimlaneEdge);
  assert.match(swimlaneEdge[0], /exitX=0\.5;exitY=1/);
  const swimlaneWaypointYs = Array.from(swimlaneEdge[0].matchAll(/<mxPoint x="[^"]+" y="([^"]+)"/g), (match) => Number(match[1]));
  assert.equal(swimlaneWaypointYs.length >= 2, true);
  assert.equal(swimlaneWaypointYs[0], swimlaneWaypointYs[1]);
  assert.ok(swimlaneWaypointYs[0] > reviewGeometry.y);
  assert.match(aiRequests.at(-1).body.messages[1].content, /"diagramType" to "swimlane"/);

  result = await request('/api/ai/diagram', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Create an order UML class diagram',
      diagramType: 'uml_class',
      config: {
        providerFormat: 'openai',
        baseUrl: `http://127.0.0.1:${aiPort}/uml`,
        apiKey: 'openai-test-key',
        model: 'test-openai-model'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.diagram.type, 'uml_class');
  assert.equal(result.body.diagram.nodeCount, 3);
  assert.match(result.body.xml, /ai_class_order/);
  assert.match(result.body.xml, /OrderItem/);
  assert.match(result.body.xml, /diamondThin/);
  assert.match(aiRequests.at(-1).body.messages[1].content, /"diagramType" to "uml_class"/);

  result = await request('/api/ai/flowchart', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Create a support flowchart',
      config: {
        providerFormat: 'anthropic',
        baseUrl: `http://127.0.0.1:${aiPort}/anthropic`,
        apiKey: 'anthropic-test-key',
        model: 'test-anthropic-model'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.diagram.title, 'Support ticket');
  assert.match(result.body.xml, /Close ticket/);
  assert.equal(aiRequests.at(-1).url, '/anthropic/messages');
  assert.equal(aiRequests.at(-1).apiKey, 'anthropic-test-key');
  assert.equal(aiRequests.at(-1).body.model, 'test-anthropic-model');

  result = await request('/api/ai/models', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        providerFormat: 'anthropic',
        baseUrl: `http://127.0.0.1:${aiPort}/anthropic`,
        apiKey: 'anthropic-test-key'
      }
    })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.models[0].id, 'test-anthropic-model');
  assert.equal(result.body.models[0].label, 'Test Anthropic Model');
  assert.equal(aiRequests.at(-1).url, '/anthropic/models');
  assert.equal(aiRequests.at(-1).apiKey, 'anthropic-test-key');

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
  cleanup.push(async () => {
    await closeServer(exportServer);
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

  result = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: '10002',
      name: '李四',
      inviteCode: inviteTwo,
      password: 'user-password-2'
    })
  }, 'two');
  assert.equal(result.res.status, 201);

  result = await request('/api/profile', {
    method: 'PUT',
    body: JSON.stringify({ name: '李四' })
  }, 'two');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.profile.displayName, '李四');

  result = await request('/api/ai/providers', {}, 'two');
  assert.equal(result.res.status, 200);
  assert.deepEqual(result.body.providers, []);

  result = await request('/api/ai/providers/' + encodeURIComponent(savedProviderId), { method: 'DELETE' });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.deleted, true);
  assert.deepEqual(result.body.providers, []);

  result = await request('/api/ops/status');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.counts.employees, 2);
  assert.equal(result.body.counts.diagrams, 1);
  assert.equal(result.body.config.opsTokenRequired, false);
  assert.equal(result.body.config.host, '127.0.0.1');
  assert.equal(result.body.config.aiClientBaseUrlsAllowed, true);

  result = await request('/api/employees');
  assert.equal(result.res.status, 200);
  const employeeTwo = result.body.employees.find((employee) => employee.employeeId === '10002');
  assert.equal(employeeTwo.name, '李四');
  assert.equal(employeeTwo.displayName, '李四');
  assert.equal(result.body.employees.some((employee) => employee.employeeId === '10001'), false);

  result = await request('/api/employees', {}, 'two');
  assert.equal(result.res.status, 200);
  const employeeOne = result.body.employees.find((employee) => employee.employeeId === '10001');
  assert.equal(employeeOne.name, '张三');

  result = await request(`/api/files/${file.id}`, {}, 'two');
  assert.equal(result.res.status, 404);

  result = await request('/api/folders');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.folders.length, 0);

  result = await request('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name: '项目资料', parentId: null })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.folder.name, '项目资料');
  assert.equal(result.body.folder.parentId, null);
  const projectFolder = result.body.folder;

  result = await request('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name: '评审', parentId: projectFolder.id })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.folder.parentId, projectFolder.id);
  const reviewFolder = result.body.folder;

  result = await request(`/api/files/${file.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ folderId: projectFolder.id })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.file.folderId, projectFolder.id);

  result = await request(`/api/files/${file.id}/copy`, {
    method: 'POST',
    body: JSON.stringify({ folderId: reviewFolder.id })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.file.folderId, reviewFolder.id);
  assert.match(result.body.file.name, /副本\.drawio$/);

  result = await request('/api/files');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.files.length, 2);
  assert.equal(result.body.files.find((item) => item.id === file.id).folderId, projectFolder.id);

  result = await request(`/api/folders/${projectFolder.id}/copy`, {
    method: 'POST',
    body: JSON.stringify({ parentId: null })
  });
  assert.equal(result.res.status, 201);
  assert.equal(result.body.folder.parentId, null);
  assert.match(result.body.folder.name, /副本$/);
  const copiedProjectFolder = result.body.folder;

  result = await request('/api/files');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.files.length, 4);

  result = await request(`/api/folders/${projectFolder.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ parentId: reviewFolder.id })
  });
  assert.equal(result.res.status, 400);
  assert.equal(result.body.error, 'invalid_folder_move');

  result = await request(`/api/folders/${reviewFolder.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ parentId: null })
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.folder.parentId, null);

  result = await request(`/api/folders/${copiedProjectFolder.id}`, { method: 'DELETE' });
  assert.equal(result.res.status, 200);
  assert.equal(result.body.deleted, true);

  result = await request('/api/folders');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.folders.length, 2);

  result = await request('/api/files');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.files.length, 2);

  result = await request(`/api/files/${file.id}/share-internal`, {
    method: 'POST',
    body: JSON.stringify({ recipients: ['10002'], message: 'Please review this diagram.' })
  }, 'one');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.share.ownerId, '10001');
  assert.deepEqual(result.body.share.recipients, ['10002']);
  assert.equal(result.body.share.profiles['10001'].displayName, '张三');
  assert.equal(result.body.share.profiles['10002'].displayName, '李四');
  assert.equal(result.body.share.unreadCount, 0);
  assert.equal(result.body.messages.length, 1);
  const internalShareId = result.body.share.id;

  result = await request('/api/internal-shares', {}, 'two');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.shares.length, 1);
  assert.equal(result.body.shares[0].id, internalShareId);
  assert.equal(result.body.shares[0].direction, 'received');
  assert.equal(result.body.shares[0].profiles['10001'].displayName, '张三');
  assert.equal(result.body.shares[0].unreadCount, 1);

  result = await request(`/api/internal-shares/${internalShareId}`, {}, 'two');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.share.file.name, file.name);
  assert.equal(result.body.share.unreadCount, 0);
  assert.equal(result.body.xml, '<mxGraphModel><root/></mxGraphModel>');

  result = await request('/api/internal-shares', {}, 'two');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.shares[0].unreadCount, 0);

  result = await request(`/api/internal-shares/${internalShareId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message: 'Looks good.' })
  }, 'two');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.messages.length, 2);
  assert.equal(result.body.message.authorId, '10002');
  assert.equal(result.body.share.profiles['10002'].displayName, '李四');
  assert.equal(result.body.share.unreadCount, 0);

  result = await request('/api/internal-shares', {}, 'one');
  assert.equal(result.res.status, 200);
  assert.equal(result.body.shares[0].unreadCount, 1);

  result = await request(`/api/internal-shares/${internalShareId}/download`, {}, 'two');
  assert.equal(result.res.status, 200);
  assert.match(result.res.headers.get('content-type'), /^application\/xml/);
  assert.equal(result.body, '<mxGraphModel><root/></mxGraphModel>');

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
  } finally {
    for (let index = cleanup.length - 1; index >= 0; index -= 1) {
      await cleanup[index]();
    }
  }
});
