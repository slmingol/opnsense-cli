# Alias Management Examples

DNS Resolver aliases allow multiple hostnames to resolve to the same IP address. This is useful for creating alternate names for services.

## Understanding Aliases

When you create a DNS host override entry like:
- Host: `myserver`
- Domain: `local.lan`
- IP: `192.168.1.100`

You can add aliases to create additional DNS names that resolve to the same IP:
- `www.local.lan` → `192.168.1.100`
- `api.local.lan` → `192.168.1.100`
- `mail.local.lan` → `192.168.1.100`

All these names will resolve to the same IP address as the parent entry.

## Examples

### 1. Create a service with web aliases

**Step 1: Create the main entry**
```bash
make dns-add HOST=homeserver DOMAIN=local.lan IP=192.168.1.100 DESC="Home server"
```

**Step 2: Add web-related aliases**
```bash
# Add www alias
make dns-alias-add HOST=homeserver DOMAIN=local.lan \
  ALIAS=www ALIAS_DOMAIN=local.lan \
  DESC="Web interface"

# Add api alias
make dns-alias-add HOST=homeserver DOMAIN=local.lan \
  ALIAS=api ALIAS_DOMAIN=local.lan \
  DESC="API endpoint"
```

Now all of these resolve to `192.168.1.100`:
- `homeserver.local.lan`
- `www.local.lan`
- `api.local.lan`

### 2. Multiple domain aliases

You can create aliases in different domains:

```bash
# Main entry
make dns-add HOST=nas DOMAIN=home.local IP=192.168.1.50 DESC="NAS device"

# Alias in different domain
make dns-alias-add HOST=nas DOMAIN=home.local \
  ALIAS=storage ALIAS_DOMAIN=lab.local \
  DESC="Storage alias"
```

Results:
- `nas.home.local` → `192.168.1.50`
- `storage.lab.local` → `192.168.1.50`

### 3. Service discovery pattern

Create a main server with service-specific aliases:

```bash
# Main server
make dns-add HOST=server01 DOMAIN=internal.lan IP=10.0.1.10 DESC="Application server"

# Service aliases
make dns-alias-add HOST=server01 DOMAIN=internal.lan \
  ALIAS=grafana ALIAS_DOMAIN=internal.lan DESC="Monitoring dashboard"

make dns-alias-add HOST=server01 DOMAIN=internal.lan \
  ALIAS=prometheus ALIAS_DOMAIN=internal.lan DESC="Metrics collection"

make dns-alias-add HOST=server01 DOMAIN=internal.lan \
  ALIAS=alertmanager ALIAS_DOMAIN=internal.lan DESC="Alert management"
```

### 4. View all entries with aliases

```bash
make dns-list
```

Output will show:
```
DNS Host Override Entries:
═══════════════════════════════════════════════════════════

1. server01.internal.lan
   IP: 10.0.1.10
   Description: Application server
   Aliases: grafana.internal.lan, prometheus.internal.lan, alertmanager.internal.lan

═══════════════════════════════════════════════════════════
Total: 1 entries
```

### 5. Remove an alias

If you no longer need an alias:

```bash
make dns-alias-delete HOST=server01 DOMAIN=internal.lan \
  ALIAS=alertmanager ALIAS_DOMAIN=internal.lan
```

## Using Docker Compose Directly

For more complex operations:

```bash
# Add alias with long description
docker-compose run --rm opnsense-cli alias:add \
  --host myserver \
  --domain local.lan \
  --alias-host backup \
  --alias-domain local.lan \
  --description "Backup service endpoint for redundancy"

# Delete alias
docker-compose run --rm opnsense-cli alias:delete \
  --host myserver \
  --domain local.lan \
  --alias-host backup \
  --alias-domain local.lan
```

## Common Use Cases

### Web Server
```bash
make dns-add HOST=webserver DOMAIN=home.lan IP=192.168.1.80
make dns-alias-add HOST=webserver DOMAIN=home.lan ALIAS=www ALIAS_DOMAIN=home.lan
make dns-alias-add HOST=webserver DOMAIN=home.lan ALIAS=blog ALIAS_DOMAIN=home.lan
```

### Development Environment
```bash
make dns-add HOST=dev DOMAIN=local.net IP=192.168.10.5
make dns-alias-add HOST=dev DOMAIN=local.net ALIAS=app ALIAS_DOMAIN=local.net
make dns-alias-add HOST=dev DOMAIN=local.net ALIAS=db ALIAS_DOMAIN=local.net
make dns-alias-add HOST=dev DOMAIN=local.net ALIAS=cache ALIAS_DOMAIN=local.net
```

### Load Balancer / Virtual IPs
```bash
make dns-add HOST=lb01 DOMAIN=cluster.local IP=10.0.0.100
make dns-alias-add HOST=lb01 DOMAIN=cluster.local ALIAS=web ALIAS_DOMAIN=cluster.local
make dns-alias-add HOST=lb01 DOMAIN=cluster.local ALIAS=api ALIAS_DOMAIN=cluster.local
```

## Tips

1. **Organized naming**: Use descriptive alias names for easier management
2. **Documentation**: Use the description field to explain the alias purpose
3. **Consistency**: Keep domains consistent unless you need cross-domain resolution
4. **Verification**: Always run `make dns-list` after changes to verify aliases were added correctly
