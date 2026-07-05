const fs = require('fs');
const path = require('path');

const DIAGRAM_TYPES = {
  flowchart: {
    label: '流程图',
    aliases: ['flow', 'process', 'process_flow', '流程', '流程图']
  },
  swimlane: {
    label: '泳道图',
    aliases: ['lane', 'lanes', 'cross_functional', 'cross-functional', '泳道', '泳道图']
  },
  sequence: {
    label: 'UML 时序图',
    aliases: ['seq', 'sequence_diagram', '时序', '时序图', '序列图']
  },
  uml_class: {
    label: 'UML 类图',
    aliases: ['class', 'class_diagram', 'uml', 'uml_class', '类图']
  },
  erd: {
    label: 'ER 图',
    aliases: ['er', 'entity_relationship', 'schema', 'data_model', 'erd', 'er图', '数据模型']
  },
  architecture: {
    label: '架构图',
    aliases: ['arch', 'system', 'system_architecture', 'service', 'architecture', '架构', '系统图']
  },
  c4: {
    label: 'C4 架构图',
    aliases: ['c4_model', 'c4model', 'container_diagram', 'component_diagram']
  },
  general: {
    label: '通用关系图',
    aliases: ['diagram', 'graph', 'mindmap', '关系图', '通用']
  }
};

const NODE_TYPES = new Set(['start', 'process', 'decision', 'data', 'end', 'subprocess']);
const FONT = 'Microsoft YaHei,Arial';
const SKILL_DIR = path.join(__dirname, 'diagram-skills');

function skillError(status, code, message) {
  return Object.assign(new Error(message), { status, code, publicMessage: message });
}

function normalizeDiagramType(value) {
  const raw = String(value || 'flowchart').trim().toLowerCase();
  const normalized = raw.replace(/[\s-]+/g, '_');

  if (DIAGRAM_TYPES[normalized]) {
    return normalized;
  }

  for (const [type, info] of Object.entries(DIAGRAM_TYPES)) {
    if (info.aliases.includes(raw) || info.aliases.includes(normalized)) {
      return type;
    }
  }

  return 'flowchart';
}

function diagramTypeLabel(type) {
  return DIAGRAM_TYPES[normalizeDiagramType(type)].label;
}

function diagramTypeOptions() {
  return Object.entries(DIAGRAM_TYPES).map(([value, info]) => ({ value, label: info.label }));
}

function normalizeSkillMarkdown(value, maxLength = 3200) {
  return String(value || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function readDiagramSkillMarkdown(type) {
  const filePath = path.join(SKILL_DIR, type, 'SKILL.md');

  try {
    return normalizeSkillMarkdown(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Skipping invalid diagram skill ${filePath}: ${err.message}`);
    }
  }

  return '';
}

function readDiagramSkillJson(type) {
  const filePath = path.join(SKILL_DIR, `${type}.json`);

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Skipping invalid diagram skill ${filePath}: ${err.message}`);
    }
  }

  return {};
}

function skillInstructionBlock(type) {
  const markdown = readDiagramSkillMarkdown(type);

  if (markdown) {
    return [
      `Developer-maintained ${diagramTypeLabel(type)} skill from lib/diagram-skills/${type}/SKILL.md:`,
      markdown
    ].join('\n');
  }

  const skill = readDiagramSkillJson(type);
  const lines = [];

  if (skill.description) {
    lines.push(`Developer-maintained ${diagramTypeLabel(type)} skill: ${sanitizeDiagramText(skill.description, '', 180)}`);
  }

  if (Array.isArray(skill.rules) && skill.rules.length) {
    lines.push('Type-specific rules:');
    skill.rules.slice(0, 20).forEach((rule) => {
      lines.push(`- ${sanitizeDiagramText(rule, '', 220)}`);
    });
  }

  if (Array.isArray(skill.avoid) && skill.avoid.length) {
    lines.push('Avoid:');
    skill.avoid.slice(0, 12).forEach((rule) => {
      lines.push(`- ${sanitizeDiagramText(rule, '', 220)}`);
    });
  }

  if (skill.schemaHint) {
    lines.push(`Schema hint: ${sanitizeDiagramText(skill.schemaHint, '', 280)}`);
  }

  return lines.join('\n');
}

function buildDiagramInstruction(prompt, requestedType) {
  const type = normalizeDiagramType(requestedType);
  const label = diagramTypeLabel(type);
  const skillBlock = skillInstructionBlock(type);

  return [
    `Create an editable draw.io ${label} from the user request.`,
    'Return only one valid JSON object. Do not use Markdown fences or explanatory text.',
    `Set "diagramType" to "${type}".`,
    '',
    'Built-in draw.io style rules:',
    '- Prefer native draw.io shapes, not Mermaid text and not SVG images.',
    '- Keep labels short, concrete, and in the user language.',
    '- Use stable ASCII ids: letters, numbers, underscore, hyphen.',
    '- Use enough structure for a useful diagram, usually 4 to 14 visible items.',
    '- Avoid decorative nodes that do not carry process, domain, data, or system meaning.',
    '- For decisions, label outgoing branches with concise yes/no or business-condition labels.',
    '- For architecture/data diagrams, group related elements by layer, owner, bounded context, or data domain.',
    '- Use swimlanes only when diagramType is "swimlane"; architecture groups are visual boundaries, not process lanes.',
    ...(skillBlock ? ['', skillBlock] : []),
    '',
    schemaForDiagramType(type),
    '',
    'User request:',
    prompt
  ].join('\n');
}

function schemaForDiagramType(type) {
  if (type === 'swimlane') {
    return [
      'Schema for swimlane:',
      '{"title":"short title","diagramType":"swimlane","lanes":[{"id":"requester","label":"Requester"}],"nodes":[{"id":"n1","label":"Submit request","type":"start|process|decision|data|end","lane":"requester"}],"edges":[{"from":"n1","to":"n2","label":"optional"}]}',
      'Use lanes for roles, departments, systems, or phases.'
    ].join('\n');
  }

  if (type === 'sequence') {
    return [
      'Schema for UML sequence diagram:',
      '{"title":"short title","diagramType":"sequence","participants":[{"id":"user","label":"User","type":"actor|system|service|database"}],"messages":[{"from":"user","to":"api","label":"Submit request","type":"sync|async|return"}]}',
      'Participants should be ordered left-to-right. Messages should be chronological.'
    ].join('\n');
  }

  if (type === 'uml_class') {
    return [
      'Schema for UML class diagram:',
      '{"title":"short title","diagramType":"uml_class","classes":[{"id":"order","name":"Order","stereotype":"optional","attributes":["id: string"],"methods":["submit(): void"]}],"relations":[{"from":"order","to":"customer","type":"association|inheritance|implementation|composition|aggregation","label":"optional"}]}',
      'Include only meaningful attributes and methods; avoid filler.'
    ].join('\n');
  }

  if (type === 'erd') {
    return [
      'Schema for ER diagram:',
      '{"title":"short title","diagramType":"erd","entities":[{"id":"users","name":"users","columns":[{"name":"id","type":"uuid","pk":true},{"name":"team_id","type":"uuid","fk":true}]}],"relations":[{"from":"users","to":"teams","label":"belongs to","cardinality":"many-to-one"}]}',
      'Mark primary keys and foreign keys where they are implied.'
    ].join('\n');
  }

  if (type === 'architecture' || type === 'c4') {
    return [
      'Schema for architecture/C4 diagram:',
      '{"title":"short title","diagramType":"' + type + '","groups":[{"id":"client","label":"Client layer"}],"components":[{"id":"web","label":"Web App","type":"client|gateway|service|database|queue|external|component","group":"client","description":"optional"}],"connections":[{"from":"web","to":"api","label":"HTTPS"}]}',
      'Use groups for layers or bounded contexts, not for swimlanes or chronological phases. Put hub components such as queues centrally.'
    ].join('\n');
  }

  if (type === 'general') {
    return [
      'Schema for general relationship diagram:',
      '{"title":"short title","diagramType":"general","nodes":[{"id":"n1","label":"Topic","type":"process|data|decision|external"}],"edges":[{"from":"n1","to":"n2","label":"optional"}]}',
      'Use this for mind maps, dependency maps, and relationship diagrams.'
    ].join('\n');
  }

  return [
    'Schema for flowchart:',
    '{"title":"short title","diagramType":"flowchart","nodes":[{"id":"n1","label":"Start","type":"start|process|decision|data|end|subprocess"}],"edges":[{"from":"n1","to":"n2","label":"optional"}]}',
    'Order nodes in natural reading order: start, main path, branch tasks, merge, end.'
  ].join('\n');
}

function sanitizeDiagramText(value, fallback, maxLength = 80) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (text || fallback).slice(0, maxLength);
}

function normalizeId(value, index, used, prefix = 'n') {
  const base = String(value || `${prefix}${index + 1}`)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40) || `${prefix}${index + 1}`;
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

  if (NODE_TYPES.has(type)) {
    return type;
  }

  if (type === 'input' || type === 'output' || type === 'io') {
    return 'data';
  }

  if (type === 'condition' || type === 'branch') {
    return 'decision';
  }

  if (index === 0) {
    return 'start';
  }

  if (index === total - 1) {
    return 'end';
  }

  return 'process';
}

function idMapFromItems(items, prefix) {
  const used = new Set();
  const rawIdMap = new Map();
  const normalized = items.map((item, index) => {
    const rawId = String(item && item.id ? item.id : `${prefix}${index + 1}`);
    const id = normalizeId(rawId, index, used, prefix);

    if (!rawIdMap.has(rawId)) {
      rawIdMap.set(rawId, id);
    }

    return { item, id, rawId, index };
  });

  return { normalized, rawIdMap };
}

function normalizeEdgeList(edgeInputs, rawIdMap, nodeIds, keyNames = {}) {
  const edges = [];
  const fromKey = keyNames.from || 'from';
  const toKey = keyNames.to || 'to';
  const labelKey = keyNames.label || 'label';

  (Array.isArray(edgeInputs) ? edgeInputs.slice(0, 80) : []).forEach((edge) => {
    const from = rawIdMap.get(String(edge && edge[fromKey])) || String(edge && edge[fromKey] || '');
    const to = rawIdMap.get(String(edge && edge[toKey])) || String(edge && edge[toKey] || '');

    if (nodeIds.has(from) && nodeIds.has(to) && from !== to) {
      edges.push({
        from,
        to,
        label: sanitizeDiagramText(edge && edge[labelKey], '', 32),
        type: sanitizeDiagramText(edge && edge.type, '', 32)
      });
    }
  });

  return edges;
}

function normalizeFlowchartSpec(raw, prompt, requestedType = 'flowchart') {
  const nodesInput = Array.isArray(raw && raw.nodes) ? raw.nodes.slice(0, 28) : [];

  if (nodesInput.length < 2) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include enough diagram nodes.');
  }

  const { normalized, rawIdMap } = idMapFromItems(nodesInput, 'n');
  const nodes = normalized.map(({ item, id, index }) => ({
    id,
    label: sanitizeDiagramText(item && item.label, `Step ${index + 1}`),
    type: normalizeNodeType(item && item.type, index, nodesInput.length)
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeEdgeList(raw && raw.edges, rawIdMap, nodeIds);

  if (!edges.length) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ from: nodes[index].id, to: nodes[index + 1].id, label: '', type: '' });
    }
  }

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI diagram', 32), 64),
    diagramType: requestedType,
    nodes,
    edges
  };
}

function normalizeSwimlaneSpec(raw, prompt) {
  const base = normalizeFlowchartSpec(raw, prompt, 'swimlane');
  const usedLaneIds = new Set();
  const laneInputs = Array.isArray(raw && raw.lanes) ? raw.lanes : [];
  const laneMap = new Map();

  laneInputs.slice(0, 10).forEach((lane, index) => {
    const rawId = String(lane && typeof lane === 'object' ? lane.id || lane.label : lane || `lane${index + 1}`);
    const id = normalizeId(rawId, index, usedLaneIds, 'lane');
    laneMap.set(rawId, id);
    laneMap.set(id, id);
  });

  base.nodes = base.nodes.map((node, index) => {
    const input = Array.isArray(raw && raw.nodes) ? raw.nodes[index] : {};
    const rawLane = String(input && input.lane || input && input.group || input && input.owner || 'default');
    let lane = laneMap.get(rawLane);

    if (!lane) {
      lane = normalizeId(rawLane, laneMap.size, usedLaneIds, 'lane');
      laneMap.set(rawLane, lane);
      laneMap.set(lane, lane);
    }

    return { ...node, lane };
  });

  const labelById = new Map();
  laneInputs.slice(0, 10).forEach((lane, index) => {
    const rawId = String(lane && typeof lane === 'object' ? lane.id || lane.label : lane || `lane${index + 1}`);
    const id = laneMap.get(rawId);
    labelById.set(id, sanitizeDiagramText(lane && typeof lane === 'object' ? lane.label || lane.id : lane, `Lane ${index + 1}`, 40));
  });

  base.nodes.forEach((node) => {
    if (!labelById.has(node.lane)) {
      labelById.set(node.lane, node.lane === 'default' ? '流程' : node.lane);
    }
  });

  base.lanes = Array.from(labelById.entries()).map(([id, label]) => ({ id, label }));
  return base;
}

function normalizeSequenceSpec(raw, prompt) {
  const messageInputs = Array.isArray(raw && raw.messages) ? raw.messages.slice(0, 48) : [];
  let participantInputs = Array.isArray(raw && raw.participants) ? raw.participants.slice(0, 12) : [];

  if (!participantInputs.length) {
    const seen = new Set();
    participantInputs = [];
    messageInputs.forEach((message) => {
      [message && message.from, message && message.to].forEach((id) => {
        const rawId = String(id || '').trim();
        if (rawId && !seen.has(rawId)) {
          seen.add(rawId);
          participantInputs.push({ id: rawId, label: rawId });
        }
      });
    });
  }

  if (participantInputs.length < 2 || !messageInputs.length) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include enough sequence participants or messages.');
  }

  const { normalized, rawIdMap } = idMapFromItems(participantInputs, 'p');
  const participants = normalized.map(({ item, id, index }) => ({
    id,
    label: sanitizeDiagramText(item && item.label || item && item.name, `Participant ${index + 1}`, 48),
    type: sanitizeDiagramText(item && item.type, 'system', 24)
  }));
  const participantIds = new Set(participants.map((item) => item.id));
  const messages = [];

  messageInputs.forEach((message) => {
    const from = rawIdMap.get(String(message && message.from)) || String(message && message.from || '');
    const to = rawIdMap.get(String(message && message.to)) || String(message && message.to || '');

    if (participantIds.has(from) && participantIds.has(to) && from !== to) {
      messages.push({
        from,
        to,
        label: sanitizeDiagramText(message && message.label, 'message', 64),
        type: sanitizeDiagramText(message && message.type, 'sync', 24).toLowerCase()
      });
    }
  });

  if (!messages.length) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include usable sequence messages.');
  }

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI sequence diagram', 32), 64),
    diagramType: 'sequence',
    participants,
    messages
  };
}

function normalizeClassSpec(raw, prompt) {
  const classInputs = Array.isArray(raw && raw.classes) ? raw.classes.slice(0, 24) : [];

  if (classInputs.length < 1) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include UML classes.');
  }

  const { normalized, rawIdMap } = idMapFromItems(classInputs, 'class');
  const classes = normalized.map(({ item, id, index }) => ({
    id,
    name: sanitizeDiagramText(item && item.name || item && item.label, `Class${index + 1}`, 48),
    stereotype: sanitizeDiagramText(item && item.stereotype, '', 32),
    attributes: normalizeTextList(item && item.attributes, 12, 54),
    methods: normalizeTextList(item && item.methods, 12, 54)
  }));
  const ids = new Set(classes.map((item) => item.id));
  const relations = normalizeEdgeList(raw && raw.relations, rawIdMap, ids).map((edge) => ({
    ...edge,
    type: edge.type || 'association'
  }));

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI class diagram', 32), 64),
    diagramType: 'uml_class',
    classes,
    relations
  };
}

function normalizeErdSpec(raw, prompt) {
  const entityInputs = Array.isArray(raw && raw.entities) ? raw.entities.slice(0, 24) : [];

  if (entityInputs.length < 1) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include ER entities.');
  }

  const { normalized, rawIdMap } = idMapFromItems(entityInputs, 'entity');
  const entities = normalized.map(({ item, id, index }) => ({
    id,
    name: sanitizeDiagramText(item && item.name || item && item.label, `Entity${index + 1}`, 48),
    columns: normalizeColumns(item && item.columns)
  }));
  const ids = new Set(entities.map((item) => item.id));
  const relations = normalizeEdgeList(raw && raw.relations, rawIdMap, ids).map((edge) => ({
    ...edge,
    cardinality: sanitizeDiagramText(edge.cardinality, '', 24)
  }));

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI ER diagram', 32), 64),
    diagramType: 'erd',
    entities,
    relations
  };
}

function normalizeArchitectureSpec(raw, prompt, type) {
  const componentInputs = Array.isArray(raw && raw.components) ? raw.components.slice(0, 36) :
    Array.isArray(raw && raw.nodes) ? raw.nodes.slice(0, 36) : [];

  if (componentInputs.length < 1) {
    throw skillError(502, 'ai_diagram_too_small', 'AI response did not include architecture components.');
  }

  const { normalized, rawIdMap } = idMapFromItems(componentInputs, 'cmp');
  const groupInputs = Array.isArray(raw && raw.groups) ? raw.groups.slice(0, 12) : [];
  const usedGroupIds = new Set();
  const groupIdMap = new Map();
  const groups = groupInputs.map((group, index) => {
    const rawId = String(group && group.id || group && group.label || `group${index + 1}`);
    const id = normalizeId(rawId, index, usedGroupIds, 'group');
    groupIdMap.set(rawId, id);
    groupIdMap.set(id, id);

    return {
      id,
      label: sanitizeDiagramText(group && group.label || group && group.name || rawId, `Group ${index + 1}`, 48)
    };
  });
  const groupLabels = new Map(groups.map((group) => [group.id, group.label]));

  const components = normalized.map(({ item, id, index }) => {
    const rawGroup = String(item && (item.group || item.layer || item.container || '') || '');
    let group = rawGroup ? groupIdMap.get(rawGroup) : '';

    if (rawGroup && !group) {
      group = normalizeId(rawGroup, groups.length, usedGroupIds, 'group');
      groupIdMap.set(rawGroup, group);
      groupIdMap.set(group, group);
      groupLabels.set(group, rawGroup);
      groups.push({ id: group, label: sanitizeDiagramText(rawGroup, rawGroup, 48) });
    }

    return {
      id,
      label: sanitizeDiagramText(item && item.label || item && item.name, `Component ${index + 1}`, 52),
      type: sanitizeDiagramText(item && item.type, 'component', 24).toLowerCase(),
      group,
      description: sanitizeDiagramText(item && item.description, '', 80)
    };
  });
  const ids = new Set(components.map((item) => item.id));
  const connections = normalizeEdgeList(raw && (raw.connections || raw.edges), rawIdMap, ids);

  return {
    title: sanitizeDiagramText(raw && raw.title, sanitizeDiagramText(prompt, 'AI architecture diagram', 32), 64),
    diagramType: type,
    groups,
    components,
    connections
  };
}

function normalizeTextList(value, limit, maxLength) {
  return (Array.isArray(value) ? value : [])
    .slice(0, limit)
    .map((item, index) => sanitizeDiagramText(item && typeof item === 'object' ? item.name || item.label : item, `item ${index + 1}`, maxLength))
    .filter(Boolean);
}

function normalizeColumns(columns) {
  const inputs = Array.isArray(columns) ? columns.slice(0, 18) : [];

  if (!inputs.length) {
    return [{ name: 'id', type: 'id', pk: true, fk: false }];
  }

  return inputs.map((column, index) => {
    if (typeof column === 'string') {
      return { name: sanitizeDiagramText(column, `column_${index + 1}`, 42), type: '', pk: false, fk: false };
    }

    return {
      name: sanitizeDiagramText(column && column.name, `column_${index + 1}`, 42),
      type: sanitizeDiagramText(column && column.type, '', 28),
      pk: Boolean(column && column.pk),
      fk: Boolean(column && column.fk)
    };
  });
}

function normalizeDiagramSpec(raw, prompt, requestedType) {
  const type = normalizeDiagramType(requestedType || raw && raw.diagramType);

  if (type === 'swimlane') {
    return normalizeSwimlaneSpec(raw, prompt);
  }

  if (type === 'sequence') {
    return normalizeSequenceSpec(raw, prompt);
  }

  if (type === 'uml_class') {
    return normalizeClassSpec(raw, prompt);
  }

  if (type === 'erd') {
    return normalizeErdSpec(raw, prompt);
  }

  if (type === 'architecture' || type === 'c4') {
    return normalizeArchitectureSpec(raw, prompt, type);
  }

  return normalizeFlowchartSpec(raw, prompt, type === 'general' ? 'general' : 'flowchart');
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

function graphModel(cells, pageWidth, pageHeight) {
  return [
    `<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">`,
    '<root>',
    cells.join(''),
    '</root>',
    '</mxGraphModel>'
  ].join('');
}

function roundedGrid(value) {
  return Math.round(value / 10) * 10;
}

function normalizeMeasuredText(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;#xa;|&#xa;|&#10;|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[A-Za-z0-9#]+;/g, 'x')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function visualTextUnits(value) {
  return Array.from(String(value || '')).reduce((sum, char) => {
    const code = char.codePointAt(0);

    if (/\s/.test(char)) {
      return sum + 0.35;
    }

    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      return sum + 1;
    }

    if (code < 128) {
      return sum + (/[A-Z0-9]/.test(char) ? 0.62 : 0.54);
    }

    return sum + 0.9;
  }, 0);
}

function labelSize(value, options = {}) {
  const fontSize = options.fontSize || 13;
  const lineHeight = options.lineHeight || Math.ceil(fontSize * 1.45);
  const paddingX = options.paddingX == null ? 24 : options.paddingX;
  const paddingY = options.paddingY == null ? 18 : options.paddingY;
  const minWidth = options.minWidth || 160;
  const maxWidth = options.maxWidth || 320;
  const minHeight = options.minHeight || 56;
  const lines = normalizeMeasuredText(value).split('\n').map((line) => line.trim()).filter(Boolean);
  const units = (lines.length ? lines : ['']).map(visualTextUnits);
  const widestUnits = Math.max(1, ...units);
  const naturalWidth = paddingX * 2 + widestUnits * fontSize;
  const width = roundedGrid(Math.min(maxWidth, Math.max(minWidth, naturalWidth)));
  const lineCapacity = Math.max(4, Math.floor((width - paddingX * 2) / fontSize));
  const wrappedLines = units.reduce((sum, unitCount) => sum + Math.max(1, Math.ceil(unitCount / lineCapacity)), 0);
  const height = roundedGrid(Math.max(minHeight, paddingY * 2 + wrappedLines * lineHeight));

  return { width, height };
}

function maxLabelWidth(values, options) {
  return values.reduce((width, value) => Math.max(width, labelSize(value, options).width), 0);
}

function nodeStyle(type) {
  const common = `whiteSpace=wrap;html=1;strokeWidth=2;fontColor=#17211f;fontSize=14;fontFamily=${FONT};align=center;verticalAlign=middle;spacing=12;shadow=0;`;

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

  if (type === 'subprocess') {
    return `${common}rounded=1;arcSize=8;fillColor=#f1ebfb;strokeColor=#7a55b5;double=1;`;
  }

  return `${common}rounded=1;arcSize=10;fillColor=#fffdf8;strokeColor=#215fbd;`;
}

function flowchartNodeSize(type, label = '') {
  let base;

  if (type === 'decision') {
    base = { width: 176, height: 96, maxWidth: 300, paddingX: 38, paddingY: 26 };
  } else if (type === 'start' || type === 'end') {
    base = { width: 184, height: 64, maxWidth: 270, paddingX: 30, paddingY: 18 };
  } else if (type === 'data') {
    base = { width: 210, height: 72, maxWidth: 300, paddingX: 34, paddingY: 20 };
  } else {
    base = { width: 210, height: 72, maxWidth: 300, paddingX: 30, paddingY: 20 };
  }

  return labelSize(label, {
    minWidth: base.width,
    maxWidth: base.maxWidth,
    minHeight: base.height,
    fontSize: 14,
    lineHeight: 22,
    paddingX: base.paddingX,
    paddingY: base.paddingY
  });
}

function edgeLabelKind(label) {
  const text = String(label || '').trim().toLowerCase();

  if (/^(no|n|false|否|不|无需|失败|拒绝)$/.test(text) || /鍚|涓|鏃犻渶|澶辫触|鎷掔粷/.test(text)) {
    return 'no';
  }

  if (/^(yes|y|true|是|需要|通过|同意|成功)$/.test(text) || /鏄|闇|閫氳繃|鍚屾剰|鎴愬姛/.test(text)) {
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

function flowchartEdgeStyle(sourceLayout, targetLayout) {
  const backward = targetLayout.index <= sourceLayout.index;
  const common = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=0',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    'endArrow=block',
    'strokeWidth=2',
    'fontSize=12',
    `fontFamily=${FONT}`,
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

function compactWaypoints(points) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    const previous = points[index - 1];
    return previous.x !== point.x || previous.y !== point.y;
  });
}

function swimlaneEdgeStyle(sourceLayout, targetLayout) {
  const backward = targetLayout.index <= sourceLayout.index;
  const pins = backward
    ? ['exitX=1', 'exitY=0.5', 'exitDx=0', 'exitDy=0', 'entryX=1', 'entryY=0.5', 'entryDx=0', 'entryDy=0']
    : ['exitX=0.5', 'exitY=1', 'exitDx=0', 'exitDy=0', 'entryX=0.5', 'entryY=0', 'entryDx=0', 'entryDy=0'];

  return `${flowchartEdgeStyle(sourceLayout, targetLayout)}${pins.join(';')};`;
}

function swimlaneCorridorY(sourceLayout, targetLayout, edgeIndex) {
  const sourceBottom = sourceLayout.y + sourceLayout.height;
  const targetTop = targetLayout.y;
  const availableGap = targetTop - sourceBottom;
  const slotOffset = edgeIndex % 2 === 0 ? 0 : 10;

  if (availableGap > 0) {
    return {
      source: roundedGrid(sourceBottom + Math.max(20, Math.min(34 + slotOffset, availableGap / 2))),
      target: roundedGrid(targetTop - Math.max(20, Math.min(34 - slotOffset, availableGap / 2)))
    };
  }

  const shared = roundedGrid(Math.max(sourceBottom, targetTop) + 34 + slotOffset);
  return { source: shared, target: shared };
}

function swimlaneSideCorridorX(sourceLayout, targetLayout, context, edgeIndex) {
  if (sourceLayout.lane < targetLayout.lane) {
    return roundedGrid(sourceLayout.laneRight + context.laneGap / 2);
  }

  if (sourceLayout.lane > targetLayout.lane) {
    return roundedGrid(sourceLayout.laneLeft - context.laneGap / 2);
  }

  if (sourceLayout.lane < context.laneCount - 1) {
    return roundedGrid(sourceLayout.laneRight + context.laneGap / 2);
  }

  if (sourceLayout.lane > 0) {
    return roundedGrid(sourceLayout.laneLeft - context.laneGap / 2);
  }

  return roundedGrid(context.groupRight + 56 + edgeIndex * 8);
}

function swimlaneEdgeWaypoints(sourceLayout, targetLayout, context, edgeIndex) {
  const sourceCenterX = roundedGrid(sourceLayout.x + sourceLayout.width / 2);
  const sourceCenterY = roundedGrid(sourceLayout.y + sourceLayout.height / 2);
  const targetCenterX = roundedGrid(targetLayout.x + targetLayout.width / 2);
  const targetCenterY = roundedGrid(targetLayout.y + targetLayout.height / 2);
  const backward = targetLayout.index <= sourceLayout.index;
  const crossLane = sourceLayout.lane !== targetLayout.lane;
  const skippedSameLane = !crossLane && targetLayout.index > sourceLayout.index + 1;

  if (backward) {
    const routeX = roundedGrid(context.groupRight + 72 + edgeIndex * 14);
    return compactWaypoints([
      { x: routeX, y: sourceCenterY },
      { x: routeX, y: targetCenterY }
    ]);
  }

  if (!crossLane && !skippedSameLane) {
    return [];
  }

  const routeY = swimlaneCorridorY(sourceLayout, targetLayout, edgeIndex);

  if (routeY.source === routeY.target) {
    return compactWaypoints([
      { x: sourceCenterX, y: routeY.source },
      { x: targetCenterX, y: routeY.target }
    ]);
  }

  const routeX = swimlaneSideCorridorX(sourceLayout, targetLayout, context, edgeIndex);
  return compactWaypoints([
    { x: sourceCenterX, y: routeY.source },
    { x: routeX, y: routeY.source },
    { x: routeX, y: routeY.target },
    { x: targetCenterX, y: routeY.target }
  ]);
}

function edgeGeometryXml(points, labelOffset = null) {
  const attrs = ['relative="1"'];

  if (labelOffset && Number.isFinite(labelOffset.x)) {
    attrs.push(`x="${labelOffset.x}"`);
  }

  if (labelOffset && Number.isFinite(labelOffset.y)) {
    attrs.push(`y="${labelOffset.y}"`);
  }

  if (!points.length) {
    return `<mxGeometry ${attrs.join(' ')} as="geometry"/>`;
  }

  return [
    `<mxGeometry ${attrs.join(' ')} as="geometry">`,
    '<Array as="points">',
    points.map((point) => `<mxPoint x="${point.x}" y="${point.y}"/>`).join(''),
    '</Array>',
    '</mxGeometry>'
  ].join('');
}

function renderFlowchartXml(spec) {
  const startY = 80;
  const minPageWidth = 900;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const nodeCellIds = new Map();
  const nodeLayouts = new Map();
  const indexById = new Map(spec.nodes.map((node, index) => [node.id, index]));
  const lanes = assignFlowchartLanes(spec, indexById);
  const laneValues = Array.from(lanes.values());
  const nodeSizes = new Map(spec.nodes.map((node) => [node.id, flowchartNodeSize(node.type, node.label)]));
  const maxNodeWidth = Math.max(210, ...Array.from(nodeSizes.values()).map((size) => size.width));
  const maxNodeHeight = Math.max(96, ...Array.from(nodeSizes.values()).map((size) => size.height));
  const gapY = Math.max(136, maxNodeHeight + 64);
  const laneGap = Math.max(285, maxNodeWidth + 110);
  const maxAbsLane = Math.max(1, ...laneValues.map((lane) => Math.abs(lane)));
  const pageWidth = Math.max(minPageWidth, maxAbsLane * 2 * laneGap + 480);
  const centerX = pageWidth / 2;

  spec.nodes.forEach((node, index) => {
    const cellId = `ai_node_${node.id}`;
    const size = nodeSizes.get(node.id);
    const lane = lanes.get(node.id) || 0;
    const x = centerX + lane * laneGap - size.width / 2;
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
  return graphModel(cells, pageWidth, pageHeight);
}

function renderSwimlaneXml(spec) {
  const nodeSizes = new Map(spec.nodes.map((node) => [node.id, flowchartNodeSize(node.type, node.label)]));
  const maxNodeWidth = Math.max(210, ...Array.from(nodeSizes.values()).map((size) => size.width));
  const maxNodeHeight = Math.max(72, ...Array.from(nodeSizes.values()).map((size) => size.height));
  const laneWidth = Math.max(270, maxNodeWidth + 66);
  const laneGap = Math.max(74, Math.ceil(maxNodeWidth / 3));
  const startX = 40;
  const startY = 70;
  const laneHeader = 34;
  const rowGap = Math.max(150, maxNodeHeight + 78);
  const nodeCellIds = new Map();
  const nodeLayouts = new Map();
  const laneOrder = (spec.lanes.length ? spec.lanes : [{ id: 'default', label: '流程' }])
    .map((lane) => ({ ...lane }));
  const laneIds = new Set(laneOrder.map((lane) => lane.id));
  const laneLayouts = new Map();
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  spec.nodes.forEach((node) => {
    if (!laneIds.has(node.lane)) {
      laneIds.add(node.lane);
      laneOrder.push({ id: node.lane, label: node.lane });
    }
  });

  const maxRows = Math.max(2, spec.nodes.length);
  const laneHeight = laneHeader + 32 + (maxRows - 1) * rowGap + maxNodeHeight + 52;
  const groupRight = startX + laneOrder.length * laneWidth + Math.max(0, laneOrder.length - 1) * laneGap;

  laneOrder.forEach((lane, laneIndex) => {
    const laneCellId = `ai_lane_${lane.id}`;
    const x = startX + laneIndex * (laneWidth + laneGap);
    const laneStyle = `swimlane;startSize=${laneHeader};html=1;whiteSpace=wrap;rounded=0;strokeWidth=2;fontStyle=1;fontSize=14;fontFamily=${FONT};fillColor=#f7faf9;strokeColor=#9fb3ad;`;
    laneLayouts.set(lane.id, {
      cellId: laneCellId,
      index: laneIndex,
      x,
      right: x + laneWidth
    });
    cells.push([
      `<mxCell id="${escapeXml(laneCellId)}" value="${escapeXml(lane.label)}" style="${escapeXml(laneStyle)}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${startY}" width="${laneWidth}" height="${laneHeight}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
  });

  spec.nodes.forEach((node, nodeIndex) => {
    const laneLayout = laneLayouts.get(node.lane) || Array.from(laneLayouts.values())[0];
    const cellId = `ai_node_${node.id}`;
    const size = nodeSizes.get(node.id);
    const width = size.width;
    const height = size.height;
    const relativeX = (laneWidth - width) / 2;
    const relativeY = laneHeader + 32 + nodeIndex * rowGap;

    nodeCellIds.set(node.id, cellId);
    nodeLayouts.set(node.id, {
      x: laneLayout.x + relativeX,
      y: startY + relativeY,
      width,
      height,
      lane: laneLayout.index,
      laneLeft: laneLayout.x,
      laneRight: laneLayout.right,
      index: nodeIndex
    });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(node.label)}" style="${escapeXml(nodeStyle(node.type))}" vertex="1" parent="${escapeXml(laneLayout.cellId)}">`,
      `<mxGeometry x="${relativeX}" y="${relativeY}" width="${width}" height="${height}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
  });

  const routingContext = {
    laneGap,
    laneCount: laneOrder.length,
    groupRight
  };

  spec.edges.forEach((edge, index) => {
    const source = nodeCellIds.get(edge.from);
    const target = nodeCellIds.get(edge.to);
    const sourceLayout = nodeLayouts.get(edge.from);
    const targetLayout = nodeLayouts.get(edge.to);

    if (!source || !target || !sourceLayout || !targetLayout) {
      return;
    }

    cells.push([
      `<mxCell id="ai_edge_${index + 1}" value="${escapeXml(edge.label)}" style="${escapeXml(swimlaneEdgeStyle(sourceLayout, targetLayout))}" edge="1" parent="1" source="${escapeXml(source)}" target="${escapeXml(target)}">`,
      edgeGeometryXml(swimlaneEdgeWaypoints(sourceLayout, targetLayout, routingContext, index)),
      '</mxCell>'
    ].join(''));
  });

  const pageWidth = Math.max(900, groupRight + 180 + spec.edges.length * 14);
  const pageHeight = Math.max(700, startY + laneHeight + 80);
  return graphModel(cells, pageWidth, pageHeight);
}

function renderSequenceXml(spec) {
  const participantGap = 90;
  const startX = 70;
  const topY = 70;
  const messageStartY = 175;
  const messageGap = 72;
  const height = Math.max(520, messageStartY + spec.messages.length * messageGap);
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const participantLayouts = new Map();
  const lifelineStyle = `shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;fontFamily=${FONT};fontSize=14;fillColor=#fffdf8;strokeColor=#6c8ebf;`;
  let cursorX = startX;

  spec.participants.forEach((participant, index) => {
    const width = labelSize(participant.label, {
      minWidth: 160,
      maxWidth: 260,
      minHeight: 58,
      fontSize: 14,
      lineHeight: 22,
      paddingX: 28,
      paddingY: 18
    }).width;
    const x = cursorX;
    const cellId = `ai_participant_${participant.id}`;
    participantLayouts.set(participant.id, {
      cellId,
      x,
      width,
      centerX: x + width / 2
    });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(participant.label)}" style="${escapeXml(lifelineStyle)}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${topY}" width="${width}" height="${height}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
    cursorX += width + participantGap;
  });

  spec.messages.forEach((message, index) => {
    const source = participantLayouts.get(message.from);
    const target = participantLayouts.get(message.to);

    if (!source || !target) {
      return;
    }

    const y = messageStartY + index * messageGap;
    const isReturn = message.type === 'return';
    const isAsync = message.type === 'async';
    const style = [
      'html=1',
      'verticalAlign=bottom',
      `fontFamily=${FONT}`,
      'fontSize=12',
      'fontColor=#3f514c',
      'labelBackgroundColor=#ffffff',
      'strokeColor=' + (isReturn ? '#8a9792' : '#52645f'),
      'strokeWidth=2',
      'endArrow=' + (isAsync || isReturn ? 'open' : 'block'),
      isAsync || isReturn ? 'dashed=1' : ''
    ].filter(Boolean).join(';') + ';';

    cells.push([
      `<mxCell id="ai_message_${index + 1}" value="${escapeXml(message.label)}" style="${escapeXml(style)}" edge="1" parent="1">`,
      '<mxGeometry relative="1" as="geometry">',
      `<mxPoint x="${source.centerX}" y="${y}" as="sourcePoint"/>`,
      `<mxPoint x="${target.centerX}" y="${y}" as="targetPoint"/>`,
      '</mxGeometry>',
      '</mxCell>'
    ].join(''));
  });

  const pageWidth = Math.max(900, cursorX - participantGap + startX);
  const pageHeight = Math.max(700, topY + height + 70);
  return graphModel(cells, pageWidth, pageHeight);
}

function classRelationStyle(type) {
  const common = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;fontFamily=${FONT};fontSize=12;fontColor=#3f514c;labelBackgroundColor=#ffffff;strokeColor=#52645f;strokeWidth=2;`;
  const normalized = String(type || '').toLowerCase();

  if (normalized === 'inheritance') {
    return `${common}endArrow=block;endFill=0;`;
  }

  if (normalized === 'implementation') {
    return `${common}endArrow=block;endFill=0;dashed=1;`;
  }

  if (normalized === 'composition') {
    return `${common}endArrow=diamondThin;endFill=1;`;
  }

  if (normalized === 'aggregation') {
    return `${common}endArrow=diamondThin;endFill=0;`;
  }

  return `${common}endArrow=open;`;
}

function renderClassXml(spec) {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(spec.classes.length))));
  const boxWidth = Math.max(260, Math.min(380, maxLabelWidth(
    spec.classes.flatMap((item) => [
      item.stereotype ? `<<${item.stereotype}>> ${item.name}` : item.name,
      ...item.attributes,
      ...item.methods
    ]),
    { minWidth: 260, maxWidth: 380, fontSize: 12, paddingX: 24 }
  )));
  const gapX = 80;
  const gapY = 90;
  const startX = 60;
  const startY = 70;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const layouts = new Map();
  const classSizes = spec.classes.map((item) => {
    const attrHeight = Math.max(34, item.attributes.length * 22 + 14);
    const methodHeight = Math.max(34, item.methods.length * 22 + 14);
    return { attrHeight, methodHeight, height: 34 + attrHeight + methodHeight };
  });
  const rowHeights = [];

  classSizes.forEach((size, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] || 0, size.height);
  });

  function rowTop(row) {
    let y = startY;

    for (let index = 0; index < row; index += 1) {
      y += rowHeights[index] + gapY;
    }

    return y;
  }

  spec.classes.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const { attrHeight, methodHeight, height } = classSizes[index];
    const x = startX + col * (boxWidth + gapX);
    const y = rowTop(row);
    const cellId = `ai_class_${item.id}`;
    const header = item.stereotype ? `&lt;&lt;${item.stereotype}&gt;&gt;&#xa;${item.name}` : item.name;
    const style = `swimlane;fontStyle=1;align=center;startSize=34;html=1;whiteSpace=wrap;fontFamily=${FONT};fontSize=14;fillColor=#edf4ff;strokeColor=#6c8ebf;strokeWidth=2;`;

    layouts.set(item.id, { cellId, x, y, width: boxWidth, height, lane: col, index });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${header}" style="${escapeXml(style)}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${y}" width="${boxWidth}" height="${height}" as="geometry"/>`,
      '</mxCell>',
      `<mxCell id="${escapeXml(cellId)}_attrs" value="${escapeXml(item.attributes.join('&#xa;') || 'attributes')}" style="text;html=1;align=left;verticalAlign=top;spacing=8;fontSize=12;fontFamily=${escapeXml(FONT)};strokeColor=none;fillColor=none;" vertex="1" parent="${escapeXml(cellId)}">`,
      `<mxGeometry x="0" y="34" width="${boxWidth}" height="${attrHeight}" as="geometry"/>`,
      '</mxCell>',
      `<mxCell id="${escapeXml(cellId)}_methods" value="${escapeXml(item.methods.join('&#xa;') || 'methods')}" style="text;html=1;align=left;verticalAlign=top;spacing=8;fontSize=12;fontFamily=${escapeXml(FONT)};strokeColor=none;fillColor=none;" vertex="1" parent="${escapeXml(cellId)}">`,
      `<mxGeometry x="0" y="${34 + attrHeight}" width="${boxWidth}" height="${methodHeight}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
  });

  spec.relations.forEach((relation, index) => {
    const source = layouts.get(relation.from);
    const target = layouts.get(relation.to);

    if (!source || !target) {
      return;
    }

    cells.push([
      `<mxCell id="ai_class_edge_${index + 1}" value="${escapeXml(relation.label)}" style="${escapeXml(classRelationStyle(relation.type))}" edge="1" parent="1" source="${escapeXml(source.cellId)}" target="${escapeXml(target.cellId)}">`,
      edgeGeometryXml(edgeWaypoints(source, target)),
      '</mxCell>'
    ].join(''));
  });

  const rows = Math.ceil(spec.classes.length / columns);
  const pageWidth = Math.max(900, startX * 2 + columns * boxWidth + (columns - 1) * gapX);
  const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * gapY;
  const pageHeight = Math.max(700, startY * 2 + contentHeight);
  return graphModel(cells, pageWidth, pageHeight);
}

function renderErdXml(spec) {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(spec.entities.length))));
  const tableWidth = Math.max(300, Math.min(420, maxLabelWidth(
    spec.entities.flatMap((entity) => [
      entity.name,
      ...entity.columns.map((column) => {
        const prefix = column.pk ? 'PK ' : column.fk ? 'FK ' : '';
        return `${prefix}${column.name}${column.type ? ': ' + column.type : ''}`;
      })
    ]),
    { minWidth: 300, maxWidth: 420, fontSize: 12, paddingX: 28 }
  )));
  const gapX = 90;
  const gapY = 90;
  const startX = 60;
  const startY = 70;
  const rowHeight = 28;
  const headerHeight = 34;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const layouts = new Map();
  const entityHeights = spec.entities.map((entity) => headerHeight + Math.max(1, entity.columns.length) * rowHeight);
  const rowHeights = [];

  entityHeights.forEach((height, index) => {
    const row = Math.floor(index / columns);
    rowHeights[row] = Math.max(rowHeights[row] || 0, height);
  });

  function rowTop(row) {
    let y = startY;

    for (let index = 0; index < row; index += 1) {
      y += rowHeights[index] + gapY;
    }

    return y;
  }

  spec.entities.forEach((entity, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const height = entityHeights[index];
    const x = startX + col * (tableWidth + gapX);
    const y = rowTop(row);
    const cellId = `ai_entity_${entity.id}`;
    const style = `swimlane;startSize=${headerHeight};html=1;whiteSpace=wrap;rounded=0;container=1;collapsible=0;recursiveResize=0;resizeParent=0;fontStyle=1;fontSize=13;fontFamily=${FONT};align=center;verticalAlign=middle;strokeColor=#6c8ebf;fillColor=#dae8fc;strokeWidth=2;`;

    layouts.set(entity.id, { cellId, x, y, width: tableWidth, height, lane: col, index });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(entity.name)}" style="${escapeXml(style)}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${y}" width="${tableWidth}" height="${height}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));

    entity.columns.forEach((column, columnIndex) => {
      const prefix = column.pk ? 'PK ' : column.fk ? 'FK ' : '';
      const label = `${prefix}${column.name}${column.type ? ': ' + column.type : ''}`;
      const rowStyle = [
        'rounded=0',
        'whiteSpace=wrap',
        'html=1',
        'align=left',
        'verticalAlign=middle',
        'spacingLeft=8',
        'spacingRight=6',
        'strokeColor=#d9e0da',
        'fillColor=' + (columnIndex % 2 === 0 ? '#ffffff' : '#f7faf7'),
        'fontColor=#17211f',
        'fontSize=12',
        `fontFamily=${FONT}`,
        'rotatable=0',
        column.pk ? 'fontStyle=1' : ''
      ].filter(Boolean).join(';') + ';';
      cells.push([
        `<mxCell id="${escapeXml(cellId)}_col_${columnIndex + 1}" value="${escapeXml(label)}" style="${escapeXml(rowStyle)}" vertex="1" parent="${escapeXml(cellId)}">`,
        `<mxGeometry x="0" y="${headerHeight + columnIndex * rowHeight}" width="${tableWidth}" height="${rowHeight}" as="geometry"/>`,
        '</mxCell>'
      ].join(''));
    });
  });

  spec.relations.forEach((relation, index) => {
    const source = layouts.get(relation.from);
    const target = layouts.get(relation.to);

    if (!source || !target) {
      return;
    }

    const style = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;dashed=1;endArrow=ERmandOne;startArrow=ERmandOne;fontSize=12;fontFamily=${FONT};labelBackgroundColor=#ffffff;strokeColor=#52645f;`;
    cells.push([
      `<mxCell id="ai_erd_edge_${index + 1}" value="${escapeXml(relation.label || relation.cardinality)}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(source.cellId)}" target="${escapeXml(target.cellId)}">`,
      edgeGeometryXml(edgeWaypoints(source, target)),
      '</mxCell>'
    ].join(''));
  });

  const rows = Math.ceil(spec.entities.length / columns);
  const pageWidth = Math.max(900, startX * 2 + columns * tableWidth + (columns - 1) * gapX);
  const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * gapY;
  const pageHeight = Math.max(700, startY * 2 + contentHeight);
  return graphModel(cells, pageWidth, pageHeight);
}

function componentStyle(type, c4) {
  const common = `rounded=1;arcSize=8;whiteSpace=wrap;html=1;strokeWidth=2;fontSize=13;fontFamily=${FONT};align=center;verticalAlign=middle;spacing=12;shadow=0;`;
  const normalized = String(type || '').toLowerCase();

  if (normalized === 'database' || normalized === 'db') {
    return `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;strokeWidth=2;fontSize=13;fontFamily=${FONT};align=center;verticalAlign=middle;spacing=12;fillColor=#d5e8d4;strokeColor=#82b366;`;
  }

  if (normalized === 'queue' || normalized === 'bus' || normalized === 'event') {
    return `${common}fillColor=#fff2cc;strokeColor=#d6b656;`;
  }

  if (normalized === 'gateway' || normalized === 'api' || normalized === 'load_balancer') {
    return `${common}fillColor=#ffe6cc;strokeColor=#d79b00;`;
  }

  if (normalized === 'external' || normalized === 'vendor') {
    return `${common}dashed=1;fillColor=#f5f5f5;strokeColor=#666666;`;
  }

  if (normalized === 'client' || normalized === 'person') {
    return `${common}fillColor=${c4 ? '#083F75' : '#e0f1ec'};strokeColor=${c4 ? '#06315C' : '#147866'};fontColor=${c4 ? '#ffffff' : '#17211f'};`;
  }

  return `${common}fillColor=${c4 ? '#63BEF2' : '#edf4ff'};strokeColor=${c4 ? '#2086C9' : '#6c8ebf'};`;
}

function architectureComponentLabel(component) {
  return component.description ? `${component.label}&#xa;${component.description}` : component.label;
}

function architectureComponentSize(component) {
  const size = labelSize(architectureComponentLabel(component), {
    minWidth: 220,
    maxWidth: 330,
    minHeight: 78,
    fontSize: 13,
    lineHeight: 21,
    paddingX: 28,
    paddingY: 20
  });
  const normalized = String(component.type || '').toLowerCase();

  if (normalized === 'database' || normalized === 'db') {
    return { width: Math.max(size.width, 230), height: Math.max(size.height + 8, 86) };
  }

  return size;
}

function architectureGroupContainerStyle(c4) {
  return [
    'rounded=1',
    'arcSize=6',
    'whiteSpace=wrap',
    'html=1',
    'container=1',
    'collapsible=0',
    'recursiveResize=0',
    'connectable=0',
    'strokeWidth=2',
    `fontFamily=${FONT}`,
    'fontSize=14',
    'shadow=0',
    `fillColor=${c4 ? '#f2f9ff' : '#f7faf9'}`,
    `strokeColor=${c4 ? '#2086C9' : '#9fb3ad'}`,
    c4 ? 'dashed=1' : ''
  ].filter(Boolean).join(';') + ';';
}

function architectureGroupLabelStyle(c4) {
  return [
    'text',
    'html=1',
    'whiteSpace=wrap',
    'strokeColor=none',
    'fillColor=none',
    'align=center',
    'verticalAlign=middle',
    'fontStyle=1',
    'fontSize=14',
    `fontFamily=${FONT}`,
    `fontColor=${c4 ? '#06315C' : '#17211f'}`,
    'spacing=0'
  ].join(';') + ';';
}

function architectureEdgeStyle(sourceLayout, targetLayout) {
  const targetRightOfSource = targetLayout.x >= sourceLayout.x;
  const pins = targetRightOfSource
    ? ['exitX=1', 'exitY=0.5', 'exitDx=0', 'exitDy=0', 'entryX=0', 'entryY=0.5', 'entryDx=0', 'entryDy=0']
    : ['exitX=0', 'exitY=0.5', 'exitDx=0', 'exitDy=0', 'entryX=1', 'entryY=0.5', 'entryDx=0', 'entryDy=0'];

  return [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    'endArrow=blockThin',
    'endFill=1',
    'fontSize=11',
    `fontFamily=${FONT}`,
    'fontColor=#404040',
    'strokeColor=#6f7f7a',
    'strokeWidth=2',
    'labelBackgroundColor=#ffffff',
    'verticalAlign=bottom',
    'spacing=8',
    ...pins
  ].join(';') + ';';
}

function architectureEdgeWaypoints(sourceLayout, targetLayout, edgeIndex) {
  const sourceCenterX = roundedGrid(sourceLayout.x + sourceLayout.width / 2);
  const sourceCenterY = roundedGrid(sourceLayout.y + sourceLayout.height / 2);
  const targetCenterX = roundedGrid(targetLayout.x + targetLayout.width / 2);
  const targetCenterY = roundedGrid(targetLayout.y + targetLayout.height / 2);
  const sourceRight = sourceLayout.x + sourceLayout.width;
  const targetRight = targetLayout.x + targetLayout.width;
  const sameColumn = Math.abs(sourceCenterX - targetCenterX) < 20;

  if (sameColumn) {
    const routeX = roundedGrid(Math.max(sourceRight, targetRight) + 56 + edgeIndex * 8);
    return compactWaypoints([
      { x: routeX, y: sourceCenterY },
      { x: routeX, y: targetCenterY }
    ]);
  }

  const sourceToTargetGap = targetLayout.x - sourceRight;
  const targetToSourceGap = sourceLayout.x - targetRight;
  const horizontalGap = sourceToTargetGap >= 0 ? sourceToTargetGap : targetToSourceGap;

  if (horizontalGap >= 70 && Math.abs(sourceCenterY - targetCenterY) < 20) {
    return [];
  }

  const routeX = sourceToTargetGap >= 0
    ? roundedGrid(sourceRight + Math.max(50, sourceToTargetGap / 2))
    : roundedGrid(targetRight + Math.max(50, targetToSourceGap / 2));

  return compactWaypoints([
    { x: routeX, y: sourceCenterY },
    { x: routeX, y: targetCenterY }
  ]);
}

function renderArchitectureXml(spec) {
  const grouped = spec.groups.length > 0;
  const groupGap = 96;
  const startX = 50;
  const startY = 70;
  const groupHeader = 52;
  const groupPaddingX = 32;
  const groupPaddingBottom = 36;
  const componentGapY = 58;
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const layouts = new Map();
  const c4 = spec.diagramType === 'c4';

  if (grouped) {
    const byGroup = new Map(spec.groups.map((group) => [group.id, []]));
    const ungroupedId = 'ungrouped';
    spec.components.forEach((component) => {
      const group = component.group && byGroup.has(component.group) ? component.group : ungroupedId;
      if (!byGroup.has(group)) {
        byGroup.set(group, []);
        spec.groups.push({ id: group, label: '未分组' });
      }

      byGroup.get(group).push(component);
    });

    const groupModels = spec.groups.map((group) => {
      const items = byGroup.get(group.id) || [];
      const componentSizes = items.map(architectureComponentSize);
      const maxComponentWidth = Math.max(220, ...componentSizes.map((size) => size.width));
      const labelWidth = labelSize(group.label, {
        minWidth: 180,
        maxWidth: 360,
        minHeight: 34,
        fontSize: 14,
        lineHeight: 22,
        paddingX: 24,
        paddingY: 8
      }).width;
      const width = Math.max(320, maxComponentWidth + groupPaddingX * 2, labelWidth + 48);
      const contentHeight = componentSizes.reduce((sum, size) => sum + size.height, 0) +
        Math.max(0, componentSizes.length - 1) * componentGapY;
      const height = Math.max(320, groupHeader + 24 + contentHeight + groupPaddingBottom);

      return { group, items, componentSizes, width, height };
    });
    const maxGroupHeight = Math.max(320, ...groupModels.map((model) => model.height));
    let groupX = startX;

    groupModels.forEach((model, groupIndex) => {
      const { group } = model;
      const groupCellId = `ai_group_${group.id}`;
      cells.push([
        `<mxCell id="${escapeXml(groupCellId)}" value="" style="${escapeXml(architectureGroupContainerStyle(c4))}" vertex="1" parent="1">`,
        `<mxGeometry x="${groupX}" y="${startY}" width="${model.width}" height="${maxGroupHeight}" as="geometry"/>`,
        '</mxCell>',
        `<mxCell id="${escapeXml(groupCellId)}_label" value="${escapeXml(group.label)}" style="${escapeXml(architectureGroupLabelStyle(c4))}" vertex="1" parent="${escapeXml(groupCellId)}">`,
        `<mxGeometry x="18" y="12" width="${model.width - 36}" height="${groupHeader - 18}" as="geometry"/>`,
        '</mxCell>'
      ].join(''));

      let componentY = groupHeader + 24;

      model.items.forEach((component, rowIndex) => {
        const size = model.componentSizes[rowIndex];
        const cellId = `ai_component_${component.id}`;
        const x = (model.width - size.width) / 2;
        const y = componentY;
        const label = architectureComponentLabel(component);
        layouts.set(component.id, {
          cellId,
          x: groupX + x,
          y: startY + y,
          width: size.width,
          height: size.height,
          lane: groupIndex,
          groupIndex,
          index: spec.components.findIndex((item) => item.id === component.id)
        });
        cells.push([
          `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(label)}" style="${escapeXml(componentStyle(component.type, c4))}" vertex="1" parent="${escapeXml(groupCellId)}">`,
          `<mxGeometry x="${x}" y="${y}" width="${size.width}" height="${size.height}" as="geometry"/>`,
          '</mxCell>'
        ].join(''));
        componentY += size.height + componentGapY;
      });

      groupX += model.width + groupGap;
    });

    spec.connections.forEach((connection, index) => appendArchitectureEdge(cells, connection, index, layouts));

    const pageWidth = Math.max(900, groupX - groupGap + startX);
    const pageHeight = Math.max(700, startY + maxGroupHeight + 80);
    return graphModel(cells, pageWidth, pageHeight);
  }

  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(spec.components.length))));
  const componentSizes = spec.components.map(architectureComponentSize);
  const columnWidths = [];
  const rowHeights = [];

  componentSizes.forEach((size, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[col] = Math.max(columnWidths[col] || 0, size.width);
    rowHeights[row] = Math.max(rowHeights[row] || 0, size.height);
  });

  function columnLeft(col) {
    let x = startX;

    for (let index = 0; index < col; index += 1) {
      x += columnWidths[index] + 110;
    }

    return x;
  }

  function rowTop(row) {
    let y = startY;

    for (let index = 0; index < row; index += 1) {
      y += rowHeights[index] + 90;
    }

    return y;
  }

  spec.components.forEach((component, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const size = componentSizes[index];
    const x = columnLeft(col) + (columnWidths[col] - size.width) / 2;
    const y = rowTop(row);
    const cellId = `ai_component_${component.id}`;
    const label = architectureComponentLabel(component);
    layouts.set(component.id, { cellId, x, y, width: size.width, height: size.height, lane: col, groupIndex: col, index });
    cells.push([
      `<mxCell id="${escapeXml(cellId)}" value="${escapeXml(label)}" style="${escapeXml(componentStyle(component.type, c4))}" vertex="1" parent="1">`,
      `<mxGeometry x="${x}" y="${y}" width="${size.width}" height="${size.height}" as="geometry"/>`,
      '</mxCell>'
    ].join(''));
  });

  spec.connections.forEach((connection, index) => appendArchitectureEdge(cells, connection, index, layouts));

  const rows = Math.ceil(spec.components.length / columns);
  const pageWidth = Math.max(900, startX * 2 + columnWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, columns - 1) * 110);
  const pageHeight = Math.max(700, startY * 2 + rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * 90);
  return graphModel(cells, pageWidth, pageHeight);
}

function appendArchitectureEdge(cells, connection, index, layouts) {
  const source = layouts.get(connection.from);
  const target = layouts.get(connection.to);

  if (!source || !target) {
    return;
  }

  cells.push([
    `<mxCell id="ai_arch_edge_${index + 1}" value="${escapeXml(connection.label)}" style="${escapeXml(architectureEdgeStyle(source, target))}" edge="1" parent="1" source="${escapeXml(source.cellId)}" target="${escapeXml(target.cellId)}">`,
    edgeGeometryXml(architectureEdgeWaypoints(source, target, index), { x: 0, y: -18 - (index % 3) * 8 }),
    '</mxCell>'
  ].join(''));
}

function renderDiagramXml(spec) {
  if (spec.diagramType === 'swimlane') {
    return renderSwimlaneXml(spec);
  }

  if (spec.diagramType === 'sequence') {
    return renderSequenceXml(spec);
  }

  if (spec.diagramType === 'uml_class') {
    return renderClassXml(spec);
  }

  if (spec.diagramType === 'erd') {
    return renderErdXml(spec);
  }

  if (spec.diagramType === 'architecture' || spec.diagramType === 'c4') {
    return renderArchitectureXml(spec);
  }

  return renderFlowchartXml(spec);
}

function diagramMetrics(spec) {
  if (spec.diagramType === 'sequence') {
    return { nodeCount: spec.participants.length, edgeCount: spec.messages.length };
  }

  if (spec.diagramType === 'uml_class') {
    return { nodeCount: spec.classes.length, edgeCount: spec.relations.length };
  }

  if (spec.diagramType === 'erd') {
    return { nodeCount: spec.entities.length, edgeCount: spec.relations.length };
  }

  if (spec.diagramType === 'architecture' || spec.diagramType === 'c4') {
    return { nodeCount: spec.components.length, edgeCount: spec.connections.length };
  }

  return { nodeCount: spec.nodes.length, edgeCount: spec.edges.length };
}

module.exports = {
  buildDiagramInstruction,
  diagramMetrics,
  diagramTypeLabel,
  diagramTypeOptions,
  normalizeDiagramSpec,
  normalizeDiagramType,
  renderDiagramXml
};
