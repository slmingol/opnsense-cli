// Kea DHCP backend. Requires: System > Settings > Administration > DHCP backend = Kea
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
// Helpers
// ---------------------------------------------------------------------------

// Returns all Kea subnets so we can resolve interface name → subnet UUID
async function fetchSubnets(client) {
  const resp = await client.post('/api/kea/dhcpv4/search_subnet',
    { current: 1, rowCount: -1, searchPhrase: '' });
  return resp.data.rows || [];
}

async function resolveSubnet(client, iface) {
  const subnets = await fetchSubnets(client);
  // Match by `interface` field (e.g. "lan") or `description`
  const match = subnets.find(s =>
    (s.interface || '').toLowerCase() === iface.toLowerCase() ||
    (s.description || '').toLowerCase() === iface.toLowerCase()
  );
  if (!match) {
    const names = subnets.map(s => s.interface || s.description || s.subnet).join(', ');
    throw new Error(`No Kea subnet found for interface "${iface}". Available: ${names}`);
  }
  return match;
}

async function fetchReservations(client, subnetUuid) {
  const resp = await client.post('/api/kea/dhcpv4/search_reservation', {
    current: 1, rowCount: -1,
    searchPhrase: '',
    subnet: subnetUuid || '',
  });
  return resp.data.rows || [];
}

async function findReservation(client, subnetUuid, mac) {
  const rows = await fetchReservations(client, subnetUuid);
  return rows.find(r => (r.hw_address || '').toLowerCase() === mac.toLowerCase()) || null;
}

async function applyChanges(client) {
  await client.post('/api/kea/service/reconfigure');
  console.log(`  ${c.gray}✓ Kea DHCP reconfigured${c.reset}`);
}

// ---------------------------------------------------------------------------
// List static mappings
// ---------------------------------------------------------------------------

async function listStaticMappings({ iface, filter } = {}) {
  const client  = getClient();
  const subnets = await fetchSubnets(client);

  const targetSubnets = iface
    ? subnets.filter(s =>
        (s.interface || '').toLowerCase() === iface.toLowerCase() ||
        (s.description || '').toLowerCase() === iface.toLowerCase()
      )
    : subnets;

  if (targetSubnets.length === 0) {
    console.log(iface ? `No Kea subnet found for interface "${iface}".` : 'No Kea subnets configured.');
    return;
  }

  let allReservations = [];
  for (const s of targetSubnets) {
    const rows = await fetchReservations(client, s.uuid);
    rows.forEach(r => { r._subnet = s.subnet; r._interface = s.interface || s.description; });
    allReservations.push(...rows);
  }

  if (filter) {
    const f = filter.toLowerCase();
    allReservations = allReservations.filter(r =>
      (r.hw_address  || '').toLowerCase().includes(f) ||
      (r.hostname    || '').toLowerCase().includes(f) ||
      (r.ip_address  || '').includes(f) ||
      (r.description || '').toLowerCase().includes(f)
    );
  }

  if (allReservations.length === 0) {
    console.log(filter ? `No reservations matching "${filter}".` : 'No DHCP reservations found.');
    return;
  }

  // Group by interface/subnet
  const byIface = {};
  for (const r of allReservations) {
    const key = r._interface || r._subnet || '?';
    (byIface[key] = byIface[key] || []).push(r);
  }

  console.log(`\n${c.bold}DHCP Reservations (${allReservations.length}):${c.reset}`);
  for (const [ifName, entries] of Object.entries(byIface)) {
    console.log(`\n  ${c.bold}${c.yellow}${ifName}${c.reset}  ${c.gray}(${entries.length} reservation${entries.length !== 1 ? 's' : ''})${c.reset}`);
    console.log('  ' + c.gray + '─'.repeat(68) + c.reset);
    for (const r of entries) {
      const ip       = r.ip_address  ? c.cyan  + r.ip_address  + c.reset : c.gray + '(dynamic)' + c.reset;
      const hostname = r.hostname    ? c.green + r.hostname    + c.reset : '';
      console.log(`  ${c.bold}${r.hw_address}${c.reset}  →  ${ip}  ${hostname}`);
      if (r.description) console.log(`    ${c.gray}${r.description}${c.reset}`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

async function addStaticMapping({ iface, mac, ip, hostname, description }) {
  if (!iface) throw new Error('--interface is required');
  if (!mac)   throw new Error('--mac is required');

  const client = getClient();
  const subnet = await resolveSubnet(client, iface);

  const payload = {
    reservation: {
      subnet:      subnet.uuid,
      hw_address:  mac.toLowerCase(),
      ip_address:  ip          || '',
      hostname:    hostname    || '',
      description: description || '',
    },
  };

  const resp = await client.post('/api/kea/dhcpv4/add_reservation', payload);
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));

  console.log(`  ${c.green}✓${c.reset} Added reservation ${c.cyan}${mac}${c.reset} → ${ip || '(any)'}${hostname ? ' (' + hostname + ')' : ''} on ${iface}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

async function updateStaticMapping({ iface, mac, ip, hostname, description }) {
  if (!iface) throw new Error('--interface is required');
  if (!mac)   throw new Error('--mac is required');

  const client  = getClient();
  const subnet  = await resolveSubnet(client, iface);
  const current = await findReservation(client, subnet.uuid, mac);
  if (!current) throw new Error(`No reservation found for MAC ${mac} on ${iface}`);

  const patch = { subnet: subnet.uuid };
  if (ip          != null) patch.ip_address  = ip;
  if (hostname    != null) patch.hostname    = hostname;
  if (description != null) patch.description = description;

  const resp = await client.post(`/api/kea/dhcpv4/set_reservation/${current.uuid}`, { reservation: patch });
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));

  console.log(`  ${c.green}✓${c.reset} Updated reservation ${c.cyan}${mac}${c.reset} on ${iface}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteStaticMapping({ iface, mac }) {
  if (!iface) throw new Error('--interface is required');
  if (!mac)   throw new Error('--mac is required');

  const client  = getClient();
  const subnet  = await resolveSubnet(client, iface);
  const current = await findReservation(client, subnet.uuid, mac);
  if (!current) throw new Error(`No reservation found for MAC ${mac} on ${iface}`);

  const resp = await client.post(`/api/kea/dhcpv4/del_reservation/${current.uuid}`);
  if (resp.data.result !== 'deleted') throw new Error(JSON.stringify(resp.data));

  console.log(`  ${c.green}✓${c.reset} Deleted reservation ${c.cyan}${mac}${c.reset} from ${iface}`);
  await applyChanges(client);
}

// ---------------------------------------------------------------------------
// List leases (read-only; works with Kea or legacy ISC DHCP)
// ---------------------------------------------------------------------------

// Lease backend selection: --backend flag > DHCP_BACKEND env var > 'kea'.
// ISC has no writable settings API, so leases are the only ISC operation here.
const LEASE_BACKENDS = {
  kea: { endpoint: '/api/kea/leases4/search',         label: 'Kea' },
  isc: { endpoint: '/api/dhcpv4/leases/search_lease', label: 'ISC' },
};

// Field names differ between the two lease endpoints; normalize to one shape.
function normalizeLease(r) {
  return {
    address:      r.address || '',
    mac:          r.mac || r.hwaddr || '',
    hostname:     r.hostname || r['client-hostname'] || '',
    state:        r.state || r.binding || '',
    status:       r.status || '',
    ends:         r.ends || r.expire || '',
    iface:        r.if_descr || r.if || '',
    type:         r.type || '',
    manufacturer: r.man || '',
  };
}

async function listLeases({ backend, filter } = {}) {
  const chosen = (backend || process.env.DHCP_BACKEND || 'kea').toLowerCase();
  const be     = LEASE_BACKENDS[chosen];
  if (!be) {
    throw new Error(`Unknown DHCP backend '${chosen}' (supported: ${Object.keys(LEASE_BACKENDS).join(', ')})`);
  }

  const client = getClient();
  const resp   = await client.post(be.endpoint, { current: 1, rowCount: -1, searchPhrase: '' });
  let leases   = (resp.data.rows || []).map(normalizeLease);

  if (filter) {
    const f = filter.toLowerCase();
    leases = leases.filter(l =>
      l.address.includes(f) ||
      l.mac.toLowerCase().includes(f) ||
      l.hostname.toLowerCase().includes(f) ||
      l.iface.toLowerCase().includes(f)
    );
  }

  if (leases.length === 0) {
    console.log(filter ? `No leases matching "${filter}".` : `No ${be.label} DHCP leases found.`);
    return;
  }

  // Group by interface
  const byIface = {};
  for (const l of leases) {
    const key = l.iface || '?';
    (byIface[key] = byIface[key] || []).push(l);
  }

  console.log(`\n${c.bold}${be.label} DHCP Leases (${leases.length}):${c.reset}`);
  for (const [ifName, entries] of Object.entries(byIface)) {
    console.log(`\n  ${c.bold}${c.yellow}${ifName}${c.reset}  ${c.gray}(${entries.length} lease${entries.length !== 1 ? 's' : ''})${c.reset}`);
    console.log('  ' + c.gray + '─'.repeat(68) + c.reset);
    for (const l of entries) {
      const hostname = l.hostname ? `  ${c.green}${l.hostname}${c.reset}` : '';
      const online   = l.status === 'online' ? `  ${c.green}●${c.reset}` : '';
      console.log(`  ${c.bold}${l.mac}${c.reset}  →  ${c.cyan}${l.address}${c.reset}${hostname}${online}`);
      const details = [l.state, l.type, l.ends && `expires ${l.ends}`, l.manufacturer]
        .filter(Boolean).join(' · ');
      if (details) console.log(`    ${c.gray}${details}${c.reset}`);
    }
  }
  console.log('');
}

module.exports = { listStaticMappings, addStaticMapping, updateStaticMapping, deleteStaticMapping, listLeases, normalizeLease };
