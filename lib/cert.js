const fs   = require('fs');
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

function fmtExpiry(daysLeft) {
  if (daysLeft == null) return c.gray + '?' + c.reset;
  if (daysLeft < 0)    return c.red  + `EXPIRED (${Math.abs(daysLeft)}d ago)` + c.reset;
  if (daysLeft < 30)   return c.red  + `${daysLeft}d` + c.reset;
  if (daysLeft < 90)   return c.yellow + `${daysLeft}d` + c.reset;
  return c.green + `${daysLeft}d` + c.reset;
}

function tsToMs(ts) {
  if (!ts) return null;
  const n = Number(ts);
  return Number.isFinite(n) ? n * 1000 : new Date(ts).getTime();
}

function fmtDate(ts) {
  const ms = tsToMs(ts);
  if (!ms) return '?';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

async function findCert(client, name) {
  const resp  = await client.get('/api/trust/cert/search');
  const certs = resp.data.rows || [];
  const match = certs.filter(ct => ct.descr === name || ct.uuid === name);
  if (match.length === 0) throw new Error(`Certificate not found: ${name}`);
  if (match.length > 1)   throw new Error(`Multiple certificates match "${name}" — use --refid (uuid)`);
  return match[0];
}

function daysLeft(cert) {
  const ms = tsToMs(cert.valid_to);
  if (!ms) return null;
  return Math.floor((ms - Date.now()) / 86400000);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function listCerts({ filter, expiringDays } = {}) {
  const client = getClient();
  const resp   = await client.get('/api/trust/cert/search');
  let   certs  = resp.data.rows || [];

  if (filter) {
    const f = filter.toLowerCase();
    certs = certs.filter(ct => (ct.descr || '').toLowerCase().includes(f));
  }
  if (expiringDays != null) {
    certs = certs.filter(ct => {
      const d = daysLeft(ct);
      return d != null && d <= expiringDays;
    });
  }

  if (certs.length === 0) {
    console.log(filter || expiringDays != null ? 'No certificates match the filter.' : 'No certificates found.');
    return;
  }

  certs.sort((a, b) => (daysLeft(a) ?? Infinity) - (daysLeft(b) ?? Infinity));

  console.log(`\n${c.bold}Certificates (${certs.length}):${c.reset}`);
  console.log(c.gray + '─'.repeat(80) + c.reset);

  for (const ct of certs) {
    const dl   = daysLeft(ct);
    const type = ct.caref ? ` ${c.gray}[signed]${c.reset}` : ` ${c.gray}[${ct.type || 'cert'}]${c.reset}`;
    console.log(`\n  ${c.bold}${c.cyan}${ct.descr || '(unnamed)'}${c.reset}${type}`);
    console.log(`    uuid    : ${c.gray}${ct.uuid || '?'}${c.reset}`);
    console.log(`    expires : ${fmtExpiry(dl)}  ${c.gray}(${fmtDate(ct.valid_to)})${c.reset}`);
    if (ct.valid_from) console.log(`    issued  : ${c.gray}${fmtDate(ct.valid_from)}${c.reset}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function importCert({ name, certFile, keyFile }) {
  if (!name)     throw new Error('--name is required');
  if (!certFile) throw new Error('--cert is required');
  if (!keyFile)  throw new Error('--key is required');
  if (!fs.existsSync(certFile)) throw new Error(`Cert file not found: ${certFile}`);
  if (!fs.existsSync(keyFile))  throw new Error(`Key file not found: ${keyFile}`);

  // OPNsense trust/cert API takes raw PEM — the controller base64-encodes internally.
  // Do NOT pre-encode; double-encoding breaks the import.
  const crt_payload = fs.readFileSync(certFile, 'utf-8').trim();
  const prv_payload = fs.readFileSync(keyFile,  'utf-8').trim();

  const client = getClient();
  const resp   = await client.post('/api/trust/cert/add', {
    cert: { descr: name, action: 'import', crt_payload, prv_payload },
  });
  if (resp.data.result !== 'saved') throw new Error(JSON.stringify(resp.data));
  const uuid = resp.data.uuid;
  console.log(`  ${c.green}✓${c.reset} Imported certificate ${c.cyan}${name}${c.reset}${uuid ? c.gray + ' (' + uuid + ')' + c.reset : ''}`);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function deleteCert({ name, refid }) {
  const client = getClient();

  let uuid = refid;
  if (!uuid) {
    if (!name) throw new Error('Either --name or --refid (uuid) is required');
    const ct = await findCert(client, name);
    uuid = ct.uuid;
  }

  const resp = await client.post(`/api/trust/cert/del/${uuid}`);
  if (resp.data.result !== 'deleted') throw new Error(JSON.stringify(resp.data));
  console.log(`  ${c.green}✓${c.reset} Deleted certificate (uuid=${uuid})`);
}

// ---------------------------------------------------------------------------
// Check (monitoring)
// ---------------------------------------------------------------------------

async function checkCerts({ expiringDays = 30 } = {}) {
  const client = getClient();
  const resp   = await client.get('/api/trust/cert/search');
  const certs  = resp.data.rows || [];

  const expiring = certs.filter(ct => {
    const d = daysLeft(ct);
    return d != null && d <= expiringDays;
  });
  const expired = expiring.filter(ct => daysLeft(ct) < 0);
  const soon    = expiring.filter(ct => daysLeft(ct) >= 0);

  if (expiring.length === 0) {
    console.log(`OK: all ${certs.length} certificate(s) valid for more than ${expiringDays} days`);
    return;
  }

  const parts = [];
  if (expired.length) parts.push(`${expired.length} EXPIRED`);
  if (soon.length)    parts.push(`${soon.length} expiring within ${expiringDays}d`);
  console.log(`${c.red}${c.bold}CRITICAL: ${parts.join(', ')}${c.reset}`);

  expiring.sort((a, b) => (daysLeft(a) ?? 0) - (daysLeft(b) ?? 0));
  for (const ct of expiring) {
    const d   = daysLeft(ct);
    const tag = d < 0
      ? `${c.red}EXPIRED ${Math.abs(d)}d ago${c.reset}`
      : `${c.yellow}expires in ${d}d${c.reset}`;
    console.log(`  ${ct.descr || ct.uuid}  ${tag}`);
  }

  process.exit(1);
}

module.exports = { listCerts, importCert, deleteCert, checkCerts };
