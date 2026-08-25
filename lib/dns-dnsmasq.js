// Dnsmasq DNS backend (OPNsense 25.7+ /api/dnsmasq endpoints).
//
// Host overrides are Dnsmasq "Hosts" entries. Aliases are stored in the
// entry's `cnames` field as comma-separated FQDNs, since Dnsmasq has no
// separate alias records like Unbound does.

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
  const resp = await client.post('/api/dnsmasq/settings/search_host',
    { current: 1, rowCount: -1, searchPhrase: '' });
  return resp.data.rows || [];
}

async function findHost(client, hostname, domain) {
  const rows = await searchHosts(client);
  return rows.find(r => r.host === hostname && r.domain === domain) || null;
}

async function applyChanges(client) {
  await client.post('/api/dnsmasq/service/reconfigure');
  console.log(`  ${c.gray}✓ Dnsmasq reconfigured${c.reset}`);
}

function splitList(value) {
  return value ? value.split(',').map(v => v.trim()).filter(Boolean) : [];
}

// Full host payload for set_host, preserving every field from the search row
// (DHCP reservation fields included) so a DNS edit never clobbers them.
function hostPayload(row, overrides = {}) {
  return {
    host: {
      host:       row.host,
      domain:     row.domain,
      local:      row.local ?? '1',
      ip:         row.ip || '',
      cnames:     row.cnames || '',
      client_id:  row.client_id || '',
      hwaddr:     row.hwaddr || '',
      lease_time: row.lease_time || '',
      ignore:     row.ignore ?? '0',
      set_tag:    row.set_tag || '',
      descr:      row.descr || '',
      comments:   row.comments || '',
      aliases:    row.aliases || '',
      ...overrides,
    },
  };
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
      (r.host   || '').toLowerCase().includes(f) ||
      (r.domain || '').toLowerCase().includes(f)
    );
  }

  if (rows.length === 0) { console.log('No entries found.'); return; }

  console.log(`\n${c.bold}DNS Host Override Entries:${c.reset}`);
  console.log(c.gray + '═'.repeat(80) + c.reset);

  rows.forEach((r, i) => {
    console.log(`\n${c.gray}${i + 1}.${c.reset} ${c.bold}${c.cyan}${r.host}.${r.domain}${c.reset}`);
    console.log(`   ${c.gray}IP:${c.reset}          ${r.ip}`);
    if (r.descr) console.log(`   ${c.gray}Description:${c.reset} ${r.descr}`);
    const aliasList = [...splitList(r.aliases), ...splitList(r.cnames)];
    if (aliasList.length > 0) {
      const names = aliasList.map(a => `${c.cyan}${a}${c.reset}`).join(', ');
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
      host,
      domain,
      local: '1',
      ip,
      descr: description || '',
    },
  };

  const resp = await client.post('/api/dnsmasq/settings/add_host', payload);
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

  const payload = hostPayload(existing, {
    ip:    ip ?? existing.ip,
    descr: description !== undefined ? description : (existing.descr || ''),
  });

  const resp = await client.post(`/api/dnsmasq/settings/set_host/${existing.uuid}`, payload);
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

  const resp = await client.post(`/api/dnsmasq/settings/del_host/${existing.uuid}`);
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

  const fqdn   = `${aliasHost}.${aliasDomain}`;
  const cnames = splitList(parent.cnames);
  if (cnames.includes(fqdn)) {
    console.log(`  ${c.blue}ℹ${c.reset} Alias already exists: ${c.cyan}${fqdn}${c.reset}`);
    return;
  }
  if (description) {
    console.log(`  ${c.yellow}⚠${c.reset} Dnsmasq CNAMEs have no per-alias description; ignoring.`);
  }

  cnames.push(fqdn);
  const payload = hostPayload(parent, { cnames: cnames.join(',') });

  const resp = await client.post(`/api/dnsmasq/settings/set_host/${parent.uuid}`, payload);
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Added alias: ${c.cyan}${fqdn}${c.reset} ${c.gray}→ ${host}.${domain}${c.reset}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete alias
// ---------------------------------------------------------------------------

async function deleteAlias({ host, domain, aliasHost, aliasDomain }) {
  const client = getClient();
  const parent = await findHost(client, host, domain);
  if (!parent) throw new Error(`Parent entry not found: ${host}.${domain}`);

  const fqdn   = `${aliasHost}.${aliasDomain}`;
  const cnames = splitList(parent.cnames);
  if (!cnames.includes(fqdn)) throw new Error(`Alias not found: ${fqdn}`);

  const payload = hostPayload(parent, {
    cnames: cnames.filter(n => n !== fqdn).join(','),
  });

  const resp = await client.post(`/api/dnsmasq/settings/set_host/${parent.uuid}`, payload);
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Deleted alias: ${c.cyan}${fqdn}${c.reset}`);
  await applyChanges(client);
}

module.exports = { listEntries, addEntry, updateEntry, deleteEntry, addAlias, deleteAlias };
