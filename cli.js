#!/usr/bin/env node

const { Command } = require('commander');
const { listEntries, addEntry, updateEntry, deleteEntry, addAlias, deleteAlias: deleteDnsAlias } = require('./lib/dns');
const { listBackends, addBackend, deleteBackend, addFrontendRoute, deleteFrontendRoute, fixBackendDnsAddresses, inspectBackend, applyHaproxy, restartHaproxy } = require('./lib/haproxy');
const { listTunnels, applyProtonVPN, teardownProtonVPN } = require('./lib/wireguard');
const { listAliases, createOrUpdateAlias, addAliasHost, removeAliasHost, deleteAlias,
        listRules, addRule, deleteRule, updateRule } = require('./lib/firewall');
const { rotateNordVPNWG, printNordVPNCreds, listNordVPNServers, teardownNordVPNWG } = require('./lib/nordvpn');
const { bulkImport, bulkExport } = require('./lib/bulk');
const { listCerts, importCert, deleteCert, checkCerts } = require('./lib/cert');
const { listStaticMappings, addStaticMapping, updateStaticMapping, deleteStaticMapping } = require('./lib/dhcp');
const { listConfigHistory, pruneConfigHistory } = require('./lib/config');
const fs = require('fs');
const packageJson = require('./package.json');

const program = new Command();

program
  .name('opnsense')
  .description('CLI tool to manage OPNsense via REST API')
  .version(packageJson.version);

// ---------------------------------------------------------------------------
// DNS (Unbound host overrides)
// ---------------------------------------------------------------------------

program
  .command('list')
  .description('List DNS host override entries')
  .option('-f, --filter <hostname>', 'Filter by hostname or domain')
  .action(async (options) => {
    try { await listEntries(options.filter); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('add')
  .description('Add a DNS host override entry')
  .requiredOption('-h, --host <hostname>', 'Hostname')
  .requiredOption('-d, --domain <domain>', 'Domain')
  .requiredOption('-i, --ip <ip>', 'IP address')
  .option('-D, --description <description>', 'Description')
  .action(async (options) => {
    try { await addEntry({ host: options.host, domain: options.domain, ip: options.ip, description: options.description || '' }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('update')
  .description('Update a DNS host override entry')
  .requiredOption('-h, --host <hostname>', 'Hostname to update')
  .requiredOption('-d, --domain <domain>', 'Domain to update')
  .option('-i, --ip <ip>', 'New IP address')
  .option('-D, --description <description>', 'New description')
  .action(async (options) => {
    try { await updateEntry({ host: options.host, domain: options.domain, ip: options.ip, description: options.description }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('delete')
  .description('Delete a DNS host override entry')
  .requiredOption('-h, --host <hostname>', 'Hostname')
  .requiredOption('-d, --domain <domain>', 'Domain')
  .action(async (options) => {
    try { await deleteEntry(options.host, options.domain); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('alias:add')
  .description('Add a DNS alias to an existing host override')
  .requiredOption('-h, --host <hostname>', 'Parent hostname')
  .requiredOption('-d, --domain <domain>', 'Parent domain')
  .requiredOption('-a, --alias-host <alias>', 'Alias hostname')
  .requiredOption('-A, --alias-domain <alias-domain>', 'Alias domain')
  .option('-D, --description <description>', 'Alias description')
  .action(async (options) => {
    try { await addAlias({ host: options.host, domain: options.domain, aliasHost: options.aliasHost, aliasDomain: options.aliasDomain, description: options.description || '' }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('alias:delete')
  .description('Delete a DNS alias from a host override')
  .requiredOption('-h, --host <hostname>', 'Parent hostname')
  .requiredOption('-d, --domain <domain>', 'Parent domain')
  .requiredOption('-a, --alias-host <alias>', 'Alias hostname to delete')
  .requiredOption('-A, --alias-domain <alias-domain>', 'Alias domain to delete')
  .action(async (options) => {
    try { await deleteDnsAlias({ host: options.host, domain: options.domain, aliasHost: options.aliasHost, aliasDomain: options.aliasDomain }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// HAProxy
// ---------------------------------------------------------------------------

program
  .command('haproxy:list')
  .description('List HAProxy backends')
  .option('-f, --filter <name>', 'Filter by backend name')
  .action(async (options) => {
    try { await listBackends({ filter: options.filter }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:add')
  .description('Add a HAProxy backend with a server')
  .requiredOption('-n, --name <name>', 'Backend name')
  .requiredOption('-s, --server-name <name>', 'Server name')
  .requiredOption('-a, --server-address <address>', 'Server address (hostname or IP)')
  .requiredOption('-p, --server-port <port>', 'Server port')
  .option('-b, --balance <type>', 'Load balance algorithm', 'roundrobin')
  .option('-c, --check-type <type>', 'Health check type', 'HTTP')
  .option('--ssl', 'Enable SSL for backend server', false)
  .action(async (options) => {
    try { await addBackend({ name: options.name, serverName: options.serverName, serverAddress: options.serverAddress, serverPort: parseInt(options.serverPort), balance: options.balance, checkType: options.checkType, ssl: options.ssl }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:delete')
  .description('Delete a HAProxy backend')
  .requiredOption('-n, --name <name>', 'Backend name')
  .action(async (options) => {
    try { await deleteBackend(options.name); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:route-add')
  .description('Add a frontend ACL and action to route to a backend')
  .requiredOption('-f, --frontend <name>', 'Frontend name')
  .requiredOption('-a, --acl <name>', 'ACL name')
  .requiredOption('-H, --hostname <hostname>', 'Hostname to match')
  .requiredOption('-b, --backend <name>', 'Backend name to route to')
  .action(async (options) => {
    try { await addFrontendRoute({ frontendName: options.frontend, aclName: options.acl, hostname: options.hostname, backendName: options.backend }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:route-delete')
  .description('Delete a frontend ACL and action')
  .requiredOption('-f, --frontend <name>', 'Frontend name')
  .requiredOption('-a, --acl <name>', 'ACL name')
  .action(async (options) => {
    try { await deleteFrontendRoute({ frontendName: options.frontend, aclName: options.acl }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:use-dns')
  .description('Convert HAProxy server addresses from IPs to .bub.lan hostnames (dry-run by default)')
  .option('--apply', 'Commit changes to OPNsense', false)
  .action(async (options) => {
    try { await fixBackendDnsAddresses({ apply: options.apply }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:inspect')
  .description('Dump raw JSON for a named backend and its linked servers')
  .requiredOption('-n, --name <name>', 'Backend name')
  .action(async (options) => {
    try { await inspectBackend({ name: options.name }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:apply')
  .description('Apply pending HAProxy config changes (reconfigure)')
  .action(async () => {
    try { await applyHaproxy(); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('haproxy:restart')
  .description('Restart the HAProxy service')
  .action(async () => {
    try { await restartHaproxy(); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// WireGuard
// ---------------------------------------------------------------------------

program
  .command('wg:status')
  .description('List WireGuard server instances and clients (peers)')
  .action(async () => {
    try { await listTunnels(); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('wg:provision <conf-file>')
  .alias('wg:apply')
  .description('Zero-touch ProtonVPN WireGuard setup from a .conf file')
  .option('-n, --server-name <name>',   'WireGuard server instance name',          'ProtonVPN01')
  .option('-c, --client-name <name>',   'WireGuard client (peer) name (default: <server>-Server)')
  .option('-g, --gateway-name <name>',  'Gateway name (default: <SERVER>_GW)')
  .option('--gw-group <name>',          'Gateway group name for failover',           'ProtonVPN_GWGrp')
  .option('-p, --listen-port <port>',   'WireGuard listen port',                    '51821')
  .option('-m, --mtu <bytes>',          'WireGuard MTU',                            '1420')
  .option('--monitor-ip <ip>',          'Gateway monitor IP',                        '1.1.1.1')
  .option('-s, --lan-subnet <cidr>',    'LAN subnet for outbound NAT',               '192.168.7.0/24')
  .option('-k, --kill-switch <host>',   'Kill-switch host (repeatable)', (v, a) => { a.push(v); return a; }, [])
  .option('--ks-alias <name>',          'Firewall alias to use for kill-switch (creates if missing)')
  .option('-l, --lan <iface>',          'LAN interface name',                        'lan')
  .option('--dry-run',                  'Print planned changes without applying')
  .action(async (confFile, options) => {
    try {
      if (!fs.existsSync(confFile)) { console.error(`Error: Config file not found: ${confFile}`); process.exit(1); }
      await applyProtonVPN({
        confFile,
        serverName:      options.serverName,
        clientName:      options.clientName,
        gatewayName:     options.gatewayName,
        gwGroupName:     options.gwGroup,
        listenPort:      parseInt(options.listenPort, 10),
        mtu:             parseInt(options.mtu, 10),
        monitorIP:       options.monitorIp,
        lanSubnet:       options.lanSubnet,
        killSwitchHosts: options.killSwitch,
        killSwitchAlias: options.ksAlias || null,
        lanIface:        options.lan,
        dryRun:          !!options.dryRun,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('wg:teardown')
  .description('Remove ProtonVPN WireGuard rules, gateway, and peer')
  .option('-n, --server-name <name>',   'Server instance name', 'ProtonVPN01')
  .option('-g, --gateway-name <name>',  'Gateway name (default: <SERVER>_GW)')
  .option('--ks-alias <name>',          'Also delete the named kill-switch alias')
  .action(async (options) => {
    try {
      await teardownProtonVPN({
        serverName:     options.serverName,
        gatewayName:    options.gatewayName,
        killSwitchAlias: options.ksAlias || null,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// NordVPN
// ---------------------------------------------------------------------------

program
  .command('nordvpn:rotate-wg')
  .description('Rotate NordVPN WireGuard client to the lowest-load server')
  .option('--token <token>',            'NordVPN access token (default: NORDVPN_TOKEN env var)')
  .option('--country-id <id>',          'NordVPN country ID (228 = US)',            '228')
  .option('-n, --server-name <name>',   'WireGuard server instance name',           'NordVPNWG01')
  .option('-g, --gateway-name <gw>',    'Gateway name to check before rotating',    'NORDVPNWG_GW')
  .option('--dry-run',                  'Print planned change without applying')
  .option('--force',                    'Rotate even if gateway is currently down')
  .action(async (options) => {
    try {
      await rotateNordVPNWG({
        accessToken: options.token || process.env.NORDVPN_TOKEN,
        countryId:   parseInt(options.countryId, 10),
        serverName:  options.serverName,
        gatewayName: options.gatewayName,
        dryRun:      !!options.dryRun,
        force:       !!options.force,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('nordvpn:creds')
  .description('Fetch NordVPN WireGuard credentials (nordlynx_private_key) from the API')
  .option('--token <token>', 'NordVPN access token (default: NORDVPN_TOKEN env var)')
  .action(async (options) => {
    try { await printNordVPNCreds(options.token || process.env.NORDVPN_TOKEN); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('nordvpn:servers')
  .description('List recommended NordVPN WireGuard servers for a country')
  .option('--country-id <id>', 'NordVPN country ID (228 = US)', '228')
  .option('-n, --limit <n>',   'Number of servers to show',     '10')
  .action(async (options) => {
    try { await listNordVPNServers({ countryId: parseInt(options.countryId, 10), limit: parseInt(options.limit, 10) }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('nordvpn:teardown-wg')
  .description('Remove NordVPN WireGuard rules, gateway, NAT, and peer')
  .option('-n, --server-name <name>',   'WireGuard server instance name',  'NordVPNWG01')
  .option('-g, --gateway-name <name>',  'Gateway name (default: <SERVER>_GW)')
  .option('--delete-tunnel',            'Also delete the WireGuard server instance')
  .action(async (options) => {
    try {
      await teardownNordVPNWG({
        serverName:   options.serverName,
        gatewayName:  options.gatewayName,
        deleteTunnel: !!options.deleteTunnel,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// Firewall rules
// ---------------------------------------------------------------------------

program
  .command('fw-rule:list')
  .description('List OPNsense firewall rules (Automation/filter rules)')
  .option('-f, --filter <text>',     'Filter by description')
  .option('-i, --interface <iface>', 'Filter by interface')
  .option('-t, --type <type>',       'Filter by action: pass | block | reject')
  .action(async (options) => {
    try { await listRules({ filter: options.filter, iface: options.interface, type: options.type }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-rule:add')
  .description('Add a firewall rule (Automation/filter rules)')
  .requiredOption('-t, --type <type>',           'Action: pass | block | reject')
  .requiredOption('-i, --interface <iface>',      'Interface (e.g. lan, wan)')
  .option('--direction <dir>',                   'Direction: in | out', 'in')
  .option('-s, --source <src>',                  'Source IP, CIDR, alias, or "any"', 'any')
  .option('--source-port <port>',                'Source port or range')
  .option('-d, --destination <dst>',             'Destination IP, CIDR, alias, or "any"', 'any')
  .option('--dest-port <port>',                  'Destination port or range')
  .option('-p, --protocol <proto>',              'Protocol: tcp | udp | tcp/udp | icmp | any')
  .option('--ip-version <ver>',                  'IP version: inet | inet6 | inet46', 'inet')
  .option('-g, --gateway <name>',                'Gateway name (policy routing)')
  .option('-D, --description <text>',            'Rule description')
  .option('--log',                               'Enable rule logging')
  .option('--disabled',                          'Create rule in disabled state')
  .action(async (options) => {
    try {
      await addRule({
        type:        options.type,
        iface:       options.interface,
        direction:   options.direction,
        source:      options.source,
        sourcePort:  options.sourcePort,
        destination: options.destination,
        destPort:    options.destPort,
        protocol:    options.protocol,
        ipprotocol:  options.ipVersion,
        gateway:     options.gateway,
        description: options.description || '',
        log:         !!options.log,
        disabled:    !!options.disabled,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-rule:delete')
  .description('Delete a firewall rule by UUID or description')
  .option('-i, --id <uuid>',            'Rule UUID (from fw-rule:list)')
  .option('-D, --description <text>',   'Exact rule description (used if --id not given)')
  .action(async (options) => {
    try { await deleteRule({ id: options.id, description: options.description }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-rule:update')
  .description('Update fields on an existing firewall rule')
  .option('-i, --id <uuid>',            'Rule UUID (from fw-rule:list)')
  .option('-D, --description <text>',   'Exact rule description to look up')
  .option('-t, --type <type>',          'New action: pass | block | reject')
  .option('--interface <iface>',        'New interface')
  .option('-s, --source <src>',         'New source')
  .option('-d, --destination <dst>',    'New destination')
  .option('-p, --protocol <proto>',     'New protocol')
  .option('-g, --gateway <name>',       'New gateway')
  .option('--enable',                   'Enable the rule')
  .option('--disable',                  'Disable the rule')
  .option('--descr <text>',             'New description')
  .action(async (options) => {
    try {
      const disabled = options.disable ? true : options.enable ? false : undefined;
      await updateRule({ id: options.id, description: options.description, type: options.type, iface: options.interface, source: options.source, destination: options.destination, protocol: options.protocol, gateway: options.gateway, disabled, descr: options.descr });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// Firewall aliases
// ---------------------------------------------------------------------------

program
  .command('fw-alias:list')
  .description('List firewall aliases')
  .option('-f, --filter <text>', 'Filter by name or description')
  .action(async (options) => {
    try { await listAliases({ filter: options.filter }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-alias:create')
  .description('Create or update a firewall alias')
  .requiredOption('-n, --name <name>',        'Alias name')
  .option('-t, --type <type>',                'Alias type: host | network | port', 'host')
  .option('-D, --description <description>',  'Alias description')
  .option('-H, --host <ip>',                  'Host/IP to include (repeatable)', (v, a) => { a.push(v); return a; }, [])
  .action(async (options) => {
    try { await createOrUpdateAlias({ name: options.name, type: options.type, description: options.description || '', hosts: options.host }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-alias:add-host')
  .description('Add a host/IP to an existing firewall alias')
  .requiredOption('-n, --name <name>',  'Alias name')
  .requiredOption('-H, --host <ip>',    'Host or IP to add')
  .option('-d, --detail <comment>',     'Comment for this entry')
  .action(async (options) => {
    try { await addAliasHost({ name: options.name, host: options.host, detail: options.detail || '' }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-alias:remove-host')
  .description('Remove a host/IP from a firewall alias')
  .requiredOption('-n, --name <name>',  'Alias name')
  .requiredOption('-H, --host <ip>',    'Host or IP to remove')
  .action(async (options) => {
    try { await removeAliasHost({ name: options.name, host: options.host }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('fw-alias:delete')
  .description('Delete a firewall alias')
  .requiredOption('-n, --name <name>', 'Alias name')
  .action(async (options) => {
    try { await deleteAlias({ name: options.name }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// DHCP (Kea)
// ---------------------------------------------------------------------------

program
  .command('dhcp:list')
  .description('List Kea DHCP reservations')
  .option('-i, --interface <iface>', 'Filter by interface/subnet (e.g. lan, opt1)')
  .option('-f, --filter <text>',     'Filter by MAC, IP, hostname, or description')
  .action(async (options) => {
    try { await listStaticMappings({ iface: options.interface, filter: options.filter }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('dhcp:add')
  .description('Add a Kea DHCP reservation (MAC → IP)')
  .requiredOption('-i, --interface <iface>', 'Interface/subnet name (e.g. lan, opt1)')
  .requiredOption('-m, --mac <mac>',         'MAC address')
  .option('-a, --ip <ip>',                   'IP address to assign')
  .option('-H, --hostname <name>',           'Hostname')
  .option('-D, --description <text>',        'Description')
  .action(async (options) => {
    try { await addStaticMapping({ iface: options.interface, mac: options.mac, ip: options.ip, hostname: options.hostname, description: options.description }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('dhcp:update')
  .description('Update an existing Kea DHCP reservation')
  .requiredOption('-i, --interface <iface>', 'Interface/subnet name')
  .requiredOption('-m, --mac <mac>',         'MAC address to look up')
  .option('-a, --ip <ip>',                   'New IP address')
  .option('-H, --hostname <name>',           'New hostname')
  .option('-D, --description <text>',        'New description')
  .action(async (options) => {
    try { await updateStaticMapping({ iface: options.interface, mac: options.mac, ip: options.ip, hostname: options.hostname, description: options.description }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('dhcp:delete')
  .description('Delete a Kea DHCP reservation')
  .requiredOption('-i, --interface <iface>', 'Interface/subnet name')
  .requiredOption('-m, --mac <mac>',         'MAC address')
  .action(async (options) => {
    try { await deleteStaticMapping({ iface: options.interface, mac: options.mac }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

program
  .command('cert:list')
  .description('List certificates with expiry information')
  .option('-f, --filter <text>',   'Filter by certificate name')
  .option('-e, --expiring <days>', 'Show only certificates expiring within N days')
  .action(async (options) => {
    try { await listCerts({ filter: options.filter, expiringDays: options.expiring != null ? parseInt(options.expiring, 10) : undefined }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('cert:import')
  .description('Import a certificate and private key into OPNsense')
  .requiredOption('-n, --name <name>', 'Certificate name')
  .requiredOption('-c, --cert <file>', 'Path to PEM certificate file')
  .requiredOption('-k, --key <file>',  'Path to PEM private key file')
  .action(async (options) => {
    try { await importCert({ name: options.name, certFile: options.cert, keyFile: options.key }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('cert:delete')
  .description('Delete a certificate')
  .option('-n, --name <name>',   'Certificate name (exact match)')
  .option('-r, --refid <uuid>',  'Certificate UUID (from cert:list)')
  .action(async (options) => {
    try { await deleteCert({ name: options.name, refid: options.refid }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('cert:check')
  .description('Exit 1 if any certificate expires within N days (for monitoring)')
  .option('-e, --expiring <days>', 'Threshold in days', '30')
  .action(async (options) => {
    try { await checkCerts({ expiringDays: parseInt(options.expiring, 10) }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// Config backup/history
// ---------------------------------------------------------------------------

program
  .command('config:history')
  .description('List OPNsense configuration backup revisions')
  .option('-n, --limit <n>', 'Show only the N most recent revisions')
  .action(async (options) => {
    try { await listConfigHistory({ limit: options.limit ? parseInt(options.limit, 10) : undefined }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('config:history-prune')
  .description('Delete old OPNsense config backup revisions')
  .option('--older-than <days>', 'Delete revisions older than N days')
  .option('--keep-last <n>',     'Keep only the N most recent revisions')
  .action(async (options) => {
    try {
      await pruneConfigHistory({
        olderThanDays: options.olderThan ? parseInt(options.olderThan, 10) : undefined,
        keepLast:      options.keepLast  ? parseInt(options.keepLast, 10)  : undefined,
      });
    } catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

program
  .command('bulk:import <file>')
  .description('Bulk import DNS entries and/or HAProxy backends from a JSON or CSV file')
  .option('--dry-run', 'Preview without applying changes')
  .action(async (file, options) => {
    try { await bulkImport({ file, dryRun: !!options.dryRun }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program
  .command('bulk:export')
  .description('Export current DNS entries and HAProxy backends to JSON')
  .option('-o, --output <file>', 'Write output to file instead of stdout')
  .action(async (options) => {
    try { await bulkExport({ output: options.output }); }
    catch (e) { console.error('Error:', e.message); process.exit(1); }
  });

program.parse();
