// DNS backend dispatcher: routes DNS commands to the resolver serving the
// firewall's host overrides (Unbound or Dnsmasq).
//
// Backend selection precedence: --backend flag > DNS_BACKEND env var > 'unbound'.

const unbound = require('./dns-unbound');
const dnsmasq = require('./dns-dnsmasq');

const BACKENDS = { unbound, dnsmasq };
const DEFAULT_BACKEND = 'unbound';

function resolveBackend(name) {
  const chosen = (name || process.env.DNS_BACKEND || DEFAULT_BACKEND).toLowerCase();
  const backend = BACKENDS[chosen];
  if (!backend) {
    throw new Error(
      `Unknown DNS backend '${chosen}' (supported: ${Object.keys(BACKENDS).join(', ')})`
    );
  }
  return backend;
}

module.exports = {
  listEntries: (filter, backend) => resolveBackend(backend).listEntries(filter),
  addEntry:    ({ backend, ...entry }) => resolveBackend(backend).addEntry(entry),
  updateEntry: ({ backend, ...entry }) => resolveBackend(backend).updateEntry(entry),
  deleteEntry: (host, domain, backend) => resolveBackend(backend).deleteEntry(host, domain),
  addAlias:    ({ backend, ...alias }) => resolveBackend(backend).addAlias(alias),
  deleteAlias: ({ backend, ...alias }) => resolveBackend(backend).deleteAlias(alias),
  getEntries:  (backend) => resolveBackend(backend).getEntries(),
};
