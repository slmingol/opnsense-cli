# OPNsense CLI Setup Guide

This guide will help you set up and configure the OPNsense CLI tool.

## Prerequisites

- **Node.js 18+** (or Docker)
- **OPNsense 25.7+** (26.x recommended)
- API key + secret (see [INSTALL_API.md](INSTALL_API.md))
- For DHCP: Kea backend enabled
- For HAProxy: `os-haproxy` plugin installed

## Quick Start

```bash
git clone https://github.com/slmingol/opnsense-cli.git
cd opnsense-cli
npm install
cp .env.example .env
```

Edit `.env`:
```bash
OPNSENSE_HOST=http://opnsense-rtr1.bub.lan
OPNSENSE_API_KEY=your-api-key-here
OPNSENSE_API_SECRET=your-api-secret-here
```

Test the connection:
```bash
make test-api
```

## Running the CLI

### Directly with Node.js
```bash
node cli.js --help
node cli.js list
node cli.js haproxy:list
```

### With npm link (global install)
```bash
npm link
opnsense --help
opnsense list
```

### With Docker Compose
```bash
docker compose build
docker compose run --rm opnsense-cli --help
docker compose run --rm opnsense-cli list
```

### With Make targets
```bash
make help          # Show all available targets
make dns-list      # List DNS entries
make haproxy-list  # List HAProxy backends
make test-api      # Test API connectivity
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPNSENSE_HOST` | ✓ | — | Base URL, e.g. `http://opnsense-rtr1.bub.lan` |
| `OPNSENSE_API_KEY` | ✓ | — | API key (username for HTTP Basic auth) |
| `OPNSENSE_API_SECRET` | ✓ | — | API secret (password for HTTP Basic auth) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | | `1` | Set to `0` for self-signed certs |
| `WG_PRIVATE_KEY` | | — | WireGuard private key for ProtonVPN provisioning |
| `NORDVPN_TOKEN` | | — | NordVPN access token for `nordvpn:*` commands |
| `NODE_NO_WARNINGS` | | — | Set to `1` to suppress Node.js deprecation warnings |

## Enabling Required Features

### Kea DHCP (for dhcp:* commands)
1. System → Settings → Administration
2. Set **DHCP backend** to **Kea**
3. Save and apply

### HAProxy (for haproxy:* commands)
1. System → Firmware → Plugins
2. Search for `os-haproxy`
3. Install the plugin

### API Access
See [INSTALL_API.md](INSTALL_API.md) for creating an API user and generating keys.

## Verifying Setup

```bash
# Test API connectivity
make test-api

# List DNS entries (should show existing host overrides)
make dns-list

# List certificates
make cert-list

# Check WireGuard status
make wg-status
```

## Troubleshooting

### "ECONNREFUSED" or "ETIMEDOUT"
- Check `OPNSENSE_HOST` — use `http://` not `https://` if HTTPS is not configured
- Verify the host is reachable: `ping opnsense-rtr1.bub.lan`

### "401 Unauthorized"
- Verify API key and secret — key = `OPNSENSE_API_KEY`, secret = `OPNSENSE_API_SECRET`
- OPNsense uses HTTP Basic auth (key:secret)

### Empty DHCP results
- Kea backend must be enabled (see above)
- ISC DHCP has no REST API in OPNsense

### HAProxy 404
- Install the `os-haproxy` plugin first

### Config history commands print web UI URL
- This is expected behavior on OPNsense 26.x — no REST API for config history
- Use the web UI at Diagnostics → Configuration History
