// NordVPN WireGuard management for OPNsense.
// Note: OPNsense has no shell-exec API endpoint, so direct `wg set` kernel updates
// are not available. Only DB update + service reconfigure. Watchdog must be a cron
// job that calls `opnsense nordvpn:rotate-wg` instead of running inline wg commands.
const https = require('https');
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
// NordVPN API helpers (unchanged from pfSense version — external HTTPS)
// ---------------------------------------------------------------------------

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchNordVPNCreds(accessToken) {
  const auth = Buffer.from(`token:${accessToken}`).toString('base64');
  const data = await get('https://api.nordvpn.com/v1/users/services/credentials', {
    Authorization: `Basic ${auth}`,
    'User-Agent':  'opnsense-cli/nordvpn',
  });
  return {
    nordlynxPrivateKey: data.nordlynx_private_key,
    username:           data.username,
    password:           data.password,
  };
}

async function fetchNordVPNServers({ countryId = 228, limit = 5 } = {}) {
  const url =
    `https://api.nordvpn.com/v1/servers/recommendations` +
    `?filters[servers_technologies][identifier]=wireguard_udp` +
    `&filters[country_id]=${countryId}` +
    `&limit=${limit}`;

  const servers = await get(url);
  return servers.map(s => {
    const wg     = (s.technologies || []).find(t => t.identifier === 'wireguard_udp');
    const pubkey = wg?.metadata?.find(m => m.name === 'public_key')?.value || '';
    const ip     = s.station || (s.ips?.[0]?.ip?.ip) || '';
    return { name: s.name, ip, load: s.load, pubkey };
  });
}

// ---------------------------------------------------------------------------
// nordvpn:rotate-wg
// ---------------------------------------------------------------------------

async function rotateNordVPNWG({
  accessToken,
  countryId   = 228,
  serverName  = 'NordVPNWG01',
  gatewayName = 'NORDVPNWG_GW',
  dryRun      = false,
  force       = false,
}) {
  const client = getClient();

  console.log(`\n${c.bold}NordVPN WireGuard rotation (OPNsense)${c.reset}`);
  console.log(c.gray + '─'.repeat(52) + c.reset);

  // Check gateway status
  try {
    const gwResp = await client.get('/api/routes/gateway/status');
    const items  = gwResp.data.items || gwResp.data.dpinger || [];
    const gw     = items.find(g => g.name === gatewayName);
    if (!gw) {
      if (!force) { console.log(`  ${c.yellow}Gateway ${gatewayName} not found — skipping${c.reset}\n`); return; }
      console.log(`  ${c.yellow}Gateway ${gatewayName} not found — proceeding (--force)${c.reset}`);
    } else if (gw.status_translated !== 'Online' && gw.healthy !== true) {
      if (!force) { console.log(`  ${c.yellow}Gateway ${gatewayName} is not online — skipping${c.reset}\n`); return; }
      console.log(`  ${c.yellow}Gateway not online — proceeding (--force)${c.reset}`);
    } else {
      console.log(`  Gateway ${c.green}${gatewayName}${c.reset} is online`);
    }
  } catch (e) {
    if (!force) { console.log(`  ${c.yellow}Could not check gateway status: ${e.message}${c.reset}\n`); return; }
  }

  // Fetch best server
  process.stdout.write(`  Fetching server recommendations...`);
  const servers = await fetchNordVPNServers({ countryId });
  if (!servers.length) throw new Error('No NordVPN WireGuard servers returned');
  const best = servers.reduce((a, b) => (a.load <= b.load ? a : b));
  process.stdout.write(` done\n`);
  console.log(`  ${c.cyan}${best.name}${c.reset}  ${best.ip}  load ${best.load}%`);

  if (!best.ip)     throw new Error(`No IP for server ${best.name}`);
  if (!best.pubkey) throw new Error(`No public key for server ${best.name}`);

  if (dryRun) {
    console.log(`\n  ${c.yellow}Dry-run — would update peer to ${best.ip}:51820${c.reset}\n`);
    return;
  }

  // Find server instance
  const sResp  = await client.get('/api/wireguard/server/searchServer');
  const server = (sResp.data.rows || []).find(s => s.name === serverName);
  if (!server) throw new Error(`WireGuard server not found: ${serverName}`);

  // Find client (peer) linked to this server
  const cResp  = await client.get('/api/wireguard/client/searchClient');
  const peer   = (cResp.data.rows || []).find(p => (p.servers || '').includes(server.uuid));
  if (!peer) throw new Error(`No client found linked to server ${serverName}`);

  const oldEndpoint = `${peer.serveraddress}:${peer.serverport}`;
  if (peer.serveraddress === best.ip && String(peer.serverport) === '51820' && peer.pubkey === best.pubkey) {
    console.log(`\n  ${c.green}Already on best server${c.reset} (${best.ip}:51820)\n`);
    return;
  }

  // Update client
  process.stdout.write(`  ${oldEndpoint} → ${best.ip}:51820 ...`);
  await client.post(`/api/wireguard/client/setClient/${peer.uuid}`, {
    client: {
      ...peer,
      pubkey:        best.pubkey,
      serveraddress: best.ip,
      serverport:    '51820',
    },
  });
  await client.post('/api/wireguard/service/reconfigure');
  process.stdout.write(` done\n`);

  console.log(`\n${c.green}${c.bold}Rotation complete.${c.reset}  ${oldEndpoint} → ${best.ip}:51820\n`);
  console.log(`${c.gray}Note: OPNsense has no shell-exec API — kernel peer updated via reconfigure only.${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// nordvpn:creds
// ---------------------------------------------------------------------------

async function printNordVPNCreds(accessToken) {
  if (!accessToken) throw new Error('NordVPN access token required (NORDVPN_TOKEN env or --token)');
  const creds = await fetchNordVPNCreds(accessToken);
  console.log(`\n${c.bold}NordVPN WireGuard credentials${c.reset}`);
  console.log(c.gray + '─'.repeat(52) + c.reset);
  console.log(`  ${c.cyan}nordlynx_private_key${c.reset}: ${creds.nordlynxPrivateKey}`);
  console.log(`  ${c.cyan}username${c.reset}:             ${creds.username}`);
  console.log(`  ${c.cyan}password${c.reset}:             ${creds.password}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// nordvpn:servers
// ---------------------------------------------------------------------------

async function listNordVPNServers({ countryId = 228, limit = 10 } = {}) {
  const servers = await fetchNordVPNServers({ countryId, limit });
  console.log(`\n${c.bold}NordVPN WireGuard servers (country_id=${countryId})${c.reset}`);
  console.log(c.gray + '─'.repeat(60) + c.reset);
  for (const s of servers) {
    const loadColor = s.load < 40 ? c.green : s.load < 75 ? c.yellow : c.red;
    console.log(`  ${c.cyan}${s.name.padEnd(30)}${c.reset}  ${s.ip.padEnd(17)}  load ${loadColor}${String(s.load).padStart(3)}%${c.reset}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// nordvpn:teardown-wg
// ---------------------------------------------------------------------------

async function teardownNordVPNWG({
  serverName   = 'NordVPNWG01',
  gatewayName,
  deleteTunnel = false,
}) {
  const client    = getClient();
  const gwName    = gatewayName || `${serverName.toUpperCase()}_GW`;
  const rulePrefix = 'opn-nordvpn-wg-';

  console.log(`\n${c.bold}Tearing down ${serverName}...${c.reset}\n`);

  // Firewall rules
  try {
    const resp    = await client.post('/api/firewall/filter/search_rule');
    const matches = (resp.data.rows || []).filter(r => r.description && r.description.startsWith(rulePrefix));
    if (matches.length) {
      const spResp    = await client.post('/api/firewall/filter/savepoint');
      const savepoint = spResp.data.revision;
      for (const r of matches) {
        await client.post(`/api/firewall/filter/del_rule/${r.uuid}`);
        console.log(`  ${c.green}✓${c.reset} Removed rule: ${r.description}`);
      }
      await client.post(`/api/firewall/filter/apply/${savepoint}`);
      await client.post(`/api/firewall/filter/cancel_rollback/${savepoint}`);
      console.log(`  ${c.gray}✓ Firewall applied${c.reset}`);
    }
  } catch (e) { console.warn(`  ${c.yellow}warn${c.reset} Firewall: ${e.message}`); }

  // Outbound NAT
  try {
    const resp    = await client.post('/api/firewall/source_nat/search_rule');
    const matches = (resp.data.rows || []).filter(r => r.description && r.description.startsWith(rulePrefix));
    for (const m of matches) {
      await client.post(`/api/firewall/source_nat/del_rule/${m.uuid}`);
      console.log(`  ${c.green}✓${c.reset} Removed NAT rule: ${m.description}`);
    }
    if (matches.length) await client.post('/api/firewall/source_nat/apply/0');
  } catch (e) { console.warn(`  ${c.yellow}warn${c.reset} NAT: ${e.message}`); }

  // Gateway
  try {
    const resp = await client.get('/api/routing/settings/search_gateway');
    const gw   = (resp.data.rows || []).find(g => g.name === gwName);
    if (gw) {
      await client.post(`/api/routing/settings/del_gateway/${gw.uuid}`);
      await client.post('/api/routing/settings/reconfigure');
      console.log(`  ${c.green}✓${c.reset} Removed gateway: ${gwName}`);
    } else {
      console.log(`  ${c.blue}ℹ${c.reset} Gateway ${gwName} not found — skipped`);
    }
  } catch (e) { console.warn(`  ${c.yellow}warn${c.reset} Gateway: ${e.message}`); }

  // WireGuard peer + optionally server
  try {
    const sResp  = await client.get('/api/wireguard/server/searchServer');
    const server = (sResp.data.rows || []).find(s => s.name === serverName);
    if (server) {
      const cResp = await client.get('/api/wireguard/client/searchClient');
      const peers = (cResp.data.rows || []).filter(p => (p.servers || '').includes(server.uuid));
      for (const p of peers) {
        await client.post(`/api/wireguard/client/delClient/${p.uuid}`);
        console.log(`  ${c.green}✓${c.reset} Removed peer: ${p.name}`);
      }
      if (deleteTunnel) {
        await client.post(`/api/wireguard/server/delServer/${server.uuid}`);
        console.log(`  ${c.green}✓${c.reset} Deleted server: ${serverName}`);
      }
      if (peers.length || deleteTunnel) {
        await client.post('/api/wireguard/service/reconfigure');
        console.log(`  ${c.gray}✓ WireGuard reconfigured${c.reset}`);
      }
    } else {
      console.log(`  ${c.blue}ℹ${c.reset} Server ${serverName} not found — skipped`);
    }
  } catch (e) { console.warn(`  ${c.yellow}warn${c.reset} WireGuard: ${e.message}`); }

  console.log(`\n${c.green}${c.bold}Done.${c.reset}`);
  if (!deleteTunnel) console.log(`${c.gray}  Server ${serverName} left in place. Pass --delete-tunnel to remove it.${c.reset}\n`);
}

module.exports = {
  fetchNordVPNCreds,
  fetchNordVPNServers,
  rotateNordVPNWG,
  printNordVPNCreds,
  listNordVPNServers,
  teardownNordVPNWG,
};
