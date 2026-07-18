const { getClient } = require('./opnsense');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

// ---------------------------------------------------------------------------
// Alias helpers
// ---------------------------------------------------------------------------

async function fetchAlias(client, name) {
  const resp  = await client.get('/api/firewall/alias/search_item');
  const match = (resp.data.rows || []).find(a => a.name === name);
  if (!match) throw new Error(`Alias not found: ${name}`);
  return match;
}

async function aliasApply(client) {
  await client.post('/api/firewall/alias/reconfigure');
  console.log(`  ${c.gray}✓ Firewall aliases applied${c.reset}`);
}

// ---------------------------------------------------------------------------
// List aliases
// ---------------------------------------------------------------------------

async function listAliases({ filter } = {}) {
  const client = getClient();
  const resp   = await client.get('/api/firewall/alias/search_item');
  let   aliases = resp.data.rows || [];

  if (filter) {
    const f = filter.toLowerCase();
    aliases = aliases.filter(a =>
      a.name.toLowerCase().includes(f) || (a.description || '').toLowerCase().includes(f)
    );
  }

  if (aliases.length === 0) {
    console.log(filter ? `No aliases matching "${filter}".` : 'No firewall aliases configured.');
    return;
  }

  console.log(`\n${c.bold}Firewall Aliases:${c.reset}`);
  console.log(c.gray + '─'.repeat(70) + c.reset);
  for (const a of aliases) {
    // content is newline-separated in OPNsense
    const members = (a.content || '').split('\n').filter(Boolean);
    console.log(`\n  ${c.bold}${c.cyan}${a.name}${c.reset}  ${c.gray}(${a.type})${c.reset}  ${a.description || ''}`);
    if (members.length === 0) {
      console.log(`    ${c.gray}(empty)${c.reset}`);
    } else {
      members.forEach(m => console.log(`    ${m}`));
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Create or update alias
// ---------------------------------------------------------------------------

async function createOrUpdateAlias({ name, type = 'host', description = '', hosts = [] }) {
  const client  = getClient();
  const resp    = await client.get('/api/firewall/alias/search_item');
  const existing = (resp.data.rows || []).find(a => a.name === name);

  // content is newline-separated
  const content = hosts.map(h => h.split('/')[0]).join('\n');
  const payload = { alias: { enabled: '1', name, type, content, description } };

  if (existing) {
    await client.post(`/api/firewall/alias/set_item/${existing.uuid}`, payload);
    console.log(`  ${c.green}✓${c.reset} Updated alias ${c.cyan}${name}${c.reset} (${hosts.length} host(s))`);
  } else {
    await client.post('/api/firewall/alias/add_item', payload);
    console.log(`  ${c.green}✓${c.reset} Created alias ${c.cyan}${name}${c.reset} (${hosts.length} host(s))`);
  }
  await aliasApply(client);
}

// ---------------------------------------------------------------------------
// Add host to alias — uses alias_util for live pf table update
// ---------------------------------------------------------------------------

async function addAliasHost({ name, host, detail = '' }) {
  const client = getClient();

  // Confirm alias exists first
  await fetchAlias(client, name);

  const ip = host.split('/')[0];

  // alias_util for live update (config + kernel together)
  const resp = await client.post(`/api/firewall/alias_util/add/${encodeURIComponent(name)}`, { address: ip });
  if (resp.data.status !== 'done' && resp.data.result !== 'added') {
    // Fallback: edit content directly via alias set
    const alias   = await fetchAlias(client, name);
    const current = (alias.content || '').split('\n').filter(Boolean);
    if (current.includes(ip)) {
      console.log(`  ${c.blue}ℹ${c.reset} ${ip} already in ${name}`);
      return;
    }
    current.push(ip);
    const payload = { alias: { ...alias, content: current.join('\n') } };
    await client.post(`/api/firewall/alias/set_item/${alias.uuid}`, payload);
    await aliasApply(client);
  }
  console.log(`  ${c.green}✓${c.reset} Added ${c.cyan}${ip}${c.reset} to alias ${c.cyan}${name}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Remove host from alias
// ---------------------------------------------------------------------------

async function removeAliasHost({ name, host }) {
  const client = getClient();
  await fetchAlias(client, name);

  const ip   = host.split('/')[0];
  const resp = await client.post(`/api/firewall/alias_util/delete/${encodeURIComponent(name)}`, { address: ip });

  if (resp.data.status !== 'done' && resp.data.result !== 'deleted') {
    // Fallback: edit content directly
    const alias   = await fetchAlias(client, name);
    const current = (alias.content || '').split('\n').filter(Boolean);
    const idx     = current.indexOf(ip);
    if (idx === -1) { console.log(`  ${c.blue}ℹ${c.reset} ${ip} not in alias ${name}`); return; }
    current.splice(idx, 1);
    const payload = { alias: { ...alias, content: current.join('\n') } };
    await client.post(`/api/firewall/alias/set_item/${alias.uuid}`, payload);
    await aliasApply(client);
  }
  console.log(`  ${c.green}✓${c.reset} Removed ${c.cyan}${ip}${c.reset} from alias ${c.cyan}${name}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Delete alias
// ---------------------------------------------------------------------------

async function deleteAlias({ name }) {
  const client = getClient();
  const resp   = await client.get('/api/firewall/alias/search_item');
  const alias  = (resp.data.rows || []).find(a => a.name === name);

  if (!alias) { console.log(`  ${c.blue}ℹ${c.reset} Alias ${name} not found — skipped`); return; }

  await client.post(`/api/firewall/alias/del_item/${alias.uuid}`);
  await aliasApply(client);
  console.log(`  ${c.green}✓${c.reset} Deleted alias ${c.cyan}${name}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Filter rule helpers
// ---------------------------------------------------------------------------

// Savepoint → change → apply → cancel_rollback pattern
async function ruleApply(client, savepoint) {
  await client.post(`/api/firewall/filter/apply/${savepoint}`);
  await client.post(`/api/firewall/filter/cancel_rollback/${savepoint}`);
  console.log(`  ${c.gray}✓ Firewall rules applied${c.reset}`);
}

// ---------------------------------------------------------------------------
// List rules
// ---------------------------------------------------------------------------

async function listRules({ filter, iface, type } = {}) {
  const client = getClient();
  const resp   = await client.post('/api/firewall/filter/search_rule');
  let   rules  = resp.data.rows || [];

  if (filter) {
    const f = filter.toLowerCase();
    rules = rules.filter(r => (r.description || '').toLowerCase().includes(f));
  }
  if (iface)  rules = rules.filter(r => (r.interface || '').includes(iface));
  if (type)   rules = rules.filter(r => r.action === type);

  if (rules.length === 0) { console.log('No firewall rules found matching criteria.'); return; }

  console.log(`\n${c.bold}Firewall Rules (${rules.length}):${c.reset}`);
  console.log(c.gray + '─'.repeat(100) + c.reset);

  for (const r of rules) {
    const action    = r.action || '?';
    const aColor    = action === 'pass' ? c.green : action === 'block' ? c.red : c.yellow;
    const disabled  = r.enabled === '0' ? ` ${c.gray}[disabled]${c.reset}` : '';
    const src       = r.source_net      || 'any';
    const dst       = r.destination_net || 'any';
    const proto     = r.protocol        || '*';

    console.log(
      `\n  ${c.bold}${String(r.uuid).substring(0, 8)}${c.reset}` +
      ` ${aColor}${action.toUpperCase().padEnd(6)}${c.reset}` +
      ` ${c.cyan}${(r.interface || '').padEnd(8)}${c.reset}` +
      `${disabled}`
    );
    console.log(`       src: ${c.cyan}${src}${r.source_port ? ':' + r.source_port : ''}${c.reset}  →  dst: ${c.cyan}${dst}${r.destination_port ? ':' + r.destination_port : ''}${c.reset}  proto: ${proto}`);
    if (r.gateway)     console.log(`       gateway: ${c.yellow}${r.gateway}${c.reset}`);
    if (r.description) console.log(`       ${c.gray}${r.description}${c.reset}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Add rule
// ---------------------------------------------------------------------------

async function addRule({
  type,
  iface,
  direction    = 'in',
  source       = 'any',
  sourcePort   = null,
  destination  = 'any',
  destPort     = null,
  protocol     = null,
  ipprotocol   = 'inet',
  gateway      = null,
  description  = '',
  log          = false,
  disabled     = false,
}) {
  const client    = getClient();
  const spResp    = await client.post('/api/firewall/filter/savepoint');
  const savepoint = spResp.data.revision;

  const payload = {
    rule: {
      enabled:         disabled ? '0' : '1',
      action:          type,
      interface:       iface,
      direction,
      ipprotocol,
      protocol:        protocol  || 'any',
      source_net:      source,
      source_port:     sourcePort   || '',
      destination_net: destination,
      destination_port: destPort    || '',
      gateway:         gateway      || '',
      log:             log ? '1'   : '0',
      description:     description || '',
      quick:           '1',
    },
  };

  const addResp = await client.post('/api/firewall/filter/add_rule', payload);
  const uuid    = addResp.data.uuid;
  await ruleApply(client, savepoint);

  const aColor = type === 'pass' ? c.green : c.red;
  console.log(`  ${c.green}✓${c.reset} Created ${aColor}${type.toUpperCase()}${c.reset} rule${description ? ': ' + description : ''}${uuid ? c.gray + ' (' + uuid.substring(0, 8) + ')' + c.reset : ''}`);
}

// ---------------------------------------------------------------------------
// Delete rule
// ---------------------------------------------------------------------------

async function deleteRule({ id, description }) {
  const client = getClient();
  let   uuid   = id || null;

  if (!uuid) {
    if (!description) throw new Error('Either --id (uuid) or --description is required');
    const resp  = await client.post('/api/firewall/filter/search_rule');
    const rules = (resp.data.rows || []).filter(r => r.description === description);
    if (rules.length === 0) throw new Error(`No rule found with description: ${description}`);
    if (rules.length > 1)  throw new Error(`Multiple rules match "${description}" — use --id instead`);
    uuid = rules[0].uuid;
  }

  const spResp    = await client.post('/api/firewall/filter/savepoint');
  const savepoint = spResp.data.revision;

  await client.post(`/api/firewall/filter/del_rule/${uuid}`);
  await ruleApply(client, savepoint);
  console.log(`  ${c.green}✓${c.reset} Deleted rule ${c.gray}(${uuid.substring(0, 8)})${c.reset}`);
}

// ---------------------------------------------------------------------------
// Update rule
// ---------------------------------------------------------------------------

async function updateRule({ id, description, ...fields }) {
  const client = getClient();
  let   uuid   = id || null;

  if (!uuid) {
    if (!description) throw new Error('Either --id (uuid) or --description is required');
    const resp  = await client.post('/api/firewall/filter/search_rule');
    const rules = (resp.data.rows || []).filter(r => r.description === description);
    if (rules.length === 0) throw new Error(`No rule found with description: ${description}`);
    if (rules.length > 1)  throw new Error(`Multiple rules match "${description}" — use --id instead`);
    uuid = rules[0].uuid;
  }

  const getResp = await client.get(`/api/firewall/filter/get_rule/${uuid}`);
  const current = getResp.data.rule || {};

  const map = {
    type:        'action',
    iface:       'interface',
    source:      'source_net',
    sourcePort:  'source_port',
    destination: 'destination_net',
    destPort:    'destination_port',
    protocol:    'protocol',
    ipprotocol:  'ipprotocol',
    gateway:     'gateway',
    descr:       'description',
    log:         'log',
    disabled:    'enabled',   // inverted below
  };

  const patch = { ...current };
  for (const [jsKey, apiKey] of Object.entries(map)) {
    if (fields[jsKey] === undefined || fields[jsKey] === null) continue;
    if (jsKey === 'disabled') {
      patch.enabled = fields[jsKey] ? '0' : '1';
    } else {
      patch[apiKey] = fields[jsKey];
    }
  }

  const spResp    = await client.post('/api/firewall/filter/savepoint');
  const savepoint = spResp.data.revision;

  await client.post(`/api/firewall/filter/set_rule/${uuid}`, { rule: patch });
  await ruleApply(client, savepoint);
  console.log(`  ${c.green}✓${c.reset} Updated rule ${c.gray}(${uuid.substring(0, 8)})${c.reset}`);
}

// ---------------------------------------------------------------------------
// NAT port forward management
// OPNsense API: /api/firewall/nat/ (available from OPNsense 24.1+)
// ---------------------------------------------------------------------------

const SEARCH_ALL = { current: 1, rowCount: -1, searchPhrase: '' };

async function listPortForwards({ filter } = {}) {
  const client = getClient();
  const resp   = await client.post('/api/firewall/nat/search_rule', SEARCH_ALL);
  let   rules  = resp.data.rows || [];

  if (filter) {
    const f = filter.toLowerCase();
    rules = rules.filter(r => (r.description || '').toLowerCase().includes(f));
  }

  if (rules.length === 0) {
    console.log(filter ? `No port forwards matching "${filter}".` : 'No NAT port forward rules configured.');
    return;
  }

  console.log(`\n${c.bold}NAT Port Forwards (${rules.length}):${c.reset}`);
  console.log(c.gray + '─'.repeat(90) + c.reset);

  for (const r of rules) {
    const disabled = r.enabled === '0' ? ` ${c.gray}[disabled]${c.reset}` : '';
    const proto    = r.protocol || '*';
    const dstPort  = r.destination_port || r.dstport || '';
    const dst      = dstPort ? `${r.destination_net || 'any'}:${dstPort}` : (r.destination_net || 'any');
    const localPort = r.local_port || dstPort;
    const tgt      = localPort && localPort !== dstPort ? `${r.target}:${localPort}` : `${r.target}:${dstPort}`;

    console.log(
      `\n  ${c.bold}${(r.uuid || '').slice(0, 8).padEnd(10)}${c.reset}` +
      ` ${c.cyan}${(r.interface || 'wan').padEnd(6)}${c.reset}` +
      ` ${c.gray}${proto.padEnd(8)}${c.reset}` +
      `${disabled}`
    );
    console.log(`       ${c.cyan}${dst}${c.reset}  →  ${c.green}${tgt}${c.reset}`);
    if (r.description) console.log(`       ${c.gray}${r.description}${c.reset}`);
  }
  console.log('');
}

async function addPortForward({
  iface       = 'wan',
  protocol    = 'TCP/UDP',
  source      = 'any',
  sourcePort  = null,
  destination = 'any',
  destPort,
  target,
  localPort   = null,
  description = '',
  disabled    = false,
  addRule     = false,
}) {
  const client = getClient();

  const payload = {
    rule: {
      interface:        iface,
      protocol,
      source_net:       source,
      source_port:      sourcePort || '',
      destination_net:  destination,
      destination_port: String(destPort),
      target,
      local_port:       String(localPort || destPort),
      description,
      enabled:          disabled ? '0' : '1',
      log:              '0',
      nosync:           '0',
    },
  };

  const resp = await client.post('/api/firewall/nat/add_rule', payload);
  await client.post('/api/firewall/nat/apply');

  const uuid = resp.data.uuid || resp.data.result;
  const lp   = localPort || destPort;
  console.log(`  ${c.green}✓${c.reset} Created port forward: ${c.cyan}${destination}:${destPort}${c.reset}  →  ${c.green}${target}:${lp}${c.reset}${uuid ? c.gray + ' (' + String(uuid).slice(0, 8) + '…)' + c.reset : ''}`);
  if (addRule) console.log(`  ${c.gray}Note: OPNsense NAT API does not auto-create an associated pass rule — add one via fw-rule:add${c.reset}`);
  console.log(`  ${c.gray}✓ NAT applied${c.reset}`);
}

async function deletePortForward({ id, description }) {
  const client = getClient();

  let uuid = id || null;

  if (!uuid) {
    if (!description) throw new Error('Either --id (uuid) or --description is required');
    const resp  = await client.post('/api/firewall/nat/search_rule', SEARCH_ALL);
    const rules = (resp.data.rows || []).filter(r => r.description === description);
    if (rules.length === 0) throw new Error(`No port forward found with description: ${description}`);
    if (rules.length > 1)  throw new Error(`Multiple port forwards match "${description}" — use --id (uuid) instead`);
    uuid = rules[0].uuid;
  }

  await client.post(`/api/firewall/nat/del_rule/${uuid}`);
  await client.post('/api/firewall/nat/apply');

  console.log(`  ${c.green}✓${c.reset} Deleted port forward ${uuid}`);
  console.log(`  ${c.gray}✓ NAT applied${c.reset}`);
}

module.exports = {
  listAliases,
  createOrUpdateAlias,
  addAliasHost,
  removeAliasHost,
  deleteAlias,
  listRules,
  addRule,
  deleteRule,
  updateRule,
  listPortForwards,
  addPortForward,
  deletePortForward,
};
