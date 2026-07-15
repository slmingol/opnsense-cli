const fs   = require('fs');
const path = require('path');
const { getClient } = require('./opnsense');
const { addEntry, addAlias } = require('./dns');
const { addBackend, addFrontendRoute } = require('./haproxy');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseJSON(filePath) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch (e) { throw new Error(`Invalid JSON in ${filePath}: ${e.message}`); }
  return Array.isArray(raw) ? { services: raw } : raw;
}

function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows    = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });

  const h = new Set(headers);
  if (h.has('alias') && h.has('port'))                    return { services: rows };
  if (h.has('host')  && h.has('domain') && h.has('ip'))   return { dns: rows };
  if (h.has('name')  && h.has('server') && h.has('port')) return { haproxy: rows };
  throw new Error(
    `Cannot infer record type from CSV headers: ${headers.join(', ')}\n` +
    `  Expected: alias+port (services), host+domain+ip (dns), or name+server+port (haproxy)`
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(data) {
  const errors = [];
  (data.services || []).forEach((s, i) => {
    if (!s.alias)       errors.push(`services[${i}]: missing alias`);
    if (!s.port)        errors.push(`services[${i}]: missing port`);
    if (!s.description) errors.push(`services[${i}]: missing description`);
    if (s.port && isNaN(parseInt(s.port))) errors.push(`services[${i}]: port must be a number`);
  });
  (data.dns || []).forEach((d, i) => {
    if (!d.host)   errors.push(`dns[${i}]: missing host`);
    if (!d.domain) errors.push(`dns[${i}]: missing domain`);
    if (!d.ip)     errors.push(`dns[${i}]: missing ip`);
    if (d.ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(d.ip)) errors.push(`dns[${i}]: ip "${d.ip}" not IPv4`);
  });
  (data.haproxy || []).forEach((h, i) => {
    if (!h.name)   errors.push(`haproxy[${i}]: missing name`);
    if (!h.server) errors.push(`haproxy[${i}]: missing server`);
    if (!h.port)   errors.push(`haproxy[${i}]: missing port`);
    if (h.port && isNaN(parseInt(h.port))) errors.push(`haproxy[${i}]: port must be a number`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Dry-run preview
// ---------------------------------------------------------------------------

function previewServices(services) {
  console.log(`\n${c.bold}Services (${services.length}):${c.reset}`);
  for (const s of services) {
    const hostBub = s.host_bub || 'docker-host-01-svcs';
    console.log(`  ${c.cyan}${s.alias}${c.reset}  port=${s.port}  "${s.description}"`);
    console.log(`    ${c.gray}DNS  ${s.alias}.bub.lan → ${hostBub}.bub.lan${c.reset}`);
    console.log(`    ${c.gray}HAProxy  ${s.alias} → ${s.alias}.bub.lan:${s.port}${c.reset}`);
  }
}

function previewDNS(entries) {
  console.log(`\n${c.bold}DNS entries (${entries.length}):${c.reset}`);
  for (const d of entries)
    console.log(`  ${c.cyan}${d.host}.${d.domain}${c.reset} → ${d.ip}${d.description ? `  ${c.gray}"${d.description}"${c.reset}` : ''}`);
}

function previewHAProxy(backends) {
  console.log(`\n${c.bold}HAProxy backends (${backends.length}):${c.reset}`);
  for (const h of backends) {
    const ssl = h.ssl === true || h.ssl === 'true';
    console.log(`  ${c.cyan}${h.name}${c.reset} → ${h.server}:${h.port}${ssl ? ` ${c.yellow}[SSL]${c.reset}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyServices(services) {
  console.log(`\n${c.bold}[Services]${c.reset}`);
  let ok = 0, fail = 0;
  for (const s of services) {
    const hostBub = s.host_bub || 'docker-host-01-svcs';
    const ssl     = s.ssl === true || s.ssl === 'true';
    console.log(`\n  ${c.cyan}${s.alias}${c.reset}  port=${s.port}${ssl ? ` ${c.yellow}[SSL]${c.reset}` : ''}`);
    try {
      await addAlias({ host: hostBub, domain: 'bub.lan', aliasHost: s.alias, aliasDomain: 'bub.lan', description: s.description });
      console.log(`    ${c.green}✓${c.reset} DNS ${s.alias}.bub.lan`);
      await addBackend({ name: s.alias, serverName: `${s.alias}.bub.lan`, serverAddress: `${s.alias}.bub.lan`, serverPort: parseInt(s.port), ssl });
      console.log(`    ${c.green}✓${c.reset} HAProxy backend :${s.port}`);
      ok++;
    } catch (e) {
      console.log(`    ${c.red}✗${c.reset} ${e.message}`);
      fail++;
    }
  }
  return { ok, fail };
}

async function applyDNS(entries) {
  console.log(`\n${c.bold}[DNS]${c.reset}`);
  let ok = 0, fail = 0;
  for (const d of entries) {
    try {
      await addEntry({ host: d.host, domain: d.domain, ip: d.ip, description: d.description || '' });
      console.log(`  ${c.green}✓${c.reset} ${d.host}.${d.domain} → ${d.ip}`);
      ok++;
    } catch (e) {
      console.log(`  ${c.red}✗${c.reset} ${d.host}.${d.domain}: ${e.message}`);
      fail++;
    }
  }
  return { ok, fail };
}

async function applyHAProxy(backends) {
  console.log(`\n${c.bold}[HAProxy]${c.reset}`);
  let ok = 0, fail = 0;
  for (const h of backends) {
    const ssl = h.ssl === true || h.ssl === 'true';
    try {
      await addBackend({ name: h.name, serverName: h.server, serverAddress: h.server, serverPort: parseInt(h.port), ssl });
      console.log(`  ${c.green}✓${c.reset} ${h.name} → ${h.server}:${h.port}`);
      ok++;
    } catch (e) {
      console.log(`  ${c.red}✗${c.reset} ${h.name}: ${e.message}`);
      fail++;
    }
  }
  return { ok, fail };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function bulkImport({ file, dryRun = false }) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  const ext = path.extname(file).toLowerCase();
  let   data;
  if      (ext === '.json') data = parseJSON(file);
  else if (ext === '.csv')  data = parseCSV(file);
  else throw new Error(`Unsupported file type: ${ext}  (use .json or .csv)`);

  const errors = validate(data);
  if (errors.length) {
    console.log(`\n${c.red}${c.bold}Validation errors (${errors.length}):${c.reset}`);
    errors.forEach(e => console.log(`  ${c.red}✗${c.reset} ${e}`));
    throw new Error('Validation failed — nothing applied');
  }

  const nS = (data.services || []).length;
  const nD = (data.dns      || []).length;
  const nH = (data.haproxy  || []).length;

  console.log(`\n${c.bold}Bulk import${c.reset}${dryRun ? `  ${c.yellow}[DRY RUN]${c.reset}` : ''}`);
  console.log(c.gray + '─'.repeat(56) + c.reset);
  if (nS) console.log(`  services : ${nS}`);
  if (nD) console.log(`  dns      : ${nD}`);
  if (nH) console.log(`  haproxy  : ${nH}`);
  console.log(`  total    : ${nS + nD + nH}`);

  if (dryRun) {
    if (data.services?.length) previewServices(data.services);
    if (data.dns?.length)      previewDNS(data.dns);
    if (data.haproxy?.length)  previewHAProxy(data.haproxy);
    console.log(`\n${c.yellow}Dry run — no changes applied.${c.reset}\n`);
    return;
  }

  let totalOk = 0, totalFail = 0;
  if (data.services?.length) { const r = await applyServices(data.services); totalOk += r.ok; totalFail += r.fail; }
  if (data.dns?.length)      { const r = await applyDNS(data.dns);           totalOk += r.ok; totalFail += r.fail; }
  if (data.haproxy?.length)  { const r = await applyHAProxy(data.haproxy);   totalOk += r.ok; totalFail += r.fail; }

  console.log(`\n${c.bold}Done.${c.reset}  ${c.green}${totalOk} succeeded${c.reset}${totalFail ? `  ${c.red}${totalFail} failed${c.reset}` : ''}\n`);
}

async function bulkExport({ output } = {}) {
  const client = getClient();

  // DNS host overrides
  const dnsResp = await client.get('/api/unbound/host/search');
  const dns     = (dnsResp.data.rows || []).map(e => {
    const entry = { host: e.hostname, domain: e.domain, ip: e.server };
    if (e.description) entry.description = e.description;
    return entry;
  });

  // HAProxy backends + servers
  const SEARCH_BODY = { current: 1, rowCount: -1, searchPhrase: '' };
  const bResp   = await client.post('/api/haproxy/settings/searchBackends', SEARCH_BODY);
  const sResp   = await client.post('/api/haproxy/settings/searchServers', SEARCH_BODY);
  const byUuid  = {};
  for (const s of (sResp.data.rows || [])) byUuid[s.uuid] = s;

  const haproxy = (bResp.data.rows || []).flatMap(b =>
    (b.linkedServers || '').split(',').filter(Boolean).map(uuid => {
      const s     = byUuid[uuid];
      const entry = { name: b.name, server: s?.address || '', port: s?.port || '' };
      if (s?.ssl === '1') entry.ssl = true;
      return entry;
    })
  );

  // HAProxy frontends (metadata only)
  const fResp     = await client.post('/api/haproxy/settings/searchFrontends', SEARCH_BODY);
  const aclResp   = await client.post('/api/haproxy/settings/searchAcls', SEARCH_BODY);
  const actResp   = await client.post('/api/haproxy/settings/searchActions', SEARCH_BODY);
  const acls      = aclResp.data.rows  || [];
  const actions   = actResp.data.rows  || [];
  const frontends = (fResp.data.rows   || []).map(f => ({
    name:    f.name,
    acls:    acls.filter(a => a.frontend === f.uuid).map(a => ({ name: a.name, value: a.value })),
    actions: actions.filter(a => a.frontend === f.uuid).map(a => ({ linkedAcl: a.linkedAcl, linkedBackend: a.linkedBackend })),
  }));

  const snapshot = {
    exported_at: new Date().toISOString(),
    dns,
    haproxy,
    frontends,
  };

  const json = JSON.stringify(snapshot, null, 2) + '\n';
  if (output) {
    fs.writeFileSync(output, json);
    console.log(`Exported ${dns.length} DNS entries, ${haproxy.length} HAProxy backend(s), ${frontends.length} frontend(s) → ${output}`);
  } else {
    process.stdout.write(json);
  }
}

module.exports = { bulkImport, bulkExport };
