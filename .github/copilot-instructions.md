# OPNsense CLI - Copilot Agent Instructions

## Project Overview

**OPNsense CLI** is a Docker-based Node.js CLI tool for managing DNS, DHCP, HAProxy, firewall rules/aliases, certificates, WireGuard VPN, and NordVPN via the OPNsense REST API. Mirrors [pfsense-cli](../pfsense-cli) with OPNsense-native endpoint naming.

- **Type**: CLI tool (Docker-containerized Node.js application)
- **Size**: Small (~30 source files, excluding node_modules)
- **Languages**: JavaScript (Node.js 20)
- **Runtime**: Docker + docker compose
- **Key Dependencies**: commander ^11.1.0, axios ^1.6.0, dotenv ^16.3.1
- **Package Manager**: npm
- **Current Version**: managed by semantic-release

## Architecture & Project Layout

### Directory Structure
```
/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # CI workflow (build, Docker verification)
│   │   ├── release.yml         # Release workflow (semantic-release + GHCR push)
│   │   └── cleanup-artifacts.yml
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── lib/
│   ├── dns.js                  # Unbound host overrides (CRUD, aliases)
│   ├── haproxy.js              # HAProxy backend/frontend/ACL management
│   ├── firewall.js             # Firewall rules + aliases (savepoint/rollback)
│   ├── dhcp.js                 # Kea DHCP static mappings
│   ├── cert.js                 # Certificate import/delete/check
│   ├── wireguard.js            # WireGuard server instances + clients
│   ├── nordvpn.js              # NordVPN WireGuard rotation
│   ├── config.js               # Config backup history (web UI fallback)
│   ├── bulk.js                 # Bulk import/export JSON+CSV
│   └── opnsense.js             # API client factory (axios with HTTP Basic auth)
├── cli.js                      # CLI entry point (Commander.js, 40+ commands)
├── Dockerfile                  # Node 20-alpine image
├── docker-compose.yml          # Service definition
├── Makefile                    # Convenience targets for all operations
├── package.json                # NPM config with semantic-release
├── .releaserc.json             # Semantic-release configuration
├── .env.example                # Environment template
├── assets/banner.svg           # README banner (OPNsense orange #D94F00)
├── docs/
│   ├── ALIASES.md              # DNS alias examples
│   ├── INSTALL_API.md          # OPNsense API key setup guide
│   └── SETUP.md                # Initial setup instructions
├── examples/
│   ├── bulk-dns.json           # Bulk DNS import example
│   ├── bulk-services.json      # Bulk service import example
│   └── bulk-services.csv       # Bulk service import CSV example
└── scripts/
    ├── nordvpn-wg-watchdog.sh  # NordVPN WireGuard cron watchdog (runs on router)
    ├── protonvpn-wg-watchdog.sh # ProtonVPN WireGuard cron watchdog (runs on router)
    ├── prune-config-history.sh # Config history prune cron helper
    ├── renew-wildcard-cert.sh  # acme.sh wildcard cert renewal + import
    ├── migrate-ks-to-alias.js  # One-shot kill-switch rule migration
    └── setup-alias.sh          # Shell alias setup helper
```

## OPNsense API — Critical Facts

### Authentication
- HTTP Basic auth: `Authorization: Basic base64(key:secret)`
- Environment: `OPNSENSE_API_KEY` (username), `OPNSENSE_API_SECRET` (password)
- **NOT** a bearer token or custom header — always HTTP Basic

### Endpoint Conventions
- Base URL: `OPNSENSE_HOST/api/<module>/<controller>/<command>`
- Endpoint names are **camelCase**: `searchHostOverride`, `addHostOverride`, `setHostOverride`
- Search endpoints require **POST** with bootgrid body: `{"current":1,"rowCount":-1,"searchPhrase":""}`
- **GET requests must NOT have `Content-Type: application/json`** — OPNsense returns 400
- All POSTs must have at minimum `{}` body — bodyless POSTs get 400/411

### Request Interceptor (lib/opnsense.js)
The axios client uses an interceptor that:
- Sets `Content-Type: application/json` ONLY on POST requests
- Defaults `config.data = {}` for POSTs with no body

### Key Endpoints by Module
| Module | Controller | Example Commands |
|---|---|---|
| DNS | `unbound/settings` | `searchHostOverride`, `addHostOverride`, `setHostOverride/<uuid>`, `delHostOverride/<uuid>` |
| DNS Aliases | `unbound/settings` | `searchHostAlias`, `addHostAlias`, `delHostAlias/<uuid>` |
| Firewall Rules | `firewall/filter` | `searchRule`, `addRule`, `setRule/<uuid>`, `delRule/<uuid>` |
| Firewall Aliases | `firewall/alias` | `searchItem`, `addItem`, `setItem/<uuid>`, `delItem/<uuid>` |
| HAProxy | `haproxy/settings` | `searchBackends`, `addBackend`, `setBackend/<uuid>`, `delBackend/<uuid>` |
| Kea DHCP | `kea/dhcpv4` | `search_subnet`, `searchReservation`, `addReservation`, `delReservation/<uuid>` |
| Certificates | `trust/cert` | `search`, `add`, `del/<uuid>` |
| WireGuard | `wireguard/server` + `wireguard/client` | `searchServer`, `addServer`, `searchClient`, `addClient` |
| Unbound reconfigure | `unbound/service` | `reconfigure` |
| HAProxy apply | `haproxy/service` | `reconfigure` |

### Known Limitations
- **Config backup history**: No REST API in OPNsense 26.x — commands print web UI URL instead
- **DHCP**: Requires Kea backend; ISC DHCP has no static mapping API (GitHub issue #4062)
- **Interface assignment**: No REST API for WireGuard interface assignment in ≤25.x (26.7+ partial)
- **SFP+ optics/DDM**: No shell-exec REST endpoint in OPNsense — `optics:show` not implemented
- **Cert renewal**: ACME plugin manages renewals; no REST hook exists
- **`valid_to` field**: Returns string Unix timestamp (e.g., `"1778877450"`) — use `Number(ts) * 1000`

## Build & Development Workflow

### Prerequisites
- Docker and docker compose installed (use `docker compose`, not `docker-compose`)
- Node.js 20+ (for local development without Docker)
- `.env` file must exist (copy from `.env.example`)

### Critical Setup Step (REQUIRED)
```bash
cp .env.example .env
# Edit .env with your OPNsense credentials:
# OPNSENSE_HOST=http://opnsense-rtr1.bub.lan
# OPNSENSE_API_KEY=your-key
# OPNSENSE_API_SECRET=your-secret
```

**Why this matters**: The `.env` file is gitignored but required by docker-compose. CI workflow includes `cp .env.example .env`. Without this, Docker build fails with "env file not found".

### Build Commands

1. **Install Node.js Dependencies**:
   ```bash
   npm ci
   ```

2. **Build Docker Image**:
   ```bash
   docker compose build
   ```

3. **Verify Build**:
   ```bash
   docker compose run --rm opnsense-cli --version
   ```

4. **Make Targets** (preferred interface):
   ```bash
   make help              # DEFAULT target — shows all available commands
   make build             # Alias for docker compose build
   make cli-help          # Show CLI --help output
   make test-api          # Test OPNsense API connectivity
   ```

### Testing

**IMPORTANT**: This project has NO test suite. `npm test --if-present` gracefully skips.

- Testing is manual via `make test-api` (requires live OPNsense instance at `opnsense-rtr1.bub.lan`)
- Always verify changes with: `make dns-list` or `make haproxy-list`

### Development Iteration

Code changes are reflected immediately without rebuilding (volume mount):
```bash
# Edit lib/dns.js, lib/haproxy.js, or cli.js
# Then immediately test:
docker compose run --rm opnsense-cli list
# Only rebuild if changing package.json dependencies:
docker compose build
```

## Version Control & Release Process

### Commit Message Convention (STRICTLY ENFORCED)

**Format**: `<type>(<scope>): <subject>`

**Types that trigger releases**:
- `feat`: New feature → **minor** version bump (1.0.0 → 1.1.0)
- `fix`: Bug fix → **patch** version bump (1.0.0 → 1.0.1)
- `docs`: Documentation → **patch** version bump
- `perf`: Performance → **patch** version bump
- `refactor`: Code refactoring → **patch** version bump

**Types that DON'T trigger releases**:
- `chore`, `test`, `build`, `ci` → No version bump

**Breaking changes**: Add `!` after type or include `BREAKING CHANGE:` in footer → **major** version bump

**Examples**:
```bash
feat(dns): add IPv6 support              # → 1.1.0
fix(haproxy): prevent duplicate routes   # → 1.0.1
docs: update README examples             # → 1.0.1
chore: update dependencies               # → No release
feat(api)!: migrate to v3 endpoints      # → 2.0.0 (breaking)
```

### CI/CD Workflows

#### CI Workflow (`.github/workflows/ci.yml`)
- **Triggers**: Push/PR to `main` or `develop`
- **Steps**: `npm ci` → `cp .env.example .env` → `docker compose build` → verify version
- **Duration**: ~1-2 minutes

#### Release Workflow (`.github/workflows/release.yml`)
- **Triggers**: Push to `main` only
- **Process**: `npm ci` → Docker login (GHCR) → `npx semantic-release` → build + push Docker image
- **GHCR image**: `ghcr.io/slmingol/opnsense-cli:latest` and `:X.Y.Z`
- **Actions**: Analyzes commits, bumps version, updates `package.json` + `CHANGELOG.md`, creates git tag + GitHub release, pushes Docker image
- **Duration**: ~1-2 minutes

### Making Changes — Complete Workflow

1. **Create feature branch**:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make changes** in `lib/`, `cli.js`, or docs

3. **Test locally**:
   ```bash
   cp .env.example .env  # If not already done
   docker compose build
   make test-api
   make dns-list
   ```

4. **Commit with conventional format**:
   ```bash
   git commit -m "feat(dns): add support for DNS64"
   ```

5. **Push and create PR**:
   ```bash
   git push origin feat/my-feature
   ```

6. **Merge to main** → Release workflow triggers → Automatic versioning + GHCR push

## Common Pitfalls & Solutions

### 1. "400 Invalid JSON syntax" on GET requests
**Problem**: Sending `Content-Type: application/json` header on GET — OPNsense parses body
**Solution**: `lib/opnsense.js` request interceptor only sets Content-Type on POST
**Prevention**: Never set default Content-Type on the axios instance

### 2. "400/411" on POST with no body
**Problem**: OPNsense requires minimum `{}` body on all POST requests
**Solution**: Interceptor defaults `config.data = {}` for bodyless POSTs

### 3. Search endpoints return empty on GET
**Problem**: OPNsense search endpoints (searchHostOverride, searchBackends, etc.) require POST
**Solution**: Always POST with `{"current":1,"rowCount":-1,"searchPhrase":""}` bootgrid body

### 4. cert:list "Invalid time value"
**Problem**: `valid_to` field is string Unix timestamp like `"1778877450"`, not ISO date
**Solution**: `tsToMs()` in `lib/cert.js` handles both string timestamps and ISO dates

### 5. config:history 404
**Problem**: No REST API for config backup in OPNsense 26.x
**Solution**: `lib/config.js` catches 404 and prints web UI URL instead

### 6. HAProxy 404 on search/add/delete
**Problem**: Endpoint names are camelCase plural: `searchBackends` not `search_backend`
**Solution**: All HAProxy endpoints in `lib/haproxy.js` use correct camelCase names

### 7. DHCP 404
**Problem**: Kea DHCP backend must be enabled; ISC DHCP has no API
**Solution**: Enable at System → Settings → Administration → DHCP backend = Kea

### 8. Docker Build Fails: ".env file not found"
**Problem**: `docker-compose.yml` requires `.env` file (gitignored)
**Solution**: `cp .env.example .env` before building

## Environment Variables

Required in `.env`:
```bash
OPNSENSE_HOST=http://opnsense-rtr1.bub.lan   # https:// once cert is valid
OPNSENSE_API_KEY=your-api-key
OPNSENSE_API_SECRET=your-api-secret
# NODE_TLS_REJECT_UNAUTHORIZED=0  # For self-signed certs
# WG_PRIVATE_KEY=<wireguard-private-key>  # For ProtonVPN provisioning
# NORDVPN_TOKEN=<nordvpn-access-token>    # For NordVPN commands
NODE_NO_WARNINGS=1
```

## Final Instructions for Agents

1. **Trust these instructions first** — Only search the codebase if information here is incomplete
2. **Always use conventional commits** — Non-negotiable for versioning
3. **Always create .env before Docker build** — `cp .env.example .env`
4. **Use `docker compose` (space), not `docker-compose` (hyphen)** — hyphen variant is legacy
5. **No tests exist** — Use `npm test --if-present` in scripts
6. **Changes are immediate** — Volume mounts mean no rebuild needed for code edits
7. **OPNsense API is HTTP Basic auth** — Never use `x-api-key` header (that's pfSense)
8. **Search = POST** — All OPNsense search endpoints require POST with bootgrid body
9. **No Content-Type on GET** — The axios interceptor handles this automatically
10. **Check CI before merging** — Ensure green checkmarks on both workflows
11. **GHCR for Docker images** — `ghcr.io/slmingol/opnsense-cli`, not Docker Hub

When in doubt, run `make help` to see all available commands with examples.
