const { getClient } = require('./opnsense');

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  gray:   '\x1b[90m',
};

// OPNsense 26.x has no REST API for config backup history.
// The feature is web-UI only at Diagnostics > Configuration History.
// These functions tell the user that and provide an alternative download link.

async function listConfigHistory({ limit } = {}) {
  const client = getClient();
  const host   = process.env.OPNSENSE_HOST;

  // Try the endpoint; if 404 (expected), explain and exit
  try {
    const resp = await client.get('/api/core/backup/search');
    let revs   = resp.data.rows || [];
    revs.sort((a, b) => (b.mtime || b.time || 0) - (a.mtime || a.time || 0));
    if (limit && limit > 0) revs = revs.slice(0, limit);
    if (revs.length === 0) { console.log('No config backup revisions found.'); return revs; }

    console.log(`\n${c.bold}Config Backup Revisions (${revs.length}):${c.reset}`);
    console.log(c.gray + '─'.repeat(80) + c.reset);
    for (const r of revs) {
      const ts  = r.mtime ? new Date(r.mtime * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '') : '?';
      const age = r.mtime ? ` (${Math.floor((Date.now() / 1000 - r.mtime) / 86400)}d ago)` : '';
      console.log(`  ${c.cyan}${ts}${c.reset}${c.gray}${age}${c.reset}`);
      if (r.description) console.log(`    ${c.gray}${r.description}${c.reset}`);
    }
    console.log('');
    return revs;
  } catch (e) {
    if (e.response?.status === 404) {
      console.log(`\n${c.yellow}Config backup history REST API not available on this OPNsense version.${c.reset}`);
      console.log(`\nManage config history in the web UI:`);
      console.log(`  ${c.cyan}${host}/ui/core/config_history${c.reset}`);
      console.log(`\nDownload current config directly:`);
      console.log(`  ${c.cyan}${host}/api/core/firmware/info${c.reset}\n`);
      return [];
    }
    throw e;
  }
}

async function pruneConfigHistory({ olderThanDays, keepLast }) {
  if (olderThanDays == null && keepLast == null) {
    throw new Error('Either --older-than or --keep-last is required');
  }

  const client = getClient();
  let revs;
  try {
    const resp = await client.get('/api/core/backup/search');
    revs = resp.data.rows || [];
  } catch (e) {
    if (e.response?.status === 404) {
      console.log(`\n${c.yellow}Config backup history REST API not available on this OPNsense version.${c.reset}`);
      console.log(`Manage config history at: ${process.env.OPNSENSE_HOST}/ui/core/config_history\n`);
      return;
    }
    throw e;
  }

  if (revs.length === 0) { console.log('No revisions to prune.'); return; }

  revs.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));

  let toDelete = [];
  if (keepLast != null) {
    toDelete = revs.slice(keepLast);
  } else {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    toDelete = revs.filter(r => r.mtime && r.mtime < cutoff);
  }

  if (toDelete.length === 0) { console.log('No revisions matched the prune criteria.'); return; }

  console.log(`\nPruning ${toDelete.length} revision${toDelete.length !== 1 ? 's' : ''}...`);
  let ok = 0, fail = 0;

  for (const r of toDelete) {
    const id = r.id || r.mtime;
    try {
      await client.post(`/api/core/backup/deleteBackup/${id}`);
      const ts = r.mtime ? new Date(r.mtime * 1000).toISOString().split('T')[0] : id;
      console.log(`  ${c.green}✓${c.reset} Deleted revision ${c.gray}${ts}${r.description ? ' — ' + r.description : ''}${c.reset}`);
      ok++;
    } catch (e) {
      console.log(`  ${c.red}✗${c.reset} Failed to delete id=${id}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\n  Pruned ${c.green}${ok}${c.reset}${fail ? `  failed ${c.red}${fail}${c.reset}` : ''}\n`);
}

module.exports = { listConfigHistory, pruneConfigHistory };
