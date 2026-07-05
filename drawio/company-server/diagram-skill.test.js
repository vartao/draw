const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDiagramInstruction,
  diagramTypeOptions,
  normalizeDiagramSpec,
  renderDiagramXml
} = require('./lib/diagram-skill');

function attrMap(source) {
  const attrs = {};
  const regex = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(source))) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseVertices(xml) {
  const cells = new Map();
  const cellRegex = /<mxCell\b([^>]*)>([\s\S]*?)<\/mxCell>/g;
  let match;

  while ((match = cellRegex.exec(xml))) {
    const attrs = attrMap(match[1]);

    if (attrs.vertex !== '1') {
      continue;
    }

    const geometryMatch = match[2].match(/<mxGeometry\b([^>]*)/);

    if (!geometryMatch) {
      continue;
    }

    const geometry = attrMap(geometryMatch[1]);
    cells.set(attrs.id, {
      id: attrs.id,
      parent: attrs.parent || '1',
      style: attrs.style || '',
      value: attrs.value || '',
      x: Number(geometry.x || 0),
      y: Number(geometry.y || 0),
      width: Number(geometry.width || 0),
      height: Number(geometry.height || 0)
    });
  }

  function absolute(cell, seen = new Set()) {
    if (cell.abs || seen.has(cell.id)) {
      return cell.abs || { x: cell.x, y: cell.y };
    }

    seen.add(cell.id);
    const parent = cells.get(cell.parent);
    const parentAbs = parent ? absolute(parent, seen) : { x: 0, y: 0 };
    cell.abs = {
      x: parentAbs.x + cell.x,
      y: parentAbs.y + cell.y
    };
    return cell.abs;
  }

  cells.forEach((cell) => {
    const abs = absolute(cell);
    cell.absX = abs.x;
    cell.absY = abs.y;
  });

  return Array.from(cells.values());
}

function overlaps(a, b) {
  return a.absX < b.absX + b.width &&
    a.absX + a.width > b.absX &&
    a.absY < b.absY + b.height &&
    a.absY + a.height > b.absY;
}

function assertNoSiblingOverlaps(xml, label) {
  const byParent = new Map();

  parseVertices(xml)
    .filter((cell) => cell.width > 0 && cell.height > 0)
    .forEach((cell) => {
      if (!byParent.has(cell.parent)) {
        byParent.set(cell.parent, []);
      }

      byParent.get(cell.parent).push(cell);
    });

  byParent.forEach((cells) => {
    for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
        const left = cells[leftIndex];
        const right = cells[rightIndex];

        assert.equal(
          overlaps(left, right),
          false,
          `${label}: ${left.id} overlaps ${right.id}`
        );
      }
    }
  });
}

const fixtures = [
  {
    type: 'flowchart',
    raw: {
      title: '采购审批',
      nodes: [
        { id: 'start', label: '提交采购申请', type: 'start' },
        { id: 'budget', label: '校验预算与供应商合规材料', type: 'process' },
        { id: 'ok', label: '预算与资质是否全部通过', type: 'decision' },
        { id: 'archive', label: '归档采购记录', type: 'end' }
      ],
      edges: [
        { from: 'start', to: 'budget' },
        { from: 'budget', to: 'ok' },
        { from: 'ok', to: 'archive', label: '通过' }
      ]
    }
  },
  {
    type: 'swimlane',
    raw: {
      title: '售后工单',
      lanes: [
        { id: 'customer', label: '客户' },
        { id: 'support', label: '客服' },
        { id: 'engineer', label: '技术支持' }
      ],
      nodes: [
        { id: 'submit', label: '提交问题', type: 'start', lane: 'customer' },
        { id: 'triage', label: '受理并分派工单', type: 'process', lane: 'support' },
        { id: 'solve', label: '定位问题并给出修复建议', type: 'process', lane: 'engineer' },
        { id: 'close', label: '确认关闭', type: 'end', lane: 'customer' }
      ],
      edges: [
        { from: 'submit', to: 'triage' },
        { from: 'triage', to: 'solve' },
        { from: 'solve', to: 'close' }
      ]
    }
  },
  {
    type: 'sequence',
    raw: {
      title: '登录时序',
      participants: [
        { id: 'user', label: '用户' },
        { id: 'web', label: '前端应用' },
        { id: 'auth', label: '认证服务' },
        { id: 'db', label: '用户数据库' }
      ],
      messages: [
        { from: 'user', to: 'web', label: '提交账号密码' },
        { from: 'web', to: 'auth', label: '请求登录校验' },
        { from: 'auth', to: 'db', label: '读取用户凭据' },
        { from: 'auth', to: 'web', label: '返回 token', type: 'return' }
      ]
    }
  },
  {
    type: 'uml_class',
    raw: {
      title: '订单类图',
      classes: [
        { id: 'order', name: 'Order', attributes: ['id: string', 'status: OrderStatus'], methods: ['submitForApproval(): void'] },
        { id: 'item', name: 'OrderItem', attributes: ['quantity: number', 'lockedUnitPrice: Money'], methods: ['calculateSubtotal(): Money'] },
        { id: 'payment', name: 'PaymentAuthorization', attributes: ['providerReference: string'], methods: ['capture(): void'] }
      ],
      relations: [
        { from: 'order', to: 'item', type: 'composition', label: 'contains' },
        { from: 'order', to: 'payment', type: 'association', label: 'paid by' }
      ]
    }
  },
  {
    type: 'erd',
    raw: {
      title: '文件 ER',
      entities: [
        { id: 'employees', name: 'employees', columns: [{ name: 'id', type: 'varchar', pk: true }, { name: 'display_name', type: 'varchar' }] },
        { id: 'files', name: 'files', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'employee_id', type: 'varchar', fk: true }, { name: 'latest_etag', type: 'sha256' }] },
        { id: 'folders', name: 'folders', columns: [{ name: 'id', type: 'uuid', pk: true }, { name: 'parent_folder_id', type: 'uuid', fk: true }] }
      ],
      relations: [
        { from: 'files', to: 'employees', label: 'owned by', cardinality: 'many-to-one' },
        { from: 'folders', to: 'employees', label: 'owned by', cardinality: 'many-to-one' }
      ]
    }
  },
  {
    type: 'architecture',
    raw: {
      title: '公司内部 draw.io 工具架构图',
      groups: [
        { id: 'client', label: '客户端层' },
        { id: 'service', label: '公司内部服务' },
        { id: 'data', label: '数据与目录' },
        { id: 'external', label: '外部依赖' }
      ],
      components: [
        { id: 'browser', label: '浏览器', type: 'client', group: 'client' },
        { id: 'static', label: '静态文件服务 统一入口与鉴权', type: 'gateway', group: 'service' },
        { id: 'assets', label: 'draw.io 静态资源 前端页面与组件', type: 'service', group: 'service' },
        { id: 'share', label: '分享访问 链接与权限', type: 'service', group: 'service' },
        { id: 'export', label: '导出服务 PNG/PDF/XML', type: 'service', group: 'service' },
        { id: 'directory', label: '员工数据目录 组织与账号', type: 'database', group: 'data', description: '账号、权限、文件索引' },
        { id: 'ai', label: 'AI 模型接口 生成与编辑', type: 'external', group: 'external' }
      ],
      connections: [
        { from: 'browser', to: 'static', label: 'HTTPS' },
        { from: 'static', to: 'directory', label: '查询员工' },
        { from: 'static', to: 'assets', label: '加载资源' },
        { from: 'assets', to: 'share', label: '分享权限' },
        { from: 'share', to: 'directory', label: '校验身份' },
        { from: 'directory', to: 'ai', label: 'AI 调用' }
      ]
    }
  },
  {
    type: 'c4',
    raw: {
      title: 'C4 容器图',
      groups: [
        { id: 'system', label: '内部系统边界' },
        { id: 'external', label: '外部系统' }
      ],
      components: [
        { id: 'person', label: '员工', type: 'person', group: 'system' },
        { id: 'web', label: 'Web 应用容器', type: 'client', group: 'system' },
        { id: 'api', label: '文件管理 API', type: 'service', group: 'system' },
        { id: 'store', label: '文件元数据存储', type: 'database', group: 'system' },
        { id: 'llm', label: '大模型服务', type: 'external', group: 'external' }
      ],
      connections: [
        { from: 'person', to: 'web', label: '使用' },
        { from: 'web', to: 'api', label: 'HTTPS/JSON' },
        { from: 'api', to: 'store', label: '读写' },
        { from: 'api', to: 'llm', label: '生成图表' }
      ]
    }
  },
  {
    type: 'general',
    raw: {
      title: '关系图',
      nodes: [
        { id: 'goal', label: '目标' },
        { id: 'constraint', label: '约束' },
        { id: 'risk', label: '风险' },
        { id: 'decision', label: '决策' }
      ],
      edges: [
        { from: 'goal', to: 'constraint', label: '受到限制' },
        { from: 'constraint', to: 'risk', label: '产生' },
        { from: 'risk', to: 'decision', label: '影响' }
      ]
    }
  }
];

test('AI diagram renderer covers every supported type without sibling overlaps', () => {
  assert.deepEqual(
    new Set(diagramTypeOptions().map((option) => option.value)),
    new Set(fixtures.map((fixture) => fixture.type))
  );

  fixtures.forEach((fixture) => {
    const spec = normalizeDiagramSpec(fixture.raw, fixture.raw.title, fixture.type);
    const xml = renderDiagramXml(spec);

    assert.match(xml, /<mxGraphModel/);
    assertNoSiblingOverlaps(xml, fixture.type);
  });
});

test('architecture and C4 groups render as boundaries instead of swimlanes', () => {
  ['architecture', 'c4'].forEach((type) => {
    const fixture = fixtures.find((item) => item.type === type);
    const spec = normalizeDiagramSpec(fixture.raw, fixture.raw.title, type);
    const xml = renderDiagramXml(spec);
    const vertices = parseVertices(xml);
    const group = vertices.find((cell) => cell.id.startsWith('ai_group_') && !cell.id.endsWith('_label'));
    const longComponent = vertices.find((cell) => cell.id === 'ai_component_static') ||
      vertices.find((cell) => cell.id === 'ai_component_api');

    assert.ok(group, `${type}: expected a group boundary`);
    assert.doesNotMatch(group.style, /(^|;)swimlane(;|$)/);
    assert.match(group.style, /container=1/);
    assert.ok(longComponent.width >= 220, `${type}: component width should fit labels`);
    assert.match(xml, /id="ai_arch_edge_1"[\s\S]*<mxGeometry relative="1" x="0" y="-18"/);
  });
});

test('architecture prompt tells the model not to mix architecture groups with swimlanes', () => {
  const instruction = buildDiagramInstruction('生成公司内部工具架构图', 'architecture');

  assert.match(instruction, /diagramType" to "architecture"/);
  assert.match(instruction, /Use swimlanes only when diagramType is "swimlane"/);
  assert.match(instruction, /not for swimlanes or chronological phases/);
});
