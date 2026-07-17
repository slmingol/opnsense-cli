// Requires os-haproxy plugin installed on OPNsense.
// Architecture: Servers are standalone objects; backends link servers via UUIDs (linkedServers).
const { getClient } = require('./opnsense');
const dns = require('dns').promises;

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

async function applyChanges(client) {
  await client.post('/api/haproxy/service/reconfigure');
  console.log(`  ${c.gray}✓ HAProxy applied${c.reset}`);
}

// ---------------------------------------------------------------------------
// List backends
// ---------------------------------------------------------------------------

const SEARCH_BODY = { current: 1, rowCount: -1, searchPhrase: '' };

async function listBackends({ filter } = {}) {
  const client   = getClient();
  const bResp    = await client.post('/api/haproxy/settings/searchBackends', SEARCH_BODY);
  let   backends = bResp.data.rows || [];

  if (filter) {
    backends = backends.filter(b => b.name.toLowerCase().includes(filter.toLowerCase()));
  }

  // Fetch servers for display
  const sResp   = await client.post('/api/haproxy/settings/searchServers', SEARCH_BODY);
  const servers = sResp.data.rows || [];
  const byUuid  = {};
  for (const s of servers) byUuid[s.uuid] = s;

  console.log(`\n${c.bold}HAProxy Backends (${backends.length}):${c.reset}`);
  console.log(c.gray + '═'.repeat(80) + c.reset);
  console.log('');

  for (const [i, b] of backends.entries()) {
    console.log(`${c.gray}${i + 1}.${c.reset} ${c.bold}${c.cyan}${b.name}${c.reset}`);
    console.log(`   ${c.gray}Balance:${c.reset} ${b.balancerAlgorithm || 'roundrobin'}`);

    const linkedUuids = (b.linkedServers || '').split(',').filter(Boolean);
    if (linkedUuids.length > 0) {
      console.log(`   ${c.gray}Servers:${c.reset}`);
      for (const uuid of linkedUuids) {
        const s = byUuid[uuid];
        if (s) {
          const ssl = s.ssl === '1' ? ` ${c.yellow}[SSL]${c.reset}` : '';
          console.log(`     ${c.gray}-${c.reset} ${c.cyan}${s.name}${c.reset} ${c.gray}(${s.address}:${s.port})${c.reset}${ssl}`);
        } else {
          console.log(`     ${c.gray}- (uuid: ${uuid})${c.reset}`);
        }
      }
    } else {
      console.log(`   ${c.gray}Servers: none${c.reset}`);
    }
    console.log('');
  }

  console.log(c.gray + '═'.repeat(80) + c.reset);
  console.log(`${c.gray}Total: ${backends.length} backends${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Add backend (create standalone server + backend that links it)
// ---------------------------------------------------------------------------

async function addBackend({ name, serverName, serverAddress, serverPort, checkType = 'HTTP', balance = 'roundrobin', ssl = false }) {
  const client = getClient();

  // Check if backend already exists
  const bResp    = await client.post('/api/haproxy/settings/searchBackends', SEARCH_BODY);
  const existing = (bResp.data.rows || []).find(b => b.name === name);

  // Check if server already exists
  const sResp     = await client.post('/api/haproxy/settings/searchServers', SEARCH_BODY);
  const existSrv  = (sResp.data.rows || []).find(s => s.name === serverName);

  let serverUuid;
  if (existSrv) {
    serverUuid = existSrv.uuid;
    console.log(`  ${c.blue}ℹ${c.reset} Server already exists: ${c.cyan}${serverName}${c.reset}`);
  } else {
    const sAdd = await client.post('/api/haproxy/settings/addServer', {
      server: {
        enabled:   '1',
        name:      serverName,
        address:   serverAddress,
        port:      String(serverPort),
        ssl:       ssl ? '1' : '0',
        weight:    '1',
        checkType,
      },
    });
    serverUuid = sAdd.data.uuid;
    console.log(`  ${c.green}✓${c.reset} Created server: ${c.cyan}${serverName}${c.reset} ${c.gray}(${serverAddress}:${serverPort})${c.reset}`);
  }

  if (existing) {
    // Add server to existing backend by appending UUID to linkedServers
    const currentLinked = (existing.linkedServers || '').split(',').filter(Boolean);
    if (currentLinked.includes(serverUuid)) {
      console.log(`  ${c.blue}ℹ${c.reset} Server already linked to backend ${c.cyan}${name}${c.reset}`);
      return;
    }
    currentLinked.push(serverUuid);
    await client.post(`/api/haproxy/settings/setBackend/${existing.uuid}`, {
      backend: { ...existing, linkedServers: currentLinked.join(',') },
    });
    console.log(`  ${c.green}✓${c.reset} Linked server to existing backend ${c.cyan}${name}${c.reset}`);
  } else {
    await client.post('/api/haproxy/settings/addBackend', {
      backend: {
        enabled:            '1',
        name,
        balancerAlgorithm:  balance,
        healthCheckEnabled: '0',
        linkedServers:      serverUuid,
      },
    });
    console.log(`  ${c.green}✓${c.reset} Created backend: ${c.cyan}${name}${c.reset}`);
  }

  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete backend
// ---------------------------------------------------------------------------

async function deleteBackend(name) {
  const client = getClient();
  const bResp  = await client.post('/api/haproxy/settings/searchBackends', SEARCH_BODY);
  const b      = (bResp.data.rows || []).find(b => b.name === name);
  if (!b) throw new Error(`Backend not found: ${name}`);

  await client.post(`/api/haproxy/settings/delBackend/${b.uuid}`);
  await applyChanges(client);
  console.log(`  ${c.green}✓${c.reset} Deleted backend: ${c.cyan}${name}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Add frontend route (ACL + use_backend action)
// ---------------------------------------------------------------------------

async function addFrontendRoute({ frontendName, aclName, hostname, backendName }) {
  const client = getClient();

  // Get frontend
  const fResp    = await client.post('/api/haproxy/settings/searchFrontends', SEARCH_BODY);
  const frontend = (fResp.data.rows || []).find(f => f.name === frontendName);
  if (!frontend) throw new Error(`Frontend not found: ${frontendName}`);

  // Get backend UUID
  const bResp   = await client.post('/api/haproxy/settings/searchBackends', SEARCH_BODY);
  const backend = (bResp.data.rows || []).find(b => b.name === backendName);
  if (!backend) throw new Error(`Backend not found: ${backendName}`);

  // Add ACL
  const aclResp = await client.post('/api/haproxy/settings/searchAcls', SEARCH_BODY);
  const existAcl = (aclResp.data.rows || []).find(a => a.name === aclName && a.frontend === frontend.uuid);
  if (!existAcl) {
    await client.post('/api/haproxy/settings/addAcl', {
      acl: {
        enabled:    '1',
        name:       aclName,
        expression: 'hdr_beg_dom',
        value:      hostname,
        frontend:   frontend.uuid,
      },
    });
    console.log(`  ${c.green}✓${c.reset} Created ACL: ${c.cyan}${aclName}${c.reset}`);
  } else {
    console.log(`  ${c.blue}ℹ${c.reset} ACL already exists: ${c.cyan}${aclName}${c.reset}`);
  }

  // Add action
  const actResp  = await client.post('/api/haproxy/settings/searchActions', SEARCH_BODY);
  const existAct = (actResp.data.rows || []).find(
    a => a.frontend === frontend.uuid && a.acl === (existAcl?.uuid || '') && a.linkedBackend === backend.uuid
  );
  if (!existAct) {
    await client.post('/api/haproxy/settings/addAction', {
      action: {
        enabled:       '1',
        frontend:      frontend.uuid,
        type:          'use_backend',
        linkedAcl:     aclName,
        linkedBackend: backend.uuid,
      },
    });
    console.log(`  ${c.green}✓${c.reset} Created action: ${c.cyan}${hostname}${c.reset} ${c.gray}→${c.reset} ${c.cyan}${backendName}${c.reset}`);
  } else {
    console.log(`  ${c.blue}ℹ${c.reset} Action already exists`);
  }

  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete frontend route
// ---------------------------------------------------------------------------

async function deleteFrontendRoute({ frontendName, aclName }) {
  const client = getClient();

  const fResp    = await client.post('/api/haproxy/settings/searchFrontends', SEARCH_BODY);
  const frontend = (fResp.data.rows || []).find(f => f.name === frontendName);
  if (!frontend) throw new Error(`Frontend not found: ${frontendName}`);

  // Delete actions that reference this ACL
  const actResp = await client.post('/api/haproxy/settings/searchActions', SEARCH_BODY);
  const actions = (actResp.data.rows || []).filter(
    a => a.frontend === frontend.uuid && (a.linkedAcl === aclName || a.acl === aclName)
  );
  for (const a of actions) {
    await client.post(`/api/haproxy/settings/delAction/${a.uuid}`);
  }

  // Delete ACL
  const aclResp = await client.post('/api/haproxy/settings/searchAcls', SEARCH_BODY);
  const acl     = (aclResp.data.rows || []).find(a => a.name === aclName && a.frontend === frontend.uuid);
  if (acl) {
    await client.post(`/api/haproxy/settings/delAcl/${acl.uuid}`);
  } else {
    throw new Error(`ACL not found: ${aclName}`);
  }

  await applyChanges(client);
  console.log(`  ${c.green}✓${c.reset} Deleted frontend route for ACL: ${c.cyan}${aclName}${c.reset}`);
}

// ---------------------------------------------------------------------------
// Convert IP-based server addresses to DNS hostnames
// ---------------------------------------------------------------------------

async function resolveHostnameForIp(ip) {
  try {
    const hosts = await dns.reverse(ip);
    for (const host of hosts) {
      if (host.endsWith('.bub.lan')) {
        const addr = await dns.lookup(host, 4).then(r => r.address).catch(() => null);
        if (addr === ip) return host;
      }
    }
  } catch {}
  return null;
}

async function fixBackendDnsAddresses({ apply = false } = {}) {
  const client  = getClient();
  const sResp   = await client.post('/api/haproxy/settings/searchServers', SEARCH_BODY);
  const servers = sResp.data.rows || [];

  const IP_RE  = /^\d+\.\d+\.\d+\.\d+$/;
  const toUpdate = [];
  const skipped  = [];

  for (const server of servers) {
    if (!IP_RE.test(server.address)) continue;
    const hostname = await resolveHostnameForIp(server.address);
    if (hostname) toUpdate.push({ server, hostname });
    else skipped.push(server);
  }

  console.log(`\n${c.bold}HAProxy DNS conversion${apply ? '' : ' (dry-run)'}${c.reset}`);
  console.log(c.gray + '─'.repeat(72) + c.reset);

  if (toUpdate.length === 0 && skipped.length === 0) {
    console.log(`${c.green}Nothing to do -- all ${servers.length} server addresses are already hostnames.${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}Will convert (${toUpdate.length}):${c.reset}`);
  for (const { server, hostname } of toUpdate) {
    console.log(`  ${c.cyan}${server.name}${c.reset}  ${c.gray}${server.address}:${server.port}${c.reset}  →  ${c.green}${hostname}:${server.port}${c.reset}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${c.bold}No hostname found (${skipped.length}):${c.reset}`);
    for (const s of skipped) {
      console.log(`  ${c.yellow}${s.name}${c.reset}  ${c.gray}${s.address}:${s.port}${c.reset}`);
    }
  }

  if (!apply) {
    console.log(`\n${c.gray}Run with --apply to commit changes.${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}Applying...${c.reset}`);
  let ok = 0, fail = 0;
  for (const { server, hostname } of toUpdate) {
    try {
      await client.post(`/api/haproxy/settings/setServer/${server.uuid}`, {
        server: { ...server, address: hostname },
      });
      console.log(`  ${c.green}✓${c.reset} ${server.name}  ${c.gray}${server.address}${c.reset} → ${hostname}`);
      ok++;
    } catch (err) {
      console.log(`  ${c.yellow}✗${c.reset} ${server.name}  ${err.response?.data?.message || err.message}`);
      fail++;
    }
  }

  await applyChanges(client);
  console.log(`\n${c.gray}Done: ${ok} updated, ${fail} failed, ${skipped.length} skipped (no DNS).${c.reset}\n`);
}

module.exports = { listBackends, addBackend, deleteBackend, addFrontendRoute, deleteFrontendRoute, fixBackendDnsAddresses };
