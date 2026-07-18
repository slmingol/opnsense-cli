# OPNsense CLI

```
   ____  ____  _   __                             ________    ____
  / __ \/ __ \/ | / /_______  ____  ________     / ____/ /   /  _/
 / / / / /_/ /  |/ / ___/ _ \/ __ \/ ___/ _ \  / /   / /    / /  
/ /_/ / ____/ /|  (__  )  __/ / / (__  )  __/ / /___/ /____/ /   
\____/_/   /_/ |_/____/\___/_/ /_/____/\___/ \____/_____/___/   

         DNS, DHCP & HAProxy Management for OPNsense
```

[![CI](https://github.com/slmingol/opnsense-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/slmingol/opnsense-cli/actions/workflows/ci.yml)
[![Release](https://github.com/slmingol/opnsense-cli/actions/workflows/release.yml/badge.svg)](https://github.com/slmingol/opnsense-cli/actions/workflows/release.yml)
[![GitHub release](https://img.shields.io/github/v/release/slmingol/opnsense-cli)](https://github.com/slmingol/opnsense-cli/releases)
[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![Docker](https://img.shields.io/badge/ghcr.io-opnsense--cli-blue?logo=docker)](https://github.com/slmingol/opnsense-cli/pkgs/container/opnsense-cli)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js&logoColor=white)](https://nodejs.org)
[![OPNsense](https://img.shields.io/badge/OPNsense-25.7%2B-D94F00?logo=opnsense&logoColor=white)](https://opnsense.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI tool to manage OPNsense via REST API. Mirrors the feature set of
[pfsense-cli](../pfsense-cli) with OPNsense-native endpoint naming, Kea DHCP
support, and the firewall savepoint/rollback safety net.

---

## Features

| Module | Commands | Notes |
|---|---|---|
| **DNS** | list, add, update, delete, alias:add, alias:delete | Unbound host overrides |
| **Firewall Rules** | fw-rule:list, add, delete, update | Automation rules only; 60s savepoint safety net |
| **Firewall Aliases** | fw-alias:list, create, add-host, remove-host, delete | Live `alias_util` updates |
| **DHCP** | dhcp:list, add, update, delete | Kea backend required |
| **Certificates** | cert:list, import, delete, check | Raw PEM import; `check` exits 1 if expiring; cron scheduling via `make cert-check-schedule` |
| **HAProxy** | haproxy:list, add, delete, route-add, route-delete, use-dns, use-ip, disable-resolver, inspect, apply, restart | Requires os-haproxy plugin |
| **WireGuard** | wg:status, wg:provision, wg:teardown | Zero-touch ProtonVPN from `.conf` file |
| **NordVPN** | nordvpn:rotate-wg, creds, servers, teardown-wg | WireGuard client rotation |
| **Config** | config:history, config:history-prune | Web-UI fallback on 26.x; see note below |
| **Bulk** | bulk:import, bulk:export | JSON + CSV; dry-run support |

✓ Idempotent — all commands check before creating  
✓ Automatic configuration apply after every change  
✓ Self-signed certificate support (`NODE_TLS_REJECT_UNAUTHORIZED=0`)  
✓ Firewall filter rules use OPNsense's savepoint/rollback (60-second safety net)

---

## Prerequisites

- **Node.js ≥ 18**
- **OPNsense 25.7 or newer** (26.x recommended — 26.7+ adds partial interface assignment API)
- OPNsense API key + secret (System → Access → Users → edit user → API Keys)
- For DHCP: Kea backend enabled (System → Settings → Administration → DHCP backend = Kea)
- For HAProxy: `os-haproxy` plugin installed

---

## Setup

```bash
git clone https://github.com/slmingol/opnsense-cli.git
cd opnsense-cli
npm install
cp .env.example .env
```

Edit `.env`:

```bash
OPNSENSE_HOST=http://opnsense-rtr1.bub.lan   # https:// once you have a valid cert
OPNSENSE_API_KEY=your-api-key-here
OPNSENSE_API_SECRET=your-api-secret-here

# Uncomment if using a self-signed certificate:
# NODE_TLS_REJECT_UNAUTHORIZED=0

# Required for WireGuard ProtonVPN provisioning:
# WG_PRIVATE_KEY=<your-wireguard-private-key>

# Required for NordVPN commands:
# NORDVPN_TOKEN=<your-nordvpn-access-token>
```

Run directly or link globally:

```bash
node cli.js list              # run directly
npm link                      # or install globally as `opnsense`
opnsense list
```

### Makefile site configuration

The Makefile uses sensible defaults for the `add-service` / `delete-service` / `list-hosts` targets. Override them without modifying the Makefile by creating a `config.mk` (gitignored):

```bash
cp config.mk.example config.mk
```

Edit `config.mk`:

```makefile
HOST_BUB         = docker-host-01-svcs   # backend host (no domain)
HOST_LAMOLABS    = lamolabs-svcs         # frontend host (no domain)
DOMAIN_BACKEND   = bub.lan              # internal DNS domain
DOMAIN_FRONTEND  = lamolabs.org         # external/HAProxy domain
HAPROXY_FRONTEND = HomePrivateServers   # HAProxy frontend name
```

---

## Usage

### Help

```bash
opnsense --help
opnsense <command> --help
```

### DNS — Unbound Host Overrides

```bash
# List all entries (with inline aliases)
opnsense list

# Filter by hostname or domain
opnsense list --filter plex

# Add
opnsense add --host plex --domain bub.lan --ip 192.168.7.50 --description "Plex server"

# Update IP
opnsense update --host plex --domain bub.lan --ip 192.168.7.51

# Delete
opnsense delete --host plex --domain bub.lan

# Add alias pointing to an existing entry
opnsense alias:add --host plex --domain bub.lan \
  --alias-host media --alias-domain bub.lan --description "Alias for Plex"

# Remove alias
opnsense alias:delete --host plex --domain bub.lan \
  --alias-host media --alias-domain bub.lan
```

### Firewall Rules

```bash
# List all automation rules
opnsense fw-rule:list

# Filter by interface or action
opnsense fw-rule:list --interface lan --type pass

# Add a rule
opnsense fw-rule:add \
  --type pass --interface lan \
  --source 192.168.7.0/24 --destination any \
  --protocol tcp --dest-port 443 \
  --description "Allow LAN to HTTPS"

# Update (enable/disable, change gateway for policy routing, etc.)
opnsense fw-rule:update --description "Allow LAN to HTTPS" --disable

# Delete by description
opnsense fw-rule:delete --description "Allow LAN to HTTPS"
```

### Firewall Aliases

```bash
# List
opnsense fw-alias:list

# Create or overwrite an alias
opnsense fw-alias:create --name trusted_hosts --type host \
  --host 192.168.7.10 --host 192.168.7.11 --description "Trusted workstations"

# Add a single IP to an existing alias (live pf table update)
opnsense fw-alias:add-host --name trusted_hosts --host 192.168.7.12

# Remove an IP
opnsense fw-alias:remove-host --name trusted_hosts --host 192.168.7.12

# Delete alias
opnsense fw-alias:delete --name trusted_hosts
```

### DHCP — Kea Static Reservations

> **Requires Kea DHCP backend.** Enable at System → Settings → Administration → DHCP backend.

```bash
# List all reservations across all subnets
opnsense dhcp:list

# Filter by interface
opnsense dhcp:list --interface lan

# Add a reservation
opnsense dhcp:add \
  --interface lan \
  --mac aa:bb:cc:dd:ee:ff \
  --ip 192.168.7.100 \
  --hostname mydevice \
  --description "Living room TV"

# Update hostname or IP
opnsense dhcp:update --interface lan --mac aa:bb:cc:dd:ee:ff --hostname newhostname

# Remove
opnsense dhcp:delete --interface lan --mac aa:bb:cc:dd:ee:ff
```

### Certificates

```bash
# List with expiry information
opnsense cert:list

# Show only certificates expiring within 60 days
opnsense cert:list --expiring 60

# Import a cert + key pair (raw PEM — not base64)
opnsense cert:import \
  --name "*.bub.lan wildcard" \
  --cert ./fullchain.pem \
  --key  ./privkey.pem

# Delete
opnsense cert:delete --name "*.bub.lan wildcard"

# Monitoring check (exits 1 if any cert expires within 30 days)
opnsense cert:check --expiring 30

# Schedule a daily cron job to run cert-check (default: 08:00)
make cert-check-schedule
make cert-check-schedule EXPIRING=60 CERT_CHECK_SCHEDULE="0 6 * * *"

# Show or remove the cron job
make cert-check-cron-status
make cert-check-unschedule
```

### HAProxy

> **Requires `os-haproxy` plugin.** Install at System → Firmware → Plugins.

```bash
# List backends
opnsense haproxy:list

# Add backend with a server
opnsense haproxy:add \
  --name plex \
  --server-name plex.bub.lan \
  --server-address plex.bub.lan \
  --server-port 32400

# Add an SSL backend
opnsense haproxy:add \
  --name vault \
  --server-name vault.bub.lan \
  --server-address vault.bub.lan \
  --server-port 8200 \
  --ssl

# Route a frontend hostname to a backend
opnsense haproxy:route-add \
  --frontend https-frontend \
  --acl plex-acl \
  --hostname plex.bub.lan \
  --backend plex

# Remove route
opnsense haproxy:route-delete --frontend https-frontend --acl plex-acl

# Delete backend
opnsense haproxy:delete --name plex

# Dry-run: show which server addresses would be converted to .bub.lan hostnames
make haproxy-use-dns

# Apply: commit the conversion (scope to one backend with NAME=)
make haproxy-use-dns APPLY=true
make haproxy-use-dns NAME=plex APPLY=true

# Dry-run: show which hostname addresses would be converted to static IPs
make haproxy-use-ip
make haproxy-use-ip NAME=plex APPLY=true

# Inspect raw backend + linked server JSON
make haproxy-inspect NAME=plex

# Apply pending HAProxy config changes
make haproxy-apply

# Restart HAProxy service
make haproxy-restart

# Clear resolver config on backend servers (dry-run by default)
make haproxy-disable-resolver
make haproxy-disable-resolver NAME=plex APPLY=true
```

### WireGuard — ProtonVPN Zero-Touch Provisioning

```bash
# Import a ProtonVPN .conf file and configure everything automatically:
# server instance, client peer, gateway, outbound NAT, kill-switch rules
opnsense wg:provision protonvpn-us-01.conf \
  --server-name ProtonVPN01 \
  --listen-port 51821 \
  --lan-subnet 192.168.7.0/24 \
  --kill-switch 1.1.1.1 \
  --kill-switch 8.8.8.8 \
  --ks-alias ProtonVPN_KillSwitch \
  --monitor-ip 1.1.1.1

# Dry-run to preview changes
opnsense wg:provision protonvpn-us-01.conf --dry-run

# Show live WireGuard status (server instances + clients + handshake info)
opnsense wg:status

# Tear down (removes rules, gateway, NAT, peer — leaves server instance)
opnsense wg:teardown --server-name ProtonVPN01

# ⚠️  Interface assignment (wg0 → WAN gateway group) must be done manually
#     in the web UI: Interfaces → Assignments
```

### NordVPN — WireGuard Client Rotation

```bash
# Fetch your nordlynx_private_key
opnsense nordvpn:creds --token $NORDVPN_TOKEN

# List recommended US servers sorted by load
opnsense nordvpn:servers --country-id 228 --limit 10

# Rotate to lowest-load server (safe to run from cron)
opnsense nordvpn:rotate-wg \
  --token $NORDVPN_TOKEN \
  --server-name NordVPNWG01 \
  --gateway-name NORDVPNWG_GW

# Force rotate even if gateway is currently down
opnsense nordvpn:rotate-wg --token $NORDVPN_TOKEN --force

# Tear down NordVPN WireGuard setup
opnsense nordvpn:teardown-wg --server-name NordVPNWG01 --delete-tunnel
```

**Cron rotation example** — add via OPNsense: System → Settings → Cron:

```
0 */6 * * *   root   /usr/local/bin/node /path/to/opnsense-cli/cli.js nordvpn:rotate-wg --token $NORDVPN_TOKEN
```

### Config History

> **Note:** OPNsense 26.x does not expose a config backup REST API. The `config:history` and `config:history-prune` commands will print the web UI URL instead.
>
> Manage config history at: **Diagnostics → Configuration History**

```bash
opnsense config:history
opnsense config:history-prune --keep-last 20
```

### Bulk Import / Export

```bash
# Export current DNS + HAProxy + frontends to JSON
opnsense bulk:export --output snapshot.json

# Preview an import without applying
opnsense bulk:import services.json --dry-run

# Apply
opnsense bulk:import services.json
```

**JSON format:**

```json
{
  "dns": [
    { "host": "plex", "domain": "bub.lan", "ip": "192.168.7.50", "description": "Plex" }
  ],
  "haproxy": [
    { "name": "plex", "server": "plex.bub.lan", "port": "32400" }
  ],
  "services": [
    { "alias": "grafana", "port": "3000", "description": "Grafana dashboards", "host_bub": "docker-host-01-svcs" }
  ]
}
```

**CSV format** — column names determine type automatically:

```csv
# DNS entries
host,domain,ip,description
plex,bub.lan,192.168.7.50,Plex server

# Services (creates DNS alias + HAProxy backend in one row)
alias,port,description
grafana,3000,Grafana dashboards
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPNSENSE_HOST` | ✓ | Base URL, e.g. `https://opnsense-rtr1.bub.lan` |
| `OPNSENSE_API_KEY` | ✓ | API key (username for HTTP Basic auth) |
| `OPNSENSE_API_SECRET` | ✓ | API secret (password for HTTP Basic auth) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | | Set to `0` to allow self-signed certificates |
| `WG_PRIVATE_KEY` | | WireGuard private key for ProtonVPN provisioning |
| `NORDVPN_TOKEN` | | NordVPN access token for `nordvpn:*` commands |

---

## Differences from pfsense-cli

| Feature | pfSense CLI | OPNsense CLI |
|---|---|---|
| Auth | `x-api-key` header | HTTP Basic (key:secret) |
| DNS API | `/api/v2/services/dns_resolver/…` | `/api/unbound/settings/…HostOverride` |
| DHCP | ISC DHCP (index-based) | Kea DHCP (UUID-based, must be enabled) |
| Cert import | base64-encoded PEM | Raw PEM (controller encodes internally) |
| Firewall rules | Numeric IDs | UUID + 60s savepoint/rollback |
| HAProxy backends | Servers embedded in backend object | Servers are standalone; linked by UUID |
| HAProxy restart | Prints GUI instructions (no API endpoint) | Real restart via `/api/haproxy/service/restart` |
| WireGuard model | Tunnels + Peers | Server instances + Clients |
| WireGuard fields | `privatekey`, `listenport` | `privkey`, `port` |
| Interface assignment | REST API | Manual (web UI) on ≤26.x |
| Optics/DDM | `/api/v2/diagnostics/command_prompt` | **Not available** (no shell exec API) |
| Cert renew | ACME + import in one step | **Not available** (ACME plugin only) |
| Config history | REST API | **Not available** (web UI only on 26.x) |

---

## Known Limitations

- **Interface assignment** — OPNsense ≤25.x has no REST API for assigning interfaces. WireGuard provisioning prints manual instructions instead. Partial API added in 26.7.
- **Config history** — No REST API in OPNsense 26.x. Commands fall back to printing the web UI URL.
- **SFP+ optics / DDM** — OPNsense has no shell-exec REST endpoint. The `optics:show` command from pfsense-cli is not implemented.
- **Certificate renewal** — ACME plugin manages renewals; no REST hook exists. Import certs manually with `cert:import` after renewal.
- **DHCP** — Requires Kea backend. ISC DHCP has no static mapping REST API on OPNsense ([issue #4062](https://github.com/opnsense/core/issues/4062)).

---

## License

[MIT](./LICENSE)
