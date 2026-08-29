const { getClient } = require('./opnsense');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function searchHosts(client) {
  const resp = await client.post('/api/unbound/settings/searchHostOverride',
    { current: 1, rowCount: -1, searchPhrase: '' });
  return resp.data.rows || [];
}

async function findHost(client, hostname, domain) {
  const rows = await searchHosts(client);
  return rows.find(r => r.hostname === hostname && r.domain === domain) || null;
}

async function applyChanges(client) {
  await client.post('/api/unbound/service/reconfigure');
  console.log(`  ${c.gray}✓ Unbound reconfigured${c.reset}`);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function listEntries(filter = null) {
  const client = getClient();
  let rows = await searchHosts(client);

  if (filter) {
    const f = filter.toLowerCase();
    rows = rows.filter(r =>
      (r.hostname || '').toLowerCase().includes(f) ||
      (r.domain   || '').toLowerCase().includes(f)
    );
  }

  if (rows.length === 0) { console.log('No entries found.'); return; }

  // Fetch aliases too so we can display them inline
  const aliasResp = await client.post('/api/unbound/settings/searchHostAlias',
    { current: 1, rowCount: -1, searchPhrase: '' });
  const aliases   = aliasResp.data.rows || [];
  const byHost    = {};
  for (const a of aliases) (byHost[a.host] = byHost[a.host] || []).push(a);

  console.log(`\n${c.bold}DNS Host Override Entries:${c.reset}`);
  console.log(c.gray + '═'.repeat(80) + c.reset);

  rows.forEach((r, i) => {
    console.log(`\n${c.gray}${i + 1}.${c.reset} ${c.bold}${c.cyan}${r.hostname}.${r.domain}${c.reset}`);
    console.log(`   ${c.gray}IP:${c.reset}          ${r.server}`);
    if (r.description) console.log(`   ${c.gray}Description:${c.reset} ${r.description}`);
    const aliasList = byHost[r.uuid] || [];
    if (aliasList.length > 0) {
      const names = aliasList.map(a => `${c.cyan}${a.hostname}.${a.domain}${c.reset}`).join(', ');
      console.log(`   ${c.gray}Aliases:${c.reset}     ${names}`);
    }
  });

  console.log('\n' + c.gray + '═'.repeat(80) + c.reset);
  console.log(`${c.gray}Total: ${rows.length} entries${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

async function addEntry({ host, domain, ip, description }) {
  const client  = getClient();
  const payload = {
    host: {
      enabled:     '1',
      hostname:    host,
      domain,
      rr:          'A',
      server:      ip,
      description: description || '',
    },
  };

  const resp = await client.post('/api/unbound/settings/addHostOverride', payload);
  if (resp.data.result !== 'saved') {
    throw new Error(JSON.stringify(resp.data));
  }
  console.log(`  ${c.green}✓${c.reset} Added DNS entry: ${c.cyan}${host}.${domain}${c.reset} ${c.gray}→ ${ip}${c.reset}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

async function updateEntry({ host, domain, ip, description }) {
  const client   = getClient();
  const existing = await findHost(client, host, domain);
  if (!existing) throw new Error(`Entry not found: ${host}.${domain}`);

  const payload = {
    host: {
      enabled:     existing.enabled ?? '1',
      hostname:    host,
      domain,
      rr:          existing.rr || 'A',
      server:      ip          ?? existing.server,
      description: description !== undefined ? description : (existing.description || ''),
    },
  };

  const resp = await client.post(`/api/unbound/settings/setHostOverride/${existing.uuid}`, payload);
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Updated DNS entry: ${c.cyan}${host}.${domain}${c.reset}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteEntry(host, domain) {
  const client   = getClient();
  const existing = await findHost(client, host, domain);
  if (!existing) throw new Error(`Entry not found: ${host}.${domain}`);

  const resp = await client.post(`/api/unbound/settings/delHostOverride/${existing.uuid}`);
  if (resp.data.result !== 'deleted') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Deleted DNS entry: ${c.cyan}${host}.${domain}${c.reset}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Add alias
// ---------------------------------------------------------------------------

async function addAlias({ host, domain, aliasHost, aliasDomain, description }) {
  const client = getClient();
  const parent = await findHost(client, host, domain);
  if (!parent) throw new Error(`Parent entry not found: ${host}.${domain}`);

  // Check if alias already exists
  const aliasResp = await client.post('/api/unbound/settings/searchHostAlias',
    { current: 1, rowCount: -1, searchPhrase: '' });
  const existing  = (aliasResp.data.rows || []).find(
    a => a.host === parent.uuid && a.hostname === aliasHost && a.domain === aliasDomain
  );
  if (existing) {
    console.log(`  ${c.blue}ℹ${c.reset} Alias already exists: ${c.cyan}${aliasHost}.${aliasDomain}${c.reset}`);
    return;
  }

  const payload = {
    alias: {
      enabled:     '1',
      host:        parent.uuid,
      hostname:    aliasHost,
      domain:      aliasDomain,
      description: description || '',
    },
  };

  const resp = await client.post('/api/unbound/settings/addHostAlias', payload);
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Added alias: ${c.cyan}${aliasHost}.${aliasDomain}${c.reset} ${c.gray}→ ${host}.${domain}${c.reset}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete alias
// ---------------------------------------------------------------------------

async function deleteAlias({ host, domain, aliasHost, aliasDomain }) {
  const client = getClient();
  const parent = await findHost(client, host, domain);
  if (!parent) throw new Error(`Parent entry not found: ${host}.${domain}`);

  const aliasResp = await client.post('/api/unbound/settings/searchHostAlias',
    { current: 1, rowCount: -1, searchPhrase: '' });
  const existing  = (aliasResp.data.rows || []).find(
    a => a.host === parent.uuid && a.hostname === aliasHost && a.domain === aliasDomain
  );
  if (!existing) throw new Error(`Alias not found: ${aliasHost}.${aliasDomain}`);

  const resp = await client.post(`/api/unbound/settings/delHostAlias/${existing.uuid}`);
  if (resp.data.result !== 'deleted') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Deleted alias: ${c.cyan}${aliasHost}.${aliasDomain}${c.reset}`);
  await applyChanges(client);
}

module.exports = { listEntries, addEntry, updateEntry, deleteEntry, addAlias, deleteAlias };
