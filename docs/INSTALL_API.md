# OPNsense API Setup

The OPNsense REST API is built-in — no package installation required. You just need to create an API key for a user.

## Step 1: Create an API User (or use existing admin)

1. Log into the OPNsense web interface
2. Navigate to **System → Access → Users**
3. Click **+** to add a new user (or edit an existing one)
4. Fill in:
   - **Username**: e.g., `api-cli`
   - **Password**: set a strong password
   - **Full name**: e.g., `CLI API User`
5. Under **Privileges**, add the required privileges (or assign to the `admins` group for full access)
6. Click **Save**

## Step 2: Generate an API Key

1. Still on the user edit page, scroll down to **API keys**
2. Click **+** to generate a new key pair
3. The browser will download a `<username>.apikey.txt` file — **save this, you cannot retrieve the secret again**
4. The file contains:
   ```
   key=<your-api-key>
   secret=<your-api-secret>
   ```

## Step 3: Configure the CLI

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```bash
   OPNSENSE_HOST=http://opnsense-rtr1.bub.lan   # or https:// if you have a valid cert
   OPNSENSE_API_KEY=<key from apikey.txt>
   OPNSENSE_API_SECRET=<secret from apikey.txt>
   ```

3. If using a self-signed certificate, uncomment:
   ```bash
   NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

## Step 4: Test the Connection

```bash
make test-api
```

You should see:
```
✓ API is accessible!
```

Or test directly with curl:
```bash
curl -s -u "YOUR_KEY:YOUR_SECRET" http://opnsense-rtr1.bub.lan/api/core/firmware/status
```

## Required Privileges

For full CLI functionality, the API user needs access to:

| Feature | OPNsense Privilege |
|---|---|
| DNS (Unbound) | Services: Unbound DNS |
| HAProxy | Services: HAProxy |
| Firewall rules/aliases | Firewall: Rules, Firewall: Aliases |
| DHCP (Kea) | Services: ISC DHCPv4 (covers Kea too) |
| Certificates | System: Certificate Manager |
| WireGuard | VPN: WireGuard |
| System info | System: Firmware |

Alternatively, assign the user to the built-in `admins` group for unrestricted access.

## Troubleshooting

### "Connection refused" or "ECONNREFUSED"
- Check `OPNSENSE_HOST` — use `http://` if HTTPS is not configured
- Verify OPNsense is reachable: `ping opnsense-rtr1.bub.lan`

### "401 Unauthorized"
- Double-check your API key and secret in `.env`
- The key goes in `OPNSENSE_API_KEY`, secret in `OPNSENSE_API_SECRET`
- The CLI uses HTTP Basic auth: key = username, secret = password

### "400 Invalid JSON syntax"
- This is a known OPNsense quirk: GET requests must NOT include `Content-Type: application/json`
- The CLI handles this automatically via the axios request interceptor in `lib/opnsense.js`

### "SSL certificate problem"
- Add `NODE_TLS_REJECT_UNAUTHORIZED=0` to your `.env` file
- Or import your OPNsense certificate into your OS trust store

### API returns 404 on some endpoints
- DHCP commands require **Kea** backend enabled: System → Settings → Administration → DHCP backend
- HAProxy commands require the `os-haproxy` plugin: System → Firmware → Plugins
- Config history is not available via REST in OPNsense 26.x (web UI only)

## API Endpoints Used

```
POST /api/unbound/settings/searchHostOverride   - List DNS entries
POST /api/unbound/settings/addHostOverride       - Add DNS entry
POST /api/unbound/settings/setHostOverride/<uuid> - Update DNS entry
POST /api/unbound/settings/delHostOverride/<uuid> - Delete DNS entry
POST /api/unbound/service/reconfigure            - Apply DNS changes

POST /api/haproxy/settings/searchBackends        - List HAProxy backends
POST /api/haproxy/settings/addBackend            - Add backend
POST /api/haproxy/settings/setBackend/<uuid>     - Update backend
POST /api/haproxy/settings/delBackend/<uuid>     - Delete backend
POST /api/haproxy/service/reconfigure            - Apply HAProxy changes

POST /api/firewall/filter/searchRule             - List firewall rules
POST /api/firewall/alias/searchItem              - List firewall aliases

POST /api/kea/dhcpv4/searchReservation          - List DHCP reservations
POST /api/trust/cert/search                      - List certificates
```

## References

- [OPNsense API Documentation](https://docs.opnsense.org/development/api.html)
- [OPNsense API Core Endpoints](https://docs.opnsense.org/development/api/core/)
- [OPNsense GitHub](https://github.com/opnsense/core)
